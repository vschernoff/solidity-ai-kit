// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

/// @notice Fixture F08: authorises with tx.origin instead of msg.sender.
contract Wallet {
    address public owner;

    constructor() {
        owner = msg.sender;
    }

    receive() external payable {}

    function sendTo(address payable to, uint256 amount) external {
        require(tx.origin == owner, "not owner"); // @gt:tx-origin
        to.transfer(amount);
    }
}
