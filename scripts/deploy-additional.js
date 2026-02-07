// Deploy TrustOracle and PaymentRouter to Arc Testnet
require('dotenv').config();
const hre = require("hardhat");

async function main() {
    const [deployer] = await hre.ethers.getSigners();

    console.log("🚀 Deploying additional contracts...\n");
    console.log("Deployer:", deployer.address);

    // Existing contract addresses
    const USDC = "0x8Fd5A8a2d6373a1c299C46Ed7862CA277316237B";
    const TRUST_PROTOCOL = "0x1eC0007C35Aa4A5008263e2C257942f4cb4F329F";
    const ESCROW_VAULT = "0x8E46e646ab9caACC8322dBD5E17A08166F09B9FD";

    // Deploy TrustOracle
    console.log("\n1️⃣ Deploying TrustOracle...");
    const TrustOracle = await hre.ethers.getContractFactory("TrustOracle");
    const trustOracle = await TrustOracle.deploy();
    await trustOracle.waitForDeployment();
    const trustOracleAddress = await trustOracle.getAddress();
    console.log("   TrustOracle deployed to:", trustOracleAddress);

    // Deploy PaymentRouter
    console.log("\n2️⃣ Deploying PaymentRouter...");
    const PaymentRouter = await hre.ethers.getContractFactory("PaymentRouter");
    const paymentRouter = await PaymentRouter.deploy(
        USDC,
        TRUST_PROTOCOL,
        ESCROW_VAULT,
        deployer.address  // Fee recipient
    );
    await paymentRouter.waitForDeployment();
    const paymentRouterAddress = await paymentRouter.getAddress();
    console.log("   PaymentRouter deployed to:", paymentRouterAddress);

    console.log("\n════════════════════════════════════════════════════════════");
    console.log("✅ ADDITIONAL DEPLOYMENT COMPLETE!");
    console.log("════════════════════════════════════════════════════════════\n");

    console.log("New Contract Addresses:");
    console.log("-----------------------");
    console.log("TrustOracle:     ", trustOracleAddress);
    console.log("PaymentRouter:   ", paymentRouterAddress);

    console.log("\n📝 Add to .env:");
    console.log(`TRUST_ORACLE_ADDRESS=${trustOracleAddress}`);
    console.log(`PAYMENT_ROUTER_ADDRESS=${paymentRouterAddress}`);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
