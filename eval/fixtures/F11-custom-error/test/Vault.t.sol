// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";
import {Vault} from "../src/Vault.sol";

contract VaultTest is Test {
    Vault internal vault;

    function setUp() public {
        vault = new Vault();
    }

    function test_withdrawMoreThanBalance() public {
        vault.withdraw(1 ether); // @gt:custom-error-args
    }

    function test_withdrawWhenPaused() public {
        vault.pause();
        vault.withdraw(0); // @gt:custom-error-no-args
    }

    function test_expectRevertMismatch() public {
        vault.pause();
        vm.expectRevert(abi.encodeWithSelector(Vault.InsufficientBalance.selector, address(this), 0, 1)); // @gt:expect-revert-mismatch
        vault.withdraw(1);
    }

    function test_expectRevertButNone() public {
        vm.expectRevert(); // @gt:expect-revert-none
        vault.deposit{value: 1}();
    }

    function test_panicDivZero() public view {
        vault.divide(1, 0); // @gt:panic-div-zero
    }

    function test_panicUnderflow() public view {
        vault.sub(0, 1); // @gt:panic-underflow
    }

    function test_undeclaredSelector() public view {
        vault.undeclared(); // @gt:undeclared-selector
    }

    function test_expectRevertMatches() public {
        vm.expectRevert(abi.encodeWithSelector(Vault.InsufficientBalance.selector, address(this), 0, 1));
        vault.withdraw(1);
    }
}
