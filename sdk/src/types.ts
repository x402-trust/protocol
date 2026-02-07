/**
 * x402 Trust Protocol SDK Types
 */

// Trust tiers
export type TrustTier = 'Elite' | 'Excellent' | 'Good' | 'Fair' | 'Poor' | 'Newcomer' | 'Verified';

// Payment status
export enum PaymentStatus {
    None = 0,
    Pending = 1,
    Completed = 2,
    Refunded = 3,
    Disputed = 4,
    Stuck = 5
}

// Provider profile
export interface ProviderProfile {
    endpoint: string;
    stake: bigint;
    registeredAt: number;
    tier: number;
    isActive: boolean;
    transactionCount: number;
    successfulCount: number;
    disputeCount: number;
    totalVolume: bigint;
    uniqueCounterparties: number;
}

// Provider stats (public view)
export interface ProviderStats {
    address: string;
    score: number;
    tier: TrustTier;
    successRate: number;
    averageResponseTime: number;
    totalTransactions: number;
    disputeRate: number;
    isActive: boolean;
}

// Payment info
export interface Payment {
    id: string;
    buyer: string;
    provider: string;
    amount: bigint;
    requestHash: string;
    createdAt: number;
    timeout: number;
    status: PaymentStatus;
    useEscrow: boolean;
}

// Payment result from createPayment
export interface PaymentResult {
    paymentId: string;
    escrowUsed: boolean;
    timeoutMinutes: number;
    transactionHash: string;
}

// Delivery proof
export interface DeliveryProof {
    requestHash: string;
    responseHash: string;
    responseSize: number;
    schemaHash?: string;
    signature: string;
}

// Dispute info
export interface Dispute {
    id: string;
    paymentId: string;
    phase: DisputePhase;
    track: DisputeTrack;
    createdAt: number;
    resolvedAt?: number;
    buyerEvidence: string;
    providerEvidence?: string;
    outcome?: DisputeOutcome;
}

export enum DisputePhase {
    Evidence = 0,
    Voting = 1,
    Reveal = 2,
    Resolved = 3
}

export enum DisputeTrack {
    FastTrack = 0,  // 60h
    Standard = 1,   // 120h
    Complex = 2     // 192h
}

export enum DisputeOutcome {
    None = 0,
    BuyerWins = 1,
    ProviderWins = 2
}

// SDK configuration
export interface TrustProtocolConfig {
    rpcUrl: string;
    contracts: {
        trustProtocol: string;
        reputationEngine: string;
        escrowVault: string;
        disputeManager: string;
        usdc: string;
    };
    signer?: any; // ethers.Signer
}

// Comparison result
export interface ProviderComparison {
    address: string;
    score: number;
    tier: TrustTier;
    timeout: number;
    recommendation: string;
}

// Event types
export interface PaymentCreatedEvent {
    paymentId: string;
    buyer: string;
    provider: string;
    amount: bigint;
    useEscrow: boolean;
    timeout: number;
}

export interface PaymentReleasedEvent {
    paymentId: string;
    provider: string;
    amount: bigint;
}

export interface DisputeRaisedEvent {
    paymentId: string;
    disputeId: string;
}
