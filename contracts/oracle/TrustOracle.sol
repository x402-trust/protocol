// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title TrustOracle
 * @notice Oracle contract for external trust data feeds
 * @dev Provides trusted external data for enhanced trust scoring
 */
contract TrustOracle is Ownable {
    
    // --- STRUCTS ---
    
    struct OracleData {
        uint256 externalScore;      // External reputation score (0-1000)
        uint256 transactionVolume;  // Historical transaction volume in USD
        uint256 accountAge;         // Account age in days
        uint256 lastUpdated;        // Timestamp of last update
        bool isVerified;            // Whether data is verified
    }
    
    struct DataProvider {
        string name;
        string endpoint;
        bool isActive;
        uint256 reputation;         // Provider reputation (0-100)
    }
    
    // --- STATE ---
    
    mapping(address => OracleData) public providerData;
    mapping(address => DataProvider) public dataProviders;
    address[] public activeProviders;
    
    uint256 public constant MIN_UPDATE_INTERVAL = 1 hours;
    uint256 public constant MAX_SCORE = 1000;
    uint256 public constant STALE_THRESHOLD = 7 days;
    
    // --- EVENTS ---
    
    event DataUpdated(address indexed provider, uint256 externalScore, uint256 volume, uint256 accountAge);
    event DataProviderRegistered(address indexed provider, string name);
    event DataProviderDeactivated(address indexed provider);
    event BatchDataUpdated(uint256 count);
    
    // --- CONSTRUCTOR ---
    
    constructor() Ownable(msg.sender) {}
    
    // --- DATA PROVIDER MANAGEMENT ---
    
    /**
     * @notice Register a new data provider
     * @param provider Address of the data provider
     * @param name Human-readable name
     * @param endpoint API endpoint for the provider
     */
    function registerDataProvider(
        address provider,
        string calldata name,
        string calldata endpoint
    ) external onlyOwner {
        require(provider != address(0), "Invalid provider");
        require(!dataProviders[provider].isActive, "Already registered");
        
        dataProviders[provider] = DataProvider({
            name: name,
            endpoint: endpoint,
            isActive: true,
            reputation: 50  // Start with neutral reputation
        });
        
        activeProviders.push(provider);
        
        emit DataProviderRegistered(provider, name);
    }
    
    /**
     * @notice Deactivate a data provider
     */
    function deactivateDataProvider(address provider) external onlyOwner {
        require(dataProviders[provider].isActive, "Not active");
        dataProviders[provider].isActive = false;
        emit DataProviderDeactivated(provider);
    }
    
    // --- DATA UPDATES ---
    
    /**
     * @notice Update oracle data for a single address
     * @param target Address to update data for
     * @param externalScore External reputation score (0-1000)
     * @param transactionVolume Historical transaction volume
     * @param accountAge Account age in days
     */
    function updateData(
        address target,
        uint256 externalScore,
        uint256 transactionVolume,
        uint256 accountAge
    ) external {
        require(dataProviders[msg.sender].isActive, "Not authorized provider");
        require(externalScore <= MAX_SCORE, "Score too high");
        
        OracleData storage data = providerData[target];
        require(
            block.timestamp >= data.lastUpdated + MIN_UPDATE_INTERVAL,
            "Too frequent"
        );
        
        data.externalScore = externalScore;
        data.transactionVolume = transactionVolume;
        data.accountAge = accountAge;
        data.lastUpdated = block.timestamp;
        data.isVerified = true;
        
        emit DataUpdated(target, externalScore, transactionVolume, accountAge);
    }
    
    /**
     * @notice Batch update data for multiple addresses
     * @param targets Array of addresses
     * @param scores Array of scores
     * @param volumes Array of volumes
     * @param ages Array of account ages
     */
    function batchUpdateData(
        address[] calldata targets,
        uint256[] calldata scores,
        uint256[] calldata volumes,
        uint256[] calldata ages
    ) external {
        require(dataProviders[msg.sender].isActive, "Not authorized provider");
        require(
            targets.length == scores.length &&
            targets.length == volumes.length &&
            targets.length == ages.length,
            "Length mismatch"
        );
        
        for (uint256 i = 0; i < targets.length; i++) {
            if (scores[i] <= MAX_SCORE) {
                OracleData storage data = providerData[targets[i]];
                data.externalScore = scores[i];
                data.transactionVolume = volumes[i];
                data.accountAge = ages[i];
                data.lastUpdated = block.timestamp;
                data.isVerified = true;
            }
        }
        
        emit BatchDataUpdated(targets.length);
    }
    
    // --- VIEW FUNCTIONS ---
    
    /**
     * @notice Get external score for an address
     * @param target Address to query
     * @return score External score (0-1000)
     * @return isStale Whether the data is stale
     */
    function getExternalScore(address target) external view returns (uint256 score, bool isStale) {
        OracleData storage data = providerData[target];
        score = data.externalScore;
        isStale = block.timestamp > data.lastUpdated + STALE_THRESHOLD;
    }
    
    /**
     * @notice Get full oracle data for an address
     */
    function getFullData(address target) external view returns (
        uint256 externalScore,
        uint256 transactionVolume,
        uint256 accountAge,
        uint256 lastUpdated,
        bool isVerified,
        bool isStale
    ) {
        OracleData storage data = providerData[target];
        externalScore = data.externalScore;
        transactionVolume = data.transactionVolume;
        accountAge = data.accountAge;
        lastUpdated = data.lastUpdated;
        isVerified = data.isVerified;
        isStale = block.timestamp > data.lastUpdated + STALE_THRESHOLD;
    }
    
    /**
     * @notice Check if address has verified data
     */
    function hasVerifiedData(address target) external view returns (bool) {
        return providerData[target].isVerified && 
               block.timestamp <= providerData[target].lastUpdated + STALE_THRESHOLD;
    }
    
    /**
     * @notice Get combined trust boost from oracle data
     * @dev Returns a boost factor (0-100) to add to on-chain score
     */
    function getTrustBoost(address target) external view returns (uint256) {
        OracleData storage data = providerData[target];
        
        if (!data.isVerified || block.timestamp > data.lastUpdated + STALE_THRESHOLD) {
            return 0;
        }
        
        // Calculate boost: max 100 points
        // - External score contributes up to 50 points
        // - Account age contributes up to 30 points (max at 365 days)
        // - Volume contributes up to 20 points (max at $100k)
        
        uint256 scoreBoost = (data.externalScore * 50) / MAX_SCORE;
        uint256 ageBoost = data.accountAge >= 365 ? 30 : (data.accountAge * 30) / 365;
        uint256 volumeBoost = data.transactionVolume >= 100000e6 ? 20 : (data.transactionVolume * 20) / 100000e6;
        
        return scoreBoost + ageBoost + volumeBoost;
    }
    
    /**
     * @notice Get number of active data providers
     */
    function getActiveProviderCount() external view returns (uint256) {
        uint256 count = 0;
        for (uint256 i = 0; i < activeProviders.length; i++) {
            if (dataProviders[activeProviders[i]].isActive) {
                count++;
            }
        }
        return count;
    }
}
