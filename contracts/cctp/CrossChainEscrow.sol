// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title ICCTPMessageTransmitter
 * @notice Interface for Circle's CCTP MessageTransmitter
 */
interface IMessageTransmitter {
    function sendMessage(
        uint32 destinationDomain,
        bytes32 recipient,
        bytes calldata messageBody
    ) external returns (uint64 nonce);
    
    function receiveMessage(
        bytes calldata message,
        bytes calldata attestation
    ) external returns (bool success);
}

/**
 * @title ITokenMessenger  
 * @notice Interface for Circle's CCTP TokenMessenger (burn/mint)
 */
interface ITokenMessenger {
    function depositForBurn(
        uint256 amount,
        uint32 destinationDomain,
        bytes32 mintRecipient,
        address burnToken
    ) external returns (uint64 nonce);
    
    function depositForBurnWithCaller(
        uint256 amount,
        uint32 destinationDomain,
        bytes32 mintRecipient,
        address burnToken,
        bytes32 destinationCaller
    ) external returns (uint64 nonce);
}

/**
 * @title CrossChainEscrow
 * @notice Cross-chain escrow using Circle's CCTP for USDC transfers
 * @dev Enables payments on Chain A to release funds on Chain B with full escrow protection
 * 
 * Flow:
 * 1. Buyer creates payment on source chain (USDC escrowed)
 * 2. Provider delivers service
 * 3. Buyer confirms → CCTP burns USDC and sends message
 * 4. Provider claims on destination chain → USDC minted
 */
contract CrossChainEscrow is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    
    // ═══════════════════════════════════════════════════════════════════════
    // CONSTANTS
    // ═══════════════════════════════════════════════════════════════════════
    
    // CCTP Domain IDs
    uint32 public constant DOMAIN_ETHEREUM = 0;
    uint32 public constant DOMAIN_AVALANCHE = 1;
    uint32 public constant DOMAIN_OP_MAINNET = 2;
    uint32 public constant DOMAIN_ARBITRUM = 3;
    uint32 public constant DOMAIN_BASE = 6;
    uint32 public constant DOMAIN_POLYGON_POS = 7;
    
    uint256 public constant MIN_PAYMENT = 1e6;  // 1 USDC minimum
    uint256 public constant CROSS_CHAIN_FEE = 50; // 0.5% fee for cross-chain
    
    // ═══════════════════════════════════════════════════════════════════════
    // TYPES
    // ═══════════════════════════════════════════════════════════════════════
    
    enum CrossChainPaymentStatus {
        None,
        Pending,           // Payment created, awaiting delivery
        Confirmed,         // Buyer confirmed, CCTP message sent
        Completed,         // Funds claimed on destination
        Refunded,          // Refunded to buyer
        Disputed           // In dispute
    }
    
    struct CrossChainPayment {
        address buyer;
        address provider;
        uint256 amount;
        uint256 fee;
        bytes32 requestHash;
        uint32 sourceChain;
        uint32 destinationChain;
        bytes32 destinationRecipient;  // Provider's address on destination chain
        uint256 createdAt;
        uint256 timeout;
        CrossChainPaymentStatus status;
        uint64 cctpNonce;              // CCTP message nonce for tracking
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // STATE
    // ═══════════════════════════════════════════════════════════════════════
    
    IERC20 public immutable usdc;
    ITokenMessenger public tokenMessenger;
    IMessageTransmitter public messageTransmitter;
    
    uint32 public localDomain;
    
    mapping(bytes32 => CrossChainPayment) public payments;
    mapping(address => bytes32[]) public buyerPayments;
    mapping(address => bytes32[]) public providerPayments;
    
    // Cross-chain counterpart addresses on each domain
    mapping(uint32 => address) public remoteEscrows;
    
    // Pending claims (nonce => paymentId)
    mapping(uint64 => bytes32) public pendingClaims;
    
    uint256 public paymentNonce;
    uint256 public totalCrossChainVolume;
    uint256 public collectedFees;
    
    address public feeRecipient;
    
    // ═══════════════════════════════════════════════════════════════════════
    // EVENTS
    // ═══════════════════════════════════════════════════════════════════════
    
    event CrossChainPaymentCreated(
        bytes32 indexed paymentId,
        address indexed buyer,
        address indexed provider,
        uint256 amount,
        uint32 sourceChain,
        uint32 destinationChain
    );
    
    event CrossChainPaymentConfirmed(
        bytes32 indexed paymentId,
        uint64 cctpNonce,
        uint256 amount
    );
    
    event CrossChainPaymentCompleted(
        bytes32 indexed paymentId,
        bytes32 destinationRecipient,
        uint256 amount
    );
    
    event CrossChainPaymentRefunded(
        bytes32 indexed paymentId,
        address indexed buyer,
        uint256 amount
    );
    
    // ═══════════════════════════════════════════════════════════════════════
    // CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════════════════
    
    constructor(
        address _usdc,
        address _tokenMessenger,
        address _messageTransmitter,
        uint32 _localDomain,
        address _feeRecipient
    ) Ownable(msg.sender) {
        usdc = IERC20(_usdc);
        tokenMessenger = ITokenMessenger(_tokenMessenger);
        messageTransmitter = IMessageTransmitter(_messageTransmitter);
        localDomain = _localDomain;
        feeRecipient = _feeRecipient;
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // ADMIN
    // ═══════════════════════════════════════════════════════════════════════
    
    function setRemoteEscrow(uint32 domain, address escrow) external onlyOwner {
        remoteEscrows[domain] = escrow;
    }
    
    function setFeeRecipient(address _feeRecipient) external onlyOwner {
        feeRecipient = _feeRecipient;
    }
    
    function withdrawFees() external onlyOwner {
        uint256 amount = collectedFees;
        collectedFees = 0;
        usdc.safeTransfer(feeRecipient, amount);
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // CROSS-CHAIN PAYMENT FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════
    
    /**
     * @notice Create a cross-chain payment
     * @param provider Provider's address on source chain
     * @param amount Payment amount in USDC
     * @param destinationChain CCTP domain ID of destination chain
     * @param destinationRecipient Provider's address on destination chain (as bytes32)
     * @param requestHash Hash of the service request
     * @param timeout Escrow timeout in seconds
     * @return paymentId Unique payment identifier
     */
    function createCrossChainPayment(
        address provider,
        uint256 amount,
        uint32 destinationChain,
        bytes32 destinationRecipient,
        bytes32 requestHash,
        uint256 timeout
    ) external nonReentrant returns (bytes32 paymentId) {
        require(amount >= MIN_PAYMENT, "Amount too small");
        require(destinationChain != localDomain, "Use local escrow");
        require(remoteEscrows[destinationChain] != address(0), "Destination not supported");
        require(destinationRecipient != bytes32(0), "Invalid recipient");
        require(timeout >= 5 minutes && timeout <= 7 days, "Invalid timeout");
        
        // Calculate fee
        uint256 fee = (amount * CROSS_CHAIN_FEE) / 10000;
        uint256 netAmount = amount - fee;
        
        // Generate payment ID
        paymentId = keccak256(abi.encodePacked(
            msg.sender,
            provider,
            amount,
            block.timestamp,
            paymentNonce++
        ));
        
        // Take payment
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        collectedFees += fee;
        
        // Create payment record
        payments[paymentId] = CrossChainPayment({
            buyer: msg.sender,
            provider: provider,
            amount: netAmount,
            fee: fee,
            requestHash: requestHash,
            sourceChain: localDomain,
            destinationChain: destinationChain,
            destinationRecipient: destinationRecipient,
            createdAt: block.timestamp,
            timeout: timeout,
            status: CrossChainPaymentStatus.Pending,
            cctpNonce: 0
        });
        
        buyerPayments[msg.sender].push(paymentId);
        providerPayments[provider].push(paymentId);
        
        emit CrossChainPaymentCreated(
            paymentId,
            msg.sender,
            provider,
            netAmount,
            localDomain,
            destinationChain
        );
        
        return paymentId;
    }
    
    /**
     * @notice Confirm delivery and initiate cross-chain transfer
     * @param paymentId Payment identifier
     */
    function confirmCrossChainDelivery(bytes32 paymentId) external nonReentrant {
        CrossChainPayment storage p = payments[paymentId];
        
        require(p.buyer == msg.sender, "Only buyer");
        require(p.status == CrossChainPaymentStatus.Pending, "Invalid status");
        
        p.status = CrossChainPaymentStatus.Confirmed;
        
        // Approve and burn USDC via CCTP
        usdc.forceApprove(address(tokenMessenger), p.amount);
        
        // Initiate cross-chain transfer
        uint64 nonce = tokenMessenger.depositForBurn(
            p.amount,
            p.destinationChain,
            p.destinationRecipient,
            address(usdc)
        );
        
        p.cctpNonce = nonce;
        pendingClaims[nonce] = paymentId;
        
        totalCrossChainVolume += p.amount;
        
        emit CrossChainPaymentConfirmed(paymentId, nonce, p.amount);
    }
    
    /**
     * @notice Claim timeout refund (if provider didn't deliver)
     * @param paymentId Payment identifier
     */
    function claimCrossChainTimeout(bytes32 paymentId) external nonReentrant {
        CrossChainPayment storage p = payments[paymentId];
        
        require(p.buyer == msg.sender, "Only buyer");
        require(p.status == CrossChainPaymentStatus.Pending, "Invalid status");
        require(block.timestamp > p.createdAt + p.timeout, "Not timed out");
        
        p.status = CrossChainPaymentStatus.Refunded;
        
        // Refund full amount (including fee as compensation)
        usdc.safeTransfer(p.buyer, p.amount + p.fee);
        collectedFees -= p.fee;
        
        emit CrossChainPaymentRefunded(paymentId, p.buyer, p.amount + p.fee);
    }
    
    /**
     * @notice Mark payment as completed (called by remote escrow via CCTP message)
     * @param nonce CCTP nonce
     */
    function markCompleted(uint64 nonce) external {
        bytes32 paymentId = pendingClaims[nonce];
        require(paymentId != bytes32(0), "Unknown nonce");
        
        CrossChainPayment storage p = payments[paymentId];
        require(p.status == CrossChainPaymentStatus.Confirmed, "Invalid status");
        
        p.status = CrossChainPaymentStatus.Completed;
        
        emit CrossChainPaymentCompleted(paymentId, p.destinationRecipient, p.amount);
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════
    
    function getPayment(bytes32 paymentId) external view returns (CrossChainPayment memory) {
        return payments[paymentId];
    }
    
    function getBuyerPayments(address buyer) external view returns (bytes32[] memory) {
        return buyerPayments[buyer];
    }
    
    function getProviderPayments(address provider) external view returns (bytes32[] memory) {
        return providerPayments[provider];
    }
    
    function getSupportedDomains() external view returns (uint32[] memory domains, string[] memory names) {
        domains = new uint32[](6);
        names = new string[](6);
        
        domains[0] = DOMAIN_ETHEREUM; names[0] = "Ethereum";
        domains[1] = DOMAIN_AVALANCHE; names[1] = "Avalanche";
        domains[2] = DOMAIN_OP_MAINNET; names[2] = "Optimism";
        domains[3] = DOMAIN_ARBITRUM; names[3] = "Arbitrum";
        domains[4] = DOMAIN_BASE; names[4] = "Base";
        domains[5] = DOMAIN_POLYGON_POS; names[5] = "Polygon";
        
        return (domains, names);
    }
    
    function getDomainName(uint32 domain) external pure returns (string memory) {
        if (domain == DOMAIN_ETHEREUM) return "Ethereum";
        if (domain == DOMAIN_AVALANCHE) return "Avalanche";
        if (domain == DOMAIN_OP_MAINNET) return "Optimism";
        if (domain == DOMAIN_ARBITRUM) return "Arbitrum";
        if (domain == DOMAIN_BASE) return "Base";
        if (domain == DOMAIN_POLYGON_POS) return "Polygon";
        return "Unknown";
    }
    
    function estimateFee(uint256 amount) external pure returns (uint256 fee, uint256 netAmount) {
        fee = (amount * CROSS_CHAIN_FEE) / 10000;
        netAmount = amount - fee;
    }
    
    function getStats() external view returns (
        uint256 totalVolume,
        uint256 totalFees,
        uint256 paymentCount
    ) {
        return (totalCrossChainVolume, collectedFees, paymentNonce);
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // UTILITY
    // ═══════════════════════════════════════════════════════════════════════
    
    /**
     * @notice Convert address to bytes32 for CCTP
     */
    function addressToBytes32(address addr) external pure returns (bytes32) {
        return bytes32(uint256(uint160(addr)));
    }
    
    /**
     * @notice Convert bytes32 to address
     */
    function bytes32ToAddress(bytes32 b) external pure returns (address) {
        return address(uint160(uint256(b)));
    }
}
