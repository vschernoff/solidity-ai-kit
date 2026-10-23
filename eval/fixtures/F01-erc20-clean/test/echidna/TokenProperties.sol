// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {Token} from "../../src/Token.sol";

/// @notice Echidna property harness. Holds: only this contract mints, and it tracks every
/// holder it ever paid, so the sum of tracked balances must equal totalSupply.
contract TokenProperties {
    Token internal token = new Token();
    address[3] internal holders = [address(0x10000), address(0x20000), address(0x30000)];

    function mint(uint8 who, uint96 amount) external {
        token.mint(holders[who % 3], amount);
    }

    function echidna_supply_equals_balances() external view returns (bool) {
        uint256 sum = token.balanceOf(address(this));
        for (uint256 i = 0; i < holders.length; i++) {
            sum += token.balanceOf(holders[i]);
        }
        return sum == token.totalSupply();
    }
}
