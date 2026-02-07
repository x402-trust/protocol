// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockUSDC
 * @notice Mock USDC token for testing on Base Sepolia
 */
contract MockUSDC is ERC20 {
    uint8 private constant DECIMALS = 6;
    
    constructor() ERC20("USD Coin", "USDC") {
        // Mint 1M USDC to deployer for testing
        _mint(msg.sender, 1_000_000 * 10**DECIMALS);
    }
    
    function decimals() public pure override returns (uint8) {
        return DECIMALS;
    }
    
    /**
     * @notice Mint tokens (for testing only)
     */
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
    
    /**
     * @notice Faucet - get 1000 USDC for testing
     */
    function faucet() external {
        _mint(msg.sender, 1000 * 10**DECIMALS);
    }
}
