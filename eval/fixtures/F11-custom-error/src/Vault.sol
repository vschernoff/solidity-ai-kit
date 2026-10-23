// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

contract Vault {
    error InsufficientBalance(address account, uint256 have, uint256 want);
    error Paused();

    mapping(address => uint256) public balanceOf;
    bool public paused;

    function deposit() external payable {
        balanceOf[msg.sender] += msg.value;
    }

    function withdraw(uint256 amount) external {
        if (paused) revert Paused();
        uint256 bal = balanceOf[msg.sender];
        if (bal < amount) revert InsufficientBalance(msg.sender, bal, amount);
        balanceOf[msg.sender] = bal - amount;
        payable(msg.sender).transfer(amount);
    }

    function pause() external {
        paused = true;
    }

    function divide(uint256 a, uint256 b) external pure returns (uint256) {
        return a / b;
    }

    function sub(uint256 a, uint256 b) external pure returns (uint256) {
        return a - b;
    }

    /// Reverts with a selector declared nowhere in the project, so no ABI can decode it.
    function undeclared() external pure {
        assembly {
            mstore(0, shl(224, 0xdeadbeef))
            revert(0, 4)
        }
    }
}
