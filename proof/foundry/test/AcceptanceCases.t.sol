// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../src/ShareVault.sol";

contract AcceptanceCasesTest {
    function testBoundaryZeroDepositIsRejectedWithoutStateChange() public {
        ShareVault vault = new ShareVault();
        (bool success, ) = address(vault).call(abi.encodeCall(vault.deposit, ()));

        require(!success, "ZERO_DEPOSIT_ACCEPTED");
        require(vault.totalAssets() == 0 && vault.totalShares() == 0, "ZERO_DEPOSIT_MUTATED_STATE");
    }

    function testFixtureFailureIsNotAVulnerabilityFinding() public pure {
        require(false, "FIXTURE_EXPECTED_TEST_FAILURE");
    }
}
