// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";
import {Counter} from "../src/Counter.sol";

/// Would pass if the project compiled. It must never be reported as passed: the build fails.
contract CounterTest is Test {
    function test_increment() public {
        Counter counter = new Counter();
        counter.increment();
        assertEq(counter.count(), 1, "count");
    }
}
