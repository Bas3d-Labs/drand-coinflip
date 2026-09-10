// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Interface of Bas3d-Labs/drand-quicknet-evm `DrandQuicknetBeaconRegistry`.
/// A permissionless, write-once cache of *verified* drand Quicknet beacons.
interface IDrandQuicknetBeaconRegistry {
    event BeaconStored(uint64 indexed round, bytes32 randomness, address indexed submitter);

    function submitBeacon(uint64 round, bytes calldata signature) external returns (bytes32);
    function getBeacon(uint64 round) external view returns (bytes32);
    function isStored(uint64 round) external view returns (bool);
    function roundScheduledTime(uint64 round) external pure returns (uint256);
    function roundAt(uint256 timestamp) external pure returns (uint64);
    function latestScheduledRound() external view returns (uint64);
    function minimumLeadRounds() external view returns (uint64);
    function verifier() external view returns (address);
    function verifierCodehash() external view returns (bytes32);
}
