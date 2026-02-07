/**
 * x402 Trust Protocol SDK
 * 
 * Secure USDC payments for AI agents with trust scoring and escrow protection
 */

export { TrustProtocolClient } from './client';

export {
    TrustTier,
    PaymentStatus,
    DisputePhase,
    DisputeTrack,
    DisputeOutcome,
    ProviderProfile,
    ProviderStats,
    Payment,
    PaymentResult,
    DeliveryProof,
    Dispute,
    TrustProtocolConfig,
    ProviderComparison,
    PaymentCreatedEvent,
    PaymentReleasedEvent,
    DisputeRaisedEvent
} from './types';

export {
    TRUST_PROTOCOL_ABI,
    REPUTATION_ENGINE_ABI,
    ESCROW_VAULT_ABI,
    DISPUTE_MANAGER_ABI,
    ERC20_ABI
} from './contracts';

// Default Base Sepolia configuration
export const BASE_SEPOLIA_CONFIG = {
    rpcUrl: 'https://sepolia.base.org',
    chainId: 84532,
    contracts: {
        trustProtocol: '',  // Not deployed yet
        reputationEngine: '',
        escrowVault: '',
        disputeManager: '',
        usdc: ''
    }
};

// Arc Testnet configuration (LIVE DEPLOYMENT v2)
export const ARC_TESTNET_CONFIG = {
    rpcUrl: 'https://rpc.testnet.arc.network',
    chainId: 5042002,
    blockExplorer: 'https://testnet.arcscan.app',
    contracts: {
        trustProtocol: '0x1eC0007C35Aa4A5008263e2C257942f4cb4F329F',
        reputationEngine: '0x86fa599c4474E8098400e57760543E7191B2DA1e',
        escrowVault: '0x35D3d7Ff317bca17a123D8B18923599Ac1F9d817',
        disputeManager: '0x7449713F47A782b5df27ac6d375A55E6dA7A58a9',
        trustOracle: '0xe8b92BAeDCc71876e74A35d6A575991782B752Bd',
        paymentRouter: '0xe37B0FA63A08A726D810A4692FeD16583a1D0Cf6',
        usdc: '0x8Fd5A8a2d6373a1c299C46Ed7862CA277316237B'  // MockUSDC
    }
};

// Default to Arc Testnet (current deployment)
export const DEFAULT_CONFIG = ARC_TESTNET_CONFIG;

// Re-export for convenience
export { ethers } from 'ethers';

