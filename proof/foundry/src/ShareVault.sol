// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract ShareVault {
    uint256 public totalAssets;
    uint256 public totalShares;
    mapping(address => uint256) public balanceOf;

    function deposit() external payable returns (uint256 sharesOut) {
        require(msg.value != 0, "ZERO_DEPOSIT");

        if (totalShares == 0) {
            sharesOut = msg.value;
        } else {
            require(totalAssets != 0, "NO_ASSETS");
            sharesOut = (msg.value * totalShares) / totalAssets;
        }

        totalAssets += msg.value;
        totalShares += sharesOut;
        balanceOf[msg.sender] += sharesOut;
    }

    function withdraw(uint256 shareAmount) external returns (uint256 assetsOut) {
        require(shareAmount != 0, "ZERO_WITHDRAWAL");
        require(balanceOf[msg.sender] >= shareAmount, "INSUFFICIENT_SHARES");

        assetsOut = (shareAmount * totalAssets) / totalShares;
        balanceOf[msg.sender] -= shareAmount;
        totalAssets -= assetsOut;

        (bool sent, ) = msg.sender.call{value: assetsOut}("");
        require(sent, "TRANSFER_FAILED");
    }
}
