// Redeploy fixed EscrowVault and PaymentRouter + link them
require('dotenv').config();
const hre = require("hardhat");

async function main() {
    const [deployer] = await hre.ethers.getSigners();

    console.log("🔧 Redeploying fixed contracts...\n");
    console.log("Deployer:", deployer.address);

    // Existing contract addresses
    const USDC = "0x8Fd5A8a2d6373a1c299C46Ed7862CA277316237B";
    const REPUTATION_ENGINE = "0x86fa599c4474E8098400e57760543E7191B2DA1e";
    const DISPUTE_MANAGER = "0x7449713F47A782b5df27ac6d375A55E6dA7A58a9";
    const TRUST_PROTOCOL = "0x1eC0007C35Aa4A5008263e2C257942f4cb4F329F";

    // 1. Redeploy EscrowVault with fix
    console.log("\n1️⃣ Redeploying EscrowVault (with createPaymentFor)...");
    const EscrowVault = await hre.ethers.getContractFactory("EscrowVault");
    const escrowVault = await EscrowVault.deploy(USDC, REPUTATION_ENGINE);
    await escrowVault.waitForDeployment();
    const escrowVaultAddress = await escrowVault.getAddress();
    console.log("   EscrowVault deployed to:", escrowVaultAddress);

    // 2. Set DisputeManager on EscrowVault
    console.log("\n2️⃣ Setting DisputeManager on EscrowVault...");
    await escrowVault.setDisputeManager(DISPUTE_MANAGER);
    console.log("   DisputeManager set!");

    // 3. Redeploy PaymentRouter with new EscrowVault
    console.log("\n3️⃣ Redeploying PaymentRouter...");
    const PaymentRouter = await hre.ethers.getContractFactory("PaymentRouter");
    const paymentRouter = await PaymentRouter.deploy(
        USDC,
        TRUST_PROTOCOL,
        escrowVaultAddress,
        deployer.address  // Fee recipient
    );
    await paymentRouter.waitForDeployment();
    const paymentRouterAddress = await paymentRouter.getAddress();
    console.log("   PaymentRouter deployed to:", paymentRouterAddress);

    // 4. Set PaymentRouter on EscrowVault
    console.log("\n4️⃣ Linking PaymentRouter to EscrowVault...");
    await escrowVault.setPaymentRouter(paymentRouterAddress);
    console.log("   PaymentRouter linked!");

    console.log("\n════════════════════════════════════════════════════════════");
    console.log("✅ REDEPLOYMENT COMPLETE!");
    console.log("════════════════════════════════════════════════════════════\n");

    console.log("Updated Contract Addresses:");
    console.log("-----------------------");
    console.log("EscrowVault (v2):   ", escrowVaultAddress);
    console.log("PaymentRouter (v2): ", paymentRouterAddress);

    console.log("\n📝 Update .env and deployment.json with:");
    console.log(`ESCROW_VAULT_ADDRESS=${escrowVaultAddress}`);
    console.log(`PAYMENT_ROUTER_ADDRESS=${paymentRouterAddress}`);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
