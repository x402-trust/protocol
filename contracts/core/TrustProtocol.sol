// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./ReputationEngine.sol";
import "./EscrowVault.sol";

/**
 * @title TrustProtocol
 * @notice Main entry point for x402 Trust Protocol
 * @dev Orchestrates ReputationEngine and EscrowVault for secure agent payments
 */
contract TrustProtocol is Ownable, ReentrancyGuard {
    
    // ═══════════════════════════════════════════════════════════════════════
    // STATE
    // ═══════════════════════════════════════════════════════════════════════
    
    ReputationEngine public reputationEngine;
    EscrowVault public escrowVault;
    
    // ═══════════════════════════════════════════════════════════════════════
    // EVENTS
    // ═══════════════════════════════════════════════════════════════════════
    
    event SecurePaymentInitiated(
        bytes32 indexed paymentId,
        address indexed buyer,
        address indexed provider,
        uint256 amount,
        uint256 providerScore
    );
    
    // ═══════════════════════════════════════════════════════════════════════
    // CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════════════════
    
    constructor(address _reputationEngine, address _escrowVault) Ownable(msg.sender) {
        reputationEngine = ReputationEngine(_reputationEngine);
        escrowVault = EscrowVault(_escrowVault);
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // MAIN FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════
    
    /**
     * @notice Make a secure payment with automatic trust-based routing
     * @param provider Provider address
     * @param amount Payment amount in USDC
     * @param requestHash Hash of the request for verification
     * @return paymentId Unique payment identifier
     */
    function securePayment(
        address provider,
        uint256 amount,
        bytes32 requestHash
    ) external nonReentrant returns (bytes32 paymentId) {
        // Check provider
        require(reputationEngine.isActive(provider), "Provider not active");
        
        uint256 score = reputationEngine.getScore(provider);
        
        // Route payment through escrow
        paymentId = escrowVault.createPayment(provider, amount, requestHash);
        
        emit SecurePaymentInitiated(paymentId, msg.sender, provider, amount, score);
        
        return paymentId;
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════
    
    /**
     * @notice Get comprehensive provider info
     */
    function getProviderInfo(address provider) external view returns (
        uint256 score,
        ReputationEngine.ProviderTier tier,
        uint256 recommendedTimeout,
        bool isActive,
        string memory endpoint
    ) {
        score = reputationEngine.getScore(provider);
        tier = reputationEngine.getTier(provider);
        recommendedTimeout = reputationEngine.getRecommendedTimeout(provider);
        isActive = reputationEngine.isActive(provider);
        
        (endpoint,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,) = reputationEngine.providers(provider);
    }
    
    /**
     * @notice Compare multiple providers
     */
    function compareProviders(address[] calldata providers_) external view returns (
        uint256[] memory scores,
        uint256[] memory timeouts
    ) {
        uint256 len = providers_.length;
        scores = new uint256[](len);
        timeouts = new uint256[](len);
        
        for (uint256 i = 0; i < len; i++) {
            scores[i] = reputationEngine.getScore(providers_[i]);
            timeouts[i] = reputationEngine.getRecommendedTimeout(providers_[i]);
        }
    }
    
    /**
     * @notice Get payment details
     */
    function getPaymentDetails(bytes32 paymentId) external view returns (
        EscrowVault.Payment memory payment
    ) {
        return escrowVault.getPayment(paymentId);
    }
    
    /**
     * @notice Check if payment needs escrow based on provider trust
     */
    function needsEscrow(address provider) external view returns (bool) {
        uint256 score = reputationEngine.getScore(provider);
        return score < 850; // Only Elite (850+) can skip escrow
    }
    
    /**
     * @notice Get trust tier description
     */
    function getTrustTier(address provider) external view returns (string memory) {
        uint256 score = reputationEngine.getScore(provider);
        
        if (score >= 850) return "Elite";
        if (score >= 700) return "Excellent";
        if (score >= 500) return "Good";
        if (score >= 400) return "Fair";
        return "Poor";
    }
}
