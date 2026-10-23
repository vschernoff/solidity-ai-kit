// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

/// @notice Fixture F04: one type error, on one line, so the expected location is exact.
contract Broken {
    uint256 public total;

    function add(uint256 amount) external {
        total += amount;
    }

    function label() external pure returns (uint256) {
        uint256 x = "not a number"; // @gt:compile-error
        return x;
    }
}
