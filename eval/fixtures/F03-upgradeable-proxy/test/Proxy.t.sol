// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";
import {Proxy} from "../src/Proxy.sol";
import {ImplV1} from "../src/ImplV1.sol";
import {ImplV2} from "../src/ImplV2.sol";

/// Every test here passes, although the contracts are unsafe: tests passing is not safety (C5).
contract ProxyTest is Test {
    ImplV1 internal proxied;
    address internal admin = address(0xAD);

    function setUp() public {
        ImplV1 v1 = new ImplV1();
        Proxy proxy = new Proxy(address(v1), abi.encodeCall(ImplV1.initialize, (admin)));
        proxied = ImplV1(address(proxy));
    }

    function test_ownerCanSetValue() public {
        vm.prank(admin);
        proxied.setValue(42);
        assertEq(proxied.value(), 42, "value");
    }

    function test_upgradeKeepsOwner() public {
        ImplV2 v2 = new ImplV2();
        vm.prank(admin);
        proxied.upgradeTo(address(v2));
        assertEq(ImplV2(address(proxied)).owner(), admin, "owner kept");
    }
}
