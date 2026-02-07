# x402 Trust Protocol

> **Trust scoring, adaptive escrow, and dispute resolution for AI agent payments.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Network: Arc Testnet](https://img.shields.io/badge/Network-Arc%20Testnet-0066FF.svg)](https://testnet.arcscan.app)
[![Tests: 125 passing](https://img.shields.io/badge/Tests-125%20passing-brightgreen.svg)]()

---

## 🎯 The Problem

x402 enables AI agents to pay for API calls with USDC. But there's a critical vulnerability: **agents pay first, receive service after**. If a provider doesn't deliver, the agent loses funds with no recourse.

## 💡 The Solution

x402 Trust Protocol adds three protection layers:

```
Before:  Agent → Pay → Hope → Maybe receive service
After:   Agent → Check score → Decide → Pay securely → Guaranteed outcome
```

---

## 🏗️ 8 Deployed Contracts (Arc Testnet)

| Contract | Purpose | Address |
|----------|---------|---------|
| **TrustProtocol** | Main entry point | [`0x1eC0007C...329F`](https://testnet.arcscan.app/address/0x1eC0007C35Aa4A5008263e2C257942f4cb4F329F) |
| **ReputationEngine** | Trust scoring (1900 lines) | [`0x86fa599c...DA1e`](https://testnet.arcscan.app/address/0x86fa599c4474E8098400e57760543E7191B2DA1e) |
| **EscrowVault** | Payment lifecycle | [`0x35D3d7Ff...d817`](https://testnet.arcscan.app/address/0x35D3d7Ff317bca17a123D8B18923599Ac1F9d817) |
| **DisputeManager** | Multi-track disputes | [`0x7449713F...58a9`](https://testnet.arcscan.app/address/0x7449713F47A782b5df27ac6d375A55E6dA7A58a9) |
| **TrustOracle** | External data feeds | [`0xe8b92BAe...52Bd`](https://testnet.arcscan.app/address/0xe8b92BAeDCc71876e74A35d6A575991782B752Bd) |
| **PaymentRouter** | Auto-routing | [`0xe37B0FA6...0Cf6`](https://testnet.arcscan.app/address/0xe37B0FA63A08A726D810A4692FeD16583a1D0Cf6) |
| **CrossChainEscrow** | CCTP integration | Ready for deployment |
| **MockUSDC** | Test token | [`0x8Fd5A8a2...237B`](https://testnet.arcscan.app/address/0x8Fd5A8a2d6373a1c299C46Ed7862CA277316237B) |

**Chain ID:** 5042002 | **RPC:** https://rpc.testnet.arc.network

### Demo Transactions

| Action | Transaction Hash |
|--------|------------------|
| Mint USDC | [`0x5aa17f4e...`](https://testnet.arcscan.app/tx/0x5aa17f4e31a26b782ce1e6a9d95081e1cf6277205789eb3e0ab6c1024eced29f) |
| Approve Stake | [`0xbb15a47f...`](https://testnet.arcscan.app/tx/0xbb15a47fda09fa88cb258652e4f170c4c385ebdabeccb4f9d49f84a49dda6dac) |
| Register Provider | [`0x97155c0c...`](https://testnet.arcscan.app/tx/0x97155c0cd5f5491b66a25d29916f1c8be5c6134bc72dc312ca1dc5ac1960eecc) |
| Approve Escrow | [`0x522601f5...`](https://testnet.arcscan.app/tx/0x522601f5cd03f784eeb72aa47b8a641e33d95c8c9978fe7877de9f8024f941a2) |
| **Create Payment** | [`0xd9cb1e5e...`](https://testnet.arcscan.app/tx/0xd9cb1e5ed48a643bd38c6da678d97e6925a43c1141843c605041158b0972f33c) |

---

## ⚡ Novel Smart Contract Features

### 1. Sybil-Resistant Scoring

Multi-factor trust scoring (300-900) that takes TIME to build:

| Factor | Weight | Description |
|--------|--------|-------------|
| Success Rate | 35% | Successful / Total transactions |
| Volume-Weighted | 25% | Large tx count more |
| Counterparty Diversity | 20% | Unique buyers (anti-wash-trading) |
| Longevity | 10% | Time since registration |
| Response Speed | 10% | Avg response time |

**Hard Constraints:**
- Score > 600 requires **7 days**
- Score > 700 requires **30 days**
- Score > 800 requires **60 days**
- Max **+5 points/day** regardless of activity
- 100 tx in 60s = **auto-quarantine**

### 2. Two-Way Reputation (Buyer + Provider)

Both sides are rated:

```solidity
struct BuyerProfile {
    uint256 score;              // 300-900
    BuyerTier tier;             // Unknown → Premium
    uint256 disputesWon;        // Legitimate complaints
    uint256 disputesLost;       // Frivolous complaints
    uint256 hallucinationScore; // False claim detection
}
```

### 3. Cross-Chain Reputation (with Anti-Manipulation)

Import your reputation from another chain with **50% discount**:

| Day | Unlock | Example (800 imported) |
|-----|--------|------------------------|
| 0 | 50% | 400 |
| 7 | 60% | 480 |
| 15 | 75% | 600 |
| 30 | 100% | 800 |

Bad behavior? **Frozen** — restart from MIN_SCORE.

### 4. False-Flag Protection

- **24-hour waiting period** before flags take effect
- **Cross-validation**: ≥3 buyers must agree
- **Appeal system**: 48h window, 10 USDC stake
- **Flagger credibility**: Bad flaggers penalized

### 5. Hallucination Detection

- Buyers rate response quality (1-5 stars)
- Cross-agent consensus detects outliers
- 3+ outlier events = warning, severe = quarantine

### 6. Adaptive Escrow

```solidity
if (score >= 850) → Direct payment, 5 min timeout
if (score >= 700) → Escrow optional, 10 min timeout
if (score >= 500) → Escrow required, 15 min timeout
if (score < 500)  → Escrow + extra scrutiny, 20 min timeout
```

### 7. Three-Track Dispute Resolution

| Track | Trigger | Timeline |
|-------|---------|----------|
| FastTrack | <$100 | 60 hours |
| Standard | $100-$10K | 120 hours |
| Complex | >$10K | 192 hours |

### 8. CCTP Cross-Chain Payments

6 chains supported: Ethereum, Base, Arbitrum, Optimism, Polygon, Avalanche

---

## 🚀 Quick Start

```bash
# Clone
git clone https://github.com/x402-trust/protocol.git
cd protocol
npm install

# Test (125 tests)
npm run test

# Deploy
npx hardhat run scripts/deploy.js --network arcTestnet
```

---

## 🤖 OpenClaw Skill

```bash
clawhub install x402-trust
```

**5 Actions:**

| Action | Description |
|--------|-------------|
| `check_provider` | Get trust score and escrow recommendation |
| `secure_payment` | Pay with escrow protection |
| `confirm_delivery` | Release funds, update scores |
| `raise_dispute` | Start dispute process |
| `compare_providers` | Compare multiple providers |

---

## 📊 Test Coverage

**125 tests across 9 suites:**

| Suite | Tests |
|-------|-------|
| Security.test.js | 42 |
| CrossChainEscrow.test.js | 20 |
| BuyerReputation.test.js | 13 |
| Integration.test.js | 12 |
| CrossChainReputation.test.js | 11 |
| EscrowVault.test.js | 10 |
| ReputationEngine.test.js | 8 |
| DisputeManager.test.js | 5 |
| TrustProtocol.test.js | 4 |

---

## 🏆 USDC Hackathon Submission

- **Track:** SmartContract
- **Network:** Arc Testnet (Circle USDC L1)
- **Documentation:** [SUBMISSION.md](./SUBMISSION.md)

---

## 📄 License

MIT License — see [LICENSE](LICENSE)
