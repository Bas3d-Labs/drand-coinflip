// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IDrandQuicknetBeaconRegistry} from "./interfaces/IDrandQuicknetBeaconRegistry.sol";

/// @title DrandCoinFlip
/// @notice A provably-fair coin flip whose randomness comes from the drand Quicknet beacon
///         via the on-chain `DrandQuicknetBeaconRegistry`.
///
///         Pattern: **commit to a future round, settle from it.**
///         - `flip()` derives a target round from `block.timestamp + LEAD_ROUNDS`. The caller has
///           no influence over it and the beacon for that round does not exist yet.
///         - `settle()` (permissionless) reads exactly that round's verified beacon, derives a
///           domain-separated seed, and resolves heads/tails. The round is never substituted.
///         - `settleWithBeacon()` lets any relayer import the beacon and settle in one tx.
///
///         No value is at stake in this version; it exists to showcase verifiable randomness.
contract DrandCoinFlip {
    // ---------------------------------------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------------------------------------

    enum Side {
        Heads,
        Tails
    }

    struct Flip {
        address player; //   who committed
        Side choice; //      the side the player called
        Side result; //      resolved side (valid only if settled)
        bool settled; //     true once the beacon has been read and the flip resolved
        uint64 targetRound; // drand Quicknet round this flip is bound to
        uint64 commitTime; // block.timestamp at commit
        uint64 settleTime; // block.timestamp at settle
        bytes32 randomness; // registry beacon value used (sha256 of the BLS signature)
        bytes32 seed; //     domain-separated seed derived from randomness
    }

    // ---------------------------------------------------------------------------------------------
    // Errors / events
    // ---------------------------------------------------------------------------------------------

    error LeadTooShort(uint64 lead, uint64 minimum);
    error UnknownFlip(uint256 id);
    error AlreadySettled(uint256 id);
    error BeaconNotImported(uint64 round);
    error BeaconMismatch(uint64 round);

    /// @dev Consumed by the drand-quicknet-evm reference relayer: "please import this round".
    event QuicknetRandomnessRequested(uint64 round);

    event FlipCommitted(
        uint256 indexed id, address indexed player, Side choice, uint64 targetRound, uint64 commitTime
    );

    event FlipSettled(
        uint256 indexed id,
        address indexed player,
        uint64 targetRound,
        bytes32 randomness,
        bytes32 seed,
        Side result,
        bool won,
        address settler
    );

    // ---------------------------------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------------------------------

    /// @dev Seed domain tag. One tag per purpose; this contract has exactly one draw per flip.
    bytes32 public constant DOMAIN_TAG = keccak256("DRAND_COINFLIP_V1");

    IDrandQuicknetBeaconRegistry public immutable registry;

    /// @notice Rounds of lead between commit and the target round. 3s per round.
    uint64 public immutable LEAD_ROUNDS;

    Flip[] private _flips;

    uint256 public settledCount;
    uint256 public headsCount;
    uint256 public tailsCount;
    uint256 public winCount;

    // ---------------------------------------------------------------------------------------------
    // Constructor
    // ---------------------------------------------------------------------------------------------

    constructor(address registry_, uint64 leadRounds) {
        uint64 minimum = IDrandQuicknetBeaconRegistry(registry_).minimumLeadRounds();
        if (leadRounds < minimum) revert LeadTooShort(leadRounds, minimum);
        registry = IDrandQuicknetBeaconRegistry(registry_);
        LEAD_ROUNDS = leadRounds;
    }

    // ---------------------------------------------------------------------------------------------
    // Commit
    // ---------------------------------------------------------------------------------------------

    /// @notice Commit a coin flip. The target drand round is derived on-chain from the current
    ///         block timestamp plus a fixed lead; the caller cannot influence it.
    /// @param choice The side the player calls.
    /// @return id The flip id (index into the flip log).
    function flip(Side choice) external returns (uint256 id) {
        uint64 target = registry.roundAt(block.timestamp) + LEAD_ROUNDS;
        id = _flips.length;
        _flips.push(
            Flip({
                player: msg.sender,
                choice: choice,
                result: Side.Heads,
                settled: false,
                targetRound: target,
                commitTime: uint64(block.timestamp),
                settleTime: 0,
                randomness: bytes32(0),
                seed: bytes32(0)
            })
        );
        emit FlipCommitted(id, msg.sender, choice, target, uint64(block.timestamp));
        emit QuicknetRandomnessRequested(target);
    }

    // ---------------------------------------------------------------------------------------------
    // Settle
    // ---------------------------------------------------------------------------------------------

    /// @notice Resolve a flip from its committed round. Permissionless; the outcome is a pure
    ///         function of (chain, contract, id, beacon) and cannot depend on who calls this.
    function settle(uint256 id) public {
        if (id >= _flips.length) revert UnknownFlip(id);
        Flip storage f = _flips[id];
        if (f.settled) revert AlreadySettled(id);
        if (!registry.isStored(f.targetRound)) revert BeaconNotImported(f.targetRound);

        bytes32 randomness = registry.getBeacon(f.targetRound);
        bytes32 seed = computeSeed(id, randomness);
        Side result = Side(bounded(seed, 2));

        f.settled = true;
        f.result = result;
        f.randomness = randomness;
        f.seed = seed;
        f.settleTime = uint64(block.timestamp);

        bool won = result == f.choice;
        unchecked {
            settledCount++;
            if (result == Side.Heads) headsCount++;
            else tailsCount++;
            if (won) winCount++;
        }

        emit FlipSettled(id, f.player, f.targetRound, randomness, seed, result, won, msg.sender);
    }

    /// @notice Import the target round's beacon into the registry (if not already present) and
    ///         settle in one transaction. `signature` is the 48-byte compressed BLS12-381 G1
    ///         signature from `https://api.drand.sh/v2/beacons/quicknet/rounds/{round}`.
    ///         The registry verifies it with a pairing check against the Quicknet public key;
    ///         a wrong or forged signature reverts there.
    function settleWithBeacon(uint256 id, bytes calldata signature) external {
        if (id >= _flips.length) revert UnknownFlip(id);
        uint64 round = _flips[id].targetRound;
        if (!registry.isStored(round)) {
            registry.submitBeacon(round, signature);
            if (!registry.isStored(round)) revert BeaconMismatch(round);
        }
        settle(id);
    }

    // ---------------------------------------------------------------------------------------------
    // Pure helpers (public so the frontend / auditors can reproduce results)
    // ---------------------------------------------------------------------------------------------

    /// @notice Domain-separated seed: tag, chain id, this contract, flip id, draw index 0, beacon.
    function computeSeed(uint256 id, bytes32 randomness) public view returns (bytes32) {
        return keccak256(abi.encode(DOMAIN_TAG, block.chainid, address(this), id, uint16(0), randomness));
    }

    /// @notice Uniform draw in [0, n) via rejection sampling (never a biased `seed % n`).
    function bounded(bytes32 seed, uint256 n) public pure returns (uint256) {
        uint256 limit = type(uint256).max - (type(uint256).max % n);
        for (;;) {
            uint256 v = uint256(seed);
            if (v < limit) return v % n;
            seed = keccak256(abi.encode(seed));
        }
    }

    // ---------------------------------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------------------------------

    function flipCount() external view returns (uint256) {
        return _flips.length;
    }

    function getFlip(uint256 id) external view returns (Flip memory) {
        if (id >= _flips.length) revert UnknownFlip(id);
        return _flips[id];
    }

    /// @notice Paginated read of the flip log: ids in [from, to).
    function getFlips(uint256 from, uint256 to) external view returns (Flip[] memory out) {
        if (to > _flips.length) to = _flips.length;
        if (from >= to) return out;
        out = new Flip[](to - from);
        for (uint256 i = from; i < to; i++) {
            out[i - from] = _flips[i];
        }
    }

    /// @notice Convenience for the UI: is the flip's beacon already on-chain, when is the round due.
    function flipStatus(uint256 id)
        external
        view
        returns (bool settled, bool beaconStored, uint64 targetRound, uint256 scheduledTime)
    {
        if (id >= _flips.length) revert UnknownFlip(id);
        Flip storage f = _flips[id];
        return (f.settled, registry.isStored(f.targetRound), f.targetRound, registry.roundScheduledTime(f.targetRound));
    }
}
