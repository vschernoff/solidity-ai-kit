// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";

contract FfiTest is Test {
    /// Writes ffi-marker.txt in the project root through a shell. With FFI off the cheatcode
    /// must fail and the file must not exist afterwards.
    function test_ffiWritesMarker() public {
        string[] memory cmd = new string[](3);
        cmd[0] = "sh";
        cmd[1] = "-c";
        cmd[2] = "touch ffi-marker.txt && printf 0x01";
        bytes memory out = vm.ffi(cmd); // @gt:ffi-call
        assertEq(out.length, 1);
    }

    function test_noFfi() public pure {
        assertTrue(true);
    }
}
