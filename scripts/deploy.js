const hre = require("hardhat");

async function main() {
    console.log("🚀 Deploying x402 Trust Protocol to Base Sepolia...\n");

    const [deployer] = await hre.ethers.getSigners();
    console.log("Deployer:", deployer.address);
    console.log("Balance:", hre.ethers.formatEther(await hre.ethers.provider.getBalance(deployer.address)), "ETH\n");

    // Step 1: Deploy MockUSDC (or use existing USDC on Base Sepolia)
    console.log("1️⃣ Deploying MockUSDC...");
    const MockUSDC = await hre.ethers.getContractFactory("MockUSDC");
    const usdc = await MockUSDC.deploy();
    await usdc.waitForDeployment();
    const usdcAddress = await usdc.getAddress();
    console.log("   MockUSDC deployed to:", usdcAddress);

    // Step 2: Deploy ReputationEngine
    console.log("\n2️⃣ Deploying ReputationEngine...");
    const ReputationEngine = await hre.ethers.getContractFactory("ReputationEngine");
    const reputationEngine = await ReputationEngine.deploy(usdcAddress);
    await reputationEngine.waitForDeployment();
    const reputationAddress = await reputationEngine.getAddress();
    console.log("   ReputationEngine deployed to:", reputationAddress);

    // Step 3: Deploy EscrowVault
    console.log("\n3️⃣ Deploying EscrowVault...");
    const EscrowVault = await hre.ethers.getContractFactory("EscrowVault");
    const escrowVault = await EscrowVault.deploy(usdcAddress, reputationAddress);
    await escrowVault.waitForDeployment();
    const escrowAddress = await escrowVault.getAddress();
    console.log("   EscrowVault deployed to:", escrowAddress);

    // Step 4: Deploy DisputeManager
    console.log("\n4️⃣ Deploying DisputeManager...");
    const DisputeManager = await hre.ethers.getContractFactory("DisputeManager");
    const disputeManager = await DisputeManager.deploy(usdcAddress, escrowAddress);
    await disputeManager.waitForDeployment();
    const disputeAddress = await disputeManager.getAddress();
    console.log("   DisputeManager deployed to:", disputeAddress);

    // Step 5: Deploy TrustProtocol
    console.log("\n5️⃣ Deploying TrustProtocol...");
    const TrustProtocol = await hre.ethers.getContractFactory("TrustProtocol");
    const trustProtocol = await TrustProtocol.deploy(reputationAddress, escrowAddress);
    await trustProtocol.waitForDeployment();
    const trustAddress = await trustProtocol.getAddress();
    console.log("   TrustProtocol deployed to:", trustAddress);

    // Step 6: Link contracts
    console.log("\n6️⃣ Linking contracts...");
    await reputationEngine.setEscrowVault(escrowAddress);
    console.log("   ✅ ReputationEngine -> EscrowVault linked");

    await escrowVault.setDisputeManager(disputeAddress);
    console.log("   ✅ EscrowVault -> DisputeManager linked");

    // Summary
    console.log("\n" + "═".repeat(60));
    console.log("✅ DEPLOYMENT COMPLETE!");
    console.log("═".repeat(60));
    console.log("\nContract Addresses:");
    console.log("-------------------");
    console.log(`MockUSDC:         ${usdcAddress}`);
    console.log(`ReputationEngine: ${reputationAddress}`);
    console.log(`EscrowVault:      ${escrowAddress}`);
    console.log(`DisputeManager:   ${disputeAddress}`);
    console.log(`TrustProtocol:    ${trustAddress}`);

    console.log("\n📝 Add to .env:");
    console.log(`USDC_ADDRESS=${usdcAddress}`);
    console.log(`REPUTATION_ENGINE_ADDRESS=${reputationAddress}`);
    console.log(`ESCROW_VAULT_ADDRESS=${escrowAddress}`);
    console.log(`DISPUTE_MANAGER_ADDRESS=${disputeAddress}`);
    console.log(`TRUST_PROTOCOL_ADDRESS=${trustAddress}`);

    // Verify instructions
    console.log("\n🔍 To verify contracts:");
    console.log(`npx hardhat verify --network baseSepolia ${usdcAddress}`);
    console.log(`npx hardhat verify --network baseSepolia ${reputationAddress} ${usdcAddress}`);
    console.log(`npx hardhat verify --network baseSepolia ${escrowAddress} ${usdcAddress} ${reputationAddress}`);
    console.log(`npx hardhat verify --network baseSepolia ${disputeAddress} ${usdcAddress} ${escrowAddress}`);
    console.log(`npx hardhat verify --network baseSepolia ${trustAddress} ${reputationAddress} ${escrowAddress}`);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
