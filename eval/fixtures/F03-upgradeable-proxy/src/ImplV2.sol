// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

/// @notice Version 2. Planted: a new variable is inserted before `value`, so every later
/// variable moves one slot (storage collision with V1). Fixture F03.
contract ImplV2 {
    bytes32 internal constant IMPLEMENTATION_SLOT =
        0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;

    address public owner; // slot 0
    uint256 public fee; // slot 1 - @gt:storage-collision
    uint256 public value; // slot 2 (was slot 1)
    bool internal initialized; // slot 3 (was slot 2)

    function setValue(uint256 newValue) external {
        require(msg.sender == owner, "not owner");
        value = newValue;
    }

    function upgradeTo(address newImplementation) external {
        assembly {
            sstore(IMPLEMENTATION_SLOT, newImplementation)
        }
    }
}
