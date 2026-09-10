# drand Coin Flip

**A provably fair coin flip on Robinhood Chain Testnet, powered by the drand Quicknet beacon through
[Bas3d-Labs/drand-quicknet-evm](https://github.com/Bas3d-Labs/drand-quicknet-evm).**

The app is deliberately tiny so that the randomness pipeline is the whole story: a contract commits to a
*future* drand round, the round's BLS signature is verified on-chain by the registry, and the result is
derived from it. Anyone can re-derive every result from public data, and the dashboard does exactly that
in the browser.

| | |
|---|---|
| Live contract | [`0xa7E13fE13245c18732F40A342263d4949c728022`](https://explorer.testnet.chain.robinhood.com/address/0xa7E13fE13245c18732F40A342263d4949c728022) (source verified) |
| Beacon registry | [`0x6e69C56D8D678aDeF8401adF1186c026A0915e2a`](https://explorer.testnet.chain.robinhood.com/address/0x6e69C56D8D678aDeF8401adF1186c026A0915e2a) |
| Chain | Robinhood Chain Testnet, id `46630`, RPC `https://rpc.testnet.chain.robinhood.com` |
| Randomness | [drand Quicknet](https://drand.love) — one BLS12-381 signature every 3 s, chain hash `52db9ba7…4e971` |

---

## Contents

1. [How we use drand-quicknet-evm](#1-how-we-use-drand-quicknet-evm)
2. [Repository layout](#2-repository-layout)
3. [Run it yourself](#3-run-it-yourself)
4. [Verifying a result by hand](#4-verifying-a-result-by-hand)
5. [Considerations and open questions before you integrate](#5-considerations-and-open-questions-before-you-integrate)
6. [Adapting this for your own app](#6-adapting-this-for-your-own-app)

---

## 1. How we use drand-quicknet-evm

`drand-quicknet-evm` is **not a VRF**. There is no request, no callback and no oracle that answers you.
It is a permissionless, write-once cache of *verified* drand beacons:

- Anyone calls `submitBeacon(round, signature)` with the 48-byte compressed G1 signature drand publishes
  for that round.
- A codehash-pinned verifier checks it with a BLS12-381 pairing (EIP-2537) against the hard-coded Quicknet
  public key.
- On success the registry stores `sha256(signature)` for the round. No owner, no setter, no overwrite.

The consumer pattern is therefore **commit to a round, settle from it**. This is what `DrandCoinFlip.sol` does:

```mermaid
sequenceDiagram
    participant U as Player
    participant C as DrandCoinFlip
    participant R as BeaconRegistry
    participant D as drand (League of Entropy)
    participant X as Relayer (anyone)

    U->>C: flip(side)
    C->>R: roundAt(block.timestamp)
    C-->>C: target = round + LEAD_ROUNDS (4)
    C-->>X: emit QuicknetRandomnessRequested(target)
    Note over D: ~12 s later drand publishes round `target`
    X->>D: GET /v2/beacons/quicknet/rounds/{target}
    X->>C: settleWithBeacon(id, signature)
    C->>R: submitBeacon(target, signature)
    R-->>R: BLS pairing check, store sha256(sig)
    C->>R: getBeacon(target)
    C-->>C: seed = keccak(tag, chainId, this, id, 0, beacon)
    C-->>C: result = bounded(seed, 2)
    C-->>U: emit FlipSettled(... result, won)
```

### Commit — [`flip()`](contracts/src/DrandCoinFlip.sol)

```solidity
uint64 target = registry.roundAt(block.timestamp) + LEAD_ROUNDS;   // contract-derived, never caller-supplied
```

The player picks only a side. The round comes from the block timestamp plus a fixed lead, so at commit
time the beacon does not exist yet. `LEAD_ROUNDS` is an immutable checked against
`registry.minimumLeadRounds()` in the constructor **and** in the deploy script.

### Settle — [`settle()` / `settleWithBeacon()`](contracts/src/DrandCoinFlip.sol)

- Permissionless. Whoever calls it, the payout goes to the player and the outcome is the same.
- Requires `registry.isStored(target)`. If the beacon is not imported yet the call reverts and the flip
  stays pending. **The round is never substituted.**
- `settleWithBeacon(id, sig)` is a convenience that imports and settles in one transaction so a relayer
  or the player can do it with one click.
- The seed is domain-separated: `keccak256(abi.encode(DOMAIN_TAG, block.chainid, address(this), id, uint16(0), randomness))`.
  The same beacon is stored identically on every chain that imports it, so chain id and contract address
  must be in the seed.
- Heads/Tails is drawn with rejection sampling (`bounded(seed, 2)`), not `seed % n`.

### Relaying — three layers so a flip always settles

The integration notes are explicit that the *player must not be the only relayer*, and that settlement
timing must not be a free option for the player. We use:

1. **Client nudge** — when the countdown hits zero the page calls `POST /api/settle`, a Next.js route that
   fetches the signature and sends `settleWithBeacon` from a server-side key. Idempotent; retries nonce
   collisions because serverless invocations overlap.
2. **Cron sweep** — `GET /api/sweep` on Vercel Cron settles anything left behind (tab closed, nudge failed).
3. **Reveal button** — the player (or anyone) can always settle from their own wallet.

A standalone [`relayer/index.mjs`](relayer/index.mjs) does the same job as a long-running process for
self-hosting. The contract also emits `QuicknetRandomnessRequested(round)`, so the reference relayer daemon
in `drand-quicknet-evm/apps/relayer` works unchanged.

### Verification — what the dashboard checks

For every settled flip the browser fetches the round from drand's public API and checks three things,
using nothing but public inputs:

1. `sha256(signature)` equals the `randomness` the contract recorded (and equals `registry.getBeacon(round)`).
2. `keccak256(abi.encode(tag, 46630, contract, id, 0, randomness))` equals the recorded `seed`.
3. `bounded(seed, 2)` equals the recorded result.

Note that `sha256(signature)` is also exactly the `randomness` field drand itself publishes in its v1 API,
so the registry value can be cross-checked against drand without touching the chain at all.

---

## 2. Repository layout

```
contracts/   Foundry: DrandCoinFlip.sol, IDrandQuicknetBeaconRegistry.sol, unit tests (mock registry),
             fork tests against the real registry + BLS verifier, Deploy.s.sol with safety assertions
web/         Next.js (App Router) + wagmi/viem: Flip page, Dashboard, /api/settle, /api/sweep, vercel.json cron
relayer/     Standalone relayer for self-hosting
scripts/     sync-abi (contracts -> web), sync-deployment (forge broadcast -> web config)
docs/        integration-notes.md — the security-review notes this integration follows
```

---

## 3. Run it yourself

### Prerequisites

- Node 20+ and pnpm
- [Foundry](https://book.getfoundry.sh/getting-started/installation)
- Testnet ETH from the [Robinhood faucet](https://faucet.testnet.chain.robinhood.com/). Gas is very cheap:
  deploying cost ~0.00001 ETH and a settlement that imports a beacon is ~0.7M gas.

```bash
git clone --recurse-submodules <this repo> && cd coinflip   # forge-std is a submodule
pnpm install
```

### 3.1 Contracts

```bash
cd contracts
forge test                                                          # unit tests against a mock registry
forge test --match-contract Fork --fork-url robinhood_testnet -vv   # against the REAL registry + verifier
```

The fork tests submit a genuine past-round signature and assert it is stored, and assert a wrong-round
signature and a sign-bit-flipped signature are rejected. `foundry.toml` sets `evm_version = "prague"`;
without it the BLS precompile does not exist locally and every submission reverts.

Deploy. The script refuses to run unless the registry's `verifier()`, `verifierCodehash()`, the live
verifier bytecode hash and `minimumLeadRounds()` all match what is pinned in it:

```bash
cp .env.example .env                        # DEPLOYER_PRIVATE_KEY=..., or use --account <foundry keystore>
forge script script/Deploy.s.sol --rpc-url robinhood_testnet --broadcast --private-key $DEPLOYER_PRIVATE_KEY
cd .. && pnpm sync-deployment               # writes address + block into web/src/config/deployments.json
```

Verify source on Blockscout:

```bash
cd contracts && forge verify-contract <ADDRESS> src/DrandCoinFlip.sol:DrandCoinFlip \
  --verifier blockscout --verifier-url https://explorer.testnet.chain.robinhood.com/api \
  --constructor-args $(cast abi-encode 'constructor(address,uint64)' 0x6e69C56D8D678aDeF8401adF1186c026A0915e2a 4)
```

### 3.2 Web app

```bash
cp web/.env.example web/.env.local          # set RELAYER_PRIVATE_KEY and CRON_SECRET (see below)
pnpm dev                                    # http://localhost:3000
```

| Variable | Where | Purpose |
|---|---|---|
| `RELAYER_PRIVATE_KEY` | server only | Signs `settleWithBeacon` for `/api/settle` and `/api/sweep`. Unset = server settlement disabled, users Reveal themselves. |
| `CRON_SECRET` | server only | Protects `/api/sweep`. Vercel sends it automatically as `Authorization: Bearer …`. |
| `RELAYER_RPC_URL` | server only | Optional private RPC for the relayer. |
| `NEXT_PUBLIC_COINFLIP_ADDRESS` | public | Overrides the address in `deployments.json`. |
| `NEXT_PUBLIC_RPC_URL`, `NEXT_PUBLIC_DEV_PRIVATE_KEY` | dev only | Local anvil fork + a wallet-less burner connector. Ignored in production builds. |

### 3.3 Deploy to Vercel

1. Import the repo, set **Root Directory** to `web`.
2. Add `RELAYER_PRIVATE_KEY` and `CRON_SECRET` as environment variables.
3. `web/vercel.json` registers `/api/sweep` every minute. Hobby plans run crons at most daily, which is
   fine for a testnet demo since the client nudge does most of the work.
4. Fund the relayer address and watch `/api/sweep` output for `"low": true`.

### 3.4 Standalone relayer (optional)

```bash
cp relayer/.env.example relayer/.env        # RELAYER_PRIVATE_KEY, COINFLIP_ADDRESS
pnpm relayer
```

### 3.5 Fully local, no testnet ETH

```bash
anvil --fork-url https://rpc.testnet.chain.robinhood.com --hardfork prague
cd contracts && forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
rm -rf broadcast/Deploy.s.sol/46630         # keep the fork deploy out of sync-deployment
```

`web/.env.local`:

```
NEXT_PUBLIC_RPC_URL=http://127.0.0.1:8545
NEXT_PUBLIC_DEV_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
NEXT_PUBLIC_COINFLIP_ADDRESS=<address printed by the script>
RELAYER_PRIVATE_KEY=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d
RELAYER_RPC_URL=http://127.0.0.1:8545
```

Real drand rounds are fetched and verified by the real registry and verifier bytecode on the fork.
Connect with "Dev burner" and flip.

---

## 4. Verifying a result by hand

Take flip `#0` on the live contract (round `32077160`):

```bash
RPC=https://rpc.testnet.chain.robinhood.com
CF=0xa7E13fE13245c18732F40A342263d4949c728022
REG=0x6e69C56D8D678aDeF8401adF1186c026A0915e2a

# 1. what the contract recorded
cast call $CF 'getFlip(uint256)((address,uint8,uint8,bool,uint64,uint64,uint64,bytes32,bytes32))' 0 --rpc-url $RPC

# 2. drand's signature for that round, hashed
SIG=$(curl -s https://api.drand.sh/v2/beacons/quicknet/rounds/32077160 | jq -r .signature)
echo -n $SIG | xxd -r -p | shasum -a 256          # == randomness in step 1 == registry value below
cast call $REG 'getBeacon(uint64)(bytes32)' 32077160 --rpc-url $RPC

# 3. the seed and the result
cast call $CF 'computeSeed(uint256,bytes32)(bytes32)' 0 0x<randomness> --rpc-url $RPC
cast call $CF 'bounded(bytes32,uint256)(uint256)' 0x<seed> 2 --rpc-url $RPC   # 0 = Heads, 1 = Tails
```

---

## 5. Considerations and open questions before you integrate

These are the things we had to get clear on. Most come straight from
[`docs/integration-notes.md`](docs/integration-notes.md), which is the security-review write-up this
integration follows; read it in full before shipping anything with value.

### 5.1 It is not a VRF, so liveness is your problem

Nobody answers your request. If no one imports the target round, the commitment stays pending forever.
That is why this repo has three settlement paths, and why the contract emits
`QuicknetRandomnessRequested`. **Questions:** who runs your relayer, who funds it, and what happens to a
commitment nobody ever settles? If you need an escape hatch it must be non-user-triggerable and
outcome-independent, otherwise it is a free reroll.

### 5.2 The lead is the whole security parameter

The beacon for round `R` is public at `genesis + (R-1)·3`. The only thing between "committed" and
"knowable" is `LEAD_ROUNDS` measured against the **chain's clock**, not wall-clock. Arbitrum-family
sequencers may run `block.timestamp` up to 24 h behind real time. If the chain lags more than
`(LEAD_ROUNDS − 1)·3` seconds, the beacon is already on `api.drand.sh` when the commit lands and an attacker
can compute the outcome first and only commit on wins (risk-free via a wrapper that reverts otherwise).

- Testnet registry `minimumLeadRounds() = 3` (6–9 s). We use **4** for a no-value demo. Measured lag on
  Robinhood testnet was ~1 s while we built this.
- Use **≥ 10 rounds (≥ 27 s)** for anything with money on it, enforce the floor in your constructor, and size
  for the *tail* (sequencer stalls and restarts), not the median.
- `minimumLeadRounds()` is declared by the registry but **not enforced** by `submitBeacon`. It is a hint for you.

**Questions:** what is the observed and worst-case timestamp lag on your chain? Is a 30 s wait acceptable
in your UX? (The wait is per commitment, so you can commit N draws to one round and reveal them instantly.)

### 5.3 Never pick a round from what the registry has

Submission is permissionless and optional, so an adversary controls *which* rounds are present and *when*.
Choosing "the latest stored round" or falling back to `R+1` when `R` is missing lets them choose outcomes.
The target must be derived from `block.timestamp`, and settlement must wait for exactly that round.

### 5.4 No selective abort

Once committed, the user must not be able to cancel or refund based on whether the now-public result is
favourable. This contract has no cancel path at all. If yours needs one, it cannot be user-callable after
the round is public.

### 5.5 Pin everything at commit, domain-separate every seed

Config, price targets, participant, count: read them from storage at settle, never re-read "current"
config. Seeds must include a purpose tag, `block.chainid`, `address(this)`, the commitment id and the draw
index, because the stored beacon is identical on every chain. Use one tag per purpose so two draws never
share a seed. Draw bounded values with rejection sampling.

### 5.6 Who pays for the beacon import

The first importer of a round pays ~680k gas for the pairing; later readers pay two SLOADs. If several of
your commitments share a round, only one import is needed. **Questions:** does the player pay (one-click
`settleWithBeacon`), does your relayer pay, or both? How do you keep the relayer funded and what do you do
when it runs dry (this app falls back to the user's wallet)?

### 5.7 Relayer engineering details we hit

- One key cannot send concurrent transactions: serialize, or fetch the pending nonce and retry on
  collisions. Serverless functions overlap, so `/api/settle` retries.
- Simulate first and treat `AlreadySettled` as success; someone else may have beaten you to it.
- `api.drand.sh` can be slow or down; the app tries `api.drand.sh`, `api2.drand.sh`, `api3.drand.sh` in order.
- The nudge endpoint spends your gas on request. It only ever settles flips that are genuinely due, so the
  worst an abuser can do is make you pay for settlements you wanted anyway, but rate-limit it if that matters.
- Gate on `gasleft()` before any external call whose failure you catch, or a caller can starve it to pick a branch.

### 5.8 Trust assumptions you are inheriting

- **drand threshold collusion** could know a future beacon early regardless of lead. That is the beacon's
  own trust model (League of Entropy, t-of-n).
- **Sequencer clock** as in 5.2.
- **The registry deployment you point at.** Do not copy the address, verify it: `verifier()` must be the
  expected verifier, `verifierCodehash()` must equal `keccak(code)` of that verifier, and the runtime bytecode
  should diff clean against the pinned commits with the metadata trailer stripped. Our deploy script asserts
  the first three every time.
- **Chain support.** The verifier needs the Prague BLS precompiles (EIP-2537). No mainnet registry exists
  yet; a mainnet consumer needs the registry and verifier deployed and verified there first.

### 5.9 Open questions we would ask the registry maintainers

- Timeline and chains for a mainnet registry deployment, and who will operate public relayers.
- Whether `minimumLeadRounds()` will ever be enforced on `submitBeacon`, or should be treated purely as advisory.
- Whether the registry should expose the raw signature as well as `sha256(signature)` for on-chain re-derivation.
- Recommended behaviour if drand pauses or a round is skipped: the schedule assumes strictly 3 s rounds.

---

## 6. Adapting this for your own app

1. Copy [`IDrandQuicknetBeaconRegistry.sol`](contracts/src/interfaces/IDrandQuicknetBeaconRegistry.sol) and
   the commit/settle skeleton from `DrandCoinFlip.sol`. Replace `bounded(seed, 2)` with your own draw; use
   one `DOMAIN_TAG` per purpose.
2. Set `LEAD_ROUNDS` for your risk (≥ 10 with value) and keep the constructor and deploy-script assertions.
3. Keep `settle` permissionless and emit `QuicknetRandomnessRequested`.
4. Reuse [`web/src/server/relayer.ts`](web/src/server/relayer.ts) as-is; it only depends on the ABI and
   the drand schedule.
5. Reuse [`web/src/lib/verify.ts`](web/src/lib/verify.ts) for client-side verification so your users can
   check results without trusting you.
6. Port the fork tests: submit a genuine round, reject a wrong round and a flipped sign bit, and assert
   your target-round math for arbitrary timestamps.

---

Built on [Bas3d-Labs/drand-quicknet-evm](https://github.com/Bas3d-Labs/drand-quicknet-evm) and
[drand](https://drand.love). Robinhood Chain docs: <https://docs.robinhood.com/chain>.
