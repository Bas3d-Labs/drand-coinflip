// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {DrandCoinFlip} from "../src/DrandCoinFlip.sol";
import {IDrandQuicknetBeaconRegistry} from "../src/interfaces/IDrandQuicknetBeaconRegistry.sol";

/// @notice Integration test against the REAL registry + BLS verifier on Robinhood Chain Testnet.
///         Run: forge test --match-contract Fork --fork-url robinhood_testnet
///         Skipped automatically when not running on a fork of chain 46630.
contract DrandCoinFlipForkTest is Test {
    address constant REGISTRY = 0x6e69C56D8D678aDeF8401adF1186c026A0915e2a;

    // Genuine Quicknet beacons (https://api.drand.sh/v2/beacons/quicknet/rounds/{round})
    uint64 constant R0 = 32000000;
    bytes constant SIG0 =
        hex"b1c90cc3c290ae966b9b5230cd3c93389bd95ae0274f7dce8ef43979745fa747c72fbebe7ddafb79088120565d91b91f";
    uint64 constant R1 = 32000001;
    bytes constant SIG1 =
        hex"aa5153f0a3f6601a2f7df7b99159cbc9ce55e9885a91e878f26b8396add3650209d2502e856f801c0bb59a4b50638046";

    IDrandQuicknetBeaconRegistry reg = IDrandQuicknetBeaconRegistry(REGISTRY);
    DrandCoinFlip cf;

    modifier onlyFork() {
        if (block.chainid != 46630) {
            vm.skip(true);
        }
        _;
    }

    function setUp() public {
        if (block.chainid != 46630) return;
        cf = new DrandCoinFlip(REGISTRY, 4);
    }

    function test_registryBinding() public onlyFork {
        assertEq(reg.verifier(), 0x90427e40e7D6f60425D29474a85595C4d8EE6B95);
        assertEq(reg.verifierCodehash(), reg.verifier().codehash);
        assertEq(reg.minimumLeadRounds(), 3);
        assertEq(reg.roundAt(1692803367), 1);
        assertEq(reg.roundAt(1692803367 + 3), 2);
        assertEq(reg.roundAt(1692803367 - 1), 0);
    }

    function test_realVerifierAcceptsGenuineSignature() public onlyFork {
        bytes32 v = reg.submitBeacon(R0, SIG0);
        assertEq(v, sha256(SIG0));
        assertTrue(reg.isStored(R0));
        assertEq(reg.getBeacon(R0), sha256(SIG0));
        // idempotent, garbage signature ignored once stored
        assertEq(reg.submitBeacon(R0, hex"00"), sha256(SIG0));
    }

    function test_realVerifierRejectsWrongRound() public onlyFork {
        if (reg.isStored(R1)) return; // cannot exercise rejection on an already-cached round
        vm.expectRevert();
        reg.submitBeacon(R1, SIG0); // signature for R0 submitted as R1
    }

    function test_realVerifierRejectsFlippedSignBit() public onlyFork {
        if (reg.isStored(R1)) return;
        bytes memory bad = SIG1;
        bad[0] = bytes1(uint8(bad[0]) ^ 0x20); // flip the compressed-point sign bit
        vm.expectRevert();
        reg.submitBeacon(R1, bad);
    }

    function test_endToEndFlipAgainstRealRegistry() public onlyFork {
        // Warp so the target round is exactly R1, then reveal with the genuine signature.
        uint256 ts = reg.roundScheduledTime(R1 - 4);
        vm.warp(ts);
        uint256 id = cf.flip(DrandCoinFlip.Side.Heads);
        assertEq(cf.getFlip(id).targetRound, R1);

        if (!reg.isStored(R1)) {
            vm.expectRevert(abi.encodeWithSelector(DrandCoinFlip.BeaconNotImported.selector, R1));
            cf.settle(id);
        }

        cf.settleWithBeacon(id, SIG1);
        DrandCoinFlip.Flip memory f = cf.getFlip(id);
        assertTrue(f.settled);
        assertEq(f.randomness, sha256(SIG1));
        assertEq(f.seed, keccak256(abi.encode(cf.DOMAIN_TAG(), uint256(46630), address(cf), id, uint16(0), sha256(SIG1))));
        assertEq(uint8(f.result), uint8(uint256(f.seed) % 2));
    }
}
