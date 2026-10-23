// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

/// @notice Local library reached through the `@shared/` remapping (no network needed).
library Fees {
    uint256 internal constant BPS = 10_000;

    function feeFor(uint256 amount, uint256 feeBps) internal pure returns (uint256) {
        return (amount * feeBps) / BPS;
    }
}
