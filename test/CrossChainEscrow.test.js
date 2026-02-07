const { expect } = require("chai");
const { ethers } = require("hardhat");

/**
 * CROSS-CHAIN ESCROW (CCTP) TESTS
 * 
 * Tests for cross-chain payment functionality:
 * - Payment creation
 * - Cross-chain confirmation
 * - Timeout refunds
 * - Fee calculation
 * - Domain support
 */

describe("CrossChainEscrow", function () {
    let usdc, crossChainEscrow;
    let owner, buyer, provider, feeRecipient;

    const PAYMENT_AMOUNT = ethers.parseUnits("100", 6);

    // Mock addresses for CCTP (these would be real on mainnet)
    const MOCK_TOKEN_MESSENGER = "0x0000000000000000000000000000000000000001";
    const MOCK_MESSAGE_TRANSMITTER = "0x0000000000000000000000000000000000000002";
    const LOCAL_DOMAIN = 6; // Base
    const DEST_DOMAIN = 0; // Ethereum

    beforeEach(async function () {
        [owner, buyer, provider, feeRecipient] = await ethers.getSigners();

        // Deploy MockUSDC
        const MockUSDC = await ethers.getContractFactory("MockUSDC");
        usdc = await MockUSDC.deploy();

        // Deploy CrossChainEscrow
        const CrossChainEscrow = await ethers.getContractFactory("CrossChainEscrow");
        crossChainEscrow = await CrossChainEscrow.deploy(
            await usdc.getAddress(),
            MOCK_TOKEN_MESSENGER,
            MOCK_MESSAGE_TRANSMITTER,
            LOCAL_DOMAIN,
            feeRecipient.address
        );

        // Set remote escrow for destination domain
        await crossChainEscrow.setRemoteEscrow(DEST_DOMAIN, "0x1234567890123456789012345678901234567890");

        // Fund buyer
        await usdc.mint(buyer.address, PAYMENT_AMOUNT * 10n);
        await usdc.connect(buyer).approve(await crossChainEscrow.getAddress(), PAYMENT_AMOUNT * 10n);
    });

    // ═══════════════════════════════════════════════════════════════════════
    // PAYMENT CREATION TESTS
    // ═══════════════════════════════════════════════════════════════════════

    describe("Payment Creation", function () {
        it("Should create cross-chain payment", async function () {
            const destRecipient = ethers.zeroPadValue(provider.address, 32);
            const requestHash = ethers.keccak256(ethers.toUtf8Bytes("test request"));
            const timeout = 15 * 60; // 15 minutes

            const tx = await crossChainEscrow.connect(buyer).createCrossChainPayment(
                provider.address,
                PAYMENT_AMOUNT,
                DEST_DOMAIN,
                destRecipient,
                requestHash,
                timeout
            );

            const receipt = await tx.wait();
            const event = receipt.logs.find(log => log.fragment?.name === "CrossChainPaymentCreated");

            expect(event).to.not.be.undefined;
            expect(event.args.buyer).to.equal(buyer.address);
            expect(event.args.sourceChain).to.equal(LOCAL_DOMAIN);
            expect(event.args.destinationChain).to.equal(DEST_DOMAIN);
        });

        it("Should reject payment below minimum", async function () {
            const destRecipient = ethers.zeroPadValue(provider.address, 32);
            const requestHash = ethers.keccak256(ethers.toUtf8Bytes("test"));
            const timeout = 15 * 60;

            const smallAmount = ethers.parseUnits("0.5", 6); // 0.5 USDC

            await expect(
                crossChainEscrow.connect(buyer).createCrossChainPayment(
                    provider.address,
                    smallAmount,
                    DEST_DOMAIN,
                    destRecipient,
                    requestHash,
                    timeout
                )
            ).to.be.revertedWith("Amount too small");
        });

        it("Should reject same-chain payment", async function () {
            const destRecipient = ethers.zeroPadValue(provider.address, 32);
            const requestHash = ethers.keccak256(ethers.toUtf8Bytes("test"));
            const timeout = 15 * 60;

            await expect(
                crossChainEscrow.connect(buyer).createCrossChainPayment(
                    provider.address,
                    PAYMENT_AMOUNT,
                    LOCAL_DOMAIN, // Same as source
                    destRecipient,
                    requestHash,
                    timeout
                )
            ).to.be.revertedWith("Use local escrow");
        });

        it("Should reject unsupported destination", async function () {
            const destRecipient = ethers.zeroPadValue(provider.address, 32);
            const requestHash = ethers.keccak256(ethers.toUtf8Bytes("test"));
            const timeout = 15 * 60;

            await expect(
                crossChainEscrow.connect(buyer).createCrossChainPayment(
                    provider.address,
                    PAYMENT_AMOUNT,
                    99, // Unsupported domain
                    destRecipient,
                    requestHash,
                    timeout
                )
            ).to.be.revertedWith("Destination not supported");
        });

        it("Should reject invalid timeout", async function () {
            const destRecipient = ethers.zeroPadValue(provider.address, 32);
            const requestHash = ethers.keccak256(ethers.toUtf8Bytes("test"));

            await expect(
                crossChainEscrow.connect(buyer).createCrossChainPayment(
                    provider.address,
                    PAYMENT_AMOUNT,
                    DEST_DOMAIN,
                    destRecipient,
                    requestHash,
                    60 // 1 minute - too short
                )
            ).to.be.revertedWith("Invalid timeout");
        });
    });

    // ═══════════════════════════════════════════════════════════════════════
    // FEE CALCULATION TESTS
    // ═══════════════════════════════════════════════════════════════════════

    describe("Fee Calculation", function () {
        it("Should calculate correct fee (0.5%)", async function () {
            const amount = ethers.parseUnits("1000", 6); // 1000 USDC
            const [fee, netAmount] = await crossChainEscrow.estimateFee(amount);

            expect(fee).to.equal(ethers.parseUnits("5", 6)); // 5 USDC (0.5%)
            expect(netAmount).to.equal(ethers.parseUnits("995", 6));
        });

        it("Should collect fees on payment creation", async function () {
            const destRecipient = ethers.zeroPadValue(provider.address, 32);
            const requestHash = ethers.keccak256(ethers.toUtf8Bytes("test"));
            const timeout = 15 * 60;

            await crossChainEscrow.connect(buyer).createCrossChainPayment(
                provider.address,
                PAYMENT_AMOUNT,
                DEST_DOMAIN,
                destRecipient,
                requestHash,
                timeout
            );

            const [, fees,] = await crossChainEscrow.getStats();
            expect(fees).to.be.gt(0);
        });
    });

    // ═══════════════════════════════════════════════════════════════════════
    // TIMEOUT TESTS
    // ═══════════════════════════════════════════════════════════════════════

    describe("Timeout Refunds", function () {
        let paymentId;

        beforeEach(async function () {
            const destRecipient = ethers.zeroPadValue(provider.address, 32);
            const requestHash = ethers.keccak256(ethers.toUtf8Bytes("test"));
            const timeout = 5 * 60; // 5 minutes

            const tx = await crossChainEscrow.connect(buyer).createCrossChainPayment(
                provider.address,
                PAYMENT_AMOUNT,
                DEST_DOMAIN,
                destRecipient,
                requestHash,
                timeout
            );

            const receipt = await tx.wait();
            const event = receipt.logs.find(log => log.fragment?.name === "CrossChainPaymentCreated");
            paymentId = event.args.paymentId;
        });

        it("Should reject premature timeout claim", async function () {
            await expect(
                crossChainEscrow.connect(buyer).claimCrossChainTimeout(paymentId)
            ).to.be.revertedWith("Not timed out");
        });

        it("Should allow timeout claim after deadline", async function () {
            // Fast forward past timeout
            await ethers.provider.send("evm_increaseTime", [6 * 60]); // 6 minutes
            await ethers.provider.send("evm_mine");

            const balanceBefore = await usdc.balanceOf(buyer.address);

            await crossChainEscrow.connect(buyer).claimCrossChainTimeout(paymentId);

            const balanceAfter = await usdc.balanceOf(buyer.address);

            // Buyer should get full refund including fee
            expect(balanceAfter - balanceBefore).to.equal(PAYMENT_AMOUNT);
        });

        it("Should only allow buyer to claim timeout", async function () {
            await ethers.provider.send("evm_increaseTime", [6 * 60]);
            await ethers.provider.send("evm_mine");

            await expect(
                crossChainEscrow.connect(provider).claimCrossChainTimeout(paymentId)
            ).to.be.revertedWith("Only buyer");
        });
    });

    // ═══════════════════════════════════════════════════════════════════════
    // VIEW FUNCTION TESTS
    // ═══════════════════════════════════════════════════════════════════════

    describe("View Functions", function () {
        it("Should return supported domains", async function () {
            const [domains, names] = await crossChainEscrow.getSupportedDomains();

            expect(domains.length).to.equal(6);
            expect(names[0]).to.equal("Ethereum");
            expect(names[4]).to.equal("Base");
        });

        it("Should get domain name by ID", async function () {
            expect(await crossChainEscrow.getDomainName(0)).to.equal("Ethereum");
            expect(await crossChainEscrow.getDomainName(6)).to.equal("Base");
            expect(await crossChainEscrow.getDomainName(99)).to.equal("Unknown");
        });

        it("Should convert address to bytes32", async function () {
            const bytes32Addr = await crossChainEscrow.addressToBytes32(provider.address);
            const convertedBack = await crossChainEscrow.bytes32ToAddress(bytes32Addr);

            expect(convertedBack.toLowerCase()).to.equal(provider.address.toLowerCase());
        });

        it("Should track payment stats", async function () {
            const [totalVolume, totalFees, paymentCount] = await crossChainEscrow.getStats();

            expect(totalVolume).to.equal(0);
            expect(paymentCount).to.equal(0);
        });
    });

    // ═══════════════════════════════════════════════════════════════════════
    // ADMIN FUNCTION TESTS
    // ═══════════════════════════════════════════════════════════════════════

    describe("Admin Functions", function () {
        it("Should allow owner to set remote escrow", async function () {
            const newRemote = "0x9876543210987654321098765432109876543210";
            await crossChainEscrow.setRemoteEscrow(1, newRemote); // Avalanche

            // Should not revert
        });

        it("Should prevent non-owner from setting remote escrow", async function () {
            await expect(
                crossChainEscrow.connect(buyer).setRemoteEscrow(1, buyer.address)
            ).to.be.reverted;
        });

        it("Should allow owner to set fee recipient", async function () {
            await crossChainEscrow.setFeeRecipient(buyer.address);
            // Should not revert
        });
    });

    // ═══════════════════════════════════════════════════════════════════════
    // PAYMENT TRACKING TESTS
    // ═══════════════════════════════════════════════════════════════════════

    describe("Payment Tracking", function () {
        it("Should track buyer payments", async function () {
            const destRecipient = ethers.zeroPadValue(provider.address, 32);
            const requestHash = ethers.keccak256(ethers.toUtf8Bytes("test"));
            const timeout = 15 * 60;

            await crossChainEscrow.connect(buyer).createCrossChainPayment(
                provider.address,
                PAYMENT_AMOUNT,
                DEST_DOMAIN,
                destRecipient,
                requestHash,
                timeout
            );

            const buyerPayments = await crossChainEscrow.getBuyerPayments(buyer.address);
            expect(buyerPayments.length).to.equal(1);
        });

        it("Should track provider payments", async function () {
            const destRecipient = ethers.zeroPadValue(provider.address, 32);
            const requestHash = ethers.keccak256(ethers.toUtf8Bytes("test"));
            const timeout = 15 * 60;

            await crossChainEscrow.connect(buyer).createCrossChainPayment(
                provider.address,
                PAYMENT_AMOUNT,
                DEST_DOMAIN,
                destRecipient,
                requestHash,
                timeout
            );

            const providerPayments = await crossChainEscrow.getProviderPayments(provider.address);
            expect(providerPayments.length).to.equal(1);
        });

        it("Should get payment details", async function () {
            const destRecipient = ethers.zeroPadValue(provider.address, 32);
            const requestHash = ethers.keccak256(ethers.toUtf8Bytes("test"));
            const timeout = 15 * 60;

            const tx = await crossChainEscrow.connect(buyer).createCrossChainPayment(
                provider.address,
                PAYMENT_AMOUNT,
                DEST_DOMAIN,
                destRecipient,
                requestHash,
                timeout
            );

            const receipt = await tx.wait();
            const event = receipt.logs.find(log => log.fragment?.name === "CrossChainPaymentCreated");
            const paymentId = event.args.paymentId;

            const payment = await crossChainEscrow.getPayment(paymentId);

            expect(payment.buyer).to.equal(buyer.address);
            expect(payment.provider).to.equal(provider.address);
            expect(payment.sourceChain).to.equal(LOCAL_DOMAIN);
            expect(payment.destinationChain).to.equal(DEST_DOMAIN);
            expect(payment.status).to.equal(1); // Pending
        });
    });
});
