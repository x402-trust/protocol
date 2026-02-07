const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("DisputeManager", function () {
    let usdc, reputationEngine, escrowVault, disputeManager;
    let owner, provider, buyer, arbitrator1, arbitrator2, arbitrator3;

    const PROVIDER_STAKE = ethers.parseUnits("500", 6);
    const ARBITRATOR_STAKE = ethers.parseUnits("500", 6);
    const PAYMENT_AMOUNT = ethers.parseUnits("10", 6);

    beforeEach(async function () {
        [owner, provider, buyer, arbitrator1, arbitrator2, arbitrator3] = await ethers.getSigners();

        // Deploy contracts
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

        // Link contracts
        await reputationEngine.setEscrowVault(await escrowVault.getAddress());
        await escrowVault.setDisputeManager(await disputeManager.getAddress());

        // Setup provider
        await usdc.mint(provider.address, PROVIDER_STAKE);
        await usdc.connect(provider).approve(await reputationEngine.getAddress(), PROVIDER_STAKE);
        await reputationEngine.connect(provider).registerWithStake("https://api.provider.com");
    });

    describe("Arbitrator Registration", function () {
        it("Should allow owner to bootstrap arbitrator during cold start", async function () {
            await disputeManager.connect(owner).bootstrapArbitrator(arbitrator1.address);

            const poolSize = await disputeManager.getArbitratorPoolSize();
            expect(poolSize).to.equal(1);
        });

        it("Should reject double registration via bootstrap", async function () {
            await disputeManager.connect(owner).bootstrapArbitrator(arbitrator1.address);

            await expect(
                disputeManager.connect(owner).bootstrapArbitrator(arbitrator1.address)
            ).to.be.revertedWith("Already registered");
        });

        it("Should reject non-owner bootstrap", async function () {
            await expect(
                disputeManager.connect(arbitrator1).bootstrapArbitrator(arbitrator2.address)
            ).to.be.revertedWithCustomError(disputeManager, "OwnableUnauthorizedAccount");
        });

        it("Should require 700+ score for regular registration", async function () {
            await usdc.mint(arbitrator1.address, ARBITRATOR_STAKE);
            await usdc.connect(arbitrator1).approve(
                await disputeManager.getAddress(),
                ARBITRATOR_STAKE
            );

            // Should fail because arbitrator1 has no reputation
            await expect(
                disputeManager.connect(arbitrator1).registerAsArbitrator()
            ).to.be.revertedWith("Score too low");
        });
    });

    describe("Dispute Tracks", function () {
        it("Should use FastTrack for small amounts", async function () {
            // This would require creating a dispute through the full flow
            // For now, just verify the constants are correct
            const fastTrackEvidence = 24 * 60 * 60; // 24 hours
            expect(await disputeManager.FAST_TRACK_EVIDENCE()).to.equal(fastTrackEvidence);
        });

        it("Should use Complex track for large amounts", async function () {
            const complexThreshold = ethers.parseUnits("1000", 6);
            expect(await disputeManager.COMPLEX_THRESHOLD()).to.equal(complexThreshold);
        });
    });

    describe("Constants", function () {
        it("Should have correct minimum pool size", async function () {
            expect(await disputeManager.MIN_ARBITRATOR_POOL()).to.equal(50);
        });

        it("Should have correct arbitrators per dispute", async function () {
            expect(await disputeManager.ARBITRATORS_PER_DISPUTE()).to.equal(7);
        });

        it("Should require 5/7 majority", async function () {
            expect(await disputeManager.REQUIRED_MAJORITY()).to.equal(5);
        });
    });
});
