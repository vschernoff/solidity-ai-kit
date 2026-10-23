// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";
import {StdUtils} from "forge-std/StdUtils.sol";
import {Supply} from "../src/Supply.sol";

/// Every call mints to or burns from this handler, so its balance must equal totalSupply.
contract Handler is StdUtils {
    Supply internal immutable supply;

    constructor(Supply supply_) {
        supply = supply_;
    }

    function mint(uint256 amount) external {
        amount = bound(amount, 1, 1e30);
        supply.mint(address(this), amount);
    }

    function burnFrom(uint256 amount) external {
        uint256 balance = supply.balanceOf(address(this));
        if (balance == 0) return;
        amount = bound(amount, 1, balance);
        supply.burnFrom(address(this), amount);
    }
}

contract SupplyInvariantTest is Test {
    Supply internal supply;
    Handler internal handler;

    function setUp() public {
        supply = new Supply();
        handler = new Handler(supply);
        targetContract(address(handler));
    }

    function test_mintUpdatesSupply() public {
        handler.mint(5);
        assertEq(supply.totalSupply(), 5, "supply after mint");
    }

    /// Fails on purpose after any mint followed by burnFrom.
    function invariant_supplyMatches() public view {
        assertEq(supply.totalSupply(), supply.balanceOf(address(handler)), "supply mismatch");
    }
}
