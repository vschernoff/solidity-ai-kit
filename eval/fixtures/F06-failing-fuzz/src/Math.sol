// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

/// @notice Fixture F06: square() overflows for x >= 2**128.
library Math {
    function square(uint256 x) internal pure returns (uint256) {
        return x * x; // @gt:overflow
    }
}
