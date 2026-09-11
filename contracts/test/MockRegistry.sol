// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {IDrandQuicknetBeaconRegistry} from "drand-quicknet-evm/interfaces/IDrandQuicknetBeaconRegistry.sol";

/// @dev Faithful reproduction of the registry's round math; storage is filled by tests.
contract MockRegistry is IDrandQuicknetBeaconRegistry {
    uint256 public constant GENESIS_TIMESTAMP = 1692803367;
    uint256 public constant PERIOD_SECONDS = 3;
    uint64 public constant MIN_LEAD = 3;

    mapping(uint64 => bytes32) private _beacons;
    bool public rejectSubmissions;

    error BeaconUnavailable(uint64 round);
    error InvalidSignature();

    function setRejectSubmissions(bool v) external { rejectSubmissions = v; }

    function store(uint64 round, bytes32 value) external { _beacons[round] = value; }

    function submitBeacon(uint64 round, bytes calldata signature) external returns (bytes32) {
        if (_beacons[round] != 0) return _beacons[round];
        if (rejectSubmissions || signature.length != 48) revert InvalidSignature();
        bytes32 v = sha256(signature);
        _beacons[round] = v;
        emit BeaconStored(round, v, msg.sender);
        return v;
    }

    function getBeacon(uint64 round) external view returns (bytes32) {
        bytes32 v = _beacons[round];
        if (v == 0) revert BeaconUnavailable(round);
        return v;
    }

    function isStored(uint64 round) external view returns (bool) { return _beacons[round] != 0; }

    function roundScheduledTime(uint64 round) public pure returns (uint256) {
        return GENESIS_TIMESTAMP + (uint256(round) - 1) * PERIOD_SECONDS;
    }

    function roundAt(uint256 timestamp) public pure returns (uint64) {
        if (timestamp < GENESIS_TIMESTAMP) return 0;
        return uint64((timestamp - GENESIS_TIMESTAMP) / PERIOD_SECONDS + 1);
    }

    function latestScheduledRound() external view returns (uint64) { return roundAt(block.timestamp); }
    function minimumLeadRounds() external pure returns (uint64) { return MIN_LEAD; }
    function verifier() external pure returns (address) { return address(0xBEEF); }
    function verifierCodehash() external pure returns (bytes32) { return bytes32(uint256(1)); }
}
