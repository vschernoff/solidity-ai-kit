// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";
import {Counter} from "../src/Counter.sol";

contract CounterTest is Test {
    function test_increment() public {
        Counter counter = new Counter();
        counter.increment();
        assertEq(counter.count(), 1, "count");
    }
}
