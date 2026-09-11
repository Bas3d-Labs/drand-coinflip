# Using the drand Quicknet beacon registry for on-chain randomness

Guidance for integrating `DrandQuicknetBeaconRegistry` (Bas3d-Labs/drand-quicknet-evm)
into a contract that needs unpredictable, publicly verifiable randomness. Written from
the StonkDrop integration and its security review; every address and claim below was
checked against the deployed bytecode and pinned source.

## 1. What it is (and isn't)

- **drand Quicknet** is a public randomness beacon: the League of Entropy publishes one
  BLS12-381 threshold signature **every 3 s** over nothing but the round number.
  Round `R` is scheduled at `genesis + (R − 1) · 3` (genesis `1692803367`). It cannot
  exist before its scheduled time unless a threshold of drand nodes colludes, and once
  published it is fetchable from `https://api.drand.sh/v2/beacons/quicknet/rounds/{R}`.
- **The registry** is a permissionless, write-once cache of *verified* beacons. Anyone
  submits a round's signature; a codehash-pinned verifier checks it against the
  hardcoded Quicknet public key with a BLS pairing (EIP-2537); the registry stores
  `sha256(signature)` for that round. No owner, no setter, no overwrite.
- **It is not a VRF.** There is no request, no callback, no oracle that answers you.
  Your contract *commits to a future round* and later *reads* that round's value.
  Anyone can settle; nobody can choose the value.

## 2. Deployment (Robinhood Chain Testnet, chain id 46630)

| Contract | Address | Source (commit) |
|---|---|---|
| `DrandQuicknetBeaconRegistry` | `0xB1e8bc94AdBb82F036aafC2Af004986F810dd0fe` | `b0f84b4` (codehash `0x6d84157b97cfea3d51931f84f17638028dff7560d9be1f07c9d668fa37480e73`) |
| `DrandQuicknetBeaconVerifier` | `0xAe9a1AbF0D30633ec1Eb73038F375b2c7Ee0E01e` | `b0f84b4` (codehash `0x916ebb69c0ceb4c049d50ad8bf5b3e566661a2b1ef33e01727ed443673b68aab`) |

The previous pair (`0x6e69…5e2a` / `0x9042…6B95`, 2026-09-10) is superseded; a consumer built on
`DrandQuicknetRandomnessConsumer` with the new codehash refuses to bind to it. Addresses and
codehashes come from `deployments/robinhood-testnet.json` in the upstream repo.

Constants: `GENESIS_TIMESTAMP = 1692803367`, `PERIOD_SECONDS = 3`,
`minimumLeadRounds() = 3`. **There is no mainnet deployment yet** — a mainnet consumer
needs the pair deployed there first (the chain must support the Prague BLS precompiles).

Verify any deployment before trusting it, in this order:

```bash
cast call $REG 'verifier()(address)'            # must equal the verifier you expect
cast call $REG 'verifierCodehash()(bytes32)'    # must equal keccak of the verifier's code:
cast keccak $(cast code $VER)
cast keccak $(cast code $REG)                   # compare to the manifest's runtimeCodehash
```

Then compile the pinned commits and diff runtime bytecode with the CBOR metadata
trailer stripped (the registry has three immutables — mask them). Both deployed
contracts above match their pinned source byte-for-byte this way.

## 3. The interface you use

**Prefer the base contract.** Since `b0f84b4` the repo ships
`contracts/src/consumers/DrandQuicknetRandomnessConsumer.sol`, an abstract contract that
implements everything in §4 below except the game logic: registry codehash authentication
and lead-floor check in the constructor, `_requestQuicknetRandomness()` (commit + relayer
event), `_getQuicknetBeacon` / `_isQuicknetBeaconStored` / `_submitQuicknetBeacon`, and
`_deriveQuicknetSeed(appDomain, uniqueRequestId, round, randomness)`. `DrandCoinFlip.sol`
in this repo is the worked example. The raw interface is still what the base contract
talks to:

```solidity
interface IDrandQuicknetBeaconRegistry {
    function submitBeacon(uint64 round, bytes calldata signature) external returns (bytes32);
    function getBeacon(uint64 round) external view returns (bytes32);   // reverts BeaconUnavailable
    function isStored(uint64 round) external view returns (bool);       // false for round 0
    function roundScheduledTime(uint64 round) external pure returns (uint256);
    function roundAt(uint256 timestamp) external pure returns (uint64); // latest round scheduled ≤ timestamp; 0 before genesis
    function latestScheduledRound() external view returns (uint64);     // roundAt(block.timestamp)
    function minimumLeadRounds() external view returns (uint64);        // declared, NOT enforced by submitBeacon
    function verifier() external view returns (address);
    function verifierCodehash() external view returns (bytes32);
    event BeaconStored(uint64 indexed round, bytes32 randomness, address indexed submitter);
}
```

`roundAt` is 1-based and returns the latest *already scheduled* round, so
`roundAt(now) + k` becomes public `(k−1)·3 … k·3` seconds after `now`.

## 4. The pattern: commit to a round, settle from it

### Commit

```solidity
uint64 constant LEAD_ROUNDS = 10;                       // your security parameter; see §5

constructor(address registry_) {
    require(IDrandQuicknetBeaconRegistry(registry_).minimumLeadRounds() <= LEAD_ROUNDS);
    registry = IDrandQuicknetBeaconRegistry(registry_);   // immutable
}

function commit(...) external {
    uint64 target = registry.roundAt(block.timestamp) + LEAD_ROUNDS;  // contract-derived, never caller-supplied
    // ...take payment / lock stake, store (player, target, params, id)...
    emit QuicknetRandomnessRequested(target);             // lets relayers know which round to import
}
```

Rules that must hold at commit time:

1. **The contract derives the round from `block.timestamp` plus a fixed lead.** The
   caller never supplies, chooses, or influences it.
2. **Never pick a round based on what the registry has stored.** Submission is
   permissionless and optional, so an adversary controls *which* valid rounds are
   present and *when* — choosing among stored rounds lets them choose outcomes.
3. **Everything that affects the outcome is fixed before the round is knowable**:
   config, price targets, participant, count. Read them from storage at settle; do
   not re-read "the current" config.

### Settle

```solidity
function settle(uint64 id, uint16 index) external {          // permissionless
    Commitment storage c = commitments[id];
    require(!settled(id, index));
    require(registry.isStored(c.target), "beacon not yet imported"); // retryable; NOT grounds for a new round
    bytes32 randomness = registry.getBeacon(c.target);
    bytes32 seed = keccak256(abi.encode(DOMAIN_TAG, block.chainid, address(this), id, index, randomness));
    // ...derive the outcome from `seed`, mark settled, pay out to c.player regardless of msg.sender...
}
```

Rules at settle time:

4. **Never substitute a round.** If `target` isn't cached, the action stays pending until
   someone imports exactly that round. Falling back to `R+1` or "latest available" is a
   reroll: the choice can depend on the already-known outcome.
5. **No selective abort.** Once committed, the user must not be able to cancel or refund
   based on whether the (now public) result is favorable. If you need a liveness escape
   hatch for a round that never gets imported, make it non-user-triggerable and
   outcome-independent.
6. **Domain-separate every seed** with a purpose tag, `block.chainid`, `address(this)`,
   the commitment id, and the draw index. The stored beacon is identical on every chain
   that imports the round. Use one tag per purpose (e.g. rarity vs. amount) so two draws
   never share a seed. The base contract's `_deriveQuicknetSeed` does this with an outer
   domain (`based-labs.drand-quicknet.consumer.seed.v1`), your application domain, chain
   id, contract, a `bytes32` unique request id, the round and the randomness.
7. **Bounded uniform draws must use rejection sampling**, not `seed % n`:

```solidity
function bounded(bytes32 seed, uint256 n) internal pure returns (uint256) {
    uint256 limit = type(uint256).max - (type(uint256).max % n); // largest multiple of n
    for (;;) {
        uint256 v = uint256(seed);
        if (v < limit) return v % n;
        seed = keccak256(abi.encode(seed));
    }
}
```

## 5. Sizing the lead — the one parameter that actually matters

The beacon for `target` is public at its scheduled time. The only thing standing
between "committed" and "knowable" is `LEAD_ROUNDS` against the chain's clock:

- `block.timestamp` is set by the sequencer's clock (Arbitrum-family chains allow it to
  run up to 24 h behind and 1 h ahead of real time; it is monotonic but not accurate).
- If block time lags wall-clock by more than `(LEAD_ROUNDS − 1) · 3 s`, the target
  beacon is already on `api.drand.sh` when the commit lands. An attacker can then compute
  the exact outcome off-chain (next id and all inputs are public) and commit only on
  wins — risk-free through a wrapper contract that reverts if the id shifts.
- Measured on Robinhood Chain: lag ≈ 1.5 s median, ~3 s max over short windows.
  The attack is opportunistic, so size for the **tail** (sequencer stalls, restarts),
  not the median.

Guidance: `minimumLeadRounds = 3` on the testnet registry means **6–9 s** — fine for a
testnet toy, not for value-bearing outcomes. Use **≥ 10 rounds (≥ 27 s)** for anything
with money on it, enforce the floor in your constructor, and treat the sequencer's
clock as a stated trust assumption. A drand threshold collusion could know a future
beacon early regardless of lead; that is the beacon's own trust model.

**UX consequence:** the wait is per *commitment*, not per draw. Commit N draws to one
round, then reveal them one at a time — one wait, instant reveals.

## 6. Relaying (getting the beacon on-chain)

- Anyone may call `submitBeacon(round, signature)`. Cost ≈ 680k gas (one pairing).
  Idempotent: a stored round returns the cached value without touching `signature`.
- Signature: the 48-byte **compressed** G1 point from the drand API's `signature`
  field (hex without `0x`; prepend it). The verifier rejects anything non-canonical
  (wrong length, flag bits, x ≥ p) and, via the pairing, any signature for a different
  round or a flipped sign bit.
- Emit `QuicknetRandomnessRequested(uint64 round)` from your consumer after the
  commitment is fixed; the repo's relayer daemon (`apps/relayer`) watches for it and
  imports exactly that round. Alternatives that work: a keeper that scans your own
  commitments, or an on-demand server function the frontend nudges once the round is
  public — but don't make the *player* the only relayer, and don't let the player be
  the only one who can trigger settlement (settlement timing becomes a free option).
- Settlement gas: reading the beacon is two SLOADs; budget for whatever your settle
  does *after* it, and gate on `gasleft()` before any external call whose failure you
  catch, or a caller can starve that call to pick an outcome branch.

## 7. Tests worth having (mocks alone hide the real risks)

- Real verifier in a fork/integration test: submit a genuine past-round signature and
  assert it stores; assert a wrong-round signature, a sign-bit-flipped signature, and a
  96-byte uncompressed one are rejected; assert a second submission is a no-op.
- `registry.roundAt(GENESIS) == 1`, `roundAt(GENESIS + 3) == 2`, `roundAt(GENESIS − 1) == 0`.
- Target selection: for any `block.timestamp`, `target ≥ latestScheduledRound() + LEAD_ROUNDS`
  and `roundScheduledTime(target) > block.timestamp + (LEAD_ROUNDS − 1) · 3`.
- Statistical sanity over many seeds: outcome frequencies ≈ configured weights, every
  bounded draw within `[0, n)`.
- Deployment assertions in the deploy script: `verifier()` and `verifierCodehash()`
  match what you pinned; `minimumLeadRounds() ≤ LEAD_ROUNDS`.

## 8. Checklist

- [ ] Registry address verified (verifier binding, codehashes, source diff), not copied
- [ ] Registry codehash from the upstream manifest passed to `DrandQuicknetRandomnessConsumer`
- [ ] Target round = `roundAt(block.timestamp) + LEAD_ROUNDS`, caller has no input
- [ ] `LEAD_ROUNDS` ≥ registry `minimumLeadRounds()`, and ≥ 10 for real value
- [ ] All outcome inputs pinned at commit; settle reads stored state only
- [ ] Settle is permissionless, requires `isStored(target)`, never substitutes a round
- [ ] No user-triggerable cancel/refund after commit
- [ ] Seeds domain-separated (tag, chainid, contract, id, index); rejection sampling
- [ ] A relayer that isn't the player; `QuicknetRandomnessRequested` emitted
- [ ] Fork tests against the real verifier; round-math and lead tests
