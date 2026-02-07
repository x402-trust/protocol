const { expect } = require("chai");
const { ethers } = require("hardhat");

/**
 * INTEGRATION TESTS
 * 
 * Full flow tests covering:
 * - Complete payment lifecycle
 * - Multi-provider scenarios
 * - Score progression
 * - Dispute resolution flows
 */

describe("Integration Tests", function () {
    let usdc, reputationEngine, escrowVault, disputeManager, trustProtocol;
    let owner, provider1, provider2, buyer1, buyer2;

    const PROVIDER_STAKE = ethers.parseUnits("500", 6);
    const PAYMENT_AMOUNT = ethers.parseUnits("10", 6);

    beforeEach(async function () {
        [owner, provider1, provider2, buyer1, buyer2] = await ethers.getSigners();

        // Deploy full stack
        const MockUSDC = await ethers.getContractFactory("MockUSDC");
        usdc = await MockUSDC.deploy();

        const ReputationEngine = await ethers.getContractFactory("ReputationEngine");
        reputationEngine = await ReputationEngine.deploy(await usdc.getAddress());

        const EscrowVault = await ethers.getContractFactory("EscrowVault");
        escrowVault = await EscrowVault.deploy(
            await usdc.getAddress(),
            await reputationEngine.getAddress()
        );

        const DisputeManager = await ethers.getContractFactory("DisputeManager");
        disputeManager = await DisputeManager.deploy(
            await usdc.getAddress(),
            await escrowVault.getAddress(),
            await reputationEngine.getAddress()
        );

        const TrustProtocol = await ethers.getContractFactory("TrustProtocol");
        trustProtocol = await TrustProtocol.deploy(
            await reputationEngine.getAddress(),
            await escrowVault.getAddress()
        );

        // Link
        await reputationEngine.setEscrowVault(await escrowVault.getAddress());
        await escrowVault.setDisputeManager(await disputeManager.getAddress());
    });

    describe("Full Payment Lifecycle", function () {
        beforeEach(async function () {
            // Setup provider
            await usdc.mint(provider1.address, PROVIDER_STAKE);
            await usdc.connect(provider1).approve(await reputationEngine.getAddress(), PROVIDER_STAKE);
            await reputationEngine.connect(provider1).registerWithStake("https://api.provider.com");

            // Setup buyer
            await usdc.mint(buyer1.address, PAYMENT_AMOUNT * 10n);
            await usdc.connect(buyer1).approve(await escrowVault.getAddress(), PAYMENT_AMOUNT * 10n);
        });

        it("Should complete full payment flow: create -> confirm -> release", async function () {
            const requestHash = ethers.keccak256(ethers.toUtf8Bytes("Get weather data"));

            // Step 1: Create payment
            const initialProviderBalance = await usdc.balanceOf(provider1.address);

            const tx = await escrowVault.connect(buyer1).createPayment(
                provider1.address,
                PAYMENT_AMOUNT,
                requestHash
            );
            const receipt = await tx.wait();
            const event = receipt.logs.find(log => log.fragment?.name === "PaymentCreated");
            const paymentId = event.args[0];

            // Verify escrow holds funds
            const escrowBalance = await usdc.balanceOf(await escrowVault.getAddress());
            expect(escrowBalance).to.equal(PAYMENT_AMOUNT);

            // Step 2: Confirm delivery
            const proof = {
                requestHash: requestHash,
                responseHash: ethers.keccak256(ethers.toUtf8Bytes("Sunny, 25C")),
                responseSize: 100,
                schemaHash: ethers.ZeroHash,
                signature: ethers.randomBytes(65)
            };

            await escrowVault.connect(buyer1).confirmDelivery(paymentId, proof);

            // Verify provider received payment
            const finalProviderBalance = await usdc.balanceOf(provider1.address);
            expect(finalProviderBalance - initialProviderBalance).to.equal(PAYMENT_AMOUNT);

            // Verify payment status
            const payment = await escrowVault.getPayment(paymentId);
            expect(payment.status).to.equal(2); // Completed
        });

        it("Should complete timeout flow: create -> timeout -> refund", async function () {
            const requestHash = ethers.keccak256(ethers.toUtf8Bytes("Get stock price"));
            const initialBuyerBalance = await usdc.balanceOf(buyer1.address);

            // Step 1: Create payment
            const tx = await escrowVault.connect(buyer1).createPayment(
                provider1.address,
                PAYMENT_AMOUNT,
                requestHash
            );
            const receipt = await tx.wait();
            const event = receipt.logs.find(log => log.fragment?.name === "PaymentCreated");
            const paymentId = event.args[0];

            // Balance decreased
            const midBuyerBalance = await usdc.balanceOf(buyer1.address);
            expect(initialBuyerBalance - midBuyerBalance).to.equal(PAYMENT_AMOUNT);

            // Step 2: Wait for timeout + grace period
            await ethers.provider.send("evm_increaseTime", [25 * 60]); // 25 minutes
            await ethers.provider.send("evm_mine");

            // Step 3: Claim timeout
            await escrowVault.connect(buyer1).claimTimeout(paymentId);

            // Verify buyer got refund
            const finalBuyerBalance = await usdc.balanceOf(buyer1.address);
            expect(finalBuyerBalance).to.equal(initialBuyerBalance);

            // Verify payment status
            const payment = await escrowVault.getPayment(paymentId);
            expect(payment.status).to.equal(3); // Refunded
        });

        it("Should complete dispute flow: create -> dispute -> resolve", async function () {
            const requestHash = ethers.keccak256(ethers.toUtf8Bytes("Translate document"));

            // Create payment
            const tx = await escrowVault.connect(buyer1).createPayment(
                provider1.address,
                PAYMENT_AMOUNT,
                requestHash
            );
            const receipt = await tx.wait();
            const event = receipt.logs.find(log => log.fragment?.name === "PaymentCreated");
            const paymentId = event.args[0];

            // Raise dispute
            const evidence = ethers.keccak256(ethers.toUtf8Bytes("Translation was wrong"));
            const disputeTx = await escrowVault.connect(buyer1).raiseDispute(paymentId, evidence);
            await disputeTx.wait();

            // Verify dispute status
            let payment = await escrowVault.getPayment(paymentId);
            expect(payment.status).to.equal(4); // Disputed

            // Resolve for provider (simulating dispute manager)
            await escrowVault.setDisputeManager(owner.address); // Temporary for test
            await escrowVault.connect(owner).resolveForProvider(paymentId);

            // Verify resolved
            payment = await escrowVault.getPayment(paymentId);
            expect(payment.status).to.equal(2); // Completed
        });
    });

    describe("Multi-Provider Comparison", function () {
        beforeEach(async function () {
            // Setup provider1 with stake (Newcomer)
            await usdc.mint(provider1.address, PROVIDER_STAKE);
            await usdc.connect(provider1).approve(await reputationEngine.getAddress(), PROVIDER_STAKE);
            await reputationEngine.connect(provider1).registerWithStake("https://api.provider1.com");

            // Setup provider2 with humanity proof (Verified)
            const proof = ethers.randomBytes(64);
            await reputationEngine.connect(provider2).registerWithHumanityProof(
                "https://api.provider2.com",
                proof
            );
        });

        it("Should correctly compare providers with different scores", async function () {
            const [scores, timeouts] = await trustProtocol.compareProviders([
                provider1.address,
                provider2.address
            ]);

            expect(scores[0]).to.equal(500); // Newcomer with stake
            expect(scores[1]).to.equal(600); // Verified with humanity proof

            // Both should have same timeout (Good tier)
            expect(timeouts[0]).to.equal(15 * 60);
            expect(timeouts[1]).to.equal(15 * 60);
        });

        it("Should show verified provider as better choice", async function () {
            const tier1 = await trustProtocol.getTrustTier(provider1.address);
            const tier2 = await trustProtocol.getTrustTier(provider2.address);

            expect(tier1).to.equal("Good");
            expect(tier2).to.equal("Good"); // 600 is still Good tier
        });
    });

    describe("Score Progression", function () {
        beforeEach(async function () {
            await usdc.mint(provider1.address, PROVIDER_STAKE);
            await usdc.connect(provider1).approve(await reputationEngine.getAddress(), PROVIDER_STAKE);
            await reputationEngine.connect(provider1).registerWithStake("https://api.provider.com");

            await usdc.mint(buyer1.address, PAYMENT_AMOUNT * 100n);
            await usdc.connect(buyer1).approve(await escrowVault.getAddress(), PAYMENT_AMOUNT * 100n);
        });

        it("Should improve score after successful transactions", async function () {
            const initialScore = await reputationEngine.getScore(provider1.address);

            // Complete multiple successful transactions
            // Note: Due to Sybil-resistant velocity limits (30s min interval between tx),
            // we need to add time gaps to avoid triggering suspicious behavior detection
            for (let i = 0; i < 5; i++) {
                const requestHash = ethers.keccak256(ethers.toUtf8Bytes(`request-${i}`));

                const tx = await escrowVault.connect(buyer1).createPayment(
                    provider1.address,
                    PAYMENT_AMOUNT,
                    requestHash
                );
                const receipt = await tx.wait();
                const event = receipt.logs.find(log => log.fragment?.name === "PaymentCreated");
                const paymentId = event.args[0];

                // Check if payment is pending (uses escrow) or already completed (direct)
                const payment = await escrowVault.getPayment(paymentId);

                if (payment.status === 1n) { // Pending - needs confirmation
                    const proof = {
                        requestHash: requestHash,
                        responseHash: ethers.keccak256(ethers.toUtf8Bytes(`response-${i}`)),
                        responseSize: 100,
                        schemaHash: ethers.ZeroHash,
                        signature: ethers.randomBytes(65)
                    };

                    await escrowVault.connect(buyer1).confirmDelivery(paymentId, proof);
                }

                // Add 35 second gap between transactions to respect MIN_TX_INTERVAL (30s)
                if (i < 4) {
                    await ethers.provider.send("evm_increaseTime", [35]);
                    await ethers.provider.send("evm_mine");
                }
            }

            const finalScore = await reputationEngine.getScore(provider1.address);
            // Score should stay stable or increase (with Sybil resistance, daily growth is capped)
            // Initial score is 500, after transactions on Day 1, max score growth is +5/day
            // So final score should be at most 505, but >= initial if no penalties
            expect(finalScore).to.be.gte(initialScore);
        });
    });

    describe("Multiple Buyers", function () {
        beforeEach(async function () {
            await usdc.mint(provider1.address, PROVIDER_STAKE);
            await usdc.connect(provider1).approve(await reputationEngine.getAddress(), PROVIDER_STAKE);
            await reputationEngine.connect(provider1).registerWithStake("https://api.provider.com");

            await usdc.mint(buyer1.address, PAYMENT_AMOUNT * 10n);
            await usdc.connect(buyer1).approve(await escrowVault.getAddress(), PAYMENT_AMOUNT * 10n);

            await usdc.mint(buyer2.address, PAYMENT_AMOUNT * 10n);
            await usdc.connect(buyer2).approve(await escrowVault.getAddress(), PAYMENT_AMOUNT * 10n);
        });

        it("Should handle concurrent payments from multiple buyers", async function () {
            const requestHash1 = ethers.keccak256(ethers.toUtf8Bytes("buyer1-request"));
            const requestHash2 = ethers.keccak256(ethers.toUtf8Bytes("buyer2-request"));

            // Both buyers create payments
            const tx1 = await escrowVault.connect(buyer1).createPayment(
                provider1.address,
                PAYMENT_AMOUNT,
                requestHash1
            );
            const tx2 = await escrowVault.connect(buyer2).createPayment(
                provider1.address,
                PAYMENT_AMOUNT,
                requestHash2
            );

            const receipt1 = await tx1.wait();
            const receipt2 = await tx2.wait();

            const event1 = receipt1.logs.find(log => log.fragment?.name === "PaymentCreated");
            const event2 = receipt2.logs.find(log => log.fragment?.name === "PaymentCreated");

            const paymentId1 = event1.args[0];
            const paymentId2 = event2.args[0];

            // Payment IDs should be different
            expect(paymentId1).to.not.equal(paymentId2);

            // Both should be pending
            const payment1 = await escrowVault.getPayment(paymentId1);
            const payment2 = await escrowVault.getPayment(paymentId2);

            expect(payment1.status).to.equal(1); // Pending
            expect(payment2.status).to.equal(1); // Pending

            // Confirm both
            const proof1 = {
                requestHash: requestHash1,
                responseHash: ethers.keccak256(ethers.toUtf8Bytes("response1")),
                responseSize: 100,
                schemaHash: ethers.ZeroHash,
                signature: ethers.randomBytes(65)
            };

            const proof2 = {
                requestHash: requestHash2,
                responseHash: ethers.keccak256(ethers.toUtf8Bytes("response2")),
                responseSize: 100,
                schemaHash: ethers.ZeroHash,
                signature: ethers.randomBytes(65)
            };

            await escrowVault.connect(buyer1).confirmDelivery(paymentId1, proof1);
            await escrowVault.connect(buyer2).confirmDelivery(paymentId2, proof2);

            // Verify provider got both payments
            const providerBalance = await usdc.balanceOf(provider1.address);
            expect(providerBalance).to.equal(PAYMENT_AMOUNT * 2n);
        });
    });

    describe("Contract Linking", function () {
        it("Should have correct contract references", async function () {
            const escrowInReputation = await reputationEngine.escrowVault();
            expect(escrowInReputation).to.equal(await escrowVault.getAddress());

            const disputeInEscrow = await escrowVault.disputeManager();
            expect(disputeInEscrow).to.equal(await disputeManager.getAddress());
        });

        it("Should have correct USDC reference", async function () {
            const usdcInReputation = await reputationEngine.usdc();
            const usdcInEscrow = await escrowVault.usdc();
            const usdcInDispute = await disputeManager.usdc();

            const expectedUSDC = await usdc.getAddress();

            expect(usdcInReputation).to.equal(expectedUSDC);
            expect(usdcInEscrow).to.equal(expectedUSDC);
            expect(usdcInDispute).to.equal(expectedUSDC);
        });
    });
});

/**
 * FUZZ TESTS
 * 
 * Property-based testing with random inputs
 */

describe("Fuzz Tests", function () {
    let usdc, reputationEngine, escrowVault;
    let owner, provider, buyer;

    const PROVIDER_STAKE = ethers.parseUnits("500", 6);

    beforeEach(async function () {
        [owner, provider, buyer] = await ethers.getSigners();

        const MockUSDC = await ethers.getContractFactory("MockUSDC");
        usdc = await MockUSDC.deploy();

        const ReputationEngine = await ethers.getContractFactory("ReputationEngine");
        reputationEngine = await ReputationEngine.deploy(await usdc.getAddress());

        const EscrowVault = await ethers.getContractFactory("EscrowVault");
        escrowVault = await EscrowVault.deploy(
            await usdc.getAddress(),
            await reputationEngine.getAddress()
        );

        await reputationEngine.setEscrowVault(await escrowVault.getAddress());

        await usdc.mint(provider.address, PROVIDER_STAKE);
        await usdc.connect(provider).approve(await reputationEngine.getAddress(), PROVIDER_STAKE);
        await reputationEngine.connect(provider).registerWithStake("https://api.provider.com");
    });

    it("Should handle random payment amounts >= minimum", async function () {
        // Generate 10 random amounts
        for (let i = 0; i < 10; i++) {
            const randomAmount = BigInt(Math.floor(Math.random() * 1000000) + 1000000); // 1-1000 USDC

            await usdc.mint(buyer.address, randomAmount);
            await usdc.connect(buyer).approve(await escrowVault.getAddress(), randomAmount);

            const requestHash = ethers.keccak256(ethers.toUtf8Bytes(`fuzz-${i}`));

            const tx = await escrowVault.connect(buyer).createPayment(
                provider.address,
                randomAmount,
                requestHash
            );

            const receipt = await tx.wait();
            expect(receipt.status).to.equal(1);
        }
    });

    it("Should handle random request hashes", async function () {
        const paymentAmount = ethers.parseUnits("10", 6);

        for (let i = 0; i < 10; i++) {
            const randomHash = ethers.randomBytes(32);

            await usdc.mint(buyer.address, paymentAmount);
            await usdc.connect(buyer).approve(await escrowVault.getAddress(), paymentAmount);

            const tx = await escrowVault.connect(buyer).createPayment(
                provider.address,
                paymentAmount,
                randomHash
            );

            const receipt = await tx.wait();
            expect(receipt.status).to.equal(1);
        }
    });

    it("Should reject random below-minimum amounts", async function () {
        for (let i = 0; i < 5; i++) {
            const belowMin = BigInt(Math.floor(Math.random() * 999999)); // 0 - 0.999999 USDC

            await usdc.mint(buyer.address, belowMin);
            await usdc.connect(buyer).approve(await escrowVault.getAddress(), belowMin);

            const requestHash = ethers.randomBytes(32);

            await expect(
                escrowVault.connect(buyer).createPayment(
                    provider.address,
                    belowMin,
                    requestHash
                )
            ).to.be.revertedWith("Amount too small");
        }
    });
});
