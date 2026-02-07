/**
 * Contract ABIs for x402 Trust Protocol
 * Generated from compiled contracts
 */

export const TRUST_PROTOCOL_ABI = [
    "function getProviderInfo(address provider) view returns (uint256 score, uint8 tier, uint256 timeout, bool isActive)",
    "function getTrustTier(address provider) view returns (string)",
    "function needsEscrow(address provider) view returns (bool)",
    "function compareProviders(address[] providers) view returns (uint256[] scores, uint256[] timeouts)",
    "function reputationEngine() view returns (address)",
    "function escrowVault() view returns (address)"
];

export const REPUTATION_ENGINE_ABI = [
    "function registerWithStake(string endpoint) external",
    "function registerWithHumanityProof(string endpoint, bytes proof) external",
    "function getScore(address provider) view returns (uint256)",
    "function getTier(address provider) view returns (uint8)",
    "function getRecommendedTimeout(address provider) view returns (uint256)",
    "function isActive(address provider) view returns (bool)",
    "function providers(address) view returns (string endpoint, uint256 stake, uint256 registeredAt, uint8 tier, bool isActive)",
    "function PROVIDER_STAKE() view returns (uint256)",
    "event ProviderRegistered(address indexed provider, string endpoint, uint8 tier)",
    "event ScoreUpdated(address indexed provider, uint256 oldScore, uint256 newScore)"
];

export const ESCROW_VAULT_ABI = [
    "function createPayment(address provider, uint256 amount, bytes32 requestHash) external returns (bytes32 paymentId)",
    "function confirmDelivery(bytes32 paymentId, tuple(bytes32 requestHash, bytes32 responseHash, uint256 responseSize, bytes32 schemaHash, bytes signature) proof) external",
    "function claimTimeout(bytes32 paymentId) external",
    "function raiseDispute(bytes32 paymentId, bytes32 evidence) external returns (bytes32 disputeId)",
    "function setHumanFallback(bytes32 paymentId, address human) external",
    "function getPayment(bytes32 paymentId) view returns (tuple(address buyer, address provider, uint256 amount, bytes32 requestHash, uint256 createdAt, uint256 timeout, uint256 deliveryBlock, uint8 status, bool useEscrow))",
    "function getPaymentStatus(bytes32 paymentId) view returns (uint8)",
    "function MIN_PAYMENT() view returns (uint256)",
    "function GRACE_PERIOD() view returns (uint256)",
    "event PaymentCreated(bytes32 indexed paymentId, address indexed buyer, address indexed provider, uint256 amount, bool useEscrow, uint256 timeout)",
    "event PaymentReleased(bytes32 indexed paymentId, address indexed provider, uint256 amount)",
    "event PaymentRefunded(bytes32 indexed paymentId, address indexed buyer, uint256 amount)",
    "event DisputeRaised(bytes32 indexed paymentId, bytes32 indexed disputeId)"
];

export const DISPUTE_MANAGER_ABI = [
    "function registerAsArbitrator() external",
    "function withdrawArbitratorStake() external",
    "function getArbitratorPoolSize() view returns (uint256)",
    "function MIN_ARBITRATOR_POOL() view returns (uint256)",
    "function ARBITRATORS_PER_DISPUTE() view returns (uint256)",
    "function REQUIRED_MAJORITY() view returns (uint256)",
    "function ARBITRATOR_STAKE() view returns (uint256)",
    "function FAST_TRACK_THRESHOLD() view returns (uint256)",
    "function COMPLEX_THRESHOLD() view returns (uint256)"
];

export const ERC20_ABI = [
    "function approve(address spender, uint256 amount) returns (bool)",
    "function allowance(address owner, address spender) view returns (uint256)",
    "function balanceOf(address account) view returns (uint256)",
    "function transfer(address to, uint256 amount) returns (bool)",
    "function decimals() view returns (uint8)"
];
