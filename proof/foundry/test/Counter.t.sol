// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract Counter {
    uint256 public value;

    function increment() external {
        value += 1;
    }
}

contract CounterTest {
    function testIncrement() public {
        Counter counter = new Counter();
        counter.increment();
        require(counter.value() == 1, "increment failed");
    }
}
