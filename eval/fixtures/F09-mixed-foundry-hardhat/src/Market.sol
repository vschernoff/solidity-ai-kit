// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {Fees} from "@shared/Fees.sol";

/// @notice Fixture F09: charges a 1% fee, but quotes it in the wrong unit.
contract Market {
    uint256 public constant FEE_BPS = 100;

    function quote(uint256 amount) external pure returns (uint256 fee) {
        fee = Fees.feeFor(amount, FEE_BPS / 10); // @gt:wrong-fee-unit
    }
}
