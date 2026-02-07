/**
 * Step 1: Generate and Register Entity Secret with Circle
 * 
 * Run this ONCE to set up your Circle wallet integration
 */

const {
    generateEntitySecret,
    registerEntitySecretCiphertext
} = require('@circle-fin/developer-controlled-wallets');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const API_KEY = process.env.CIRCLE_API_KEY;
const ENTITY_SECRET = process.env.CIRCLE_ENTITY_SECRET;

async function main() {
    if (!API_KEY || !ENTITY_SECRET) {
        console.error('❌ Error: CIRCLE_API_KEY and CIRCLE_ENTITY_SECRET must be set in .env');
        console.log('\nCreate a .env file with:');
        console.log('CIRCLE_API_KEY=your_api_key');
        console.log('CIRCLE_ENTITY_SECRET=your_entity_secret');
        process.exit(1);
    }

    console.log('🔄 Registering Entity Secret with Circle...\n');

    try {
        // Use project root directory for recovery file
        const projectRoot = path.join(__dirname, '..');

        const response = await registerEntitySecretCiphertext({
            apiKey: API_KEY,
            entitySecret: ENTITY_SECRET,
            recoveryFileDownloadPath: projectRoot
        });

        console.log('✅ Entity Secret registered successfully!\n');

        if (response.data?.recoveryFile) {
            console.log('📁 Recovery file downloaded');
        }

        console.log('\n✅ Setup complete! Now run: node scripts/create-circle-wallet.js');

    } catch (error) {
        console.error('❌ Error:', error.message);

        if (error.response?.data) {
            console.error('Response:', JSON.stringify(error.response.data, null, 2));
        }
    }
}

main();
