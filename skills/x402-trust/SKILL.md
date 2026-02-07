---
name: x402-trust
description: Secure x402 payments with trust scoring and escrow protection for AI agents
homepage: https://github.com/x402-trust/protocol
---

# x402 Trust Protocol Skill

This skill enables AI agents to make secure x402 payments by checking provider reputation and using escrow protection when needed. It solves the "pay-then-deliver" risk in x402 by adding trust scoring, adaptive escrow, and dispute resolution.

## Problem Solved

x402 payments are "pay first, receive service after" - risky for agents. This skill adds:
- **Trust Scoring**: Check provider reputation (300-900) before paying
- **Adaptive Escrow**: Low-trust providers require escrow protection
- **Dispute Resolution**: If service fails, get your USDC back

## Available Actions

### check_provider

Check a provider's trust score before making a payment.

**Usage:**
```
Check the trust score for provider 0x1234...5678
```

**Returns:**
- `score`: Trust score (300-900)
- `tier`: Elite (850+) / Excellent (700+) / Good (500+) / Fair (400+) / Poor
- `escrow_required`: Whether escrow protection is needed
- `recommended_timeout`: Suggested escrow timeout in minutes

### secure_payment

Make a USDC payment with trust-based escrow protection.

**Usage:**
```
Make a secure payment of 10 USDC to provider 0x1234...5678 for "translation service"
```

**Parameters:**
- `provider_address`: Provider's wallet address
- `amount_usdc`: Payment amount in USDC
- `request_description`: What you're paying for

**Returns:**
- `payment_id`: Unique identifier for tracking
- `escrow_used`: Whether funds are in escrow
- `timeout_minutes`: How long until timeout

### confirm_delivery

Confirm successful delivery and release escrowed payment.

**Usage:**
```
Confirm delivery for payment abc123...
```

**Parameters:**
- `payment_id`: Payment identifier from secure_payment

**Returns:**
- `success`: Boolean
- `provider_new_score`: Updated provider score

### raise_dispute

Dispute a failed or incorrect delivery.

**Usage:**
```
Raise dispute for payment abc123... because "no response received"
```

**Parameters:**
- `payment_id`: Payment identifier
- `reason`: Description of the issue

**Returns:**
- `dispute_id`: Dispute identifier
- `track`: FastTrack (60h) / Standard (120h) / Complex (192h)
- `resolution_deadline`: When dispute will be resolved

### compare_providers

Compare multiple providers for the same service.

**Usage:**
```
Compare providers 0x1234..., 0x5678..., 0x9abc... and recommend the best
```

**Returns:**
- `comparison`: Array of provider scores and stats
- `recommended`: Best provider address

## Configuration

Add to your OpenClaw config:

```json
{
  "skills": {
    "entries": {
      "x402-trust": {
        "enabled": true,
        "env": {
          "RPC_URL": "https://rpc.testnet.arc.network",
          "TRUST_PROTOCOL_ADDRESS": "0x1eC0007C35Aa4A5008263e2C257942f4cb4F329F",
          "EVM_PRIVATE_KEY": "0x..."
        }
      }
    }
  }
}
```

## Smart Contracts

- **Network**: Arc Testnet (Circle USDC L1)
- **TrustProtocol**: Main entry point
- **ReputationEngine**: Trust scoring with anti-gaming
- **EscrowVault**: Payment lifecycle and slashing
- **DisputeManager**: Commit-reveal arbitration
- **TrustOracle**: External trust data feeds
- **PaymentRouter**: Automatic payment routing

## Links

- [GitHub Repository](https://github.com/x402-trust/protocol)
- [Arc Testnet Explorer](https://testnet.arcscan.app)
- [x402 Protocol](https://x402.org)

## Example Flow

```
Agent: check_provider 0xProviderAddress
→ Score: 650 (Good), Escrow: Required, Timeout: 15min

Agent: secure_payment 0xProviderAddress 5 USDC "Get BTC price"
→ Payment ID: 0xabc123, Escrow: Yes

[Provider delivers service]

Agent: confirm_delivery 0xabc123
→ Success! Provider score: 655 (+5)
```

## Why This Matters

AI agents need reliable economic infrastructure. This skill provides:
- **Predictable settlement**: USDC-based, on-chain
- **Risk mitigation**: Escrow protects buyers
- **Reputation system**: Bad actors get banned
- **Agent-native**: No human intervention required
