// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "../core/TrustProtocol.sol";
import "../core/EscrowVault.sol";

/**
 * @title PaymentRouter
 * @notice Routes USDC payments based on trust scores
 * @dev Automatically decides between direct payment and escrow based on provider trust
 */
contract PaymentRouter is ReentrancyGuard {
    using SafeERC20 for IERC20;
    
    // --- STATE ---
    
    IERC20 public immutable usdc;
    TrustProtocol public immutable trustProtocol;
    EscrowVault public immutable escrowVault;
    
    // Payment statistics
    mapping(address => uint256) public totalPaymentsSent;
    mapping(address => uint256) public totalPaymentsReceived;
    mapping(address => uint256) public directPaymentCount;
    mapping(address => uint256) public escrowPaymentCount;
    
    // Fee configuration
    uint256 public constant PROTOCOL_FEE_BPS = 10; // 0.1% fee
    uint256 public constant BPS_DENOMINATOR = 10000;
    address public feeRecipient;
    uint256 public totalFeesCollected;
    
    // --- STRUCTS ---
    
    struct PaymentRoute {
        bool useEscrow;
        uint256 timeout;
        uint256 providerScore;
        string providerTier;
    }
    
    struct PaymentReceipt {
        bytes32 paymentId;
        address buyer;
        address provider;
        uint256 amount;
        uint256 fee;
        bool usedEscrow;
        uint256 timestamp;
    }
    
    // --- EVENTS ---
    
    event PaymentRouted(
        bytes32 indexed paymentId,
        address indexed buyer,
        address indexed provider,
        uint256 amount,
        bool usedEscrow,
        uint256 providerScore
    );
    
    event DirectPaymentSent(
        address indexed buyer,
        address indexed provider,
        uint256 amount,
        uint256 fee
    );
    
    event FeeCollected(uint256 amount);
    event FeeRecipientUpdated(address newRecipient);
    
    // --- CONSTRUCTOR ---
    
    constructor(
        address _usdc,
        address _trustProtocol,
        address _escrowVault,
        address _feeRecipient
    ) {
        require(_usdc != address(0), "Invalid USDC");
        require(_trustProtocol != address(0), "Invalid TrustProtocol");
        require(_escrowVault != address(0), "Invalid EscrowVault");
        require(_feeRecipient != address(0), "Invalid fee recipient");
        
        usdc = IERC20(_usdc);
        trustProtocol = TrustProtocol(_trustProtocol);
        escrowVault = EscrowVault(_escrowVault);
        feeRecipient = _feeRecipient;
    }
    
    // --- MAIN FUNCTIONS ---
    
    /**
     * @notice Get the recommended payment route for a provider
     * @param provider Address to check
     * @return route Payment routing recommendation
     */
    function getPaymentRoute(address provider) public view returns (PaymentRoute memory route) {
        (uint256 score, ReputationEngine.ProviderTier tier, uint256 timeout, bool isActive, ) = trustProtocol.getProviderInfo(provider);
        
        route.providerScore = score;
        route.timeout = timeout;
        route.useEscrow = trustProtocol.needsEscrow(provider);
        
        // Get tier name
        if (tier == ReputationEngine.ProviderTier.Unregistered) route.providerTier = "UNKNOWN";
        else if (tier == ReputationEngine.ProviderTier.Newcomer) route.providerTier = "BRONZE";
        else if (tier == ReputationEngine.ProviderTier.Graduated) route.providerTier = "SILVER";
        else if (tier == ReputationEngine.ProviderTier.Verified) route.providerTier = "PLATINUM";
        
        return route;
    }
    
    /**
     * @notice Route a payment to a provider (auto-selects direct or escrow)
     * @param provider Provider address
     * @param amount Payment amount in USDC
     * @param requestHash Hash of the request being paid for
     * @return paymentId Payment ID (for escrow) or bytes32(0) for direct
     * @return usedEscrow Whether escrow was used
     */
    function routePayment(
        address provider,
        uint256 amount,
        bytes32 requestHash
    ) external nonReentrant returns (bytes32 paymentId, bool usedEscrow) {
        require(provider != address(0), "Invalid provider");
        require(amount > 0, "Amount must be > 0");
        
        PaymentRoute memory route = getPaymentRoute(provider);
        
        // Calculate fee
        uint256 fee = (amount * PROTOCOL_FEE_BPS) / BPS_DENOMINATOR;
        uint256 netAmount = amount - fee;
        
        // Transfer USDC from sender
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        
        // Collect fee
        if (fee > 0) {
            usdc.safeTransfer(feeRecipient, fee);
            totalFeesCollected += fee;
            emit FeeCollected(fee);
        }
        
        if (route.useEscrow) {
            // Route through escrow
            usdc.forceApprove(address(escrowVault), netAmount);
            paymentId = escrowVault.createPaymentFor(msg.sender, provider, netAmount, requestHash);
            usedEscrow = true;
            escrowPaymentCount[msg.sender]++;
        } else {
            // Direct payment to provider
            usdc.safeTransfer(provider, netAmount);
            paymentId = keccak256(abi.encodePacked(msg.sender, provider, amount, block.timestamp));
            usedEscrow = false;
            directPaymentCount[msg.sender]++;
            
            emit DirectPaymentSent(msg.sender, provider, netAmount, fee);
        }
        
        // Update statistics
        totalPaymentsSent[msg.sender] += amount;
        totalPaymentsReceived[provider] += netAmount;
        
        emit PaymentRouted(paymentId, msg.sender, provider, amount, usedEscrow, route.providerScore);
        
        return (paymentId, usedEscrow);
    }
    
    /**
     * @notice Make a direct payment (bypass escrow check)
     * @dev Use only when you explicitly trust the provider
     */
    function directPayment(
        address provider,
        uint256 amount
    ) external nonReentrant returns (bytes32 paymentId) {
        require(provider != address(0), "Invalid provider");
        require(amount > 0, "Amount must be > 0");
        
        // Calculate fee
        uint256 fee = (amount * PROTOCOL_FEE_BPS) / BPS_DENOMINATOR;
        uint256 netAmount = amount - fee;
        
        // Transfer
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        usdc.safeTransfer(provider, netAmount);
        
        if (fee > 0) {
            usdc.safeTransfer(feeRecipient, fee);
            totalFeesCollected += fee;
        }
        
        paymentId = keccak256(abi.encodePacked(msg.sender, provider, amount, block.timestamp, "direct"));
        
        totalPaymentsSent[msg.sender] += amount;
        totalPaymentsReceived[provider] += netAmount;
        directPaymentCount[msg.sender]++;
        
        emit DirectPaymentSent(msg.sender, provider, netAmount, fee);
        
        return paymentId;
    }
    
    /**
     * @notice Force escrow payment (bypass trust check)
     * @dev Use when you want extra protection regardless of provider trust
     */
    function escrowPayment(
        address provider,
        uint256 amount,
        bytes32 requestHash
    ) external nonReentrant returns (bytes32 paymentId) {
        require(provider != address(0), "Invalid provider");
        require(amount > 0, "Amount must be > 0");
        
        // Calculate fee
        uint256 fee = (amount * PROTOCOL_FEE_BPS) / BPS_DENOMINATOR;
        uint256 netAmount = amount - fee;
        
        // Transfer
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        
        if (fee > 0) {
            usdc.safeTransfer(feeRecipient, fee);
            totalFeesCollected += fee;
        }
        
        // Create escrow
        usdc.forceApprove(address(escrowVault), netAmount);
        paymentId = escrowVault.createPaymentFor(msg.sender, provider, netAmount, requestHash);
        
        totalPaymentsSent[msg.sender] += amount;
        escrowPaymentCount[msg.sender]++;
        
        emit PaymentRouted(paymentId, msg.sender, provider, amount, true, 0);
        
        return paymentId;
    }
    
    // --- VIEW FUNCTIONS ---
    
    /**
     * @notice Get payment statistics for an address
     */
    function getPaymentStats(address account) external view returns (
        uint256 totalSent,
        uint256 totalReceived,
        uint256 directCount,
        uint256 escrowCount
    ) {
        return (
            totalPaymentsSent[account],
            totalPaymentsReceived[account],
            directPaymentCount[account],
            escrowPaymentCount[account]
        );
    }
    
    /**
     * @notice Calculate fee for a given amount
     */
    function calculateFee(uint256 amount) external pure returns (uint256) {
        return (amount * PROTOCOL_FEE_BPS) / BPS_DENOMINATOR;
    }
    
    /**
     * @notice Check if provider is recommended for direct payment
     */
    function canPayDirect(address provider) external view returns (bool) {
        return !trustProtocol.needsEscrow(provider);
    }
    
    // --- ADMIN FUNCTIONS ---
    
    /**
     * @notice Update fee recipient
     */
    function setFeeRecipient(address newRecipient) external {
        require(msg.sender == feeRecipient, "Only current recipient");
        require(newRecipient != address(0), "Invalid recipient");
        feeRecipient = newRecipient;
        emit FeeRecipientUpdated(newRecipient);
    }
}
