// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";
import {Market} from "../src/Market.sol";

contract MarketTest is Test {
    Market internal market;

    function setUp() public {
        market = new Market();
    }

    function test_quoteOfZero() public view {
        assertEq(market.quote(0), 0, "zero");
    }

    /// Fails on purpose: 1% of 10_000 is 100, the contract quotes 10.
    function test_quoteIsOnePercent() public view {
        assertEq(market.quote(10_000), 100, "fee mismatch");
    }
}
