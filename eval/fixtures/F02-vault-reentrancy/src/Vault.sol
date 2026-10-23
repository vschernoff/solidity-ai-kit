// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

/// @notice Staking vault with a planted reentrancy bug. Fixture F02.
/// withdraw() pays out before it zeroes the caller's balance.
contract Vault {
    mapping(address => uint256) public balances;

    event Deposited(address indexed account, uint256 amount);
    event Withdrawn(address indexed account, uint256 amount);

    function deposit() external payable {
        require(msg.value > 0, "zero deposit");
        balances[msg.sender] += msg.value;
        emit Deposited(msg.sender, msg.value);
    }

    function withdraw() external {
        uint256 amount = balances[msg.sender];
        require(amount > 0, "nothing to withdraw");
        (bool ok, ) = msg.sender.call{value: amount}(""); // @gt:reentrancy
        require(ok, "send failed");
        balances[msg.sender] = 0;
        emit Withdrawn(msg.sender, amount);
    }
}
