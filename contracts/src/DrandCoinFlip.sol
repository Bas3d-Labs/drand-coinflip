// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {DrandQuicknetRandomnessConsumer} from "drand-quicknet-evm/consumers/DrandQuicknetRandomnessConsumer.sol";

/// @title DrandCoinFlip
/// @notice A provably-fair coin flip whose randomness comes from the drand Quicknet beacon
///         via the on-chain `DrandQuicknetBeaconRegistry`.
///
///         Built on `DrandQuicknetRandomnessConsumer` (Bas3d-Labs/drand-quicknet-evm), which owns
///         the registry integration: it authenticates the registry's runtime codehash at
///         construction, enforces the registry's `minimumLeadRounds` floor, commits to an exact
///         future round, emits `QuicknetRandomnessRequested` for relayers, and derives
///         domain-separated seeds. This contract only adds the game.
///
///         Pattern: **commit to a future round, settle from it.**
///         - `flip()` commits to `latestScheduledRound() + quicknetLeadRounds`. The caller has no
///           influence over it and the beacon for that round does not exist yet.
///         - `settle()` (permissionless) reads exactly that round's verified beacon, derives a seed,
///           and resolves heads/tails. The round is never substituted.
///         - `settleWithBeacon()` lets any relayer import the beacon and settle in one tx
///           (liveness recovery for the *same* committed round).
///
///         No value is at stake in this version; it exists to showcase verifiable randomness.
contract DrandCoinFlip is DrandQuicknetRandomnessConsumer {
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

    error UnknownFlip(uint256 id);
    error AlreadySettled(uint256 id);
    error BeaconNotImported(uint64 round);
    error BeaconMismatch(uint64 round);

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

    /// @notice Application domain passed to `_deriveQuicknetSeed`. One per randomness-consuming
    ///         feature; this contract has exactly one draw per flip.
    bytes32 public constant DOMAIN_TAG = keccak256("DRAND_COINFLIP_V1");

    Flip[] private _flips;

    uint256 public settledCount;
    uint256 public headsCount;
    uint256 public tailsCount;
    uint256 public winCount;

    // ---------------------------------------------------------------------------------------------
    // Constructor
    // ---------------------------------------------------------------------------------------------

    /// @param registry_ `DrandQuicknetBeaconRegistry` to bind to (immutable).
    /// @param registryCodehash_ Expected runtime codehash of `registry_`, taken from the upstream
    ///        deployment manifest (`deployments/<network>.json`). The base constructor reverts if
    ///        the live code does not match, so a wrong or swapped registry cannot be bound.
    /// @param leadRounds Rounds between commit and target (3 s each). Must be >= the registry's
    ///        `minimumLeadRounds()`; the base constructor enforces this.
    constructor(address registry_, bytes32 registryCodehash_, uint64 leadRounds)
        DrandQuicknetRandomnessConsumer(registry_, registryCodehash_, leadRounds)
    {}

    // ---------------------------------------------------------------------------------------------
    // Commit
    // ---------------------------------------------------------------------------------------------

    /// @notice Commit a coin flip. The target drand round is derived on-chain from the current
    ///         block timestamp plus the fixed lead; the caller cannot influence it.
    /// @param choice The side the player calls.
    /// @return id The flip id (index into the flip log).
    function flip(Side choice) external returns (uint256 id) {
        // Commits to an exact future round and emits QuicknetRandomnessRequested(round).
        uint64 target = _requestQuicknetRandomness();
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
    }

    // ---------------------------------------------------------------------------------------------
    // Settle
    // ---------------------------------------------------------------------------------------------

    /// @notice Resolve a flip from its committed round. Permissionless; the outcome is a pure
    ///         function of (chain, contract, id, round, beacon) and cannot depend on who calls this.
    function settle(uint256 id) public {
        if (id >= _flips.length) revert UnknownFlip(id);
        Flip storage f = _flips[id];
        if (f.settled) revert AlreadySettled(id);
        if (!_isQuicknetBeaconStored(f.targetRound)) revert BeaconNotImported(f.targetRound);

        bytes32 randomness = _getQuicknetBeacon(f.targetRound);
        bytes32 seed = computeSeed(id, f.targetRound, randomness);
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
    ///         a wrong or forged signature reverts there. The round is always the committed one.
    function settleWithBeacon(uint256 id, bytes calldata signature) external {
        if (id >= _flips.length) revert UnknownFlip(id);
        uint64 round = _flips[id].targetRound;
        if (!_isQuicknetBeaconStored(round)) {
            _submitQuicknetBeacon(round, signature);
            if (!_isQuicknetBeaconStored(round)) revert BeaconMismatch(round);
        }
        settle(id);
    }

    // ---------------------------------------------------------------------------------------------
    // Pure helpers (public so the frontend / auditors can reproduce results)
    // ---------------------------------------------------------------------------------------------

    /// @notice The seed used for flip `id`, exactly as `DrandQuicknetRandomnessConsumer` derives it:
    ///         keccak256(abi.encode(QUICKNET_SEED_DOMAIN, DOMAIN_TAG, chainid, this, bytes32(id), round, randomness)).
    function computeSeed(uint256 id, uint64 round, bytes32 randomness) public view returns (bytes32) {
        return _deriveQuicknetSeed(DOMAIN_TAG, bytes32(id), round, randomness);
    }

    /// @notice The base contract's outer seed domain, exposed for off-chain reproduction.
    function seedDomain() external pure returns (bytes32) {
        return QUICKNET_SEED_DOMAIN;
    }

    /// @notice Uniform draw in [0, n) via rejection sampling (never a biased `seed % n`).
    function bounded(bytes32 seed, uint256 n) public pure returns (uint256 draw) {
        uint256 limit = type(uint256).max - (type(uint256).max % n);
        uint256 v = uint256(seed);
        while (v >= limit) {
            seed = keccak256(abi.encode(seed));
            v = uint256(seed);
        }
        draw = v % n;
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
        return (
            f.settled,
            _isQuicknetBeaconStored(f.targetRound),
            f.targetRound,
            _quicknetRegistry().roundScheduledTime(f.targetRound)
        );
    }
}
