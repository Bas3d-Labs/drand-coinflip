// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {DrandCoinFlip} from "../src/DrandCoinFlip.sol";
import {IDrandQuicknetBeaconRegistry} from "../src/interfaces/IDrandQuicknetBeaconRegistry.sol";

/// @notice Deploys DrandCoinFlip against the verified Robinhood Chain Testnet registry.
///         Run:  forge script script/Deploy.s.sol --rpc-url robinhood_testnet --broadcast --account <keystore>
contract Deploy is Script {
    // Robinhood Chain Testnet (chain id 46630) — verified against pinned source, see ../../drandquicknetrandomness.md
    address constant REGISTRY = 0x6e69C56D8D678aDeF8401adF1186c026A0915e2a;
    address constant VERIFIER = 0x90427e40e7D6f60425D29474a85595C4d8EE6B95;
    bytes32 constant VERIFIER_CODEHASH = 0x55ed5b7bad08ed41842bc0bd1c1e431609f0ece0c441aaa25d29c6f660febe63;

    /// @dev 4 rounds = 9–12 s wait. Fine for a no-value testnet demo; use >= 10 when money is on it.
    uint64 constant LEAD_ROUNDS = 4;

    function run() external returns (DrandCoinFlip flipper) {
        require(block.chainid == 46630, "wrong chain");

        IDrandQuicknetBeaconRegistry reg = IDrandQuicknetBeaconRegistry(REGISTRY);
        require(reg.verifier() == VERIFIER, "registry verifier mismatch");
        require(reg.verifierCodehash() == VERIFIER_CODEHASH, "verifier codehash mismatch");
        require(VERIFIER.codehash == VERIFIER_CODEHASH, "live verifier code mismatch");
        require(reg.minimumLeadRounds() <= LEAD_ROUNDS, "lead below registry minimum");

        vm.startBroadcast();
        flipper = new DrandCoinFlip(REGISTRY, LEAD_ROUNDS);
        vm.stopBroadcast();

        console.log("DrandCoinFlip deployed at", address(flipper));
        console.log("registry", address(flipper.registry()));
        console.log("leadRounds", flipper.LEAD_ROUNDS());
    }
}
