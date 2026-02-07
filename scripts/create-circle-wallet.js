/**
 * Create Circle Wallet on Base Sepolia
 */

const { initiateDeveloperControlledWalletsClient } = require('@circle-fin/developer-controlled-wallets');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

async function main() {
    const apiKey = process.env.CIRCLE_API_KEY;
    const entitySecret = process.env.CIRCLE_ENTITY_SECRET;

    if (!apiKey || !entitySecret) {
        console.error('❌ Missing CIRCLE_API_KEY or CIRCLE_ENTITY_SECRET in .env');
        return;
    }

    console.log('🔄 Initializing Circle SDK...');

    const circleDeveloperSdk = initiateDeveloperControlledWalletsClient({
        apiKey,
        entitySecret
    });

    try {
        // Step 1: Create Wallet Set
        console.log('📦 Creating Wallet Set...');
        const walletSetResponse = await circleDeveloperSdk.createWalletSet({
            name: 'x402-trust-protocol'
        });

        const walletSetId = walletSetResponse.data.walletSet.id;
        console.log(`✅ Wallet Set created: ${walletSetId}`);

        // Step 2: Create Wallet on Base Sepolia
        console.log('💳 Creating wallet on Base Sepolia...');
        const walletResponse = await circleDeveloperSdk.createWallets({
            accountType: 'EOA',
            blockchains: ['BASE-SEPOLIA'],
            count: 1,
            walletSetId
        });

        const wallet = walletResponse.data.wallets[0];

        console.log(`
╔════════════════════════════════════════════════════════════╗
║  ✅ Wallet Created Successfully!                           ║
╠════════════════════════════════════════════════════════════╣
║                                                            ║
║  Wallet ID: ${wallet.id}     ║
║  Address:   ${wallet.address}                     ║
║  Blockchain: BASE-SEPOLIA                                  ║
║                                                            ║
╠════════════════════════════════════════════════════════════╣
║  NEXT: Fund with ETH from faucet:                          ║
║  https://www.alchemy.com/faucets/base-sepolia              ║
╚════════════════════════════════════════════════════════════╝
`);

        // Append to .env
        const envAddition = `
# Circle Wallet
CIRCLE_WALLET_ID=${wallet.id}
CIRCLE_WALLET_ADDRESS=${wallet.address}
CIRCLE_WALLET_SET_ID=${walletSetId}
`;

        fs.appendFileSync(path.join(__dirname, '../.env'), envAddition);
        console.log('💾 Wallet info added to .env');

        // Save wallet info
        const walletInfo = {
            walletSetId,
            walletId: wallet.id,
            address: wallet.address,
            blockchain: 'BASE-SEPOLIA',
            createdAt: new Date().toISOString()
        };

        fs.writeFileSync(
            path.join(__dirname, '../circle-wallet.json'),
            JSON.stringify(walletInfo, null, 2)
        );
        console.log('💾 Wallet info saved to circle-wallet.json');

    } catch (error) {
        console.error('❌ Error:', error.message);
        if (error.response?.data) {
            console.error('Response:', JSON.stringify(error.response.data, null, 2));
        }
    }
}

main();
