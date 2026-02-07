const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("EscrowVault", function () {
    let usdc, reputationEngine, escrowVault;
    let owner, provider, buyer;

    const PROVIDER_STAKE = ethers.parseUnits("500", 6);
    const PAYMENT_AMOUNT = ethers.parseUnits("10", 6); // 10 USDC

    beforeEach(async function () {
        [owner, provider, buyer] = await ethers.getSigners();

        // Deploy MockUSDC
        const MockUSDC = await ethers.getContractFactory("MockUSDC");
        usdc = await MockUSDC.deploy();

        // Deploy ReputationEngine
        const ReputationEngine = await ethers.getContractFactory("ReputationEngine");
        reputationEngine = await ReputationEngine.deploy(await usdc.getAddress());

        // Deploy EscrowVault
        const EscrowVault = await ethers.getContractFactory("EscrowVault");
        escrowVault = await EscrowVault.deploy(
            await usdc.getAddress(),
            await reputationEngine.getAddress()
        );

        // Link contracts
        await reputationEngine.setEscrowVault(await escrowVault.getAddress());

        // Setup provider
        await usdc.mint(provider.address, PROVIDER_STAKE);
        await usdc.connect(provider).approve(await reputationEngine.getAddress(), PROVIDER_STAKE);
        await reputationEngine.connect(provider).registerWithStake("https://api.provider.com");

        // Setup buyer with USDC
        await usdc.mint(buyer.address, PAYMENT_AMOUNT * 10n);
        await usdc.connect(buyer).approve(await escrowVault.getAddress(), PAYMENT_AMOUNT * 10n);
    });

    describe("Payment Creation", function () {
        it("Should create a payment with escrow", async function () {
            const requestHash = ethers.keccak256(ethers.toUtf8Bytes("Get BTC price"));

            const tx = await escrowVault.connect(buyer).createPayment(
                provider.address,
                PAYMENT_AMOUNT,
                requestHash
            );

            const receipt = await tx.wait();
            const event = receipt.logs.find(
                log => log.fragment?.name === "PaymentCreated"
            );

            expect(event).to.not.be.undefined;

            // Check buyer's USDC was transferred
            const escrowBalance = await usdc.balanceOf(await escrowVault.getAddress());
            expect(escrowBalance).to.equal(PAYMENT_AMOUNT);
        });

        it("Should reject payment to unregistered provider", async function () {
            const [, , , unregistered] = await ethers.getSigners();
            const requestHash = ethers.keccak256(ethers.toUtf8Bytes("test"));

            await expect(
                escrowVault.connect(buyer).createPayment(
                    unregistered.address,
                    PAYMENT_AMOUNT,
                    requestHash
                )
            ).to.be.revertedWith("Provider not active");
        });

        it("Should reject payment below minimum", async function () {
            const requestHash = ethers.keccak256(ethers.toUtf8Bytes("test"));
            const tooSmall = ethers.parseUnits("0.5", 6); // 0.5 USDC

            await expect(
                escrowVault.connect(buyer).createPayment(
                    provider.address,
                    tooSmall,
                    requestHash
                )
            ).to.be.revertedWith("Amount too small");
        });
    });

    describe("Payment Confirmation", function () {
        let paymentId;
        const requestHash = ethers.keccak256(ethers.toUtf8Bytes("Get BTC price"));

        beforeEach(async function () {
            const tx = await escrowVault.connect(buyer).createPayment(
                provider.address,
                PAYMENT_AMOUNT,
                requestHash
            );
            const receipt = await tx.wait();

            // Extract paymentId from event
            const event = receipt.logs.find(
                log => log.fragment?.name === "PaymentCreated"
            );
            paymentId = event.args[0];
        });

        it("Should release payment on confirmation", async function () {
            const proof = {
                requestHash: requestHash,
                responseHash: ethers.keccak256(ethers.toUtf8Bytes("BTC: $50000")),
                responseSize: 100,
                schemaHash: ethers.ZeroHash,
                signature: ethers.randomBytes(65) // Mock signature
            };

            const providerBalanceBefore = await usdc.balanceOf(provider.address);

            await escrowVault.connect(buyer).confirmDelivery(paymentId, proof);

            const providerBalanceAfter = await usdc.balanceOf(provider.address);
            expect(providerBalanceAfter - providerBalanceBefore).to.equal(PAYMENT_AMOUNT);

            // Check payment status
            const payment = await escrowVault.getPayment(paymentId);
            expect(payment.status).to.equal(2); // Completed
        });

        it("Should reject confirmation from non-buyer", async function () {
            const proof = {
                requestHash: requestHash,
                responseHash: ethers.keccak256(ethers.toUtf8Bytes("BTC: $50000")),
                responseSize: 100,
                schemaHash: ethers.ZeroHash,
                signature: ethers.randomBytes(65)
            };

            await expect(
                escrowVault.connect(provider).confirmDelivery(paymentId, proof)
            ).to.be.revertedWith("Only buyer");
        });

        it("Should reject invalid proof", async function () {
            const proof = {
                requestHash: ethers.keccak256(ethers.toUtf8Bytes("wrong")), // Wrong hash
                responseHash: ethers.keccak256(ethers.toUtf8Bytes("BTC: $50000")),
                responseSize: 100,
                schemaHash: ethers.ZeroHash,
                signature: ethers.randomBytes(65)
            };

            await expect(
                escrowVault.connect(buyer).confirmDelivery(paymentId, proof)
            ).to.be.revertedWith("Invalid proof");
        });
    });

    describe("Timeout Claims", function () {
        let paymentId;
        const requestHash = ethers.keccak256(ethers.toUtf8Bytes("Get BTC price"));

        beforeEach(async function () {
            const tx = await escrowVault.connect(buyer).createPayment(
                provider.address,
                PAYMENT_AMOUNT,
                requestHash
            );
            const receipt = await tx.wait();
            const event = receipt.logs.find(
                log => log.fragment?.name === "PaymentCreated"
            );
            paymentId = event.args[0];
        });

        it("Should reject early timeout claim", async function () {
            await expect(
                escrowVault.connect(buyer).claimTimeout(paymentId)
            ).to.be.revertedWith("Not timed out");
        });

        it("Should allow timeout claim after deadline", async function () {
            // Fast forward time past timeout + grace period
            await ethers.provider.send("evm_increaseTime", [25 * 60]); // 25 minutes
            await ethers.provider.send("evm_mine");

            const buyerBalanceBefore = await usdc.balanceOf(buyer.address);

            await escrowVault.connect(buyer).claimTimeout(paymentId);

            const buyerBalanceAfter = await usdc.balanceOf(buyer.address);
            expect(buyerBalanceAfter - buyerBalanceBefore).to.equal(PAYMENT_AMOUNT);

            // Check payment status
            const payment = await escrowVault.getPayment(paymentId);
            expect(payment.status).to.equal(3); // Refunded
        });
    });

    describe("Dispute Raising", function () {
        let paymentId;
        const requestHash = ethers.keccak256(ethers.toUtf8Bytes("Get BTC price"));

        beforeEach(async function () {
            const tx = await escrowVault.connect(buyer).createPayment(
                provider.address,
                PAYMENT_AMOUNT,
                requestHash
            );
            const receipt = await tx.wait();
            const event = receipt.logs.find(
                log => log.fragment?.name === "PaymentCreated"
            );
            paymentId = event.args[0];
        });

        it("Should allow buyer to raise dispute", async function () {
            const evidence = ethers.keccak256(ethers.toUtf8Bytes("No response received"));

            const tx = await escrowVault.connect(buyer).raiseDispute(paymentId, evidence);
            const receipt = await tx.wait();

            const event = receipt.logs.find(
                log => log.fragment?.name === "DisputeRaised"
            );
            expect(event).to.not.be.undefined;

            // Check payment status
            const payment = await escrowVault.getPayment(paymentId);
            expect(payment.status).to.equal(4); // Disputed
        });

        it("Should reject dispute from non-buyer", async function () {
            const evidence = ethers.keccak256(ethers.toUtf8Bytes("evidence"));

            await expect(
                escrowVault.connect(provider).raiseDispute(paymentId, evidence)
            ).to.be.revertedWith("Only buyer");
        });
    });

    describe("Human Fallback", function () {
        let paymentId;
        const requestHash = ethers.keccak256(ethers.toUtf8Bytes("Get BTC price"));

        beforeEach(async function () {
            const tx = await escrowVault.connect(buyer).createPayment(
                provider.address,
                PAYMENT_AMOUNT,
                requestHash
            );
            const receipt = await tx.wait();
            const event = receipt.logs.find(
                log => log.fragment?.name === "PaymentCreated"
            );
            paymentId = event.args[0];
        });

        it("Should allow buyer to set human fallback", async function () {
            const [, , , human] = await ethers.getSigners();

            await escrowVault.connect(buyer).setHumanFallback(paymentId, human.address);

            const fallback = await escrowVault.humanFallback(paymentId);
            expect(fallback).to.equal(human.address);
        });
    });
});
