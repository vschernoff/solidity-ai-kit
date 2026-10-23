// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";
import {Token} from "../src/Token.sol";

contract TokenTest is Test {
    Token internal token;
    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);

    function setUp() public {
        token = new Token();
        token.mint(alice, 1_000e18);
    }

    function test_transfer() public {
        vm.prank(alice);
        token.transfer(bob, 100e18);
        assertEq(token.balanceOf(bob), 100e18, "bob balance");
        assertEq(token.balanceOf(alice), 900e18, "alice balance");
    }

    function test_transferFromUsesAllowance() public {
        vm.prank(alice);
        token.approve(bob, 50e18);
        vm.prank(bob);
        token.transferFrom(alice, bob, 50e18);
        assertEq(token.allowance(alice, bob), 0, "allowance spent");
        assertEq(token.balanceOf(bob), 50e18, "bob balance");
    }

    function test_RevertWhen_mintByNonOwner() public {
        vm.prank(alice);
        vm.expectRevert(Token.NotOwner.selector);
        token.mint(alice, 1);
    }

    function testFuzz_transferKeepsSupply(uint256 amount) public {
        amount = bound(amount, 0, 1_000e18);
        vm.prank(alice);
        token.transfer(bob, amount);
        assertEq(token.balanceOf(alice) + token.balanceOf(bob), token.totalSupply(), "supply");
    }
}
