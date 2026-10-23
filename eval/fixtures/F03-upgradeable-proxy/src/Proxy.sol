// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

/// @notice Minimal ERC-1967 proxy. Fixture F03.
contract Proxy {
    // bytes32(uint256(keccak256("eip1967.proxy.implementation")) - 1)
    bytes32 internal constant IMPLEMENTATION_SLOT =
        0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;

    constructor(address implementation, bytes memory initData) {
        assembly {
            sstore(IMPLEMENTATION_SLOT, implementation)
        }
        if (initData.length > 0) {
            (bool ok, ) = implementation.delegatecall(initData);
            require(ok, "init failed");
        }
    }

    fallback() external payable {
        assembly {
            let impl := sload(IMPLEMENTATION_SLOT)
            calldatacopy(0, 0, calldatasize())
            let ok := delegatecall(gas(), impl, 0, calldatasize(), 0, 0)
            returndatacopy(0, 0, returndatasize())
            switch ok
            case 0 {
                revert(0, returndatasize())
            }
            default {
                return(0, returndatasize())
            }
        }
    }
}
