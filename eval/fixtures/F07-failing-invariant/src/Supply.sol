// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

/// @notice Fixture F07: burnFrom() lowers the holder's balance but forgets totalSupply.
contract Supply {
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;

    function mint(address to, uint256 amount) external {
        totalSupply += amount;
        balanceOf[to] += amount;
    }

    function burnFrom(address from, uint256 amount) external {
        require(balanceOf[from] >= amount, "burn exceeds balance");
        balanceOf[from] -= amount; // @gt:missing-supply-update
    }
}
