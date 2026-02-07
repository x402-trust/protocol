# x402 Trust Protocol SDK

TypeScript SDK for interacting with the x402 Trust Protocol smart contracts.

## Installation

```bash
npm install @x402-trust/sdk
```

## Quick Start

```typescript
import { TrustProtocolClient, PaymentStatus } from '@x402-trust/sdk';
import { ethers } from 'ethers';

// Initialize client
const client = new TrustProtocolClient({
  rpcUrl: 'https://sepolia.base.org',
  contracts: {
    trustProtocol: '0x...',
    reputationEngine: '0x...',
    escrowVault: '0x...',
    disputeManager: '0x...',
    usdc: '0x...'
  },
  signer: yourSigner // ethers.Signer
});

// Check provider before paying
const score = await client.getProviderScore('0xProvider');
console.log(`Provider score: ${score}`);

const needsEscrow = await client.needsEscrow('0xProvider');
console.log(`Escrow required: ${needsEscrow}`);

// Create secure payment
const payment = await client.createSecurePayment({
  provider: '0xProvider',
  amount: BigInt(10e6), // 10 USDC
  requestHash: client.hashRequest('Get BTC price')
});

console.log(`Payment ID: ${payment.paymentId}`);
console.log(`Escrow used: ${payment.escrowUsed}`);
console.log(`Timeout: ${payment.timeoutMinutes} minutes`);

// Confirm delivery
await client.confirmDelivery(payment.paymentId, {
  requestHash: client.hashRequest('Get BTC price'),
  responseHash: client.hashResponse('$50,000'),
  responseSize: 100,
  signature: '0x...'
});

// Or raise dispute if service failed
const dispute = await client.raiseDispute(
  payment.paymentId,
  'Provider did not respond within timeout'
);
console.log(`Dispute ID: ${dispute.disputeId}`);
```

## API Reference

### Provider Info

- `getProviderScore(address)` - Get trust score (300-900)
- `getProviderTier(address)` - Get tier name (Elite/Excellent/Good/Fair/Poor)
- `getProviderStats(address)` - Get full stats object
- `needsEscrow(address)` - Check if escrow is required
- `compareProviders(addresses)` - Compare multiple providers

### Payments

- `createSecurePayment(params)` - Create payment with trust routing
- `confirmDelivery(paymentId, proof)` - Release escrowed funds
- `claimTimeout(paymentId)` - Claim refund after timeout
- `getPayment(paymentId)` - Get payment details
- `getPaymentStatus(paymentId)` - Get payment status

### Disputes

- `raiseDispute(paymentId, evidence)` - Start dispute process

### Registration

- `registerAsProvider(endpoint)` - Register with 500 USDC stake
- `registerAsArbitrator()` - Register as arbitrator with stake

### Utilities

- `getUsdcBalance(address)` - Get USDC balance
- `hashRequest(request)` - Create request hash
- `hashResponse(response)` - Create response hash

## Types

```typescript
type TrustTier = 'Elite' | 'Excellent' | 'Good' | 'Fair' | 'Poor';

enum PaymentStatus {
  None = 0,
  Pending = 1,
  Completed = 2,
  Refunded = 3,
  Disputed = 4,
  Stuck = 5
}

interface PaymentResult {
  paymentId: string;
  escrowUsed: boolean;
  timeoutMinutes: number;
  transactionHash: string;
}
```

## License

MIT
