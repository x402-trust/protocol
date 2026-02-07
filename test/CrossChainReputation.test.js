const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("CrossChainReputation", function () {
    let reputationEngine, usdc;
    let owner, provider1, provider2, buyer1;

    beforeEach(async function () {
        [owner, provider1, provider2, buyer1] = await ethers.getSigners();

        // Deploy MockUSDC
        const MockUSDC = await ethers.getContractFactory("MockUSDC");
        usdc = await MockUSDC.deploy();

        // Deploy ReputationEngine
        const ReputationEngine = await ethers.getContractFactory("ReputationEngine");
        reputationEngine = await ReputationEngine.deploy(await usdc.getAddress());

        // Setup
        const PROVIDER_STAKE = await reputationEngine.PROVIDER_STAKE();
        await usdc.mint(provider1.address, PROVIDER_STAKE);
        await usdc.connect(provider1).approve(await reputationEngine.getAddress(), PROVIDER_STAKE);
        await reputationEngine.connect(provider1).registerWithStake("https://api.provider1.com");
    });

    describe("Export Reputation", function () {
        it("Should export provider reputation", async function () {
            const tx = await reputationEngine.connect(provider1).exportReputation(84532); // Base Sepolia

            const receipt = await tx.wait();
            const event = receipt.logs.find(log => {
                try {
                    const parsed = reputationEngine.interface.parseLog(log);
                    return parsed.name === "ReputationExported";
                } catch { return false; }
            });

            expect(event).to.not.be.undefined;
        });

        it("Should reject export for non-registered entity", async function () {
            await expect(
                reputationEngine.connect(buyer1).exportReputation(84532)
            ).to.be.revertedWith("No reputation to export");
        });
    });

    describe("Trusted Contracts", function () {
        it("Should allow owner to set trusted contract", async function () {
            await reputationEngine.setTrustedContract(84532, provider2.address);
            expect(await reputationEngine.trustedContracts(84532)).to.equal(provider2.address);
        });

        it("Should reject setting zero address", async function () {
            await expect(
                reputationEngine.setTrustedContract(84532, ethers.ZeroAddress)
            ).to.be.revertedWith("Invalid address");
        });

        it("Should reject non-owner setting trusted contract", async function () {
            await expect(
                reputationEngine.connect(buyer1).setTrustedContract(84532, provider2.address)
            ).to.be.reverted;
        });
    });

    describe("Import Reputation", function () {
        it("Should reject import from untrusted chain", async function () {
            // Create fake proof
            const proof = ethers.AbiCoder.defaultAbiCoder().encode(
                ["address", "uint256", "uint8", "uint256", "uint256", "uint256"],
                [buyer1.address, 700, 2, 84532, 31337, Math.floor(Date.now() / 1000)]
            );

            await expect(
                reputationEngine.connect(buyer1).importReputation(proof)
            ).to.be.revertedWith("Untrusted source chain");
        });
    });

    describe("Effective Score Calculation", function () {
        it("Should return local score for non-imported entity", async function () {
            const [effectiveScore, unlockPct] = await reputationEngine.getEffectiveScore(provider1.address);

            expect(effectiveScore).to.equal(await reputationEngine.INITIAL_SCORE());
            expect(unlockPct).to.equal(100);
        });
    });

    describe("Chain Constants", function () {
        it("Should have correct chain IDs", async function () {
            expect(await reputationEngine.CHAIN_ARC_TESTNET()).to.equal(5042002);
            expect(await reputationEngine.CHAIN_BASE_SEPOLIA()).to.equal(84532);
            expect(await reputationEngine.CHAIN_ARBITRUM_SEPOLIA()).to.equal(421614);
        });

        it("Should have correct import discount", async function () {
            expect(await reputationEngine.IMPORT_DISCOUNT()).to.equal(50);
        });

        it("Should have correct unlock schedule", async function () {
            expect(await reputationEngine.UNLOCK_DAY_7()).to.equal(10);
            expect(await reputationEngine.UNLOCK_DAY_15()).to.equal(15);
            expect(await reputationEngine.UNLOCK_DAY_30()).to.equal(25);
        });
    });

    describe("Import Details", function () {
        it("Should return empty for non-imported entity", async function () {
            const details = await reputationEngine.getImportedReputation(buyer1.address);

            expect(details.importedScore).to.equal(0);
            expect(details.sourceChainId).to.equal(0);
            expect(details.isFrozen).to.equal(false);
        });
    });
});
