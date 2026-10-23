// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

/// @notice UUPS-style implementation, version 1. Fixture F03.
/// Planted: upgradeTo has no access control.
contract ImplV1 {
    bytes32 internal constant IMPLEMENTATION_SLOT =
        0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;

    address public owner; // slot 0
    uint256 public value; // slot 1
    bool internal initialized; // slot 2

    function initialize(address owner_) external {
        require(!initialized, "already initialized");
        initialized = true;
        owner = owner_;
    }

    function setValue(uint256 newValue) external {
        require(msg.sender == owner, "not owner");
        value = newValue;
    }

    function upgradeTo(address newImplementation) external { // @gt:unprotected-upgrade
        assembly {
            sstore(IMPLEMENTATION_SLOT, newImplementation)
        }
    }
}
