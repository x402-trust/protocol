/**
 * x402 Trust Protocol API Gateway
 * 
 * Provides REST API endpoints for trust scoring and escrow operations
 * with x402 USDC payment integration
 */

require('dotenv').config({ path: '../.env' });
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { ethers } = require('ethers');

const app = express();
const PORT = process.env.PORT || 3402;

// Middleware
app.use(cors());
app.use(helmet());
app.use(express.json());

// Contract addresses (Arc Testnet)
const CONTRACTS = {
    trustProtocol: '0x1eC0007C35Aa4A5008263e2C257942f4cb4F329F',
    reputationEngine: '0x86fa599c4474E8098400e57760543E7191B2DA1e',
    escrowVault: '0x8E46e646ab9caACC8322dBD5E17A08166F09B9FD',
    disputeManager: '0x7449713F47A782b5df27ac6d375A55E6dA7A58a9',
    usdc: '0x8Fd5A8a2d6373a1c299C46Ed7862CA277316237B'
};

// ABIs (simplified)
const TRUST_PROTOCOL_ABI = [
    "function getProviderInfo(address provider) view returns (uint256 score, uint8 tier, uint256 timeout, bool isActive)",
    "function getTrustTier(address provider) view returns (string)",
    "function needsEscrow(address provider) view returns (bool)",
    "function compareProviders(address[] providers) view returns (uint256[] scores, uint256[] timeouts)"
];

const REPUTATION_ENGINE_ABI = [
    "function getScore(address provider) view returns (uint256)",
    "function getTier(address provider) view returns (uint8)",
    "function getRecommendedTimeout(address provider) view returns (uint256)",
    "function isActive(address provider) view returns (bool)"
];

// Provider setup
const provider = new ethers.JsonRpcProvider('https://rpc.testnet.arc.network');
const trustProtocol = new ethers.Contract(CONTRACTS.trustProtocol, TRUST_PROTOCOL_ABI, provider);
const reputationEngine = new ethers.Contract(CONTRACTS.reputationEngine, REPUTATION_ENGINE_ABI, provider);

// x402 Payment configuration
const PAYMENT_ADDRESS = process.env.PAYMENT_ADDRESS || '0xc40fa288FF2A0C5b0481c97709614413F58014D0';
const PRICE_PER_CALL = '1000'; // 0.001 USDC (6 decimals)

// Tier names
const TIER_NAMES = ['UNKNOWN', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM'];

// Recommendations based on score
function getRecommendation(score) {
    if (score >= 850) return "Highly recommended - Elite provider with excellent track record";
    if (score >= 700) return "Recommended - Excellent provider, low risk";
    if (score >= 500) return "Acceptable - Good provider, use escrow protection recommended";
    if (score >= 400) return "Caution - Fair provider, escrow strongly recommended";
    return "Not recommended - Poor track record, high risk";
}

// x402 Payment middleware
function x402Middleware(req, res, next) {
    const paymentProof = req.headers['x-payment-proof'];

    // For demo, skip payment verification (in production, verify on-chain)
    if (process.env.SKIP_PAYMENT === 'true') {
        return next();
    }

    if (!paymentProof) {
        return res.status(402).json({
            error: 'Payment Required',
            message: 'This endpoint requires x402 USDC payment',
            payment: {
                address: PAYMENT_ADDRESS,
                amount: PRICE_PER_CALL,
                token: 'USDC',
                network: 'arc-testnet',
                chainId: 5042002
            },
            instructions: 'Transfer USDC to the address above, then retry with X-Payment-Proof header containing the transaction hash'
        });
    }

    // TODO: Verify payment on-chain
    next();
}

// --- API ROUTES ---

// Health check (free)
app.get('/health', (req, res) => {
    res.json({ status: 'ok', network: 'arc-testnet', contracts: CONTRACTS });
});

// API docs (free)
app.get('/docs', (req, res) => {
    res.json({
        name: 'x402 Trust Protocol API',
        version: '1.0.0',
        description: 'Trust scoring and escrow protection for AI agent payments',
        endpoints: [
            { method: 'GET', path: '/v1/provider/:address', description: 'Get provider trust info' },
            { method: 'POST', path: '/v1/compare', description: 'Compare multiple providers' }
        ],
        payment: {
            protocol: 'x402',
            token: 'USDC',
            network: 'arc-testnet',
            pricePerCall: '0.001 USDC'
        }
    });
});

// Get provider trust info
app.get('/v1/provider/:address', x402Middleware, async (req, res) => {
    try {
        const { address } = req.params;

        if (!ethers.isAddress(address)) {
            return res.status(400).json({ error: 'Invalid address' });
        }

        const [info, tierName, needsEscrow] = await Promise.all([
            trustProtocol.getProviderInfo(address),
            trustProtocol.getTrustTier(address),
            trustProtocol.needsEscrow(address)
        ]);

        const score = Number(info.score);
        const tier = Number(info.tier);
        const timeout = Number(info.timeout);
        const isActive = info.isActive;

        res.json({
            address,
            score,
            tier: TIER_NAMES[tier] || 'UNKNOWN',
            tierName,
            escrow_required: needsEscrow,
            recommended_timeout: timeout,
            is_active: isActive,
            recommendation: getRecommendation(score)
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Compare providers
app.post('/v1/compare', x402Middleware, async (req, res) => {
    try {
        const { providers } = req.body;

        if (!Array.isArray(providers) || providers.length < 2) {
            return res.status(400).json({ error: 'Provide at least 2 provider addresses' });
        }

        const validAddresses = providers.filter(a => ethers.isAddress(a));
        if (validAddresses.length !== providers.length) {
            return res.status(400).json({ error: 'Invalid address in list' });
        }

        const [scores, timeouts] = await trustProtocol.compareProviders(providers);

        const comparison = providers.map((address, i) => ({
            address,
            score: Number(scores[i]),
            recommended_timeout: Number(timeouts[i])
        }));

        // Sort by score descending
        comparison.sort((a, b) => b.score - a.score);

        res.json({
            comparison,
            recommended: comparison[0].address,
            reasoning: `${comparison[0].address} has the highest trust score (${comparison[0].score})`
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get provider score only (lightweight)
app.get('/v1/score/:address', x402Middleware, async (req, res) => {
    try {
        const { address } = req.params;

        if (!ethers.isAddress(address)) {
            return res.status(400).json({ error: 'Invalid address' });
        }

        const score = await reputationEngine.getScore(address);

        res.json({
            address,
            score: Number(score),
            recommendation: getRecommendation(Number(score))
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Check if escrow required
app.get('/v1/escrow/:address', x402Middleware, async (req, res) => {
    try {
        const { address } = req.params;

        if (!ethers.isAddress(address)) {
            return res.status(400).json({ error: 'Invalid address' });
        }

        const needsEscrow = await trustProtocol.needsEscrow(address);
        const score = await reputationEngine.getScore(address);

        res.json({
            address,
            escrow_required: needsEscrow,
            score: Number(score),
            reason: needsEscrow
                ? 'Provider score below GOLD tier threshold, escrow recommended for protection'
                : 'Provider has high trust score, direct payment is safe'
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 x402 Trust Protocol API running on port ${PORT}`);
    console.log(`📋 Docs: http://localhost:${PORT}/docs`);
    console.log(`🌐 Network: Arc Testnet (Chain ID: 5042002)`);
    console.log(`💰 Payment: ${PRICE_PER_CALL} USDC per call`);
});

module.exports = app;
