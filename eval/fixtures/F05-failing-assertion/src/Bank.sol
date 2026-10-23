// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

/// @notice Fixture F05: transfer() silently keeps one unit.
contract Bank {
    mapping(address => uint256) public balanceOf;

    function credit(address account, uint256 amount) external {
        balanceOf[account] += amount;
    }

    function transfer(address to, uint256 amount) external {
        require(balanceOf[msg.sender] >= amount, "insufficient");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount - 1; // @gt:off-by-one
    }
}
