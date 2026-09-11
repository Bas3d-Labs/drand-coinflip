// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {Script, console} from "forge-std/Script.sol";
import {DrandCoinFlip} from "../src/DrandCoinFlip.sol";
import {IDrandQuicknetBeaconRegistry} from "drand-quicknet-evm/interfaces/IDrandQuicknetBeaconRegistry.sol";

/// @notice Deploys DrandCoinFlip against the Robinhood Chain Testnet registry.
///         Run:  forge script script/Deploy.s.sol --rpc-url robinhood_testnet --broadcast --account <keystore>
contract Deploy is Script {
    // Robinhood Chain Testnet (chain id 46630).
    // Source of truth: lib/drand-quicknet-evm/deployments/robinhood-testnet.json (pinned submodule).
    address constant REGISTRY = 0xB1e8bc94AdBb82F036aafC2Af004986F810dd0fe;
    bytes32 constant REGISTRY_CODEHASH = 0x6d84157b97cfea3d51931f84f17638028dff7560d9be1f07c9d668fa37480e73;
    address constant VERIFIER = 0xAe9a1AbF0D30633ec1Eb73038F375b2c7Ee0E01e;
    bytes32 constant VERIFIER_CODEHASH = 0x916ebb69c0ceb4c049d50ad8bf5b3e566661a2b1ef33e01727ed443673b68aab;

    /// @dev 4 rounds = 9–12 s wait. Fine for a no-value testnet demo; use >= 10 when money is on it.
    uint64 constant LEAD_ROUNDS = 4;

    function run() external returns (DrandCoinFlip flipper) {
        require(block.chainid == 46630, "wrong chain");

        // Belt and braces: the consumer base re-checks the registry codehash in its constructor,
        // but fail loudly here with a readable reason before spending gas.
        IDrandQuicknetBeaconRegistry reg = IDrandQuicknetBeaconRegistry(REGISTRY);
        require(REGISTRY.codehash == REGISTRY_CODEHASH, "live registry code mismatch");
        require(reg.verifier() == VERIFIER, "registry verifier mismatch");
        require(reg.verifierCodehash() == VERIFIER_CODEHASH, "verifier codehash mismatch");
        require(VERIFIER.codehash == VERIFIER_CODEHASH, "live verifier code mismatch");
        require(reg.minimumLeadRounds() <= LEAD_ROUNDS, "lead below registry minimum");

        vm.startBroadcast();
        flipper = new DrandCoinFlip(REGISTRY, REGISTRY_CODEHASH, LEAD_ROUNDS);
        vm.stopBroadcast();

        console.log("DrandCoinFlip deployed at", address(flipper));
        console.log("registry", flipper.quicknetBeaconRegistry());
        console.log("leadRounds", flipper.quicknetLeadRounds());
    }
}
