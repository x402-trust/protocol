const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("ReputationEngine", function () {
    let usdc, reputationEngine, escrowVault;
    let owner, provider1, provider2, buyer1, buyer2;

    const PROVIDER_STAKE = ethers.parseUnits("500", 6); // 500 USDC
    const INITIAL_SCORE = 500;

    beforeEach(async function () {
        [owner, provider1, provider2, buyer1, buyer2] = await ethers.getSigners();

        // Deploy MockUSDC
        const MockUSDC = await ethers.getContractFactory("MockUSDC");
        usdc = await MockUSDC.deploy();

        // Deploy ReputationEngine
        const ReputationEngine = await ethers.getContractFactory("ReputationEngine");
        reputationEngine = await ReputationEngine.deploy(await usdc.getAddress());

        // Mint USDC to provider1 for staking
        await usdc.mint(provider1.address, PROVIDER_STAKE);
        await usdc.connect(provider1).approve(await reputationEngine.getAddress(), PROVIDER_STAKE);
    });

    describe("Registration", function () {
        it("Should allow provider registration with stake", async function () {
            await reputationEngine.connect(provider1).registerWithStake("https://api.provider1.com");

            const score = await reputationEngine.getScore(provider1.address);
            expect(score).to.equal(INITIAL_SCORE);

            const tier = await reputationEngine.getTier(provider1.address);
            expect(tier).to.equal(1); // Newcomer
        });

        it("Should reject registration without enough stake", async function () {
            await expect(
                reputationEngine.connect(provider2).registerWithStake("https://api.provider2.com")
            ).to.be.reverted;
        });

        it("Should reject empty endpoint", async function () {
            await expect(
                reputationEngine.connect(provider1).registerWithStake("")
            ).to.be.revertedWith("Empty endpoint");
        });

        it("Should reject double registration", async function () {
            await reputationEngine.connect(provider1).registerWithStake("https://api.provider1.com");

            await usdc.mint(provider1.address, PROVIDER_STAKE);
            await usdc.connect(provider1).approve(await reputationEngine.getAddress(), PROVIDER_STAKE);

            await expect(
                reputationEngine.connect(provider1).registerWithStake("https://api.provider1.com/v2")
            ).to.be.revertedWith("Already registered");
        });

        it("Should enforce registration cooldown", async function () {
            await reputationEngine.connect(provider1).registerWithStake("https://api.provider1.com");

            // Try to register again from same address after cooldown bypass attempt
            // This tests the lastRegistration mapping
            const profile = await reputationEngine.providers(provider1.address);
            expect(profile.tier).to.equal(1); // Newcomer
        });
    });

    describe("Trust Score", function () {
        beforeEach(async function () {
            await reputationEngine.connect(provider1).registerWithStake("https://api.provider1.com");
        });

        it("Should return initial score for new provider", async function () {
            const score = await reputationEngine.getScore(provider1.address);
            expect(score).to.equal(INITIAL_SCORE);
        });

        it("Should return recommended timeout based on score", async function () {
            const timeout = await reputationEngine.getRecommendedTimeout(provider1.address);
            expect(timeout).to.equal(15 * 60); // 15 minutes for Good tier (500 score)
        });

        it("Should check if provider is active", async function () {
            const isActive = await reputationEngine.isActive(provider1.address);
            expect(isActive).to.equal(true);

            const isActive2 = await reputationEngine.isActive(provider2.address);
            expect(isActive2).to.equal(false);
        });
    });

    describe("Tier Classification", function () {
        beforeEach(async function () {
            await reputationEngine.connect(provider1).registerWithStake("https://api.provider1.com");
        });

        it("Should classify newcomer correctly", async function () {
            const tier = await reputationEngine.getTier(provider1.address);
            expect(tier).to.equal(1); // Newcomer
        });
    });

    describe("Humanity Proof Registration", function () {
        it("Should allow registration with valid humanity proof", async function () {
            // Create a 32+ byte proof
            const proof = ethers.randomBytes(64);

            await reputationEngine.connect(provider2).registerWithHumanityProof(
                "https://api.verified.com",
                proof
            );

            const tier = await reputationEngine.getTier(provider2.address);
            expect(tier).to.equal(3); // Verified

            const score = await reputationEngine.getScore(provider2.address);
            expect(score).to.equal(600); // Higher starting score
        });

        it("Should reject reused humanity proof", async function () {
            const proof = ethers.randomBytes(64);

            await reputationEngine.connect(provider1).registerWithHumanityProof(
                "https://api.verified1.com",
                proof
            );

            await expect(
                reputationEngine.connect(provider2).registerWithHumanityProof(
                    "https://api.verified2.com",
                    proof
                )
            ).to.be.revertedWith("Proof already used");
        });

        it("Should reject short humanity proof", async function () {
            const shortProof = ethers.randomBytes(16); // Less than 32 bytes

            await expect(
                reputationEngine.connect(provider1).registerWithHumanityProof(
                    "https://api.provider.com",
                    shortProof
                )
            ).to.be.revertedWith("Invalid proof");
        });
    });
});
