// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Multicall as MulticallV494} from "../lib/openzeppelin/v4.9.4/contracts/utils/Multicall.sol";
import {Multicall as MulticallV495} from "../lib/openzeppelin/v4.9.5/contracts/utils/Multicall.sol";

contract CounterV494 is MulticallV494 {
    uint256 public count;

    function increment() external {
        count += 1;
    }
}

contract CounterV495 is MulticallV495 {
    uint256 public count;

    function increment() external {
        count += 1;
    }
}

contract OpenZeppelinMulticallTest {
    function testHistoricalV494OneSubcallExecutesTwice() public {
        CounterV494 target = new CounterV494();
        target.multicall(_oneIncrement());
        require(target.count() == 2, "HISTORICAL_DOUBLE_CALL_NOT_REPRODUCED");
    }

    function testPatchedV495OneSubcallExecutesOnce() public {
        CounterV495 target = new CounterV495();
        target.multicall(_oneIncrement());
        require(target.count() == 1, "PATCHED_SINGLE_CALL_NOT_OBSERVED");
    }

    function testInvariantV494OneSubcallExecutesOnce() public {
        CounterV494 target = new CounterV494();
        target.multicall(_oneIncrement());
        require(target.count() == 1, "INV_SINGLE_EXECUTION");
    }

    function _oneIncrement() private pure returns (bytes[] memory calls) {
        calls = new bytes[](1);
        calls[0] = abi.encodeWithSignature("increment()");
    }
}
