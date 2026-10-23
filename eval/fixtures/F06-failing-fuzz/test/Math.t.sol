// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";
import {Math} from "../src/Math.sol";

contract MathHarness {
    function square(uint256 x) external pure returns (uint256) {
        return Math.square(x);
    }
}

contract MathTest is Test {
    MathHarness internal math;

    function setUp() public {
        math = new MathHarness();
    }

    function test_squareOfThree() public view {
        assertEq(math.square(3), 9, "3^2");
    }

    /// Fails on purpose for any x >= 2**128 (arithmetic overflow, panic 0x11).
    function testFuzz_squareIsMonotonic(uint256 x) public view {
        assertGe(math.square(x), x, "square below input");
    }
}
