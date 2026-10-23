// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";
import {Bank} from "../src/Bank.sol";

contract BankTest is Test {
    Bank internal bank;
    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);

    function setUp() public {
        bank = new Bank();
        bank.credit(alice, 1_000);
    }

    function test_credit() public view {
        assertEq(bank.balanceOf(alice), 1_000, "credited");
    }

    /// Fails on purpose: bob receives 99, not 100.
    function test_transfer() public {
        vm.prank(alice);
        bank.transfer(bob, 100);
        assertEq(bank.balanceOf(bob), 100, "balance mismatch");
    }
}
