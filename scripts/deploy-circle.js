/**
 * Deploy x402 Trust Protocol using Circle Programmable Wallets
 * 
 * This script uses Circle SDK to deploy contracts with Gas Station (sponsored gas)
 */

const { initiateDeveloperControlledWalletsClient } = require('@circle-fin/developer-controlled-wallets');
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Load compiled contracts
const loadArtifact = (name) => {
    const artifactPath = path.join(__dirname, `../artifacts/contracts`);

    // Find the contract file
    const findContract = (dir, contractName) => {
        const files = fs.readdirSync(dir, { withFileTypes: true });
        for (const file of files) {
            const fullPath = path.join(dir, file.name);
            if (file.isDirectory()) {
                const result = findContract(fullPath, contractName);
                if (result) return result;
            } else if (file.name === `${contractName}.json`) {
                return JSON.parse(fs.readFileSync(fullPath, 'utf8'));
            }
        }
        return null;
    };

    return findContract(artifactPath, name);
};

async function main() {
    console.log('🚀 Deploying x402 Trust Protocol via Circle SDK...\n');

    // Initialize Circle SDK
    const circleSdk = initiateDeveloperControlledWalletsClient({
        apiKey: process.env.CIRCLE_API_KEY,
        entitySecret: process.env.CIRCLE_ENTITY_SECRET
    });

    const walletId = process.env.CIRCLE_WALLET_ID;
    const walletAddress = process.env.CIRCLE_WALLET_ADDRESS;

    console.log(`Wallet: ${walletAddress}`);
    console.log(`Wallet ID: ${walletId}\n`);

    // Load contract artifacts
    const artifacts = {
        MockUSDC: loadArtifact('MockUSDC'),
        ReputationEngine: loadArtifact('ReputationEngine'),
        EscrowVault: loadArtifact('EscrowVault'),
        DisputeManager: loadArtifact('DisputeManager'),
        TrustProtocol: loadArtifact('TrustProtocol')
    };

    // Helper to deploy contract via Circle
    async function deployContract(name, constructorArgs = []) {
        console.log(`📦 Deploying ${name}...`);

        const artifact = artifacts[name];
        if (!artifact) throw new Error(`Artifact not found for ${name}`);

        // Encode constructor arguments
        const iface = new ethers.Interface(artifact.abi);
        const deployData = artifact.bytecode +
            (constructorArgs.length > 0 ? iface.encodeDeploy(constructorArgs).slice(2) : '');

        // Create contract deployment transaction via Circle
        const response = await circleSdk.createContractExecutionTransaction({
            walletId,
            callData: deployData,
            contractAddress: '', // Empty for deployment
            fee: {
                type: 'level',
                config: {
                    feeLevel: 'MEDIUM'
                }
            }
        });

        const txId = response.data.id;
        console.log(`   Transaction ID: ${txId}`);

        // Wait for confirmation
        let tx;
        let attempts = 0;
        while (attempts < 60) {
            const status = await circleSdk.getTransaction({ id: txId });
            tx = status.data.transaction;

            if (tx.state === 'CONFIRMED') {
                console.log(`   ✅ Deployed at: ${tx.contractAddress}`);
                return tx.contractAddress;
            } else if (tx.state === 'FAILED') {
                throw new Error(`Deployment failed: ${tx.errorReason}`);
            }

            await new Promise(r => setTimeout(r, 2000));
            attempts++;
        }

        throw new Error('Deployment timeout');
    }

    // Helper to call contract function via Circle
    async function callContract(contractAddress, abi, functionName, args = []) {
        console.log(`   Calling ${functionName}...`);

        const iface = new ethers.Interface(abi);
        const callData = iface.encodeFunctionData(functionName, args);

        const response = await circleSdk.createContractExecutionTransaction({
            walletId,
            callData,
            contractAddress,
            fee: {
                type: 'level',
                config: {
                    feeLevel: 'MEDIUM'
                }
            }
        });

        const txId = response.data.id;

        // Wait for confirmation
        let attempts = 0;
        while (attempts < 30) {
            const status = await circleSdk.getTransaction({ id: txId });
            const tx = status.data.transaction;

            if (tx.state === 'CONFIRMED') {
                console.log(`   ✅ ${functionName} executed`);
                return tx;
            } else if (tx.state === 'FAILED') {
                throw new Error(`Call failed: ${tx.errorReason}`);
            }

            await new Promise(r => setTimeout(r, 2000));
            attempts++;
        }

        throw new Error('Transaction timeout');
    }

    try {
        // Deploy all contracts
        console.log('\n═══════════════════════════════════════════════════════════\n');

        // 1. MockUSDC
        const usdcAddress = await deployContract('MockUSDC');

        // 2. ReputationEngine
        const reputationAddress = await deployContract('ReputationEngine', [usdcAddress]);

        // 3. EscrowVault  
        const escrowAddress = await deployContract('EscrowVault', [usdcAddress, reputationAddress]);

        // 4. DisputeManager
        const disputeAddress = await deployContract('DisputeManager', [usdcAddress, escrowAddress]);

        // 5. TrustProtocol
        const trustAddress = await deployContract('TrustProtocol', [reputationAddress, escrowAddress]);

        // 6. Link contracts
        console.log('\n🔗 Linking contracts...');
        await callContract(reputationAddress, artifacts.ReputationEngine.abi, 'setEscrowVault', [escrowAddress]);
        await callContract(escrowAddress, artifacts.EscrowVault.abi, 'setDisputeManager', [disputeAddress]);

        // Summary
        console.log('\n═══════════════════════════════════════════════════════════');
        console.log('✅ DEPLOYMENT COMPLETE!');
        console.log('═══════════════════════════════════════════════════════════\n');

        const addresses = {
            USDC_ADDRESS: usdcAddress,
            REPUTATION_ENGINE_ADDRESS: reputationAddress,
            ESCROW_VAULT_ADDRESS: escrowAddress,
            DISPUTE_MANAGER_ADDRESS: disputeAddress,
            TRUST_PROTOCOL_ADDRESS: trustAddress
        };

        console.log('Contract Addresses:');
        console.log('-------------------');
        Object.entries(addresses).forEach(([key, value]) => {
            console.log(`${key}=${value}`);
        });

        // Save to .env
        const envPath = path.join(__dirname, '../.env');
        let envContent = fs.readFileSync(envPath, 'utf8');
        Object.entries(addresses).forEach(([key, value]) => {
            if (envContent.includes(key)) {
                envContent = envContent.replace(new RegExp(`${key}=.*`), `${key}=${value}`);
            } else {
                envContent += `\n${key}=${value}`;
            }
        });
        fs.writeFileSync(envPath, envContent);
        console.log('\n💾 Contract addresses saved to .env');

        // Save deployment info
        const deploymentInfo = {
            network: 'base-sepolia',
            deployedAt: new Date().toISOString(),
            deployer: walletAddress,
            contracts: addresses
        };
        fs.writeFileSync(
            path.join(__dirname, '../deployment.json'),
            JSON.stringify(deploymentInfo, null, 2)
        );
        console.log('💾 Deployment info saved to deployment.json');

    } catch (error) {
        console.error('\n❌ Deployment failed:', error.message);
        if (error.response?.data) {
            console.error('Details:', JSON.stringify(error.response.data, null, 2));
        }
        process.exit(1);
    }
}

main();
