// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../core/EscrowVault.sol";

interface IReputationEngine {
    function getTrustScore(address agent) external view returns (uint256);
    function getAgentRegistrationTime(address agent) external view returns (uint256);
}

/**
 * @title DisputeManager
 * @notice Handles dispute lifecycle with commit-reveal voting
 * @dev Part of x402 Trust Protocol
 */
contract DisputeManager is Ownable, ReentrancyGuard {
    
    // ═══════════════════════════════════════════════════════════════════════
    // CONSTANTS
    // ═══════════════════════════════════════════════════════════════════════
    
    // Timelines
    uint256 public constant FAST_TRACK_EVIDENCE = 24 hours;
    uint256 public constant FAST_TRACK_VOTING = 24 hours;
    uint256 public constant FAST_TRACK_REVEAL = 12 hours;
    
    uint256 public constant STANDARD_EVIDENCE = 48 hours;
    uint256 public constant STANDARD_VOTING = 48 hours;
    uint256 public constant STANDARD_REVEAL = 24 hours;
    
    uint256 public constant COMPLEX_EVIDENCE = 72 hours;
    uint256 public constant COMPLEX_VOTING = 72 hours;
    uint256 public constant COMPLEX_REVEAL = 48 hours;
    
    uint256 public constant COMPLEX_THRESHOLD = 1000e6; // 1000 USDC
    
    // Arbitration
    uint256 public constant MIN_ARBITRATOR_POOL = 50;
    uint256 public constant ARBITRATORS_PER_DISPUTE = 7;
    uint256 public constant REQUIRED_MAJORITY = 5;
    uint256 public constant ARBITRATOR_STAKE = 500e6;
    
    // Arbitrator eligibility
    uint256 public constant MIN_ARBITRATOR_SCORE = 700;
    uint256 public constant MIN_ARBITRATOR_AGE = 30 days;
    
    // ═══════════════════════════════════════════════════════════════════════
    // TYPES
    // ═══════════════════════════════════════════════════════════════════════
    
    enum DisputePhase { Evidence, Voting, Reveal, Resolved }
    enum DisputeTrack { FastTrack, Standard, Complex }
    enum Outcome { Pending, BuyerWins, ProviderWins, Split }
    
    struct Dispute {
        bytes32 paymentId;
        address buyer;
        address provider;
        uint256 amount;
        DisputeTrack track;
        DisputePhase phase;
        uint256 createdAt;
        uint256 evidenceDeadline;
        uint256 votingDeadline;
        uint256 revealDeadline;
        bytes32 buyerEvidence;
        bytes32 providerEvidence;
        Outcome outcome;
    }
    
    struct Arbitrator {
        uint256 stake;
        uint256 totalVotes;
        uint256 correctVotes;
        uint256 lastActiveAt;
        bool isActive;
    }
    
    struct Vote {
        bytes32 commitment;
        bool revealed;
        bool votedForBuyer;
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // STATE
    // ═══════════════════════════════════════════════════════════════════════
    
    IERC20 public immutable usdc;
    EscrowVault public escrowVault;
    IReputationEngine public reputationEngine;
    
    mapping(bytes32 => Dispute) public disputes;
    mapping(address => Arbitrator) public arbitrators;
    mapping(bytes32 => address[]) public disputeArbitrators;
    mapping(bytes32 => mapping(address => Vote)) public votes;
    
    address[] public arbitratorPool;
    
    // ═══════════════════════════════════════════════════════════════════════
    // EVENTS
    // ═══════════════════════════════════════════════════════════════════════
    
    event DisputeCreated(bytes32 indexed disputeId, bytes32 indexed paymentId, DisputeTrack track);
    event EvidenceSubmitted(bytes32 indexed disputeId, address indexed party, bytes32 evidenceHash);
    event VoteCommitted(bytes32 indexed disputeId, address indexed arbitrator);
    event VoteRevealed(bytes32 indexed disputeId, address indexed arbitrator, bool votedForBuyer);
    event DisputeResolved(bytes32 indexed disputeId, Outcome outcome);
    event ArbitratorRegistered(address indexed arbitrator);
    event ArbitratorSlashed(address indexed arbitrator, uint256 amount);
    
    // ═══════════════════════════════════════════════════════════════════════
    // CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════════════════
    
    constructor(address _usdc, address _escrowVault, address _reputationEngine) Ownable(msg.sender) {
        usdc = IERC20(_usdc);
        escrowVault = EscrowVault(_escrowVault);
        reputationEngine = IReputationEngine(_reputationEngine);
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // ARBITRATOR FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════
    
    /**
     * @notice Register as an arbitrator (requires 700+ score and 30+ days history)
     */
    function registerAsArbitrator() external nonReentrant {
        require(!arbitrators[msg.sender].isActive, "Already registered");
        
        uint256 score = reputationEngine.getTrustScore(msg.sender);
        uint256 registeredAt = reputationEngine.getAgentRegistrationTime(msg.sender);
        require(score >= MIN_ARBITRATOR_SCORE, "Score too low");
        require(block.timestamp >= registeredAt + MIN_ARBITRATOR_AGE, "Account too new");
        
        require(usdc.transferFrom(msg.sender, address(this), ARBITRATOR_STAKE), "Stake failed");
        
        arbitrators[msg.sender] = Arbitrator({
            stake: ARBITRATOR_STAKE,
            totalVotes: 0,
            correctVotes: 0,
            lastActiveAt: block.timestamp,
            isActive: true
        });
        
        arbitratorPool.push(msg.sender);
        
        emit ArbitratorRegistered(msg.sender);
    }
    
    /**
     * @notice Bootstrap arbitrator pool (owner only, for cold start)
     */
    function bootstrapArbitrator(address arbitrator) external onlyOwner {
        require(!arbitrators[arbitrator].isActive, "Already registered");
        require(arbitratorPool.length < MIN_ARBITRATOR_POOL, "Bootstrap period over");
        
        arbitrators[arbitrator] = Arbitrator({
            stake: 0,
            totalVotes: 0,
            correctVotes: 0,
            lastActiveAt: block.timestamp,
            isActive: true
        });
        
        arbitratorPool.push(arbitrator);
        
        emit ArbitratorRegistered(arbitrator);
    }
    
    /**
     * @notice Withdraw arbitrator stake
     */
    function withdrawArbitratorStake() external nonReentrant {
        Arbitrator storage a = arbitrators[msg.sender];
        require(a.isActive, "Not registered");
        require(a.stake > 0, "No stake");
        
        uint256 amount = a.stake;
        a.stake = 0;
        a.isActive = false;
        
        require(usdc.transfer(msg.sender, amount), "Transfer failed");
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // DISPUTE FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════
    
    /**
     * @notice Create a dispute (called internally when buyer raises dispute in EscrowVault)
     */
    function createDispute(
        bytes32 paymentId,
        address buyer,
        address provider,
        uint256 amount,
        bytes32 buyerEvidence
    ) external returns (bytes32 disputeId) {
        require(arbitratorPool.length >= MIN_ARBITRATOR_POOL, "Not enough arbitrators");
        
        disputeId = keccak256(abi.encodePacked(paymentId, block.timestamp));
        
        // Determine track based on amount
        DisputeTrack track;
        uint256 evidenceDeadline;
        uint256 votingDeadline;
        uint256 revealDeadline;
        
        if (amount >= COMPLEX_THRESHOLD) {
            track = DisputeTrack.Complex;
            evidenceDeadline = block.timestamp + COMPLEX_EVIDENCE;
            votingDeadline = evidenceDeadline + COMPLEX_VOTING;
            revealDeadline = votingDeadline + COMPLEX_REVEAL;
        } else if (amount >= 100e6) {
            track = DisputeTrack.Standard;
            evidenceDeadline = block.timestamp + STANDARD_EVIDENCE;
            votingDeadline = evidenceDeadline + STANDARD_VOTING;
            revealDeadline = votingDeadline + STANDARD_REVEAL;
        } else {
            track = DisputeTrack.FastTrack;
            evidenceDeadline = block.timestamp + FAST_TRACK_EVIDENCE;
            votingDeadline = evidenceDeadline + FAST_TRACK_VOTING;
            revealDeadline = votingDeadline + FAST_TRACK_REVEAL;
        }
        
        disputes[disputeId] = Dispute({
            paymentId: paymentId,
            buyer: buyer,
            provider: provider,
            amount: amount,
            track: track,
            phase: DisputePhase.Evidence,
            createdAt: block.timestamp,
            evidenceDeadline: evidenceDeadline,
            votingDeadline: votingDeadline,
            revealDeadline: revealDeadline,
            buyerEvidence: buyerEvidence,
            providerEvidence: bytes32(0),
            outcome: Outcome.Pending
        });
        
        // Select arbitrators
        _selectArbitrators(disputeId);
        
        emit DisputeCreated(disputeId, paymentId, track);
        
        return disputeId;
    }
    
    /**
     * @notice Submit provider evidence
     */
    function submitProviderEvidence(bytes32 disputeId, bytes32 evidence) external {
        Dispute storage d = disputes[disputeId];
        require(msg.sender == d.provider, "Not provider");
        require(d.phase == DisputePhase.Evidence, "Wrong phase");
        require(block.timestamp <= d.evidenceDeadline, "Deadline passed");
        
        d.providerEvidence = evidence;
        
        emit EvidenceSubmitted(disputeId, msg.sender, evidence);
    }
    
    /**
     * @notice Advance to voting phase
     */
    function advanceToVoting(bytes32 disputeId) external {
        Dispute storage d = disputes[disputeId];
        require(d.phase == DisputePhase.Evidence, "Wrong phase");
        require(block.timestamp > d.evidenceDeadline, "Evidence phase not over");
        
        d.phase = DisputePhase.Voting;
    }
    
    /**
     * @notice Commit vote (hash of vote + salt)
     */
    function commitVote(bytes32 disputeId, bytes32 commitment) external {
        Dispute storage d = disputes[disputeId];
        require(d.phase == DisputePhase.Voting, "Wrong phase");
        require(block.timestamp <= d.votingDeadline, "Deadline passed");
        require(_isSelectedArbitrator(disputeId, msg.sender), "Not selected");
        require(votes[disputeId][msg.sender].commitment == bytes32(0), "Already committed");
        
        votes[disputeId][msg.sender].commitment = commitment;
        
        emit VoteCommitted(disputeId, msg.sender);
    }
    
    /**
     * @notice Advance to reveal phase
     */
    function advanceToReveal(bytes32 disputeId) external {
        Dispute storage d = disputes[disputeId];
        require(d.phase == DisputePhase.Voting, "Wrong phase");
        require(block.timestamp > d.votingDeadline, "Voting phase not over");
        
        d.phase = DisputePhase.Reveal;
    }
    
    /**
     * @notice Reveal vote
     */
    function revealVote(bytes32 disputeId, bool votedForBuyer, bytes32 salt) external {
        Dispute storage d = disputes[disputeId];
        require(d.phase == DisputePhase.Reveal, "Wrong phase");
        require(block.timestamp <= d.revealDeadline, "Deadline passed");
        
        Vote storage v = votes[disputeId][msg.sender];
        require(v.commitment != bytes32(0), "No commitment");
        require(!v.revealed, "Already revealed");
        
        // Verify commitment
        bytes32 expectedCommitment = keccak256(abi.encodePacked(votedForBuyer, salt));
        require(v.commitment == expectedCommitment, "Invalid reveal");
        
        v.revealed = true;
        v.votedForBuyer = votedForBuyer;
        
        arbitrators[msg.sender].totalVotes++;
        arbitrators[msg.sender].lastActiveAt = block.timestamp;
        
        emit VoteRevealed(disputeId, msg.sender, votedForBuyer);
    }
    
    /**
     * @notice Resolve dispute after reveal phase
     */
    function resolveDispute(bytes32 disputeId) external nonReentrant {
        Dispute storage d = disputes[disputeId];
        require(d.phase == DisputePhase.Reveal, "Wrong phase");
        require(block.timestamp > d.revealDeadline, "Reveal phase not over");
        
        // Count votes
        uint256 buyerVotes = 0;
        uint256 providerVotes = 0;
        
        address[] storage selectedArbitrators = disputeArbitrators[disputeId];
        for (uint256 i = 0; i < selectedArbitrators.length; i++) {
            Vote storage v = votes[disputeId][selectedArbitrators[i]];
            if (v.revealed) {
                if (v.votedForBuyer) {
                    buyerVotes++;
                } else {
                    providerVotes++;
                }
            }
        }
        
        // Determine outcome
        Outcome outcome;
        if (buyerVotes >= REQUIRED_MAJORITY) {
            outcome = Outcome.BuyerWins;
            escrowVault.resolveForBuyer(d.paymentId);
        } else if (providerVotes >= REQUIRED_MAJORITY) {
            outcome = Outcome.ProviderWins;
            escrowVault.resolveForProvider(d.paymentId);
        } else {
            // No clear majority - split
            outcome = Outcome.Split;
            // Handle split case in escrow
        }
        
        d.outcome = outcome;
        d.phase = DisputePhase.Resolved;
        
        // Update arbitrator accuracy
        _updateArbitratorAccuracy(disputeId, outcome);
        
        emit DisputeResolved(disputeId, outcome);
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════
    
    function getDispute(bytes32 disputeId) external view returns (Dispute memory) {
        return disputes[disputeId];
    }
    
    function getArbitratorPoolSize() external view returns (uint256) {
        return arbitratorPool.length;
    }
    
    function getDisputeArbitrators(bytes32 disputeId) external view returns (address[] memory) {
        return disputeArbitrators[disputeId];
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // INTERNAL FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════
    
    function _selectArbitrators(bytes32 disputeId) internal {
        // Simple random selection (in production: use VRF)
        uint256 poolSize = arbitratorPool.length;
        require(poolSize >= ARBITRATORS_PER_DISPUTE, "Pool too small");
        
        uint256 selected = 0;
        uint256 seed = uint256(keccak256(abi.encodePacked(disputeId, block.timestamp, block.prevrandao)));
        
        bool[] memory used = new bool[](poolSize);
        
        while (selected < ARBITRATORS_PER_DISPUTE) {
            uint256 index = seed % poolSize;
            seed = uint256(keccak256(abi.encodePacked(seed)));
            
            if (!used[index] && arbitrators[arbitratorPool[index]].isActive) {
                used[index] = true;
                disputeArbitrators[disputeId].push(arbitratorPool[index]);
                selected++;
            }
        }
    }
    
    function _isSelectedArbitrator(bytes32 disputeId, address arbitrator) internal view returns (bool) {
        address[] storage selected = disputeArbitrators[disputeId];
        for (uint256 i = 0; i < selected.length; i++) {
            if (selected[i] == arbitrator) return true;
        }
        return false;
    }
    
    function _updateArbitratorAccuracy(bytes32 disputeId, Outcome outcome) internal {
        if (outcome == Outcome.Split) return;
        
        bool buyerWon = outcome == Outcome.BuyerWins;
        address[] storage selected = disputeArbitrators[disputeId];
        
        for (uint256 i = 0; i < selected.length; i++) {
            Vote storage v = votes[disputeId][selected[i]];
            if (v.revealed) {
                if (v.votedForBuyer == buyerWon) {
                    arbitrators[selected[i]].correctVotes++;
                }
            }
        }
    }
}
