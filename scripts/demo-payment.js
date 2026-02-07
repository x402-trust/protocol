/**
 * x402 Trust Protocol — Create Payment Demo
 * Run: npx hardhat run scripts/demo-payment.js --network arcTestnet
 */

const hre = require("hardhat");

const CONTRACTS = {
    REPUTATION_ENGINE: "0x86fa599c4474E8098400e57760543E7191B2DA1e",
    ESCROW_VAULT: "0x35D3d7Ff317bca17a123D8B18923599Ac1F9d817",
    USDC: "0x8Fd5A8a2d6373a1c299C46Ed7862CA277316237B"
};

async function main() {
    console.log("╔══════════════════════════════════════════════════════════╗");
    console.log("║    x402 Trust Protocol — Payment Demo (Arc Testnet)      ║");
    console.log("╚══════════════════════════════════════════════════════════╝\n");

    const [deployer] = await hre.ethers.getSigners();
    console.log(`Deployer: ${deployer.address}\n`);

    const escrowVault = await hre.ethers.getContractAt("EscrowVault", CONTRACTS.ESCROW_VAULT);
    const usdc = await hre.ethers.getContractAt("MockUSDC", CONTRACTS.USDC);

    // Provider is the deployer (we already registered as provider)
    const provider = deployer.address;
    const paymentAmount = hre.ethers.parseUnits("10", 6); // 10 USDC
    const requestHash = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("Demo API request: Get BTC price at " + Date.now()));

    console.log("━━━ Creating Escrow Payment ━━━\n");
    console.log(`Provider: ${provider}`);
    console.log(`Amount: 10 USDC`);
    console.log(`Request: Get BTC price\n`);

    // Approve USDC
    try {
        const approveTx = await usdc.approve(CONTRACTS.ESCROW_VAULT, paymentAmount);
        await approveTx.wait();
        console.log(`✅ Approved USDC for escrow`);
        console.log(`   TX: ${approveTx.hash}\n`);
    } catch (e) {
        console.log(`⚠️ Approve failed: ${e.reason || e.message}\n`);
        return;
    }

    // Create payment (3 params: provider, amount, requestHash)
    try {
        const paymentTx = await escrowVault.createPayment(provider, paymentAmount, requestHash);
        const receipt = await paymentTx.wait();
        console.log(`✅ Created escrow payment!`);
        console.log(`   TX: ${paymentTx.hash}`);

        // Find payment ID from event
        const event = receipt.logs.find(log => {
            try {
                const parsed = escrowVault.interface.parseLog(log);
                return parsed && parsed.name === "PaymentCreated";
            } catch { return false; }
        });

        if (event) {
            const parsed = escrowVault.interface.parseLog(event);
            console.log(`   Payment ID: ${parsed.args.paymentId}\n`);

            // Confirm delivery
            console.log("━━━ Confirming Delivery ━━━\n");
            const responseHash = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("BTC = $65,432.10"));
            const confirmTx = await escrowVault.confirmDelivery(parsed.args.paymentId, responseHash);
            await confirmTx.wait();
            console.log(`✅ Delivery confirmed!`);
            console.log(`   TX: ${confirmTx.hash}\n`);
        }

        console.log("╔══════════════════════════════════════════════════════════╗");
        console.log("║                 Payment Demo Complete!                   ║");
        console.log("╚══════════════════════════════════════════════════════════╝\n");

        console.log("📋 Add to SUBMISSION.md:\n");
        console.log(`| Create Payment | [\`${paymentTx.hash.slice(0, 10)}...${paymentTx.hash.slice(-8)}\`](https://testnet.arcscan.app/tx/${paymentTx.hash}) |`);

    } catch (e) {
        console.log(`❌ Payment creation failed: ${e.reason || e.message}\n`);
        console.log("Full error:", e);
    }
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
