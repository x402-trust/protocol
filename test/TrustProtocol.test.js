const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("TrustProtocol", function () {
    let usdc, reputationEngine, escrowVault, trustProtocol;
    let owner, provider, buyer;

    const PROVIDER_STAKE = ethers.parseUnits("500", 6);
    const PAYMENT_AMOUNT = ethers.parseUnits("10", 6);

    beforeEach(async function () {
        [owner, provider, buyer] = await ethers.getSigners();

        // Deploy all contracts
        const MockUSDC = await ethers.getContractFactory("MockUSDC");
        usdc = await MockUSDC.deploy();

        const ReputationEngine = await ethers.getContractFactory("ReputationEngine");
        reputationEngine = await ReputationEngine.deploy(await usdc.getAddress());

        const EscrowVault = await ethers.getContractFactory("EscrowVault");
        escrowVault = await EscrowVault.deploy(
            await usdc.getAddress(),
            await reputationEngine.getAddress()
        );

        const TrustProtocol = await ethers.getContractFactory("TrustProtocol");
        trustProtocol = await TrustProtocol.deploy(
            await reputationEngine.getAddress(),
            await escrowVault.getAddress()
        );

        // Link contracts
        await reputationEngine.setEscrowVault(await escrowVault.getAddress());

        // Setup provider
        await usdc.mint(provider.address, PROVIDER_STAKE);
        await usdc.connect(provider).approve(await reputationEngine.getAddress(), PROVIDER_STAKE);
        await reputationEngine.connect(provider).registerWithStake("https://api.provider.com");

        // Setup buyer
        await usdc.mint(buyer.address, PAYMENT_AMOUNT * 10n);
        await usdc.connect(buyer).approve(await escrowVault.getAddress(), PAYMENT_AMOUNT * 10n);
    });

    describe("Provider Info", function () {
        it("Should return correct provider info", async function () {
            const [score, tier, timeout, isActive] = await trustProtocol.getProviderInfo(provider.address);

            expect(score).to.equal(500);
            expect(tier).to.equal(1); // Newcomer
            expect(timeout).to.equal(15 * 60); // 15 minutes
            expect(isActive).to.equal(true);
        });

        it("Should return correct trust tier string", async function () {
            const tier = await trustProtocol.getTrustTier(provider.address);
            expect(tier).to.equal("Good");
        });

        it("Should indicate escrow is needed for low-trust provider", async function () {
            const needsEscrow = await trustProtocol.needsEscrow(provider.address);
            expect(needsEscrow).to.equal(true);
        });
    });

    describe("Compare Providers", function () {
        let provider2;

        beforeEach(async function () {
            [, , , provider2] = await ethers.getSigners();

            // Register provider2 with humanity proof (higher score)
            const proof = ethers.randomBytes(64);
            await reputationEngine.connect(provider2).registerWithHumanityProof(
                "https://api.provider2.com",
                proof
            );
        });

        it("Should compare multiple providers", async function () {
            const [scores, timeouts] = await trustProtocol.compareProviders([
                provider.address,
                provider2.address
            ]);

            expect(scores[0]).to.equal(500); // Regular provider
            expect(scores[1]).to.equal(600); // Verified provider

            expect(timeouts[0]).to.equal(15 * 60); // 15 min
            expect(timeouts[1]).to.equal(15 * 60); // 15 min (score 600 still Good tier)
        });
    });
});
