/**
 * x402 Trust Protocol — Demo Transactions (Simplified)
 * Run: npx hardhat run scripts/demo-transactions.js --network arcTestnet
 */

const hre = require("hardhat");

const CONTRACTS = {
    TRUST_PROTOCOL: "0x1eC0007C35Aa4A5008263e2C257942f4cb4F329F",
    REPUTATION_ENGINE: "0x86fa599c4474E8098400e57760543E7191B2DA1e",
    ESCROW_VAULT: "0x35D3d7Ff317bca17a123D8B18923599Ac1F9d817",
    USDC: "0x8Fd5A8a2d6373a1c299C46Ed7862CA277316237B"
};

async function main() {
    console.log("╔══════════════════════════════════════════════════════════╗");
    console.log("║    x402 Trust Protocol — Demo Transactions (Arc Testnet) ║");
    console.log("╚══════════════════════════════════════════════════════════╝\n");

    const [deployer] = await hre.ethers.getSigners();
    console.log(`Deployer: ${deployer.address}`);

    const balance = await hre.ethers.provider.getBalance(deployer.address);
    console.log(`Balance: ${hre.ethers.formatEther(balance)} ETH\n`);

    const reputationEngine = await hre.ethers.getContractAt("ReputationEngine", CONTRACTS.REPUTATION_ENGINE);
    const escrowVault = await hre.ethers.getContractAt("EscrowVault", CONTRACTS.ESCROW_VAULT);
    const usdc = await hre.ethers.getContractAt("MockUSDC", CONTRACTS.USDC);

    const txHashes = [];

    // ============================================================
    // Read constants
    // ============================================================
    console.log("Reading Contract Constants...\n");
    const INITIAL_SCORE = await reputationEngine.INITIAL_SCORE();
    const PROVIDER_STAKE = await reputationEngine.PROVIDER_STAKE();
    console.log(`INITIAL_SCORE: ${INITIAL_SCORE}`);
    console.log(`PROVIDER_STAKE: ${hre.ethers.formatUnits(PROVIDER_STAKE, 6)} USDC\n`);

    // ============================================================
    // DEMO 1: Mint USDC
    // ============================================================
    console.log("━━━ DEMO 1: Minting Test USDC ━━━\n");
    try {
        const mintTx = await usdc.mint(deployer.address, hre.ethers.parseUnits("1000", 6));
        await mintTx.wait();
        console.log(`✅ Minted 1000 USDC`);
        console.log(`   TX: ${mintTx.hash}\n`);
        txHashes.push({ action: "Mint USDC", hash: mintTx.hash });
    } catch (e) {
        console.log(`⚠️ Mint failed: ${e.reason || e.message}\n`);
    }

    // ============================================================
    // DEMO 2: Register as Provider
    // ============================================================
    console.log("━━━ DEMO 2: Registering as Provider ━━━\n");

    // Approve stake
    try {
        const approveTx = await usdc.approve(CONTRACTS.REPUTATION_ENGINE, PROVIDER_STAKE);
        await approveTx.wait();
        console.log(`✅ Approved ${hre.ethers.formatUnits(PROVIDER_STAKE, 6)} USDC`);
        console.log(`   TX: ${approveTx.hash}\n`);
        txHashes.push({ action: "Approve Stake", hash: approveTx.hash });
    } catch (e) {
        console.log(`⚠️ Approve failed: ${e.reason || e.message}\n`);
    }

    // Register
    try {
        const registerTx = await reputationEngine.registerWithStake("https://api.demo-provider.com/v1");
        await registerTx.wait();
        console.log(`✅ Registered as provider!`);
        console.log(`   TX: ${registerTx.hash}`);
        console.log(`   Initial Score: ${INITIAL_SCORE}\n`);
        txHashes.push({ action: "Register Provider", hash: registerTx.hash });
    } catch (e) {
        console.log(`⚠️ Register failed (may already be registered): ${e.reason || e.message}\n`);
    }

    // ============================================================
    // DEMO 3: Create Escrow Payment (with a different provider)
    // ============================================================
    console.log("━━━ DEMO 3: Creating Escrow Payment ━━━\n");

    const paymentAmount = hre.ethers.parseUnits("10", 6);
    const demoProvider = "0x1111111111111111111111111111111111111111"; // Simulated provider
    const requestHash = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("Demo: Get BTC price"));

    try {
        const approveEscrowTx = await usdc.approve(CONTRACTS.ESCROW_VAULT, paymentAmount);
        await approveEscrowTx.wait();
        console.log(`✅ Approved 10 USDC for escrow`);
        console.log(`   TX: ${approveEscrowTx.hash}\n`);
        txHashes.push({ action: "Approve Escrow", hash: approveEscrowTx.hash });
    } catch (e) {
        console.log(`⚠️ Escrow approve failed: ${e.reason || e.message}\n`);
    }

    try {
        const paymentTx = await escrowVault.createPayment(demoProvider, paymentAmount, requestHash, 900);
        await paymentTx.wait();
        console.log(`✅ Created escrow payment!`);
        console.log(`   TX: ${paymentTx.hash}`);
        console.log(`   Amount: 10 USDC`);
        console.log(`   Provider: ${demoProvider}\n`);
        txHashes.push({ action: "Create Payment", hash: paymentTx.hash });
    } catch (e) {
        console.log(`⚠️ Payment creation failed: ${e.reason || e.message}\n`);
    }

    // ============================================================
    // SUMMARY
    // ============================================================
    console.log("╔═══════════════════════════════════════════════════════╗");
    console.log("║              Demo Transactions Complete!              ║");
    console.log("╚═══════════════════════════════════════════════════════╝\n");

    if (txHashes.length > 0) {
        console.log("📋 Copy for SUBMISSION.md:\n");
        console.log("**Demo Transactions (Arc Testnet):**\n");
        console.log("| Action | Transaction Hash |");
        console.log("|--------|------------------|");
        txHashes.forEach(tx => {
            console.log(`| ${tx.action} | [\`${tx.hash.slice(0, 10)}...${tx.hash.slice(-8)}\`](https://testnet.arcscan.app/tx/${tx.hash}) |`);
        });
        console.log("\n");
    }
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
