/**
 * x402 Trust Protocol SDK
 *
 * Secure USDC payments for AI agents with trust scoring and escrow protection
 */
export { TrustProtocolClient } from './client';
export { TrustTier, PaymentStatus, DisputePhase, DisputeTrack, DisputeOutcome, ProviderProfile, ProviderStats, Payment, PaymentResult, DeliveryProof, Dispute, TrustProtocolConfig, ProviderComparison, PaymentCreatedEvent, PaymentReleasedEvent, DisputeRaisedEvent } from './types';
export { TRUST_PROTOCOL_ABI, REPUTATION_ENGINE_ABI, ESCROW_VAULT_ABI, DISPUTE_MANAGER_ABI, ERC20_ABI } from './contracts';
export declare const BASE_SEPOLIA_CONFIG: {
    rpcUrl: string;
    chainId: number;
    contracts: {
        trustProtocol: string;
        reputationEngine: string;
        escrowVault: string;
        disputeManager: string;
        usdc: string;
    };
};
export declare const ARC_TESTNET_CONFIG: {
    rpcUrl: string;
    chainId: number;
    blockExplorer: string;
    contracts: {
        trustProtocol: string;
        reputationEngine: string;
        escrowVault: string;
        disputeManager: string;
        usdc: string;
    };
};
export declare const DEFAULT_CONFIG: {
    rpcUrl: string;
    chainId: number;
    blockExplorer: string;
    contracts: {
        trustProtocol: string;
        reputationEngine: string;
        escrowVault: string;
        disputeManager: string;
        usdc: string;
    };
};
export { ethers } from 'ethers';
