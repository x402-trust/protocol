/**
 * Get Entity Public Key and Generate Ciphertext for Rotation
 */

const crypto = require('crypto');
const https = require('https');
require('dotenv').config();

const API_KEY = process.env.CIRCLE_API_KEY;

async function getPublicKey() {
    if (!API_KEY) {
        throw new Error('CIRCLE_API_KEY not set in .env');
    }

    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'api.circle.com',
            path: '/v1/w3s/config/entity/publicKey',
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${API_KEY}`,
                'Content-Type': 'application/json'
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    resolve(parsed);
                } catch (e) {
                    reject(new Error('Failed to parse response: ' + data));
                }
            });
        });

        req.on('error', reject);
        req.end();
    });
}

function encryptEntitySecret(entitySecret, publicKeyPem) {
    const buffer = Buffer.from(entitySecret, 'hex');
    const encrypted = crypto.publicEncrypt(
        {
            key: publicKeyPem,
            padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
            oaepHash: 'sha256'
        },
        buffer
    );
    return encrypted.toString('base64');
}

async function main() {
    console.log('🔄 Fetching Entity Public Key from Circle API...\n');

    try {
        const response = await getPublicKey();

        if (response.data?.publicKey) {
            const publicKey = response.data.publicKey;
            console.log('✅ Got Public Key!\n');
            console.log('Public Key (first 100 chars):');
            console.log(publicKey.substring(0, 100) + '...\n');

            // Generate new entity secret
            const newEntitySecret = crypto.randomBytes(32).toString('hex');
            console.log('🔐 New Entity Secret:');
            console.log(newEntitySecret + '\n');

            // Encrypt it
            const ciphertext = encryptEntitySecret(newEntitySecret, publicKey);
            console.log('🔒 Ciphertext (paste this in Circle Console):');
            console.log('='.repeat(60));
            console.log(ciphertext);
            console.log('='.repeat(60));

            console.log('\n📋 STEPS:');
            console.log('1. Go to Circle Console → Programmable Wallets → Config → Entity Secret');
            console.log('2. Click "Reset" (if you have recovery file) or contact support');
            console.log('3. Paste the ciphertext above');
            console.log('\n⚠️  Save this Entity Secret somewhere safe:');
            console.log(newEntitySecret);

        } else {
            console.error('❌ Failed to get public key:', response);
        }
    } catch (error) {
        console.error('❌ Error:', error.message);
    }
}

main();
