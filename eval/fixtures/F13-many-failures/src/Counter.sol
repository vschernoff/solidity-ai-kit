// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

contract Counter {
    uint256 public number;

    function setNumber(uint256 n) public {
        number = n;
    }

    function increment() public {
        number++; // @gt:increment
    }
}
