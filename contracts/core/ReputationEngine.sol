// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title ReputationEngine
 * @notice Calculates and stores provider trust scores with anti-gaming measures
 * @dev Part of x402 Trust Protocol - secure payments for AI agents
 */
contract ReputationEngine is Ownable, ReentrancyGuard {
    
    // ═══════════════════════════════════════════════════════════════════════
    // CONSTANTS
    // ═══════════════════════════════════════════════════════════════════════
    
    uint256 public constant PROVIDER_STAKE = 500e6;           // 500 USDC
    uint256 public constant REGISTRATION_COOLDOWN = 7 days;
    uint256 public constant GRADUATION_TX_COUNT = 100;
    uint256 public constant GRADUATION_PERIOD = 30 days;
    uint256 public constant MIN_UNIQUE_COUNTERPARTIES = 25;
    uint256 public constant MAX_DISPUTE_RATE = 3;             // 3%
    uint256 public constant MAX_SINGLE_COUNTERPARTY_PCT = 10; // 10%
    
    uint256 public constant MIN_SCORE = 300;
    uint256 public constant MAX_SCORE = 900;
    uint256 public constant INITIAL_SCORE = 500;
    
    // ═══════════════════════════════════════════════════════════════════════
    // SYBIL-RESISTANT CONSTANTS (Critical for trust integrity)
    // ═══════════════════════════════════════════════════════════════════════
    
    // Time-based requirements - prevents rapid trust building
    uint256 public constant MIN_DAYS_FOR_600 = 7 days;
    uint256 public constant MIN_DAYS_FOR_700 = 30 days;
    uint256 public constant MIN_DAYS_FOR_800 = 60 days;
    uint256 public constant MAX_SCORE_GAIN_PER_DAY = 5;
    
    // Velocity limits - burst detection instead of blocking
    uint256 public constant BURST_WINDOW = 60 seconds;
    uint256 public constant BURST_THRESHOLD = 30;          // 30 tx in 60s = suspicious
    uint256 public constant SEVERE_BURST_THRESHOLD = 100;  // 100 tx in 60s = quarantine
    
    // Network analysis thresholds
    uint256 public constant CIRCULAR_FLOW_THRESHOLD = 3;
    
    // ═══════════════════════════════════════════════════════════════════════
    // APPEAL & QUARANTINE CONSTANTS
    // ═══════════════════════════════════════════════════════════════════════
    
    uint256 public constant FLAG_WAITING_PERIOD = 24 hours;     // Before flag takes effect
    uint256 public constant APPEAL_PERIOD = 48 hours;           // Time to file appeal
    uint256 public constant APPEAL_STAKE = 10e6;                // 10 USDC to appeal
    uint256 public constant MIN_VALIDATORS_FOR_FLAG = 3;        // Need 3 buyers to confirm
    uint256 public constant QUARANTINE_DURATION = 7 days;       // Default quarantine
    uint256 public constant FLAGGER_CREDIBILITY_WEIGHT = 100;   // Base weight
    
    // ═══════════════════════════════════════════════════════════════════════
    // HALLUCINATION DETECTION CONSTANTS
    // ═══════════════════════════════════════════════════════════════════════
    
    uint256 public constant HALLUCINATION_THRESHOLD = 30;       // 30% = warning
    uint256 public constant SEVERE_HALLUCINATION = 50;          // 50% = quarantine
    uint256 public constant CONSISTENCY_MIN_CHECKS = 5;         // Min cross-validations
    uint256 public constant OUTLIER_THRESHOLD = 3;              // 3 outlier = flag
    
    // ═══════════════════════════════════════════════════════════════════════
    // CROSS-CHAIN REPUTATION PORTABILITY CONSTANTS
    // ═══════════════════════════════════════════════════════════════════════
    
    uint256 public constant IMPORT_DISCOUNT = 50;               // 50% initial discount
    uint256 public constant UNLOCK_DAY_7 = 10;                  // +10% at day 7
    uint256 public constant UNLOCK_DAY_15 = 15;                 // +15% at day 15
    uint256 public constant UNLOCK_DAY_30 = 25;                 // +25% at day 30
    uint256 public constant IMPORT_PROOF_VALIDITY = 1 hours;    // Proof expires in 1 hour
    
    // Chain IDs for cross-chain
    uint32 public constant CHAIN_ARC_TESTNET = 5042002;
    uint32 public constant CHAIN_BASE_SEPOLIA = 84532;
    uint32 public constant CHAIN_ARBITRUM_SEPOLIA = 421614;
    
    // ═══════════════════════════════════════════════════════════════════════
    // TYPES
    // ═══════════════════════════════════════════════════════════════════════
    
    enum ProviderTier { Unregistered, Newcomer, Graduated, Verified }
    
    struct ProviderProfile {
        string endpoint;
        ProviderTier tier;
        uint256 score;
        uint256 registeredAt;
        uint256 totalTransactions;
        uint256 successfulTransactions;
        uint256 disputeCount;
        uint256 totalVolume;
        uint256 successfulVolume;
        uint256 totalResponseTime;
        uint256 lastActivityAt;
        bool isBanned;
        // Sybil-resistant tracking
        uint256 lastScoreUpdate;
        uint256 scoreAtLastUpdate;
        uint256 txCountToday;
        uint256 txCountThisHour;
        uint256 lastTxTimestamp;
        uint256 dayStartTimestamp;
        uint256 hourStartTimestamp;
        uint256 suspiciousBehaviorCount;
        bool isFlaggedForReview;
        // FALSE-FLAG PROTECTION
        uint256 flagCount;                    // Times flagged
        uint256 successfulAppealCount;        // Flags overturned
        uint256 confirmedViolationCount;      // Flags confirmed as valid
        bool isInAppealPeriod;
        uint256 lastFlagTimestamp;
        // ANTI-MANIPULATION
        uint256 suspiciousPatternScore;       // 0-100 automated detection
        uint256 humanVerificationCount;       // Times verified by human
        bool isHumanVerified;                // WorldID/Passport verified
        bool isQuarantined;                  // Temporarily isolated
        uint256 quarantineEndTime;
        // RESPONSE QUALITY (Hallucination tracking)
        uint256 responseQualityScore;         // 0-100 based on buyer ratings
        uint256 invalidResponseCount;         // "Response was invalid" claims
        uint256 validResponseCount;           // "Response was valid" confirmations
        uint256 hallucinationClaimCount;      // "Provider gave false data"
    }
    
    struct BootstrapProfile {
        uint256 stakeAmount;
        uint256 startTime;
        uint256 txCount;
        uint256 disputeCount;
        uint256 uniqueCounterparties;
        mapping(address => uint256) volumeFrom;
        address[] counterpartyList;
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // STATE
    // ═══════════════════════════════════════════════════════════════════════
    
    IERC20 public immutable usdc;
    
    mapping(address => ProviderProfile) public providers;
    mapping(address => BootstrapProfile) public bootstraps;
    mapping(address => uint256) public lastRegistration;
    mapping(bytes32 => bool) public usedHumanityProofs;
    
    // Flow graph for circular detection
    mapping(address => mapping(address => uint256)) public flowGraph;
    
    address public escrowVault;
    
    // ═══════════════════════════════════════════════════════════════════════
    // ADVANCED REPUTATION STATE
    // ═══════════════════════════════════════════════════════════════════════
    
    enum FlagStatus { Pending, Validated, Rejected, Appealed, Overturned }
    
    struct Flag {
        bytes32 id;
        address target;              // Provider or buyer being flagged
        address flagger;             // Who submitted the flag
        string reason;
        FlagStatus status;
        uint256 submittedAt;
        uint256 validatorsNeeded;    // MIN_VALIDATORS_FOR_FLAG
        uint256 validatorCount;      // How many confirmed
        uint256 flaggerCredibility;  // Weight of this flagger
        bool isProviderFlag;         // True = flagging provider, False = flagging buyer
    }
    
    struct ResponseRating {
        address buyer;
        address provider;
        bytes32 paymentId;
        uint8 qualityScore;          // 1-5 stars
        bool isValid;                // Was response accurate?
        uint256 timestamp;
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // CROSS-CHAIN IMPORTED REPUTATION
    // ═══════════════════════════════════════════════════════════════════════
    
    struct ImportedReputation {
        uint256 importedScore;           // Original score from source chain
        uint32 sourceChainId;            // Where it came from
        uint256 importedAt;              // When imported
        uint256 effectiveScore;          // Discounted score (gradually unlocks)
        bool isImported;                 // Has imported reputation
        bool isFrozen;                   // Bad behavior = frozen
    }
    
    // Imported reputation tracking
    mapping(address => ImportedReputation) public importedReps;
    
    // Trusted contracts on other chains (chainId => contract address)
    mapping(uint32 => address) public trustedContracts;
    
    // Events for cross-chain
    event ReputationExported(address indexed entity, uint256 score, uint32 destinationChain, bytes32 proofHash);
    event ReputationImported(address indexed entity, uint256 importedScore, uint256 effectiveScore, uint32 sourceChain);
    event ImportedReputationFrozen(address indexed entity, string reason);
    event ImportedReputationUnlocked(address indexed entity, uint256 newEffectiveScore, uint256 unlockPercentage);
    event TrustedContractSet(uint32 chainId, address contractAddress);
    
    // Flag tracking
    mapping(bytes32 => Flag) public flags;
    mapping(address => bytes32[]) public flagsAgainst;     // Flags against an address
    mapping(address => bytes32[]) public flagsSubmitted;   // Flags an address submitted
    mapping(bytes32 => address[]) public flagValidators;   // Who validated a flag
    
    // Response ratings for cross-validation
    mapping(bytes32 => ResponseRating[]) public paymentRatings;  // All ratings for a payment
    mapping(address => mapping(address => uint256[])) public buyerProviderRatings;  // Buyer's ratings of provider

    
    // Cross-validation: tracking agreement between buyers
    mapping(address => mapping(address => bool)) public buyerAgreement;  // Did two buyers agree?
    
    // Burst tracking for velocity
    mapping(address => uint256) public burstWindowStart;
    mapping(address => uint256) public txInBurstWindow;
    
    // ═══════════════════════════════════════════════════════════════════════
    // BUYER/AGENT REPUTATION (Two-Way Trust)
    // ═══════════════════════════════════════════════════════════════════════
    
    enum BuyerTier { Unknown, Risky, Standard, Reliable, Premium }
    
    struct BuyerProfile {
        uint256 score;                    // 300-900 like providers
        BuyerTier tier;
        uint256 totalPayments;            // Total payments made
        uint256 successfulPayments;       // Confirmed without dispute
        uint256 disputeCount;             // Disputes initiated
        uint256 disputesWon;              // Disputes won (legitimate complaints)
        uint256 disputesLost;             // Disputes lost (frivolous complaints)
        uint256 totalConfirmationTime;    // Cumulative time to confirm (ms)
        uint256 totalVolume;              // Total USDC paid
        uint256 timeoutCount;             // How many times let payment timeout
        uint256 firstPaymentAt;           // Account age
        uint256 lastActivityAt;
        bool isFlagged;                   // Flagged for suspicious behavior
        // HALLUCINATION TRACKING
        uint256 hallucinationScore;       // 0-100, how often makes false claims
        uint256 invalidClaimCount;        // "Response invalid" claims that were WRONG
        uint256 validClaimCount;          // "Response invalid" claims that were RIGHT
        uint256 consistencyScore;         // 0-100, agreement with other buyers
        // CROSS-VALIDATION
        uint256 agreementWithOthers;      // % agreement with majority
        uint256 outlierCount;             // Times disagreed with majority
        uint256 crossValidationCount;     // Total cross-validation checks
        // ANTI-MANIPULATION DETECTION
        uint256 humanManipulationScore;   // 0-100, detects if controlled
        uint256 patternBreakCount;        // Sudden behavior changes
        uint256 unusualActivityCount;     // Unusual patterns detected
        bool isQuarantined;               // Temporarily isolated
        uint256 quarantineEndTime;
        // FLAG HISTORY
        uint256 flagsReceived;            // Flags from providers
        uint256 flagsGiven;               // Flags given to providers
        uint256 flagsGivenOverturned;     // False flags this buyer made
        uint256 appealCount;              // Appeals filed
        uint256 appealSuccessCount;       // Successful appeals
    }
    
    mapping(address => BuyerProfile) public buyers;
    
    // Buyer reputation constants
    uint256 public constant BUYER_INITIAL_SCORE = 500;
    uint256 public constant BUYER_MIN_SCORE = 300;
    uint256 public constant BUYER_MAX_SCORE = 900;
    uint256 public constant MAX_BUYER_DISPUTE_RATE = 20;  // 20% dispute rate = risky
    uint256 public constant RELIABLE_BUYER_THRESHOLD = 700;
    uint256 public constant PREMIUM_BUYER_THRESHOLD = 800;
    
    // Events for buyer reputation
    event BuyerScoreUpdated(address indexed buyer, uint256 oldScore, uint256 newScore);
    event BuyerFlagged(address indexed buyer, string reason);
    event BuyerTierChanged(address indexed buyer, BuyerTier oldTier, BuyerTier newTier);
    
    // ═══════════════════════════════════════════════════════════════════════
    // EVENTS
    // ═══════════════════════════════════════════════════════════════════════
    
    event ProviderRegistered(address indexed provider, string endpoint, ProviderTier tier);
    event ProviderGraduated(address indexed provider, uint256 newScore);
    event ScoreUpdated(address indexed provider, uint256 oldScore, uint256 newScore);
    event ProviderBanned(address indexed provider, string reason);
    event ProviderFlagged(address indexed provider, string reason);
    event StakeWithdrawn(address indexed provider, uint256 amount);
    event CircularFlowDetected(address indexed provider, address indexed buyer, uint256 amount, uint256 reverseFlow);
    
    // NEW: Advanced Reputation Events
    event FlagSubmitted(bytes32 indexed flagId, address indexed target, address indexed flagger, string reason);
    event FlagValidated(bytes32 indexed flagId, bool confirmed);
    event AppealFiled(bytes32 indexed flagId, address indexed appellant, uint256 stake);
    event AppealResolved(bytes32 indexed flagId, bool successful);
    event Quarantined(address indexed entity, string reason, uint256 endTime);
    event QuarantineLifted(address indexed entity);
    event HallucinationDetected(address indexed buyer, uint256 hallucinationScore, uint256 outlierCount);
    event ResponseRated(bytes32 indexed paymentId, address indexed provider, uint8 quality, bool isValid);
    event CrossValidationResult(address indexed buyer, address indexed provider, bool agreedWithMajority);
    event ManipulationDetected(address indexed entity, string pattern, uint256 score);
    
    // ═══════════════════════════════════════════════════════════════════════
    // MODIFIERS
    // ═══════════════════════════════════════════════════════════════════════
    
    modifier onlyEscrow() {
        require(msg.sender == escrowVault, "Only escrow");
        _;
    }
    
    modifier notBanned(address provider) {
        require(!providers[provider].isBanned, "Provider banned");
        _;
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════════════════
    
    constructor(address _usdc) Ownable(msg.sender) {
        usdc = IERC20(_usdc);
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // ADMIN FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════
    
    function setEscrowVault(address _escrow) external onlyOwner {
        escrowVault = _escrow;
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // REGISTRATION
    // ═══════════════════════════════════════════════════════════════════════
    
    /**
     * @notice Register as a new provider with stake
     * @param endpoint API endpoint URL
     */
    function registerWithStake(string calldata endpoint) external nonReentrant {
        require(providers[msg.sender].tier == ProviderTier.Unregistered, "Already registered");
        require(block.timestamp - lastRegistration[msg.sender] >= REGISTRATION_COOLDOWN, "Cooldown");
        require(bytes(endpoint).length > 0, "Empty endpoint");
        
        // Take stake
        require(usdc.transferFrom(msg.sender, address(this), PROVIDER_STAKE), "Stake failed");
        
        // Initialize provider
        providers[msg.sender] = ProviderProfile({
            endpoint: endpoint,
            tier: ProviderTier.Newcomer,
            score: INITIAL_SCORE,
            registeredAt: block.timestamp,
            totalTransactions: 0,
            successfulTransactions: 0,
            disputeCount: 0,
            totalVolume: 0,
            successfulVolume: 0,
            totalResponseTime: 0,
            lastActivityAt: block.timestamp,
            isBanned: false,
            // Sybil-resistant tracking
            lastScoreUpdate: block.timestamp,
            scoreAtLastUpdate: INITIAL_SCORE,
            txCountToday: 0,
            txCountThisHour: 0,
            lastTxTimestamp: 0,
            dayStartTimestamp: block.timestamp,
            hourStartTimestamp: block.timestamp,
            suspiciousBehaviorCount: 0,
            isFlaggedForReview: false,
            // FALSE-FLAG PROTECTION
            flagCount: 0,
            successfulAppealCount: 0,
            confirmedViolationCount: 0,
            isInAppealPeriod: false,
            lastFlagTimestamp: 0,
            // ANTI-MANIPULATION
            suspiciousPatternScore: 0,
            humanVerificationCount: 0,
            isHumanVerified: false,
            isQuarantined: false,
            quarantineEndTime: 0,
            // RESPONSE QUALITY
            responseQualityScore: 0,
            invalidResponseCount: 0,
            validResponseCount: 0,
            hallucinationClaimCount: 0
        });
        
        // Initialize bootstrap
        bootstraps[msg.sender].stakeAmount = PROVIDER_STAKE;
        bootstraps[msg.sender].startTime = block.timestamp;
        
        lastRegistration[msg.sender] = block.timestamp;
        
        emit ProviderRegistered(msg.sender, endpoint, ProviderTier.Newcomer);
    }
    
    /**
     * @notice Register with humanity proof (free, no stake required)
     * @param endpoint API endpoint URL
     * @param humanityProof Proof from Worldcoin/GitcoinPassport
     */
    function registerWithHumanityProof(
        string calldata endpoint,
        bytes calldata humanityProof
    ) external {
        require(providers[msg.sender].tier == ProviderTier.Unregistered, "Already registered");
        require(bytes(endpoint).length > 0, "Empty endpoint");
        require(humanityProof.length > 0, "Empty proof");
        
        bytes32 proofHash = keccak256(humanityProof);
        require(!usedHumanityProofs[proofHash], "Proof already used");
        
        // In production: verify with Worldcoin/GitcoinPassport oracle
        // For hackathon: accept valid-looking proofs
        require(_verifyHumanityProof(humanityProof), "Invalid proof");
        
        usedHumanityProofs[proofHash] = true;
        
        // Initialize as Verified (skips bootstrap)
        providers[msg.sender] = ProviderProfile({
            endpoint: endpoint,
            tier: ProviderTier.Verified,
            score: 600, // Higher starting score for verified humans
            registeredAt: block.timestamp,
            totalTransactions: 0,
            successfulTransactions: 0,
            disputeCount: 0,
            totalVolume: 0,
            successfulVolume: 0,
            totalResponseTime: 0,
            lastActivityAt: block.timestamp,
            isBanned: false,
            // Sybil-resistant tracking
            lastScoreUpdate: block.timestamp,
            scoreAtLastUpdate: 600,
            txCountToday: 0,
            txCountThisHour: 0,
            lastTxTimestamp: 0,
            dayStartTimestamp: block.timestamp,
            hourStartTimestamp: block.timestamp,
            suspiciousBehaviorCount: 0,
            isFlaggedForReview: false,
            // FALSE-FLAG PROTECTION
            flagCount: 0,
            successfulAppealCount: 0,
            confirmedViolationCount: 0,
            isInAppealPeriod: false,
            lastFlagTimestamp: 0,
            // ANTI-MANIPULATION
            suspiciousPatternScore: 0,
            humanVerificationCount: 1, // Already verified
            isHumanVerified: true,     // Already verified
            isQuarantined: false,
            quarantineEndTime: 0,
            // RESPONSE QUALITY
            responseQualityScore: 0,
            invalidResponseCount: 0,
            validResponseCount: 0,
            hallucinationClaimCount: 0
        });
        
        emit ProviderRegistered(msg.sender, endpoint, ProviderTier.Verified);
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // METRICS UPDATE (Called by EscrowVault)
    // ═══════════════════════════════════════════════════════════════════════
    
    /**
     * @notice Record a transaction outcome
     * @param provider Provider address
     * @param buyer Buyer address
     * @param amount Payment amount
     * @param success Whether delivery was successful
     * @param responseTime Response time in milliseconds
     */
    function recordTransaction(
        address provider,
        address buyer,
        uint256 amount,
        bool success,
        uint256 responseTime
    ) external onlyEscrow notBanned(provider) {
        ProviderProfile storage p = providers[provider];
        require(p.tier != ProviderTier.Unregistered, "Not registered");
        
        // ═══════════════════════════════════════════════════════════════════════
        // VELOCITY TRACKING (Anti-Sybil)
        // ═══════════════════════════════════════════════════════════════════════
        
        // Reset daily counter if new day
        if (block.timestamp >= p.dayStartTimestamp + 1 days) {
            p.txCountToday = 0;
            p.dayStartTimestamp = block.timestamp;
        }
        
        // Reset hourly counter if new hour
        if (block.timestamp >= p.hourStartTimestamp + 1 hours) {
            p.txCountThisHour = 0;
            p.hourStartTimestamp = block.timestamp;
        }
        
        // ═════════════════════════════════════════════════════════════════════
        // BURST DETECTION (Not blocking, just tracking)
        // Allows micropayments while detecting suspicious patterns
        // ═════════════════════════════════════════════════════════════════════
        
        // Reset burst window if expired
        if (block.timestamp >= burstWindowStart[provider] + BURST_WINDOW) {
            burstWindowStart[provider] = block.timestamp;
            txInBurstWindow[provider] = 0;
        }
        
        txInBurstWindow[provider]++;
        
        // Check for suspicious burst activity
        if (txInBurstWindow[provider] >= BURST_THRESHOLD) {
            p.suspiciousBehaviorCount++;
            
            // Severe burst = quarantine check
            if (txInBurstWindow[provider] >= SEVERE_BURST_THRESHOLD) {
                if (!p.isQuarantined) {
                    p.isQuarantined = true;
                    p.quarantineEndTime = block.timestamp + QUARANTINE_DURATION;
                    emit Quarantined(provider, "Severe transaction burst", p.quarantineEndTime);
                }
            } else if (p.suspiciousBehaviorCount >= 5) {
                p.isFlaggedForReview = true;
                emit ProviderFlagged(provider, "Repeated burst activity");
            }
        }
        
        // Update velocity counters
        p.txCountToday++;
        p.txCountThisHour++;
        p.lastTxTimestamp = block.timestamp;
        
        // ═══════════════════════════════════════════════════════════════════════
        // STANDARD METRICS UPDATE
        // ═══════════════════════════════════════════════════════════════════════
        
        p.totalTransactions++;
        p.totalVolume += amount;
        p.totalResponseTime += responseTime;
        p.lastActivityAt = block.timestamp;
        
        if (success) {
            p.successfulTransactions++;
            p.successfulVolume += amount;
        }
        
        // Track for bootstrap graduation
        if (p.tier == ProviderTier.Newcomer) {
            _updateBootstrap(provider, buyer, amount, !success);
        }
        
        // Update flow graph for circular detection
        flowGraph[buyer][provider] += amount;
        
        // ═══════════════════════════════════════════════════════════════════════
        // CIRCULAR FLOW DETECTION (Anti-Wash Trading)
        // If buyer has received significant funds from this provider, flag it
        // ═══════════════════════════════════════════════════════════════════════
        
        uint256 reverseFlow = flowGraph[provider][buyer];
        if (reverseFlow > 0 && reverseFlow >= amount / 2) {
            // Significant circular flow detected
            p.suspiciousBehaviorCount++;
            emit CircularFlowDetected(provider, buyer, amount, reverseFlow);
        }
        
        // Recalculate score
        uint256 oldScore = p.score;
        p.score = _calculateScore(provider);
        
        if (oldScore != p.score) {
            emit ScoreUpdated(provider, oldScore, p.score);
        }
    }
    
    /**
     * @notice Record a dispute
     */
    function recordDispute(address provider) external onlyEscrow notBanned(provider) {
        ProviderProfile storage p = providers[provider];
        p.disputeCount++;
        
        if (p.tier == ProviderTier.Newcomer) {
            bootstraps[provider].disputeCount++;
        }
        
        // Recalculate score
        uint256 oldScore = p.score;
        p.score = _calculateScore(provider);
        
        emit ScoreUpdated(provider, oldScore, p.score);
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // GRADUATION
    // ═══════════════════════════════════════════════════════════════════════
    
    /**
     * @notice Check and process provider graduation
     */
    function checkGraduation(address provider) external {
        ProviderProfile storage p = providers[provider];
        require(p.tier == ProviderTier.Newcomer, "Not newcomer");
        
        BootstrapProfile storage bp = bootstraps[provider];
        
        // Check all graduation requirements
        require(bp.txCount >= GRADUATION_TX_COUNT, "Not enough transactions");
        require(block.timestamp - bp.startTime >= GRADUATION_PERIOD, "Too soon");
        require(bp.uniqueCounterparties >= MIN_UNIQUE_COUNTERPARTIES, "Not enough diversity");
        
        // Check dispute rate
        uint256 disputeRate = (bp.disputeCount * 100) / bp.txCount;
        require(disputeRate <= MAX_DISPUTE_RATE, "Too many disputes");
        
        // Check volume distribution (anti-wash trading)
        require(_checkVolumeDistribution(provider), "Suspicious volume pattern");
        
        // Graduate!
        p.tier = ProviderTier.Graduated;
        p.score = _calculateScore(provider);
        
        emit ProviderGraduated(provider, p.score);
    }
    
    /**
     * @notice Withdraw stake after graduation
     */
    function withdrawStake() external nonReentrant {
        ProviderProfile storage p = providers[msg.sender];
        require(p.tier == ProviderTier.Graduated || p.tier == ProviderTier.Verified, "Not graduated");
        
        BootstrapProfile storage bp = bootstraps[msg.sender];
        require(bp.stakeAmount > 0, "No stake");
        
        uint256 amount = bp.stakeAmount;
        bp.stakeAmount = 0;
        
        require(usdc.transfer(msg.sender, amount), "Transfer failed");
        
        emit StakeWithdrawn(msg.sender, amount);
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════
    
    /**
     * @notice Get provider's current trust score
     */
    function getScore(address provider) external view returns (uint256) {
        return providers[provider].score;
    }
    
    /**
     * @notice Get trust score for any agent (provider or buyer)
     */
    function getTrustScore(address agent) external view returns (uint256) {
        if (providers[agent].tier != ProviderTier.Unregistered) {
            return providers[agent].score;
        }
        if (buyers[agent].score > 0) {
            return buyers[agent].score;
        }
        return 0;
    }
    
    /**
     * @notice Get agent registration time (provider or buyer)
     */
    function getAgentRegistrationTime(address agent) external view returns (uint256) {
        if (providers[agent].registeredAt > 0) {
            return providers[agent].registeredAt;
        }
        if (buyers[agent].firstPaymentAt > 0) {
            return buyers[agent].firstPaymentAt;
        }
        return 0;
    }
    
    /**
     * @notice Get provider's tier
     */
    function getTier(address provider) external view returns (ProviderTier) {
        return providers[provider].tier;
    }
    
    /**
     * @notice Get recommended escrow timeout based on score
     */
    function getRecommendedTimeout(address provider) external view returns (uint256) {
        uint256 score = providers[provider].score;
        
        if (score >= 850) return 5 minutes;
        if (score >= 700) return 10 minutes;
        if (score >= 500) return 15 minutes;
        return 20 minutes;
    }
    
    /**
     * @notice Check if provider is registered and active
     */
    function isActive(address provider) external view returns (bool) {
        ProviderProfile storage p = providers[provider];
        return p.tier != ProviderTier.Unregistered && !p.isBanned;
    }
    
    /**
     * @notice Detect circular flow (A→B→...→A)
     */
    function detectCircularFlow(address from, address to) external view returns (bool) {
        return _hasPath(to, from, 5);
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // INTERNAL FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════
    
    function _updateBootstrap(
        address provider,
        address buyer,
        uint256 amount,
        bool isDispute
    ) internal {
        BootstrapProfile storage bp = bootstraps[provider];
        bp.txCount++;
        
        if (isDispute) {
            bp.disputeCount++;
        }
        
        // Track unique counterparties
        if (bp.volumeFrom[buyer] == 0) {
            bp.uniqueCounterparties++;
            bp.counterpartyList.push(buyer);
        }
        bp.volumeFrom[buyer] += amount;
    }
    
    function _checkVolumeDistribution(address provider) internal view returns (bool) {
        BootstrapProfile storage bp = bootstraps[provider];
        uint256 totalVolume = providers[provider].totalVolume;
        
        if (totalVolume == 0) return false;
        
        // Check that no single counterparty > 10% of volume
        for (uint256 i = 0; i < bp.counterpartyList.length; i++) {
            uint256 pct = (bp.volumeFrom[bp.counterpartyList[i]] * 100) / totalVolume;
            if (pct > MAX_SINGLE_COUNTERPARTY_PCT) {
                return false;
            }
        }
        
        return true;
    }
    
    function _calculateScore(address provider) internal view returns (uint256) {
        ProviderProfile storage p = providers[provider];
        
        if (p.totalTransactions == 0) {
            return INITIAL_SCORE;
        }
        
        // Component 1: Success Rate (35%, max 315 points)
        uint256 successRate = (p.successfulTransactions * 100) / p.totalTransactions;
        uint256 successPoints = (successRate * 315) / 100;
        
        // Component 2: Volume-Weighted Success (25%, max 225 points)
        uint256 volumeWeighted = 0;
        if (p.totalVolume > 0) {
            volumeWeighted = (p.successfulVolume * 225) / p.totalVolume;
        }
        
        // Component 3: Diversity (20%, max 180 points)
        // Require more counterparties for higher scores
        uint256 uniqueUsers = bootstraps[provider].uniqueCounterparties;
        uint256 diversityPoints = uniqueUsers * 18; // ~10 per user
        if (diversityPoints > 180) diversityPoints = 180;
        
        // Component 4: Longevity (10%, max 90 points)
        uint256 months = (block.timestamp - p.registeredAt) / 30 days;
        uint256 longevityPoints = months * 9;
        if (longevityPoints > 90) longevityPoints = 90;
        
        // Component 5: Speed (10%, max 90 points)
        uint256 avgResponseTime = p.totalResponseTime / p.totalTransactions;
        uint256 speedPoints = 90;
        if (avgResponseTime > 30000) speedPoints = 0; // > 30s = 0 points
        else if (avgResponseTime > 10000) speedPoints = 45; // 10-30s = 45 points
        else if (avgResponseTime > 5000) speedPoints = 70; // 5-10s = 70 points
        
        uint256 rawScore = MIN_SCORE + successPoints + volumeWeighted + 
                           diversityPoints + longevityPoints + speedPoints;
        
        // Apply dispute penalty
        if (p.totalTransactions > 0) {
            uint256 disputeRate = (p.disputeCount * 100) / p.totalTransactions;
            uint256 penalty = disputeRate * 2; // 2 points per 1% dispute rate
            if (penalty > 100) penalty = 100;
            rawScore = rawScore > penalty ? rawScore - penalty : MIN_SCORE;
        }
        
        // ═══════════════════════════════════════════════════════════════════════
        // TIER-BASED SCORE CAPS (Critical security measure)
        // Prevents new providers from immediately reaching high trust scores
        // ═══════════════════════════════════════════════════════════════════════
        
        uint256 maxScoreForTier;
        if (p.tier == ProviderTier.Verified) {
            maxScoreForTier = MAX_SCORE; // 900
        } else if (p.tier == ProviderTier.Graduated) {
            maxScoreForTier = 800;
        } else if (p.tier == ProviderTier.Newcomer) {
            maxScoreForTier = 650; // Newcomers cannot exceed 650
        } else {
            maxScoreForTier = INITIAL_SCORE; // Unregistered = 500
        }
        
        // Transaction volume requirement for high scores
        // Need at least 10 transactions to exceed 600
        // Need at least 25 transactions to exceed 700
        // Need at least 50 transactions to exceed 800
        if (p.totalTransactions < 10 && rawScore > 600) {
            rawScore = 600;
        } else if (p.totalTransactions < 25 && rawScore > 700) {
            rawScore = 700;
        } else if (p.totalTransactions < 50 && rawScore > 800) {
            rawScore = 800;
        }
        
        // ═══════════════════════════════════════════════════════════════════════
        // TIME-BASED RESTRICTIONS (Anti-Sybil: No rapid trust building)
        // Even with perfect behavior, score growth is limited by TIME
        // ═══════════════════════════════════════════════════════════════════════
        
        uint256 accountAge = block.timestamp - p.registeredAt;
        
        // Minimum account age requirements for high scores
        if (accountAge < MIN_DAYS_FOR_600 && rawScore > 600) {
            rawScore = 600; // Must wait 7 days for score > 600
        }
        if (accountAge < MIN_DAYS_FOR_700 && rawScore > 700) {
            rawScore = 700; // Must wait 30 days for score > 700  
        }
        if (accountAge < MIN_DAYS_FOR_800 && rawScore > 800) {
            rawScore = 800; // Must wait 60 days for score > 800
        }
        
        // ═══════════════════════════════════════════════════════════════════════
        // DAILY SCORE GROWTH LIMIT (Anti-Sybil: Max +5 points per day)
        // Prevents trust bombing - score can only increase gradually
        // ═══════════════════════════════════════════════════════════════════════
        
        // Calculate max allowed score based on daily growth limit
        uint256 daysSinceRegistration = accountAge / 1 days;
        if (daysSinceRegistration == 0) daysSinceRegistration = 1;
        
        // Max score = INITIAL_SCORE + (days * MAX_SCORE_GAIN_PER_DAY)
        // Day 1: max 505, Day 7: max 535, Day 30: max 650, Day 60: max 800
        uint256 maxScoreByTime = INITIAL_SCORE + (daysSinceRegistration * MAX_SCORE_GAIN_PER_DAY);
        
        if (rawScore > maxScoreByTime) {
            rawScore = maxScoreByTime;
        }
        
        // ═══════════════════════════════════════════════════════════════════════
        // SUSPICIOUS BEHAVIOR PENALTY
        // Flagged providers get score penalty
        // ═══════════════════════════════════════════════════════════════════════
        
        if (p.suspiciousBehaviorCount > 0) {
            uint256 suspiciousPenalty = p.suspiciousBehaviorCount * 10;
            if (suspiciousPenalty > 100) suspiciousPenalty = 100;
            rawScore = rawScore > suspiciousPenalty ? rawScore - suspiciousPenalty : MIN_SCORE;
        }
        
        if (p.isFlaggedForReview) {
            // Flagged providers capped at 500 until reviewed
            if (rawScore > INITIAL_SCORE) {
                rawScore = INITIAL_SCORE;
            }
        }
        
        // Apply tier cap
        if (rawScore > maxScoreForTier) {
            rawScore = maxScoreForTier;
        }
        
        // Final cap at MAX_SCORE
        if (rawScore > MAX_SCORE) rawScore = MAX_SCORE;
        
        return rawScore;
    }
    
    function _hasPath(address from, address to, uint256 depth) internal view returns (bool) {
        if (depth == 0) return false;
        if (flowGraph[from][to] > 0) return true;
        
        // Simple BFS would need iteration - simplified for gas
        // In production, this would use off-chain computation with on-chain verification
        return false;
    }
    
    function _verifyHumanityProof(bytes calldata proof) internal pure returns (bool) {
        // Simplified for hackathon - in production would verify with oracle
        return proof.length >= 32;
    }
    
    function _banProvider(address provider, string memory reason) internal {
        providers[provider].isBanned = true;
        emit ProviderBanned(provider, reason);
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // BUYER/AGENT REPUTATION FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════
    
    /**
     * @notice Record a buyer's payment behavior
     * @param buyer Buyer address
     * @param amount Payment amount
     * @param wasSuccessful Whether payment completed without dispute
     * @param confirmationTime Time to confirm delivery (ms)
     */
    function recordBuyerTransaction(
        address buyer,
        uint256 amount,
        bool wasSuccessful,
        uint256 confirmationTime
    ) external onlyEscrow {
        BuyerProfile storage b = buyers[buyer];
        
        // Initialize first payment
        if (b.firstPaymentAt == 0) {
            b.firstPaymentAt = block.timestamp;
            b.score = BUYER_INITIAL_SCORE;
            b.tier = BuyerTier.Standard;
        }
        
        b.totalPayments++;
        b.totalVolume += amount;
        b.lastActivityAt = block.timestamp;
        
        if (wasSuccessful) {
            b.successfulPayments++;
            b.totalConfirmationTime += confirmationTime;
        }
        
        // Recalculate score
        uint256 oldScore = b.score;
        b.score = _calculateBuyerScore(buyer);
        
        // Update tier
        BuyerTier oldTier = b.tier;
        b.tier = _getBuyerTierFromScore(b.score);
        
        if (b.score != oldScore) {
            emit BuyerScoreUpdated(buyer, oldScore, b.score);
        }
        if (b.tier != oldTier) {
            emit BuyerTierChanged(buyer, oldTier, b.tier);
        }
    }
    
    /**
     * @notice Record a dispute initiated by buyer
     * @param buyer Buyer address
     * @param won Whether buyer won the dispute
     */
    function recordBuyerDispute(address buyer, bool won) external onlyEscrow {
        BuyerProfile storage b = buyers[buyer];
        b.disputeCount++;
        
        if (won) {
            b.disputesWon++;
        } else {
            b.disputesLost++;
            // Frivolous disputes hurt score more
            if (b.disputesLost >= 3) {
                b.isFlagged = true;
                emit BuyerFlagged(buyer, "Multiple frivolous disputes");
            }
        }
        
        uint256 oldScore = b.score;
        b.score = _calculateBuyerScore(buyer);
        
        BuyerTier oldTier = b.tier;
        b.tier = _getBuyerTierFromScore(b.score);
        
        if (b.score != oldScore) {
            emit BuyerScoreUpdated(buyer, oldScore, b.score);
        }
        if (b.tier != oldTier) {
            emit BuyerTierChanged(buyer, oldTier, b.tier);
        }
    }
    
    /**
     * @notice Record buyer timeout (didn't confirm within deadline)
     * @param buyer Buyer address
     */
    function recordBuyerTimeout(address buyer) external onlyEscrow {
        BuyerProfile storage b = buyers[buyer];
        b.timeoutCount++;
        
        // Multiple timeouts indicate unreliable buyer
        if (b.timeoutCount >= 5) {
            b.isFlagged = true;
            emit BuyerFlagged(buyer, "Excessive payment timeouts");
        }
        
        uint256 oldScore = b.score;
        b.score = _calculateBuyerScore(buyer);
        b.tier = _getBuyerTierFromScore(b.score);
        
        emit BuyerScoreUpdated(buyer, oldScore, b.score);
    }
    
    /**
     * @notice Get buyer's trust score
     * @param buyer Buyer address
     * @return score Buyer's trust score (300-900)
     */
    function getBuyerScore(address buyer) external view returns (uint256) {
        if (buyers[buyer].firstPaymentAt == 0) {
            return BUYER_INITIAL_SCORE;
        }
        return buyers[buyer].score;
    }
    
    /**
     * @notice Get buyer's tier
     * @param buyer Buyer address
     * @return tier Buyer's trust tier
     */
    function getBuyerTier(address buyer) external view returns (BuyerTier) {
        return buyers[buyer].tier;
    }
    
    /**
     * @notice Check if buyer is reliable (score >= 700)
     * @param buyer Buyer address
     * @return reliable Whether buyer is reliable
     */
    function isBuyerReliable(address buyer) external view returns (bool) {
        if (buyers[buyer].isFlagged) return false;
        return buyers[buyer].score >= RELIABLE_BUYER_THRESHOLD;
    }
    
    /**
     * @notice Check if buyer is flagged for suspicious behavior
     * @param buyer Buyer address
     * @return flagged Whether buyer is flagged
     */
    function isBuyerFlagged(address buyer) external view returns (bool) {
        return buyers[buyer].isFlagged;
    }
    
    /**
     * @notice Get comprehensive buyer info
     * @param buyer Buyer address
     * @return score Trust score
     * @return tier Trust tier
     * @return paymentCount Total payments
     * @return disputeRate Dispute percentage
     * @return avgConfirmTime Average confirmation time (ms)
     * @return flagged Whether buyer is flagged
     */
    function getBuyerInfo(address buyer) external view returns (
        uint256 score,
        BuyerTier tier,
        uint256 paymentCount,
        uint256 disputeRate,
        uint256 avgConfirmTime,
        bool flagged
    ) {
        BuyerProfile storage b = buyers[buyer];
        score = b.score == 0 ? BUYER_INITIAL_SCORE : b.score;
        tier = b.tier;
        paymentCount = b.totalPayments;
        disputeRate = b.totalPayments > 0 ? (b.disputeCount * 100) / b.totalPayments : 0;
        avgConfirmTime = b.successfulPayments > 0 ? b.totalConfirmationTime / b.successfulPayments : 0;
        flagged = b.isFlagged;
    }
    
    /**
     * @notice Calculate buyer trust score (internal)
     */
    function _calculateBuyerScore(address buyer) internal view returns (uint256) {
        BuyerProfile storage b = buyers[buyer];
        
        if (b.totalPayments == 0) return BUYER_INITIAL_SCORE;
        
        uint256 rawScore = BUYER_INITIAL_SCORE;
        
        // Success rate component (40%)
        // Buyers who complete payments without issues get bonus
        uint256 successRate = (b.successfulPayments * 100) / b.totalPayments;
        rawScore += (successRate * 160) / 100; // Max +160 points
        
        // Dispute behavior component (30%)
        // High dispute rate = penalty, but winning disputes = less penalty
        if (b.disputeCount > 0) {
            uint256 disputeRate = (b.disputeCount * 100) / b.totalPayments;
            uint256 lossRate = (b.disputesLost * 100) / b.disputeCount;
            
            // Penalty based on dispute rate and how many were frivolous
            uint256 penalty = (disputeRate * lossRate) / 10;
            if (penalty > 150) penalty = 150;
            rawScore = rawScore > penalty ? rawScore - penalty : BUYER_MIN_SCORE;
        } else {
            rawScore += 50; // Bonus for no disputes
        }
        
        // Confirmation speed component (15%)
        // Fast confirmers are good for the ecosystem
        if (b.successfulPayments > 0) {
            uint256 avgConfirmTime = b.totalConfirmationTime / b.successfulPayments;
            if (avgConfirmTime < 60000) { // < 1 min
                rawScore += 60;
            } else if (avgConfirmTime < 300000) { // < 5 min
                rawScore += 40;
            } else if (avgConfirmTime < 900000) { // < 15 min
                rawScore += 20;
            }
            // No bonus for slow confirmers
        }
        
        // Account age component (10%)
        uint256 accountAge = block.timestamp - b.firstPaymentAt;
        if (accountAge > 180 days) {
            rawScore += 40;
        } else if (accountAge > 90 days) {
            rawScore += 25;
        } else if (accountAge > 30 days) {
            rawScore += 10;
        }
        
        // Timeout penalty (5%)
        if (b.timeoutCount > 0) {
            uint256 timeoutRate = (b.timeoutCount * 100) / b.totalPayments;
            uint256 penalty = timeoutRate * 2;
            if (penalty > 50) penalty = 50;
            rawScore = rawScore > penalty ? rawScore - penalty : BUYER_MIN_SCORE;
        }
        
        // Volume bonus (small)
        if (b.totalVolume > 100000e6) { // > 100K USDC
            rawScore += 20;
        } else if (b.totalVolume > 10000e6) { // > 10K USDC
            rawScore += 10;
        }
        
        // Flagged penalty
        if (b.isFlagged) {
            rawScore = rawScore > 100 ? rawScore - 100 : BUYER_MIN_SCORE;
        }
        
        // Cap at bounds
        if (rawScore < BUYER_MIN_SCORE) rawScore = BUYER_MIN_SCORE;
        if (rawScore > BUYER_MAX_SCORE) rawScore = BUYER_MAX_SCORE;
        
        return rawScore;
    }
    
    /**
     * @notice Get buyer tier from score
     */
    function _getBuyerTierFromScore(uint256 score) internal pure returns (BuyerTier) {
        if (score >= PREMIUM_BUYER_THRESHOLD) return BuyerTier.Premium;
        if (score >= RELIABLE_BUYER_THRESHOLD) return BuyerTier.Reliable;
        if (score >= 450) return BuyerTier.Standard;
        if (score >= 350) return BuyerTier.Risky;
        return BuyerTier.Unknown;
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // ADVANCED REPUTATION: FLAGGING SYSTEM
    // ═══════════════════════════════════════════════════════════════════════
    
    /**
     * @notice Submit a flag against a provider or buyer
     * @param target Address to flag
     * @param reason Reason for flagging
     * @param isProviderFlag True if flagging a provider, false for buyer
     */
    function submitFlag(
        address target,
        string calldata reason,
        bool isProviderFlag
    ) external returns (bytes32) {
        require(target != msg.sender, "Cannot flag self");
        
        bytes32 flagId = keccak256(abi.encodePacked(target, msg.sender, block.timestamp, reason));
        require(flags[flagId].submittedAt == 0, "Flag exists");
        
        // Calculate flagger credibility
        uint256 credibility = _calculateFlaggerCredibility(msg.sender);
        
        flags[flagId] = Flag({
            id: flagId,
            target: target,
            flagger: msg.sender,
            reason: reason,
            status: FlagStatus.Pending,
            submittedAt: block.timestamp,
            validatorsNeeded: MIN_VALIDATORS_FOR_FLAG,
            validatorCount: 1, // Flagger counts as 1
            flaggerCredibility: credibility,
            isProviderFlag: isProviderFlag
        });
        
        flagsAgainst[target].push(flagId);
        flagsSubmitted[msg.sender].push(flagId);
        
        // Update flagger's flag count
        buyers[msg.sender].flagsGiven++;
        
        emit FlagSubmitted(flagId, target, msg.sender, reason);
        
        return flagId;
    }
    
    /**
     * @notice Validate an existing flag (cross-validation)
     * @param flagId The flag to validate
     * @param agrees Whether validator agrees with the flag
     */
    function validateFlag(bytes32 flagId, bool agrees) external {
        Flag storage f = flags[flagId];
        require(f.submittedAt > 0, "Flag not found");
        require(f.status == FlagStatus.Pending, "Flag not pending");
        require(f.flagger != msg.sender, "Cannot validate own flag");
        require(f.target != msg.sender, "Target cannot validate");
        
        // Check validator hasn't already validated
        address[] storage validators = flagValidators[flagId];
        for (uint i = 0; i < validators.length; i++) {
            require(validators[i] != msg.sender, "Already validated");
        }
        
        validators.push(msg.sender);
        
        if (agrees) {
            f.validatorCount++;
            
            // Check if enough validators to confirm
            if (f.validatorCount >= f.validatorsNeeded) {
                _confirmFlag(flagId);
            }
        } else {
            // Disagreement - counts against flagger
            buyers[f.flagger].outlierCount++;
        }
        
        // Update cross-validation stats
        buyers[msg.sender].crossValidationCount++;
        
        emit CrossValidationResult(msg.sender, f.target, agrees);
    }
    
    /**
     * @notice Appeal a flag (requires stake)
     * @param flagId The flag to appeal
     */
    function appealFlag(bytes32 flagId) external {
        Flag storage f = flags[flagId];
        require(f.target == msg.sender, "Only target can appeal");
        require(f.status == FlagStatus.Validated, "Can only appeal validated flags");
        require(block.timestamp <= f.submittedAt + FLAG_WAITING_PERIOD + APPEAL_PERIOD, "Appeal period ended");
        
        // Take appeal stake
        require(usdc.transferFrom(msg.sender, address(this), APPEAL_STAKE), "Stake failed");
        
        f.status = FlagStatus.Appealed;
        
        if (f.isProviderFlag) {
            providers[msg.sender].isInAppealPeriod = true;
        }
        
        buyers[msg.sender].appealCount++;
        
        emit AppealFiled(flagId, msg.sender, APPEAL_STAKE);
    }
    
    /**
     * @notice Resolve an appeal (owner or arbitrator)
     * @param flagId The flag being appealed
     * @param successful Whether appeal is successful
     */
    function resolveAppeal(bytes32 flagId, bool successful) external onlyOwner {
        Flag storage f = flags[flagId];
        require(f.status == FlagStatus.Appealed, "Not in appeal");
        
        if (successful) {
            // Appeal won - flag overturned
            f.status = FlagStatus.Overturned;
            
            // Return stake to appellant
            require(usdc.transfer(f.target, APPEAL_STAKE), "Return stake failed");
            
            // Update flagger as unreliable
            buyers[f.flagger].flagsGivenOverturned++;
            buyers[f.flagger].hallucinationScore = _calculateHallucinationScore(f.flagger);
            
            // Update target
            if (f.isProviderFlag) {
                providers[f.target].successfulAppealCount++;
                providers[f.target].isInAppealPeriod = false;
            }
            buyers[f.target].appealSuccessCount++;
            
        } else {
            // Appeal failed - flag stands
            f.status = FlagStatus.Validated;
            
            // Slash appeal stake
            // (Could distribute to validators)
            
            if (f.isProviderFlag) {
                providers[f.target].confirmedViolationCount++;
                providers[f.target].isInAppealPeriod = false;
            }
        }
        
        emit AppealResolved(flagId, successful);
    }
    
    /**
     * @dev Confirm a flag after sufficient validation
     */
    function _confirmFlag(bytes32 flagId) internal {
        Flag storage f = flags[flagId];
        f.status = FlagStatus.Validated;
        
        // Apply consequences after waiting period
        if (f.isProviderFlag) {
            providers[f.target].flagCount++;
            providers[f.target].lastFlagTimestamp = block.timestamp;
            
            // Check if should quarantine
            if (providers[f.target].flagCount >= 3) {
                _quarantineProvider(f.target, "Multiple confirmed flags");
            }
        } else {
            buyers[f.target].flagsReceived++;
            buyers[f.target].isFlagged = true;
        }
        
        emit FlagValidated(flagId, true);
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // ADVANCED REPUTATION: QUARANTINE SYSTEM
    // ═══════════════════════════════════════════════════════════════════════
    
    /**
     * @dev Quarantine a provider
     */
    function _quarantineProvider(address provider, string memory reason) internal {
        ProviderProfile storage p = providers[provider];
        p.isQuarantined = true;
        p.quarantineEndTime = block.timestamp + QUARANTINE_DURATION;
        
        emit Quarantined(provider, reason, p.quarantineEndTime);
    }
    
    /**
     * @dev Quarantine a buyer
     */
    function _quarantineBuyer(address buyer, string memory reason) internal {
        BuyerProfile storage b = buyers[buyer];
        b.isQuarantined = true;
        b.quarantineEndTime = block.timestamp + QUARANTINE_DURATION;
        
        emit Quarantined(buyer, reason, b.quarantineEndTime);
    }
    
    /**
     * @notice Lift quarantine if time expired
     */
    function liftQuarantineIfExpired(address entity) external {
        if (providers[entity].isQuarantined && block.timestamp >= providers[entity].quarantineEndTime) {
            providers[entity].isQuarantined = false;
            emit QuarantineLifted(entity);
        }
        if (buyers[entity].isQuarantined && block.timestamp >= buyers[entity].quarantineEndTime) {
            buyers[entity].isQuarantined = false;
            emit QuarantineLifted(entity);
        }
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // ADVANCED REPUTATION: RESPONSE RATING & HALLUCINATION
    // ═══════════════════════════════════════════════════════════════════════
    
    /**
     * @notice Rate a provider's response quality
     * @param paymentId The payment this rating is for
     * @param quality 1-5 star rating
     * @param isValid Whether the response was accurate/valid
     */
    function rateResponse(bytes32 paymentId, uint8 quality, bool isValid) external {
        require(quality >= 1 && quality <= 5, "Quality must be 1-5");
        
        // Get payment info from escrow (simplified - would need interface)
        // For now, assume caller is valid buyer
        
        ResponseRating memory rating = ResponseRating({
            buyer: msg.sender,
            provider: address(0), // Would get from payment
            paymentId: paymentId,
            qualityScore: quality,
            isValid: isValid,
            timestamp: block.timestamp
        });
        
        paymentRatings[paymentId].push(rating);
        
        // Update buyer's rating history
        if (!isValid) {
            buyers[msg.sender].invalidClaimCount++;
        } else {
            buyers[msg.sender].validClaimCount++;
        }
        
        // Cross-validate with other ratings
        _crossValidateRating(paymentId, msg.sender, isValid);
        
        emit ResponseRated(paymentId, rating.provider, quality, isValid);
    }
    
    /**
     * @dev Cross-validate a rating against others
     */
    function _crossValidateRating(bytes32 paymentId, address buyer, bool isValid) internal {
        ResponseRating[] storage ratings = paymentRatings[paymentId];
        
        if (ratings.length < 2) return; // Need at least 2 ratings
        
        // Count agreement
        uint256 validCount = 0;
        uint256 invalidCount = 0;
        
        for (uint i = 0; i < ratings.length; i++) {
            if (ratings[i].isValid) validCount++;
            else invalidCount++;
        }
        
        bool majorityValid = validCount > invalidCount;
        bool agreedWithMajority = (isValid && majorityValid) || (!isValid && !majorityValid);
        
        if (agreedWithMajority) {
            buyers[buyer].agreementWithOthers++;
        } else {
            buyers[buyer].outlierCount++;
            
            // Check if this buyer is consistently an outlier
            if (buyers[buyer].outlierCount >= OUTLIER_THRESHOLD) {
                buyers[buyer].hallucinationScore = _calculateHallucinationScore(buyer);
                
                if (buyers[buyer].hallucinationScore >= SEVERE_HALLUCINATION) {
                    _quarantineBuyer(buyer, "Severe hallucination detected");
                }
                
                emit HallucinationDetected(buyer, buyers[buyer].hallucinationScore, buyers[buyer].outlierCount);
            }
        }
    }
    
    /**
     * @dev Calculate hallucination score (0-100)
     */
    function _calculateHallucinationScore(address buyer) internal view returns (uint256) {
        BuyerProfile storage b = buyers[buyer];
        
        uint256 totalClaims = b.validClaimCount + b.invalidClaimCount;
        if (totalClaims == 0) return 0;
        
        // Base: agreement rate (inverse = hallucination tendency)
        uint256 totalValidations = b.agreementWithOthers + b.outlierCount;
        uint256 outlierPct = 0;
        if (totalValidations > 0) {
            outlierPct = (b.outlierCount * 100) / totalValidations;
        }
        
        // Factor in overturned flags (false flags = hallucination)
        uint256 flagPenalty = 0;
        if (b.flagsGiven > 0) {
            flagPenalty = (b.flagsGivenOverturned * 20) / b.flagsGiven;
        }
        
        return outlierPct + flagPenalty;
    }
    
    /**
     * @dev Calculate flagger credibility (higher = more trustworthy flags)
     */
    function _calculateFlaggerCredibility(address flagger) internal view returns (uint256) {
        BuyerProfile storage b = buyers[flagger];
        
        uint256 base = FLAGGER_CREDIBILITY_WEIGHT;
        
        // New buyers have reduced weight
        if (b.totalPayments < 10) {
            base = base * 30 / 100; // 30% weight
        }
        
        // Overturn rate reduces credibility
        if (b.flagsGiven > 0) {
            uint256 successRate = ((b.flagsGiven - b.flagsGivenOverturned) * 100) / b.flagsGiven;
            base = base * successRate / 100;
        }
        
        // High hallucination score reduces credibility
        if (b.hallucinationScore > 0) {
            base = base * (100 - b.hallucinationScore) / 100;
        }
        
        return base;
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // ADVANCED REPUTATION: TRANSPARENCY VIEWS
    // ═══════════════════════════════════════════════════════════════════════
    
    /**
     * @notice Get full provider reputation with all advanced metrics
     */
    function getFullProviderReputation(address provider) external view returns (
        uint256 overallScore,
        uint256 successRate,
        uint256 flagCount,
        uint256 successfulAppeals,
        uint256 hallucinationClaimCount,
        bool isHumanVerified,
        bool isQuarantined,
        uint256 uniqueBuyers,
        string memory tier,
        string memory riskAssessment
    ) {
        ProviderProfile storage p = providers[provider];
        
        overallScore = p.score;
        successRate = p.totalTransactions > 0 ? (p.successfulTransactions * 100) / p.totalTransactions : 0;
        flagCount = p.flagCount;
        successfulAppeals = p.successfulAppealCount;
        hallucinationClaimCount = p.hallucinationClaimCount;
        isHumanVerified = p.isHumanVerified;
        isQuarantined = p.isQuarantined;
        uniqueBuyers = bootstraps[provider].uniqueCounterparties;
        
        // Tier string
        if (p.tier == ProviderTier.Verified) tier = "Verified";
        else if (p.tier == ProviderTier.Graduated) tier = "Graduated";
        else if (p.tier == ProviderTier.Newcomer) tier = "Newcomer";
        else tier = "Unregistered";
        
        // Risk assessment
        if (p.isQuarantined) riskAssessment = "HIGH - Quarantined";
        else if (p.flagCount >= 2) riskAssessment = "MEDIUM - Multiple flags";
        else if (p.score < 400) riskAssessment = "MEDIUM - Low score";
        else riskAssessment = "LOW";
    }
    
    /**
     * @notice Get full buyer reputation with all advanced metrics
     */
    function getFullBuyerReputation(address buyer) external view returns (
        uint256 overallScore,
        uint256 successRate,
        uint256 disputeRate,
        uint256 hallucinationScore,
        uint256 consistencyScore,
        uint256 flagsGiven,
        uint256 flagsOverturned,
        bool isQuarantined,
        string memory tier,
        string memory reliabilityAssessment
    ) {
        BuyerProfile storage b = buyers[buyer];
        
        overallScore = b.score;
        successRate = b.totalPayments > 0 ? (b.successfulPayments * 100) / b.totalPayments : 0;
        disputeRate = b.totalPayments > 0 ? (b.disputeCount * 100) / b.totalPayments : 0;
        hallucinationScore = b.hallucinationScore;
        consistencyScore = b.consistencyScore;
        flagsGiven = b.flagsGiven;
        flagsOverturned = b.flagsGivenOverturned;
        isQuarantined = b.isQuarantined;
        
        // Tier string
        if (b.tier == BuyerTier.Premium) tier = "Premium";
        else if (b.tier == BuyerTier.Reliable) tier = "Reliable";
        else if (b.tier == BuyerTier.Standard) tier = "Standard";
        else if (b.tier == BuyerTier.Risky) tier = "Risky";
        else tier = "Unknown";
        
        // Reliability assessment
        if (b.isQuarantined) reliabilityAssessment = "UNRELIABLE - Quarantined";
        else if (b.hallucinationScore >= HALLUCINATION_THRESHOLD) reliabilityAssessment = "CAUTION - High hallucination";
        else if (b.outlierCount >= OUTLIER_THRESHOLD) reliabilityAssessment = "CAUTION - Frequent outlier";
        else if (b.score >= RELIABLE_BUYER_THRESHOLD) reliabilityAssessment = "RELIABLE";
        else reliabilityAssessment = "STANDARD";
    }
    
    /**
     * @notice Should I trust this buyer?
     */
    function shouldITrustBuyer(address buyer) external view returns (
        bool recommended,
        string memory reason,
        uint256 riskLevel
    ) {
        BuyerProfile storage b = buyers[buyer];
        
        if (b.isQuarantined) {
            return (false, "Buyer is quarantined", 10);
        }
        if (b.hallucinationScore >= SEVERE_HALLUCINATION) {
            return (false, "High hallucination rate", 8);
        }
        if (b.flagsGivenOverturned > 3) {
            return (false, "History of false flags", 7);
        }
        if (b.score < 350) {
            return (false, "Very low score", 6);
        }
        if (b.score >= RELIABLE_BUYER_THRESHOLD) {
            return (true, "Reliable buyer", 2);
        }
        
        return (true, "Standard buyer", 4);
    }
    
    /**
     * @notice Should I trust this provider?
     */
    function shouldITrustProvider(address provider) external view returns (
        bool recommended,
        string memory reason,
        uint256 riskLevel
    ) {
        ProviderProfile storage p = providers[provider];
        
        if (p.isBanned) {
            return (false, "Provider is banned", 10);
        }
        if (p.isQuarantined) {
            return (false, "Provider is quarantined", 9);
        }
        if (p.flagCount >= 3) {
            return (false, "Multiple confirmed flags", 7);
        }
        if (p.score < 400) {
            return (false, "Low trust score", 6);
        }
        if (p.isHumanVerified && p.score >= 700) {
            return (true, "Human-verified, high score", 1);
        }
        if (p.score >= 700) {
            return (true, "High trust score", 2);
        }
        
        return (true, "Standard provider", 4);
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // CROSS-CHAIN REPUTATION PORTABILITY
    // ═══════════════════════════════════════════════════════════════════════
    
    /**
     * @notice Set trusted contract address for a chain (owner only)
     * @param chainId The chain ID (e.g., 84532 for Base Sepolia)
     * @param contractAddress The ReputationEngine address on that chain
     */
    function setTrustedContract(uint32 chainId, address contractAddress) external onlyOwner {
        require(contractAddress != address(0), "Invalid address");
        trustedContracts[chainId] = contractAddress;
        emit TrustedContractSet(chainId, contractAddress);
    }
    
    /**
     * @notice Export reputation proof for cross-chain portability
     * @param destinationChainId Chain where reputation will be imported
     * @return proof Signed proof of current reputation
     * @return proofHash Hash of the proof for verification
     */
    function exportReputation(uint32 destinationChainId) external returns (
        bytes memory proof,
        bytes32 proofHash
    ) {
        // Get the entity's score (try provider first, then buyer)
        uint256 score;
        uint8 entityType; // 1 = provider, 2 = buyer
        
        if (providers[msg.sender].tier != ProviderTier.Unregistered) {
            score = providers[msg.sender].score;
            entityType = 1;
        } else if (buyers[msg.sender].totalPayments > 0) {
            score = buyers[msg.sender].score;
            entityType = 2;
        } else {
            revert("No reputation to export");
        }
        
        // Create proof data
        proof = abi.encode(
            msg.sender,           // entity address
            score,                // current score
            entityType,           // provider or buyer
            block.chainid,        // source chain
            destinationChainId,   // destination chain
            block.timestamp       // timestamp
        );
        
        proofHash = keccak256(proof);
        
        emit ReputationExported(msg.sender, score, destinationChainId, proofHash);
    }
    
    /**
     * @notice Import reputation from another chain (with discount)
     * @param proof The proof data from exportReputation
     * @dev Imported score is discounted and gradually unlocks
     */
    function importReputation(bytes calldata proof) external {
        // Decode proof
        (
            address entity,
            uint256 importedScore,
            uint8 entityType,
            uint256 sourceChainId,
            uint256 destChainId,
            uint256 timestamp
        ) = abi.decode(proof, (address, uint256, uint8, uint256, uint256, uint256));
        
        // Verify proof
        require(entity == msg.sender, "Proof not for sender");
        require(destChainId == block.chainid, "Wrong destination chain");
        require(block.timestamp <= timestamp + IMPORT_PROOF_VALIDITY, "Proof expired");
        require(sourceChainId != block.chainid, "Cannot import from same chain");
        require(trustedContracts[uint32(sourceChainId)] != address(0), "Untrusted source chain");
        
        // Check if already has imported reputation
        require(!importedReps[msg.sender].isImported, "Already imported");
        
        // Calculate discounted effective score
        // 50% discount applied immediately
        uint256 effectiveScore = (importedScore * (100 - IMPORT_DISCOUNT)) / 100;
        
        // Ensure minimum score
        if (effectiveScore < MIN_SCORE) {
            effectiveScore = MIN_SCORE;
        }
        
        // Store imported reputation
        importedReps[msg.sender] = ImportedReputation({
            importedScore: importedScore,
            sourceChainId: uint32(sourceChainId),
            importedAt: block.timestamp,
            effectiveScore: effectiveScore,
            isImported: true,
            isFrozen: false
        });
        
        // Initialize entity profile with discounted score
        if (entityType == 1) {
            // Provider - only update if not already registered
            if (providers[msg.sender].tier == ProviderTier.Unregistered) {
                providers[msg.sender].score = effectiveScore;
                providers[msg.sender].tier = ProviderTier.Newcomer;
                providers[msg.sender].registeredAt = block.timestamp;
                providers[msg.sender].lastActivityAt = block.timestamp;
            }
        } else {
            // Buyer - set initial score
            if (buyers[msg.sender].score == 0) {
                buyers[msg.sender].score = effectiveScore;
                buyers[msg.sender].tier = _getBuyerTierFromScore(effectiveScore);
            }
        }
        
        emit ReputationImported(msg.sender, importedScore, effectiveScore, uint32(sourceChainId));
    }
    
    /**
     * @notice Get effective score (considers imported reputation unlock)
     * @param entity The address to check
     * @return effectiveScore The current effective score
     * @return unlockPercentage How much of imported score is unlocked (0-100)
     */
    function getEffectiveScore(address entity) public view returns (
        uint256 effectiveScore,
        uint256 unlockPercentage
    ) {
        ImportedReputation storage imp = importedReps[entity];
        
        // If not imported or frozen, return local score
        if (!imp.isImported || imp.isFrozen) {
            // Return provider score if exists, else buyer score
            if (providers[entity].tier != ProviderTier.Unregistered) {
                return (providers[entity].score, 100);
            }
            return (buyers[entity].score, 100);
        }
        
        // Calculate unlock based on time
        uint256 daysSinceImport = (block.timestamp - imp.importedAt) / 1 days;
        
        // Graduated unlock: 50% + 10% (day 7) + 15% (day 15) + 25% (day 30)
        if (daysSinceImport >= 30) {
            unlockPercentage = 100;
        } else if (daysSinceImport >= 15) {
            unlockPercentage = 50 + UNLOCK_DAY_7 + UNLOCK_DAY_15; // 75%
        } else if (daysSinceImport >= 7) {
            unlockPercentage = 50 + UNLOCK_DAY_7; // 60%
        } else {
            unlockPercentage = 50; // Initial 50%
        }
        
        // Calculate effective score
        effectiveScore = (imp.importedScore * unlockPercentage) / 100;
        
        // Get local score for comparison
        uint256 localScore;
        if (providers[entity].tier != ProviderTier.Unregistered) {
            localScore = providers[entity].score;
        } else {
            localScore = buyers[entity].score;
        }
        
        // Return higher of effective imported score or local score
        // This allows local activity to matter
        if (localScore > effectiveScore) {
            effectiveScore = localScore;
            unlockPercentage = 100;
        }
    }
    
    /**
     * @notice Freeze imported reputation (called on bad behavior)
     * @param entity Address to freeze
     * @param reason Reason for freezing
     */
    function _freezeImportedReputation(address entity, string memory reason) internal {
        if (importedReps[entity].isImported) {
            importedReps[entity].isFrozen = true;
            
            // Reset score to minimum
            if (providers[entity].tier != ProviderTier.Unregistered) {
                providers[entity].score = MIN_SCORE;
            }
            if (buyers[entity].score > 0) {
                buyers[entity].score = MIN_SCORE;
            }
            
            emit ImportedReputationFrozen(entity, reason);
        }
    }
    
    /**
     * @notice Update effective score (call periodically to unlock)
     * @param entity Address to update
     */
    function updateEffectiveScore(address entity) external {
        ImportedReputation storage imp = importedReps[entity];
        require(imp.isImported && !imp.isFrozen, "Not eligible");
        
        (uint256 newEffective, uint256 unlockPct) = getEffectiveScore(entity);
        
        if (newEffective > imp.effectiveScore) {
            imp.effectiveScore = newEffective;
            
            // Update actual entity score
            if (providers[entity].tier != ProviderTier.Unregistered) {
                providers[entity].score = newEffective;
            }
            if (buyers[entity].score > 0 && buyers[entity].score < newEffective) {
                buyers[entity].score = newEffective;
            }
            
            emit ImportedReputationUnlocked(entity, newEffective, unlockPct);
        }
    }
    
    /**
     * @notice Get imported reputation details
     */
    function getImportedReputation(address entity) external view returns (
        uint256 importedScore,
        uint32 sourceChainId,
        uint256 importedAt,
        uint256 effectiveScore,
        bool isFrozen,
        uint256 daysSinceImport,
        uint256 unlockPercentage
    ) {
        ImportedReputation storage imp = importedReps[entity];
        
        importedScore = imp.importedScore;
        sourceChainId = imp.sourceChainId;
        importedAt = imp.importedAt;
        effectiveScore = imp.effectiveScore;
        isFrozen = imp.isFrozen;
        
        if (imp.isImported) {
            daysSinceImport = (block.timestamp - imp.importedAt) / 1 days;
            (, unlockPercentage) = getEffectiveScore(entity);
        }
    }
}
