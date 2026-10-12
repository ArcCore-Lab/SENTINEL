// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../src/ShareVault.sol";

interface Vm {
    function deal(address account, uint256 newBalance) external;
}

contract ShareVaultActor {
    receive() external payable {}

    function deposit(ShareVault vault) external payable {
        vault.deposit{value: msg.value}();
    }

    function withdraw(ShareVault vault, uint256 shareAmount) external returns (uint256) {
        uint256 beforeBalance = address(this).balance;
        vault.withdraw(shareAmount);
        return address(this).balance - beforeBalance;
    }
}

contract ShareVaultTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function testExpectedBug_ReproducesBobHalfPayout() public {
        (ShareVault vault, ShareVaultActor alice, ShareVaultActor bob) = _fundAndDeposit();

        alice.withdraw(vault, 1 ether);
        uint256 bobPayout = bob.withdraw(vault, 1 ether);

        require(bobPayout == 0.5 ether, "REPRODUCTION_DID_NOT_MATCH");
    }

    function testWithdrawPreservesOutstandingShareInvariant() public {
        (ShareVault vault, ShareVaultActor alice, ShareVaultActor bob) = _fundAndDeposit();

        alice.withdraw(vault, 1 ether);

        uint256 trackedShares = vault.totalShares();
        uint256 outstandingShares = vault.balanceOf(address(alice)) + vault.balanceOf(address(bob));
        require(trackedShares == outstandingShares, "INV_SHARE_SUPPLY_CONSERVATION");
    }

    function testEveryShareholderCanRedeemOriginalDeposit() public {
        (ShareVault vault, ShareVaultActor alice, ShareVaultActor bob) = _fundAndDeposit();

        alice.withdraw(vault, 1 ether);
        uint256 bobPayout = bob.withdraw(vault, 1 ether);

        require(bobPayout == 1 ether, "INV_FULL_REDEMPTION");
    }

    function _fundAndDeposit() private returns (ShareVault, ShareVaultActor, ShareVaultActor) {
        vm.deal(address(this), 2 ether);
        ShareVault vault = new ShareVault();
        ShareVaultActor alice = new ShareVaultActor();
        ShareVaultActor bob = new ShareVaultActor();

        alice.deposit{value: 1 ether}(vault);
        bob.deposit{value: 1 ether}(vault);

        return (vault, alice, bob);
    }
}
