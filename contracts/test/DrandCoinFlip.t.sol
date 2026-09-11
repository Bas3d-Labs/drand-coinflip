// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {Test} from "forge-std/Test.sol";
import {DrandCoinFlip} from "../src/DrandCoinFlip.sol";
import {DrandQuicknetRandomnessConsumer} from "drand-quicknet-evm/consumers/DrandQuicknetRandomnessConsumer.sol";
import {IDrandQuicknetRandomnessConsumer} from "drand-quicknet-evm/interfaces/IDrandQuicknetRandomnessConsumer.sol";
import {MockRegistry} from "./MockRegistry.sol";

contract DrandCoinFlipTest is Test {
    uint64 constant LEAD = 4;
    MockRegistry reg;
    bytes32 regCodehash;
    DrandCoinFlip cf;
    address alice = makeAddr("alice");
    address relayer = makeAddr("relayer");

    function setUp() public {
        reg = new MockRegistry();
        regCodehash = address(reg).codehash;
        vm.warp(1_789_000_000);
        cf = new DrandCoinFlip(address(reg), regCodehash, LEAD);
    }

    function expectedSeed(uint256 id, uint64 round, bytes32 r) internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256("based-labs.drand-quicknet.consumer.seed.v1"),
                cf.DOMAIN_TAG(),
                block.chainid,
                address(cf),
                bytes32(id),
                round,
                r
            )
        );
    }

    // ---- round math (mirrors the registry) ----

    function test_roundMath() public view {
        assertEq(reg.roundAt(reg.GENESIS_TIMESTAMP()), 1);
        assertEq(reg.roundAt(reg.GENESIS_TIMESTAMP() + 3), 2);
        assertEq(reg.roundAt(reg.GENESIS_TIMESTAMP() - 1), 0);
    }

    // ---- constructor (all enforced by DrandQuicknetRandomnessConsumer) ----

    function test_constructorBindsRegistry() public view {
        assertEq(cf.quicknetBeaconRegistry(), address(reg));
        assertEq(cf.quicknetBeaconRegistryCodehash(), regCodehash);
        assertEq(cf.quicknetLeadRounds(), LEAD);
        assertEq(cf.seedDomain(), keccak256("based-labs.drand-quicknet.consumer.seed.v1"));
    }

    function test_constructorEnforcesLeadFloor() public {
        vm.expectRevert(
            abi.encodeWithSelector(DrandQuicknetRandomnessConsumer.QuicknetLeadBelowRegistryMinimum.selector, 2, 3)
        );
        new DrandCoinFlip(address(reg), regCodehash, 2);
        new DrandCoinFlip(address(reg), regCodehash, 3); // ok at the floor
    }

    function test_constructorRejectsZeroLead() public {
        vm.expectRevert(DrandQuicknetRandomnessConsumer.InvalidQuicknetLeadRounds.selector);
        new DrandCoinFlip(address(reg), regCodehash, 0);
    }

    function test_constructorRejectsWrongCodehash() public {
        vm.expectRevert(DrandQuicknetRandomnessConsumer.InvalidQuicknetBeaconRegistryCodehash.selector);
        new DrandCoinFlip(address(reg), keccak256("not the registry"), LEAD);
        vm.expectRevert(DrandQuicknetRandomnessConsumer.InvalidQuicknetBeaconRegistryCodehash.selector);
        new DrandCoinFlip(address(reg), bytes32(0), LEAD);
    }

    function test_constructorRejectsNonContractRegistry() public {
        vm.expectRevert(DrandQuicknetRandomnessConsumer.InvalidQuicknetBeaconRegistry.selector);
        new DrandCoinFlip(alice, regCodehash, LEAD);
    }

    // ---- commit ----

    function testFuzz_targetIsFutureRound(uint256 ts) public {
        ts = bound(ts, reg.GENESIS_TIMESTAMP(), type(uint64).max);
        vm.warp(ts);
        vm.prank(alice);
        uint256 id = cf.flip(DrandCoinFlip.Side.Heads);
        DrandCoinFlip.Flip memory f = cf.getFlip(id);
        assertEq(f.targetRound, reg.latestScheduledRound() + LEAD);
        assertGt(reg.roundScheduledTime(f.targetRound), ts + (LEAD - 1) * 3);
        assertEq(f.player, alice);
        assertFalse(f.settled);
        assertFalse(reg.isStored(f.targetRound));
    }

    function test_commitEmitsRelayerEvent() public {
        uint64 expected = reg.latestScheduledRound() + LEAD;
        // Base contract emits the relayer discovery event first (round is indexed) ...
        vm.expectEmit(true, false, false, true);
        emit IDrandQuicknetRandomnessConsumer.QuicknetRandomnessRequested(expected);
        // ... then the game event.
        vm.expectEmit(true, true, false, true);
        emit DrandCoinFlip.FlipCommitted(0, alice, DrandCoinFlip.Side.Tails, expected, uint64(block.timestamp));
        vm.prank(alice);
        cf.flip(DrandCoinFlip.Side.Tails);
    }

    // ---- settle ----

    function test_settleRequiresExactRound() public {
        vm.prank(alice);
        uint256 id = cf.flip(DrandCoinFlip.Side.Heads);
        uint64 target = cf.getFlip(id).targetRound;

        // neighbouring rounds are present, target is not -> still pending (no substitution)
        reg.store(target - 1, keccak256("a"));
        reg.store(target + 1, keccak256("b"));
        vm.expectRevert(abi.encodeWithSelector(DrandCoinFlip.BeaconNotImported.selector, target));
        cf.settle(id);

        reg.store(target, keccak256("t"));
        vm.prank(relayer); // permissionless
        cf.settle(id);
        DrandCoinFlip.Flip memory f = cf.getFlip(id);
        assertTrue(f.settled);
        assertEq(f.randomness, keccak256("t"));
        assertEq(f.seed, cf.computeSeed(id, target, keccak256("t")));
        assertEq(f.seed, expectedSeed(id, target, keccak256("t")));
        assertEq(uint8(f.result), uint8(cf.bounded(f.seed, 2)));
        assertEq(cf.settledCount(), 1);
        assertEq(cf.headsCount() + cf.tailsCount(), 1);

        vm.expectRevert(abi.encodeWithSelector(DrandCoinFlip.AlreadySettled.selector, id));
        cf.settle(id);
    }

    function test_settleWithBeaconImportsThenSettles() public {
        vm.prank(alice);
        uint256 id = cf.flip(DrandCoinFlip.Side.Heads);
        uint64 target = cf.getFlip(id).targetRound;
        bytes memory sig = new bytes(48);
        sig[0] = 0x98;

        vm.prank(relayer);
        cf.settleWithBeacon(id, sig);
        assertTrue(reg.isStored(target));
        assertEq(cf.getFlip(id).randomness, sha256(sig));
        assertTrue(cf.getFlip(id).settled);
    }

    function test_settleWithBeaconRejectsBadSignature() public {
        vm.prank(alice);
        uint256 id = cf.flip(DrandCoinFlip.Side.Heads);
        vm.expectRevert(MockRegistry.InvalidSignature.selector);
        cf.settleWithBeacon(id, hex"deadbeef");
    }

    function test_settleWithBeaconIsIdempotentOnStoredRound() public {
        vm.prank(alice);
        uint256 id = cf.flip(DrandCoinFlip.Side.Heads);
        uint64 target = cf.getFlip(id).targetRound;
        reg.store(target, keccak256("stored"));
        cf.settleWithBeacon(id, hex""); // signature ignored when already stored
        assertEq(cf.getFlip(id).randomness, keccak256("stored"));
    }

    function test_seedIsDomainSeparatedPerFlip() public {
        vm.startPrank(alice);
        uint256 a = cf.flip(DrandCoinFlip.Side.Heads);
        uint256 b = cf.flip(DrandCoinFlip.Side.Heads);
        vm.stopPrank();
        uint64 round = cf.getFlip(a).targetRound;
        assertEq(round, cf.getFlip(b).targetRound); // same block => same round
        bytes32 r = keccak256("same-round-beacon");
        assertTrue(cf.computeSeed(a, round, r) != cf.computeSeed(b, round, r));
        assertEq(cf.computeSeed(a, round, r), expectedSeed(a, round, r));
        // round is also bound into the seed
        assertTrue(cf.computeSeed(a, round, r) != cf.computeSeed(a, round + 1, r));
    }

    function test_unknownFlipReverts() public {
        vm.expectRevert(abi.encodeWithSelector(DrandCoinFlip.UnknownFlip.selector, 7));
        cf.getFlip(7);
        vm.expectRevert(abi.encodeWithSelector(DrandCoinFlip.UnknownFlip.selector, 0));
        cf.settle(0);
    }

    function test_getFlipsPagination() public {
        vm.startPrank(alice);
        for (uint256 i = 0; i < 5; i++) cf.flip(DrandCoinFlip.Side.Tails);
        vm.stopPrank();
        assertEq(cf.flipCount(), 5);
        assertEq(cf.getFlips(1, 3).length, 2);
        assertEq(cf.getFlips(3, 99).length, 2);
        assertEq(cf.getFlips(4, 2).length, 0);
    }

    // ---- statistics ----

    function test_boundedIsUniformOverManySeeds() public view {
        uint256 heads;
        uint256 n = 5000;
        for (uint256 i = 0; i < n; i++) {
            uint256 v = cf.bounded(keccak256(abi.encode(i)), 2);
            assertLt(v, 2);
            if (v == 0) heads++;
        }
        // 5000 draws: expect 2500 +/- ~5 sigma (sigma ~ 35)
        assertGt(heads, 2325);
        assertLt(heads, 2675);
    }

    function testFuzz_boundedInRange(bytes32 seed, uint256 n) public view {
        n = bound(n, 1, 1000);
        assertLt(cf.bounded(seed, n), n);
    }
}
