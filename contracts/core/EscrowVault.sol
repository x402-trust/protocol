// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./ReputationEngine.sol";

/**
 * @title EscrowVault
 * @notice Holds and releases payments based on trust scores with dispute support
 * @dev Part of x402 Trust Protocol - secure payments for AI agents
 */
contract EscrowVault is Ownable, ReentrancyGuard {
    
    // ═══════════════════════════════════════════════════════════════════════
    // CONSTANTS
    // ═══════════════════════════════════════════════════════════════════════
    
    uint256 public constant GRACE_PERIOD = 5 minutes;
    uint256 public constant MIN_PAYMENT = 1e6;  // 1 USDC
    uint256 public constant STUCK_THRESHOLD = 1 days;
    
    // ═══════════════════════════════════════════════════════════════════════
    // TYPES
    // ═══════════════════════════════════════════════════════════════════════
    
    enum PaymentStatus { 
        None,
        Pending,      // Waiting for delivery
        Completed,    // Delivered successfully
        Refunded,     // Timed out or dispute won by buyer
        Disputed,     // Under dispute
        Stuck         // Timeout exceeded, needs intervention
    }
    
    struct Payment {
        address buyer;
        address provider;
        uint256 amount;
        bytes32 requestHash;
        uint256 createdAt;
        uint256 timeout;
        uint256 deliveryBlock;    // Block when confirmed (for response time)
        PaymentStatus status;
        bool useEscrow;
    }
    
    struct DeliveryProof {
        bytes32 requestHash;
        bytes32 responseHash;
        uint256 responseSize;
        bytes32 schemaHash;
        bytes signature;
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // STATE
    // ═══════════════════════════════════════════════════════════════════════
    
    IERC20 public immutable usdc;
    ReputationEngine public reputationEngine;
    address public disputeManager;
    
    mapping(bytes32 => Payment) public payments;
    mapping(bytes32 => address) public humanFallback;
    mapping(address => uint256) public providerStakes;
    mapping(address => uint256) public initialStakes;
    
    uint256 public insuranceFund;
    uint256 public paymentNonce;
    
    // Slashing parameters
    uint256 public constant SLASH_PER_DISPUTE = 10;  // 10%
    uint256 public constant BAN_THRESHOLD = 50;       // 50% lost = banned
    
    // ═══════════════════════════════════════════════════════════════════════
    // EVENTS
    // ═══════════════════════════════════════════════════════════════════════
    
    event PaymentCreated(
        bytes32 indexed paymentId,
        address indexed buyer,
        address indexed provider,
        uint256 amount,
        bool useEscrow,
        uint256 timeout
    );
    
    event PaymentReleased(bytes32 indexed paymentId, address indexed provider, uint256 amount);
    event PaymentRefunded(bytes32 indexed paymentId, address indexed buyer, uint256 amount);
    event DisputeRaised(bytes32 indexed paymentId, bytes32 indexed disputeId);
    event ProviderSlashed(address indexed provider, uint256 amount);
    event HumanFallbackSet(bytes32 indexed paymentId, address human);
    event PaymentMarkedStuck(bytes32 indexed paymentId);
    
    // ═══════════════════════════════════════════════════════════════════════
    // MODIFIERS
    // ═══════════════════════════════════════════════════════════════════════
    
    modifier onlyDisputeManager() {
        require(msg.sender == disputeManager, "Only dispute manager");
        _;
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════════════════
    
    constructor(address _usdc, address _reputationEngine) Ownable(msg.sender) {
        usdc = IERC20(_usdc);
        reputationEngine = ReputationEngine(_reputationEngine);
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // ADMIN
    // ═══════════════════════════════════════════════════════════════════════
    
    function setDisputeManager(address _disputeManager) external onlyOwner {
        disputeManager = _disputeManager;
    }
    
    address public paymentRouter;
    
    function setPaymentRouter(address _paymentRouter) external onlyOwner {
        paymentRouter = _paymentRouter;
    }
    
    modifier onlyPaymentRouter() {
        require(msg.sender == paymentRouter, "Only payment router");
        _;
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // PAYMENT FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════
    
    /**
     * @notice Create a secure payment with trust-based routing
     * @param provider Provider address
     * @param amount Payment amount in USDC
     * @param requestHash Hash of the request (for verification)
     * @return paymentId Unique payment identifier
     */
    function createPayment(
        address provider,
        uint256 amount,
        bytes32 requestHash
    ) external nonReentrant returns (bytes32 paymentId) {
        require(amount >= MIN_PAYMENT, "Amount too small");
        require(reputationEngine.isActive(provider), "Provider not active");
        
        // Generate unique payment ID
        paymentId = keccak256(abi.encodePacked(
            msg.sender,
            provider,
            amount,
            block.timestamp,
            paymentNonce++
        ));
        
        // Get recommended timeout based on trust score
        uint256 timeout = reputationEngine.getRecommendedTimeout(provider);
        uint256 score = reputationEngine.getScore(provider);
        
        // Determine if escrow is needed
        // High trust (850+) = optional escrow
        // Medium trust (500-849) = required escrow
        // Low trust (<500) = required escrow with longer timeout
        bool useEscrow = score < 850;
        
        // Take payment from buyer
        require(usdc.transferFrom(msg.sender, address(this), amount), "Transfer failed");
        
        // Create payment record
        payments[paymentId] = Payment({
            buyer: msg.sender,
            provider: provider,
            amount: amount,
            requestHash: requestHash,
            createdAt: block.timestamp,
            timeout: timeout,
            deliveryBlock: 0,
            status: PaymentStatus.Pending,
            useEscrow: useEscrow
        });
        
        // If no escrow needed, release immediately
        if (!useEscrow) {
            _releasePayment(paymentId, 1000); // Assume fast response for direct
        }
        
        emit PaymentCreated(paymentId, msg.sender, provider, amount, useEscrow, timeout);
        
        return paymentId;
    }
    
    /**
     * @notice Create a payment on behalf of a buyer (called by PaymentRouter)
     * @param buyer The actual buyer address
     * @param provider Provider address
     * @param amount Payment amount in USDC
     * @param requestHash Hash of the request (for verification)
     * @return paymentId Unique payment identifier
     */
    function createPaymentFor(
        address buyer,
        address provider,
        uint256 amount,
        bytes32 requestHash
    ) external nonReentrant onlyPaymentRouter returns (bytes32 paymentId) {
        require(buyer != address(0), "Invalid buyer");
        require(amount >= MIN_PAYMENT, "Amount too small");
        require(reputationEngine.isActive(provider), "Provider not active");
        
        // Generate unique payment ID
        paymentId = keccak256(abi.encodePacked(
            buyer,
            provider,
            amount,
            block.timestamp,
            paymentNonce++
        ));
        
        // Get recommended timeout based on trust score
        uint256 timeout = reputationEngine.getRecommendedTimeout(provider);
        uint256 score = reputationEngine.getScore(provider);
        
        // Always use escrow when routed (router handles direct payments itself)
        bool useEscrow = true;
        
        // Take payment from router (router already has the funds)
        require(usdc.transferFrom(msg.sender, address(this), amount), "Transfer failed");
        
        // Create payment record with ACTUAL buyer
        payments[paymentId] = Payment({
            buyer: buyer,
            provider: provider,
            amount: amount,
            requestHash: requestHash,
            createdAt: block.timestamp,
            timeout: timeout,
            deliveryBlock: 0,
            status: PaymentStatus.Pending,
            useEscrow: useEscrow
        });
        
        emit PaymentCreated(paymentId, buyer, provider, amount, useEscrow, timeout);
        
        return paymentId;
    }
    
    /**
     * @notice Confirm delivery and release payment
     * @param paymentId Payment identifier
     * @param proof Delivery proof from provider
     */
    function confirmDelivery(
        bytes32 paymentId,
        DeliveryProof calldata proof
    ) external nonReentrant {
        Payment storage p = payments[paymentId];
        
        // CHECKS
        require(p.status == PaymentStatus.Pending, "Invalid status");
        require(msg.sender == p.buyer, "Only buyer");
        require(p.useEscrow, "No escrow");
        
        // Verify proof
        require(_validateProof(paymentId, proof), "Invalid proof");
        
        // Calculate response time (in ms) from timestamp difference
        uint256 responseTime = (block.timestamp - p.createdAt) * 1000;
        
        // EFFECTS - before external calls
        p.deliveryBlock = block.number;
        
        _releasePayment(paymentId, responseTime);
    }
    
    /**
     * @notice Claim refund after timeout
     * @param paymentId Payment identifier
     */
    function claimTimeout(bytes32 paymentId) external nonReentrant {
        Payment storage p = payments[paymentId];
        
        // CHECKS
        require(p.status == PaymentStatus.Pending, "Invalid status");
        require(msg.sender == p.buyer, "Only buyer");
        require(block.timestamp > p.createdAt + p.timeout + GRACE_PERIOD, "Not timed out");
        
        // EFFECTS
        p.status = PaymentStatus.Refunded;
        uint256 amount = p.amount;
        p.amount = 0;
        
        // INTERACTIONS
        require(usdc.transfer(p.buyer, amount), "Transfer failed");
        
        // Record failed transaction for provider
        reputationEngine.recordTransaction(p.provider, p.buyer, amount, false, 0);
        
        // Record timeout for buyer (they let it expire instead of confirming)
        reputationEngine.recordBuyerTimeout(p.buyer);
        
        emit PaymentRefunded(paymentId, p.buyer, amount);
    }
    
    /**
     * @notice Raise a dispute
     * @param paymentId Payment identifier
     * @param evidence Evidence hash
     */
    function raiseDispute(
        bytes32 paymentId,
        bytes32 evidence
    ) external nonReentrant returns (bytes32 disputeId) {
        Payment storage p = payments[paymentId];
        
        require(p.status == PaymentStatus.Pending, "Invalid status");
        require(msg.sender == p.buyer, "Only buyer");
        require(block.timestamp <= p.createdAt + p.timeout + GRACE_PERIOD, "Too late");
        
        p.status = PaymentStatus.Disputed;
        
        // Generate dispute ID
        disputeId = keccak256(abi.encodePacked(paymentId, block.timestamp));
        
        // Record dispute in reputation
        reputationEngine.recordDispute(p.provider);
        
        emit DisputeRaised(paymentId, disputeId);
        
        return disputeId;
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // DISPUTE RESOLUTION (Called by DisputeManager)
    // ═══════════════════════════════════════════════════════════════════════
    
    /**
     * @notice Resolve dispute in favor of buyer
     */
    function resolveForBuyer(bytes32 paymentId) external onlyDisputeManager nonReentrant {
        Payment storage p = payments[paymentId];
        require(p.status == PaymentStatus.Disputed, "Not disputed");
        
        // EFFECTS
        p.status = PaymentStatus.Refunded;
        uint256 amount = p.amount;
        p.amount = 0;
        
        // Slash provider
        uint256 slashAmount = _slashProvider(p.provider);
        
        // INTERACTIONS - pay buyer (original + half of slash)
        uint256 totalPayout = amount + slashAmount / 2;
        require(usdc.transfer(p.buyer, totalPayout), "Transfer failed");
        
        emit PaymentRefunded(paymentId, p.buyer, totalPayout);
    }
    
    /**
     * @notice Resolve dispute in favor of provider
     */
    function resolveForProvider(bytes32 paymentId) external onlyDisputeManager nonReentrant {
        Payment storage p = payments[paymentId];
        require(p.status == PaymentStatus.Disputed, "Not disputed");
        
        _releasePayment(paymentId, 0);
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // HUMAN FALLBACK
    // ═══════════════════════════════════════════════════════════════════════
    
    /**
     * @notice Set human fallback for stuck transactions
     */
    function setHumanFallback(bytes32 paymentId, address human) external {
        Payment storage p = payments[paymentId];
        require(msg.sender == p.buyer, "Only buyer");
        
        humanFallback[paymentId] = human;
        emit HumanFallbackSet(paymentId, human);
    }
    
    /**
     * @notice Mark payment as stuck
     */
    function markAsStuck(bytes32 paymentId) external {
        Payment storage p = payments[paymentId];
        require(p.status == PaymentStatus.Pending || p.status == PaymentStatus.Disputed, "Invalid status");
        require(block.timestamp > p.createdAt + p.timeout + STUCK_THRESHOLD, "Not stuck yet");
        
        p.status = PaymentStatus.Stuck;
        emit PaymentMarkedStuck(paymentId);
    }
    
    /**
     * @notice Human intervention for stuck payments
     */
    function humanIntervention(bytes32 paymentId, bool refund) external nonReentrant {
        Payment storage p = payments[paymentId];
        require(msg.sender == humanFallback[paymentId], "Not authorized");
        require(p.status == PaymentStatus.Stuck, "Not stuck");
        
        if (refund) {
            p.status = PaymentStatus.Refunded;
            uint256 amount = p.amount;
            p.amount = 0;
            require(usdc.transfer(p.buyer, amount), "Transfer failed");
            emit PaymentRefunded(paymentId, p.buyer, amount);
        } else {
            _releasePayment(paymentId, 0);
        }
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // PROVIDER STAKE
    // ═══════════════════════════════════════════════════════════════════════
    
    /**
     * @notice Add stake as provider (for slashing protection)
     */
    function addProviderStake(uint256 amount) external nonReentrant {
        require(usdc.transferFrom(msg.sender, address(this), amount), "Transfer failed");
        providerStakes[msg.sender] += amount;
        initialStakes[msg.sender] += amount;
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════
    
    function getPayment(bytes32 paymentId) external view returns (Payment memory) {
        return payments[paymentId];
    }
    
    function getPaymentStatus(bytes32 paymentId) external view returns (PaymentStatus) {
        return payments[paymentId].status;
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // INTERNAL FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════
    
    function _releasePayment(bytes32 paymentId, uint256 responseTime) internal {
        Payment storage p = payments[paymentId];
        
        // EFFECTS
        p.status = PaymentStatus.Completed;
        uint256 amount = p.amount;
        address provider = p.provider;
        p.amount = 0;
        
        // INTERACTIONS
        require(usdc.transfer(provider, amount), "Transfer failed");
        
        // Update provider reputation
        reputationEngine.recordTransaction(provider, p.buyer, amount, true, responseTime);
        
        // Update buyer reputation (successful payment)
        reputationEngine.recordBuyerTransaction(p.buyer, amount, true, responseTime);
        
        emit PaymentReleased(paymentId, provider, amount);
    }
    
    function _slashProvider(address provider) internal returns (uint256 slashAmount) {
        uint256 stake = providerStakes[provider];
        if (stake == 0) return 0;
        
        slashAmount = (stake * SLASH_PER_DISPUTE) / 100;
        providerStakes[provider] -= slashAmount;
        
        // Half to insurance, half to buyer
        insuranceFund += slashAmount / 2;
        
        emit ProviderSlashed(provider, slashAmount);
        
        // Check for ban
        uint256 remaining = (providerStakes[provider] * 100) / initialStakes[provider];
        if (remaining < (100 - BAN_THRESHOLD)) {
            // Ban would be handled by ReputationEngine
        }
        
        return slashAmount;
    }
    
    function _validateProof(bytes32 paymentId, DeliveryProof calldata proof) internal view returns (bool) {
        Payment storage p = payments[paymentId];
        
        // 1. Request hash must match
        if (proof.requestHash != p.requestHash) return false;
        
        // 2. Size must be reasonable (at least 32 bytes)
        if (proof.responseSize < 32) return false;
        
        // 3. Signature verification (simplified for hackathon)
        // In production: verify ECDSA signature from provider
        if (proof.signature.length < 65) return false;
        
        return true;
    }
}
