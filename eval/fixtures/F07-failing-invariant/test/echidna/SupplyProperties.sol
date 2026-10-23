// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {Supply} from "../../src/Supply.sol";

/// @notice Echidna harness for the same bug as invariant_supplyMatches.
contract SupplyProperties {
    Supply internal supply = new Supply();

    function mint(uint128 amount) external {
        supply.mint(address(this), amount);
    }

    function burnFrom(uint128 amount) external {
        supply.burnFrom(address(this), amount);
    }

    function echidna_supply_matches() external view returns (bool) {
        return supply.totalSupply() == supply.balanceOf(address(this));
    }
}
