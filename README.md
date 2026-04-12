# UnicornX

> Zero-knowledge fantasy league for YC startups, running on Aleo.

**Live:** [aleo.unicornx.fun](https://aleo.unicornx.fun)
**Program:** `unicornx_v2.aleo` (Aleo testnet)
**Admin:** `aleo1d96ex9hc8j5hj3wwu7elyxsm4dzphw6u7t9vx5hnpg5mjh6anvxqeqcq64`

---

## 1. What is UnicornX

UnicornX is a fantasy sports league where the "athletes" are 19 real Y Combinator / frontier-tech startups (OpenAI, Anthropic, Cursor, Lovable, Browser Use, …). Players buy NFT packs, draft a private 5-card lineup, and compete in on-chain tournaments where scores come from each startup's real Twitter/X activity during the tournament window.

Card ownership, rarity, level, and lineup composition are **private** — only the player's wallet can prove what they hold. Tournament entries, scores, and prize payouts are settled on-chain via Aleo zero-knowledge proofs.

---

## 2. Why Aleo (vs EVM)

Fantasy leagues are a bad fit for transparent chains. If every lineup is visible on-chain at `enter_tournament` time, players copy whoever looks smart, front-run each other, or collude with off-chain pools. On Ethereum you'd need expensive commit-reveal dances, custom zk-circuits, or centralised servers to paper over this. Aleo gives it to you natively:

| Concern                          | EVM approach                                     | Aleo approach                                            |
|----------------------------------|--------------------------------------------------|----------------------------------------------------------|
| Hide lineup until scoring        | Commit-reveal, 2 txs + timing window             | `enter_tournament` takes 5 `CardProof` as **private** inputs — lineup never hits public state |
| Prove "I own card X"             | Public ownership in ERC-721 / mapping            | BHP256 commitment; only the owner knows `salt`           |
| Score lineup without revealing it | Off-chain oracle + attestation signature         | `calculate_score` runs the dot-product `Σ(score × level)` inside the ZK circuit; only the final `u64` hits state |
| Anti-collusion / anti-copy       | Whitelists, ZK rollup add-on                     | Inherent: nobody can see what anyone else drafted        |
| Gas to prove a 5-card tournament entry | Exploding with `zk-SNARK` gadget calls     | One Varuna-KZG proof, verified cheaply on-chain          |

The result: we can build a game where *lineup secrecy is a first-class guarantee*, not something bolted on with servers and rate limits.

---

## 3. Architecture

```
                   ┌──────────────────────────────────────────────┐
                   │                Player browser                │
                   │  React + Vite + @provablehq/sdk (WASM)       │
                   │  - computes BHP256 commitments client-side   │
                   │  - holds decrypted Card records              │
                   │  - persists lineup in localStorage           │
                   └──────────────┬───────────────────────────────┘
                                  │
                      signTx / decryptRecord
                                  │
                   ┌──────────────▼───────────────┐
                   │   Shield / Leo / Fox / Puzzle │
                   │   (Aleo wallet adapters)      │
                   └──────────────┬───────────────┘
                                  │
                              proof + tx
                                  │
   ┌────────────────┐   ┌─────────▼───────────┐   ┌───────────────────────┐
   │ Aleo explorer  │◄──┤   Aleo testnet L1    ├──►│  Backend (Node/Express)│
   │ (read mappings)│   │  unicornx_v2.aleo    │   │  :5170                 │
   └────────────────┘   │  - cards mapping     │   │  - pack fulfiller      │
                        │  - tournaments       │   │  - upgrade fulfiller   │
                        │  - listings          │   │  - daily Twitter scorer│
                        └─────────▲────────────┘   │  - AI recommender      │
                                  │                │  - indexer / REST API  │
                                  │                └────────┬───────────────┘
                                  │                         │
                                  │  admin-signed txs       │ OpenRouter + X API
                                  │  (mint/open/score/      │
                                  │   finalize)             │
                                  └─────────────────────────┘
```

Responsibilities:

- **Frontend** (`frontend/`) – wallet connect, WASM crypto (`aleoCrypto.ts`), UI, ZK proof generation via Shield/Leo.
- **Contract** (`contracts/unicornx_v2/src/main.leo`) – source of truth for cards, tournaments, marketplace.
- **Backend** (`server/`) – admin signer for asynchronous fulfillment (opening packs, upgrading cards, publishing daily scores); Twitter scorer; AI lineup recommender; REST endpoints for cached reads.

---

## 4. What's Private, What's Public

This is the most important section for understanding UnicornX. Aleo lets you pick, per field, whether it lives as a `private` record (encrypted to an owner) or a `public` mapping entry (world-readable).

### 4.1 Fields by visibility

| Field                  | Where it lives                                 | Visibility |
|------------------------|------------------------------------------------|------------|
| `card_id` (field)      | `Card` record (encrypted) + `CardProof` input  | **Private** — only owner sees |
| `salt` (field)         | `Card` record + `CardProof` input              | **Private** while held in wallet; temporarily **public** while listed in marketplace |
| `card_owner`           | `Card` record owner field + `CardProof` input  | **Private** (address is inside an encrypted record) |
| `commitment = BHP256(CardProof)` | key of `cards` mapping               | **Public** (but reveals nothing — preimage is salted) |
| `startup_id`, `rarity`, `level`, `locked` | `CardData` value of `cards[commitment]` | **Public** |
| `pending_packs[hash(user)]` | mapping, u32 counter                      | **Public** (count only; `hash(user)` hides identity weakly) |
| `player_entered[entry_key]` | bool                                      | **Public** — "this address entered tournament T" |
| `player_score[entry_key]` | u64                                        | **Public** after `calculate_score` runs |
| Lineup (which 5 cards) | passed as `private CardProof` inputs only     | **Private forever** — never written to any mapping |
| `tournaments[id]`      | `TournamentData` mapping                       | **Public** (heights, status, entry_count, prize_pool) |
| `scores_hash[tid]`     | `BHP256(StartupScores)`                        | **Public** (hash only, until admin reveals full scores via `calculate_score` calls) |
| `CardListing` (for listed cards) | `listings[commitment]` mapping       | **Public** — includes `card_id` + `salt` of the listed card |
| Referral link `referrer_of[hash(user)] → addr` | mapping                | **Public** |

### 4.2 Privacy across a card's lifecycle

Each card's `(card_id, salt, card_owner)` triple is its "ownership proof key." The contract refreshes `salt` at every move so no two states of the same card are linkable by an observer.

| Flow                           | card_id | salt      | owner   | Notes |
|--------------------------------|---------|-----------|---------|-------|
| Sitting in wallet              | Private | Private   | Private | Only `BHP256(commitment)` is visible; `CardData` reveals traits but not owner |
| Entered in tournament          | Private | Private   | Private | `cards[cm].locked = true` is public, but *which user* it belongs to isn't — `player_entered` uses `BHP256(PlayerTournament)` derived from a different (`tid`, `addr`) tuple |
| Listed on marketplace          | Private? | **Public** | **Public** (seller) | `CardListing` publishes full `{card_id, startup_id, rarity, level, salt, seller}` so the buyer can atomically build a new `CardProof` against the old commitment. The listing is the one public-salt moment in the card's life. |
| Cancelled listing              | Back to private | Back to private | Back to private | Listing removed. The old salt is now burnt info, but because nobody consumed the commitment, the owner can optionally rotate by calling `transfer_card(self, new_salt)` |
| Bought by new owner            | Private | **New private salt**, old public salt is stale | Private (buyer) | `buy_listing` takes `new_salt` as a private input from the buyer. The old `commitment` is removed from `cards`; a fresh `BHP256(new CardProof)` is inserted. Observers see "listing removed, a new commitment appeared," but cannot link them without seeing the buyer's private input. |
| Scored in tournament           | Private | Private | Private | `calculate_score` takes 5 `CardProof` as private inputs; only the `u64` score hits `player_score`. The 5 `startup_id`s and `level`s are crushed into a single number inside the proof. |
| Merged (3 → 1)                 | Private | Private | Private | `merge_cards` deletes three commitments, writes one new. Observer sees 3 deletes + 1 insert; cannot tell which 3. |

### 4.3 What an observer *can* infer

We don't hand-wave ZK — here's the leakage:

- Total cards minted (`total_cards_minted[0u8]`), total packs sold, tournament entry counts, prize pool size.
- The set of card *traits* that exist (read every `cards[*]` value) but not who owns them.
- *That* a given address entered a tournament (via `player_entered`), and their final score — but not their 5 cards.
- *That* someone has `N` pending packs (counter keyed by `BHP256(addr as field)`, which is pseudonymous but not strictly unlinkable since anyone can hash any candidate address and check).
- For listed cards: everything about that card except which wallet *used to* own it before this listing (seller is explicit on the listing).

---

## 5. Cryptographic Primitives

### 5.1 Commitments

The whole contract pivots on one hash:

```leo
let commitment: field = BHP256::hash_to_field(CardProof {
    card_id, card_owner, startup_id, rarity, level, salt
});
```

`BHP256` is **Bowe–Hopwood–Pedersen over a prime field** — a Pedersen-style hash with 256-bit collision resistance, chosen because it's extremely cheap to prove inside a SNARK circuit (a handful of scalar multiplications vs. thousands of boolean ops for SHA-256). The commitment:

- Hides the card's identity (preimage-hiding when `salt` is unpredictable).
- Binds owner + traits + salt, so you can't swap any one field without forging a new commitment.
- Is used as a mapping key (`cards: field => CardData`) so the contract can enforce "this commitment exists and isn't locked" without learning the preimage.

Commitments are computed client-side (no backend call) via `@provablehq/sdk` WASM — see `frontend/lib/aleoCrypto.ts`:

```ts
// aleoCrypto.ts — simplified
const literal = `{ card_id: ${cardId}field, card_owner: ${owner},
                   startup_id: ${sid}u8, rarity: ${r}u8,
                   level: ${l}u8, salt: ${salt}field }`;
const pt   = Plaintext.fromString(literal);
const bits = pt.toBitsLe();
const hash = new BHP256().hash(bits).toString();   // "<digits>field"
```

### 5.2 Transition proofs

Every Leo `fn` compiles to an R1CS circuit. When a user calls it, snarkVM generates a **Varuna-KZG** (marlin-style) proof `π` that:

1. The private inputs (e.g. the 5 `CardProof`s for `enter_tournament`) satisfy every `assert` in the transition.
2. The public inputs/outputs match what's shown on-chain.
3. The state writes (`cards.set(…)`, `tournaments.set(…)`) are exactly those the circuit computed.

The verifier runs on-chain; verification cost is ~constant and cheap. Leaked information is strictly `{public inputs, public outputs, state-writes-by-key}` — anything marked `private` is information-theoretically hidden (zero-knowledge property).

### 5.3 Scores commit–reveal

To prevent admin from publishing scores *after* seeing who would win, the contract uses a commitment on the scores:

```leo
fn set_startup_scores(public tournament_id: field, public scores: StartupScores) -> Final {
    // admin-only, must be after start_height
    let h: field = BHP256::hash_to_field(scores);
    scores_hash.set(tournament_id, h);
}

fn calculate_score(private p1..p5: CardProof,
                   public tournament_id: field,
                   public scores: StartupScores) -> Final {
    let provided_hash: field = BHP256::hash_to_field(scores);
    // …
    let stored_hash: field = scores_hash.get(tournament_id);
    assert_eq(provided_hash, stored_hash);   // scores can't change after commit
}
```

Subtle point: `set_startup_scores` stores *only the hash*. The raw 19-score struct isn't written anywhere — each player passes it as a public input to `calculate_score` and the contract just re-hashes and compares. Any tampering breaks the hash.

### 5.4 Record encryption

`record Card { owner: address, card_id, startup_id, rarity, level, salt }` is emitted as an **encrypted record** on-chain, encrypted to `owner`'s Aleo view key. Only the owner can decrypt and use it off-chain. In the current v2 architecture, the `Card` record is actually treated as a *receipt* for local storage (see `usePacks.ts` — records are parsed and cached); the contract never consumes records as inputs (documented at the top of `main.leo`: "KEY PRINCIPLE: Custom records are ONLY outputs, NEVER inputs"). All ownership proofs go through the `CardProof` + `salt` pattern on mappings.

---

## 6. How Tournaments Work

Tournaments have a linear status machine: **Created → Active → Finalized** (or **Cancelled**). Status is a `u8` in `TournamentData`:

| Value | Meaning    |
|-------|------------|
| `0u8` | Created (registration/active — same status, distinguished by block height) |
| `1u8` | (reserved) |
| `2u8` | Finalized  |
| `3u8` | Cancelled  |

The three key heights:

```
block.height │
             │  < registration_height        │ registration not yet open
             │  >= registration_height       │ enter_tournament allowed
             │   & < start_height            │
             │  >= start_height              │ set_startup_scores allowed (admin)
             │   & < end_height              │ calculate_score allowed (each player, once)
             │  >= end_height                │ finalize_tournament → status = 2u8
             │                               │ distribute_prize + unlock_cards
             ▼
```

Phase-by-phase:

1. **Created** — Admin calls `create_tournament(registration_height, start_height, end_height)`. A `tournaments[tid]` entry is written with `status=0`, `prize_pool=0`, `entry_count=0`. The contract asserts `start_height > registration_height` and `end_height > start_height`.
2. **Registration** — Whenever `block.height >= registration_height && < start_height`:
   - Players call `enter_tournament(p1..p5, tid)` with 5 `CardProof` structs.
   - All 5 commitments are asserted pairwise distinct.
   - `cards[cm_i].locked` is set to `true`.
   - `player_entered[BHP256(PlayerTournament{tid, player})] = true`.
3. **Pack-feeding prize pool** — Throughout `status=0`, any `buy_pack(amount, referrer, tid)` routes 80–90 % of the payment into `tournaments[tid].prize_pool` (see §7). The contract asserts `block.height < t.end_height`.
4. **Active / Scoring** — At `start_height`, admin calls `set_startup_scores(tid, scores)`:
   - Writes `scores_hash[tid] = BHP256(scores)`.
   - Each entered player then has until `end_height` to call `calculate_score(p1..p5, tid, scores)`. The contract verifies `BHP256(scores) == scores_hash[tid]`, computes `Σ(base_i × level_i)`, writes `player_score[entry_key]`.
5. **Finalized** — After `end_height`:
   - Admin calls `finalize_tournament(tid)` → `status = 2u8`.
   - Admin ranks scores off-chain (reads `player_score` mapping via explorer) and calls `distribute_prize(winner, amount, tid)` for each payout; contract decrements `prize_pool` and calls `credits.aleo::transfer_public_to_private`.
   - Players call `unlock_cards(p1..p5, tid)` to set `locked=false` on each of their 5 commitments so the cards can be traded/merged/upgraded again. Status must be `2u8` or `3u8`.

The `cancel_tournament` path jumps status to `3u8` from `0u8` directly; cards can still be unlocked.

---

## 7. Pack Economics

Every pack purchase is a single transition that splits the payment three ways and then updates a counter:

```leo
// from main.leo::buy_pack
let has_ref:         bool = referrer != caller && referrer != admin_addr;
let platform_share:  u64  = amount / 10u64;                      // 10%
let referral_share:  u64  = has_ref ? (amount / 10u64) : 0u64;   // 10% if valid referrer
let prize_share:     u64  = amount - platform_share - referral_share; // 80% or 90%

// One credits.transfer_public_as_signer → admin(platform + prize custody)
// One credits.transfer_public_as_signer → referrer (or 0 to admin if no ref)
// Then:
tournaments[tid].prize_pool += prize_share;
pending_packs[BHP256(caller as field)] += 1;
```

| Scenario          | Platform | Referrer | Prize pool | Total |
|-------------------|----------|----------|------------|-------|
| No referrer       | 10 %     | 0 %      | 90 %       | 100 % |
| Valid referrer    | 10 %     | 10 %     | 80 %       | 100 % |

Notes:
- **Prize custody**: admin holds the prize float on their public balance. `prize_pool` in the mapping is accounting-only; actual ALEO lives in the admin's `credits` balance. `distribute_prize` draws from there via `transfer_public_to_private`, after asserting `prize_pool >= amount`.
- **Pack price** is enforced against `pack_price[0u8]` (default 100 000 microcredits = 0.1 ALEO).
- **Opening a pack is asynchronous**: `buy_pack` only bumps `pending_packs`. Player then calls `request_open_pack` (moves 1 slot to `open_requests`), and admin fulfills with `open_pack(player, c1..c5)`, minting 5 `Card` records. The admin server does the randomness off-chain (`server/services/pack-fulfiller.js`) because randomness in ZK is awkward; the contract only verifies rarity tiers through the `startup_id` buckets baked into `mint_card` (`startup_id ≤ 5` ⇒ rarity 3, `≤ 8` ⇒ 2, `≤ 13` ⇒ 1, else 0).

---

## 8. Marketplace

Two kinds of listings: individual cards (`list_card`) and sealed packs (`list_pack`).

### 8.1 Card listings — the salt trade-off

Listing a card requires publishing the card's full data, including the normally-private `salt`:

```leo
fn list_card(private proof: CardProof, public price: u64) -> Final {
    // …
    listings.set(cm, CardListing {
        seller: caller, price,
        card_id: proof.card_id,
        startup_id, rarity, level,
        salt: proof.salt,               // ← public while listed!
        listed_at: block.height,
    });
    cards[cm].locked = true;
}
```

Why? The buyer needs to build a new `CardProof` (with a *new* salt they chose) and prove "this new commitment replaces the listed commitment" atomically inside `buy_listing`. For the buyer's circuit to be sound, they need the old preimage. There's no Aleo-native way to do a private-to-private transfer of a mapping entry without revealing the salt, short of consuming records (which the Shield-wallet-first architecture avoids — see the comment block at the top of `main.leo`).

The upshot:
- While listed, the card is de-anonymised ("seller X is offering card Y with salt S").
- On cancel (`cancel_listing`), the mapping row is deleted and locking is lifted. The old salt is now historically known, but no further information leaks — the card sits in `cards[cm]` keyed by the same commitment. A cautious owner who wants full privacy again can `transfer_card(self, new_salt)` to rotate.
- On purchase (`buy_listing(seller_proof, new_salt, seller, price)`), the contract:
  - Transfers `price * 96/100` to seller, `price * 4/100` to admin (platform fee: `price / 25u64`).
  - Deletes the old commitment, inserts `new_cm = BHP256(new CardProof{..., card_owner: buyer, salt: new_salt})`.
  - Emits a new private `Card` record to the buyer.
  - The buyer's fresh salt is never revealed, so the card is private again post-trade.

### 8.2 Pack listings

Packs are fungible (all packs are identical random draws), so `list_pack(price)` just escrows one slot of `pending_packs[BHP256(seller)]` into `pack_listings[id] = PackListing{seller, price, listed_at}`. `buy_pack_listing(id, seller, price)` swaps credit for slot (4 % platform fee, 96 % to seller). `cancel_pack_listing(id)` returns the slot.

---

## 9. Daily Scoring

The flow combines an off-chain data pipeline with an on-chain commit-reveal:

1. **Daily Twitter ingestion** (`server/services/daily-scorer.js`) — a cron at `10 0 * * *` UTC fetches tweets for each of the 19 startups via `server/jobs/twitter-league-scorer.js`, scores them (funding news, launches, engagement), and appends to `server/data/daily-scores.json`:
   ```json
   { "2026-04-12": { "s1": 123, "s2": 45, …, "s19": 0 }, … }
   ```
2. **Admin commit** — After `start_height`, admin calls `set_startup_scores(tid, scoresStruct)`. Contract writes `scores_hash[tid] = BHP256(scoresStruct)` — *only the hash*, not the scores themselves.
3. **Player reveal** — Each entered player calls `calculate_score(p1..p5, tid, scoresStruct)` from the UI. They pass the same plaintext scores (fetched from `/api/startups/scores/aggregated`, which must match the hash). The circuit:
   ```
   // pseudocode
   for each CardProof p_i:
       base_i = scores["s" + p_i.startup_id]          // 19-way select inside the circuit
   total = Σ base_i * p_i.level
   assert BHP256(scores) == scores_hash[tid]
   assert player_entered[entry_key]
   assert !player_scored[entry_key]
   player_score[entry_key]         = total
   player_scored[entry_key]        = true
   total_tournament_score[tid]    += total
   ```
   The 19-way select per card is unrolled in Leo with a giant ternary (see lines 571–575 of `main.leo`) — Leo has no indexed-field access, so we spell it out.
4. **Leaderboard** — Backend `/api/leaderboard/:id` (and a planned indexer) iterates `player_score` entries via explorer mapping queries. There is no in-contract ranking — see §15.

---

## 10. Contract Functions Reference

All transitions on `unicornx_v2.aleo`:

| Function                     | Caller       | Purpose |
|------------------------------|--------------|---------|
| `mint_card`                  | admin        | Mint a single card of specific rarity/startup (used for seeding & fulfillment edge cases). Writes `cards[cm]`, returns `Card` record. |
| `buy_pack`                   | any user     | Purchase one pack; 10/10/80 split to platform / referrer / tournament prize pool; bumps `pending_packs`. |
| `request_open_pack`          | any user     | Burns one `pending_packs` slot into `open_requests`; asks admin to fulfill. |
| `open_pack`                  | admin        | Mints 5 random lvl-1 `Card` records for a player, consuming one `open_requests` slot. |
| `merge_cards`                | owner of 3 cards | Burn 3 same-rarity cards, mint 1 card of rarity+1. Caps at rarity 3. |
| `upgrade_card`               | any user (`success` is a public admin-determined bool) | On success: level+1. On failure: burn to null address. Consumes old commitment. |
| `transfer_card`              | owner        | Move a card to another address with a new salt. |
| `create_tournament`          | admin        | Register a new tournament with registration / start / end heights. |
| `enter_tournament`           | player       | Lock 5 cards into tournament; set `player_entered`. |
| `set_startup_scores`         | admin        | Commit to the tournament's startup scores (stores only the hash). |
| `calculate_score`            | player       | Privately compute and reveal the player's aggregate score for the tournament. |
| `finalize_tournament`        | admin        | Move status `0 → 2` after `end_height`. |
| `distribute_prize`           | admin        | Pay a winner from admin's balance; decrement `prize_pool`. |
| `unlock_cards`               | anyone       | Set `locked=false` on the 5 cards after tournament is finalized/cancelled. |
| `cancel_tournament`          | admin        | Status `0 → 3`. |
| `list_card`                  | card owner   | Publish a card listing (reveals salt). |
| `cancel_listing`             | seller       | Remove a card listing; unlock card. |
| `buy_listing`                | any user     | Atomic purchase of a listed card; 4 % platform fee; rotates salt. |
| `list_pack` / `cancel_pack_listing` / `buy_pack_listing` | user | Same pattern for unopened packs. |

---

## 11. Running Locally

### Prerequisites

- Node 20+
- `leo` 4.0.0 (only needed if recompiling the contract)
- `snarkos` / `snarkvm` (only needed for a local devnet)
- A funded Aleo testnet account to use as admin (ALEO testnet credits)

### Setup

```bash
# Prereqs: node 20+, leo 4.0.0, snarkos

# 1. Backend
cd server
npm install
cp .env.example .env
#   Edit .env:
#     ADMIN_PRIVATE_KEY=APrivateKey1zkp...     (your admin signer)
#     ADMIN_ADDRESS=aleo1...                    (matching address)
#     ADMIN_API_KEY=<shared secret for /api/admin/*>
#     PROGRAM_ID=unicornx_v2.aleo
#     NETWORK=testnet
#     ENDPOINT=https://api.explorer.provable.com/v1
#     OPENROUTER_API_KEY=sk-or-...              (optional, for AI recommender)

# 2. Frontend
cd ../frontend
npm install
cp .env.example .env
#   Usually no edits needed for local dev.
```

### Run

```bash
# Terminal 1 — backend
cd server && node index.js       # :5170

# Terminal 2 — frontend
cd frontend && npm run dev       # :5171
```

Open http://localhost:5171, connect a Leo / Shield / Fox / Puzzle wallet, and you're in.

### Optional: recompile / redeploy contract

```bash
cd contracts/unicornx_v2
leo build
leo deploy --network testnet --endpoint https://api.explorer.provable.com/v1
```

You'll need to update `frontend/lib/networks.ts::ALEO_PROGRAM_ID` and `server/.env::PROGRAM_ID` if you bump the name.

---

## 12. Deploying to Production

Two scripts in the repo root:

- `deploy.sh` — first-time setup. Clones the repo, installs deps, builds the frontend into `dist/`, starts two `pm2` processes: `unicornx-backend` (`node server/index.js` on :5170) and `unicornx-frontend` (`serve frontend/dist` on :5171), runs `pm2 save && pm2 startup`.
- `update.sh` — subsequent deploys. `git pull`, reinstall, rebuild, `pm2 restart`.

Flags:

```bash
bash deploy.sh --install-infra   # also apt-install nginx + certbot
bash deploy.sh --systemd         # use systemd units instead of pm2
bash deploy.sh --install-infra --systemd   # both
```

nginx is reverse-proxied via `nginx/aleo.unicornx.fun.conf`:

```
location /       → static frontend dist on :5171
location /api/   → proxy to backend on :5170
```

Install:
```bash
sudo cp nginx/aleo.unicornx.fun.conf /etc/nginx/sites-available/
sudo ln -s /etc/nginx/sites-available/aleo.unicornx.fun.conf /etc/nginx/sites-enabled/
sudo certbot --nginx -d aleo.unicornx.fun
sudo nginx -t && sudo systemctl reload nginx
```

Production URL: **https://aleo.unicornx.fun**

---

## 13. Deployed Contract

| Field       | Value                                                                   |
|-------------|-------------------------------------------------------------------------|
| Program     | `unicornx_v2.aleo`                                                      |
| Network     | Aleo testnet                                                            |
| Admin       | `aleo1d96ex9hc8j5hj3wwu7elyxsm4dzphw6u7t9vx5hnpg5mjh6anvxqeqcq64`       |
| Endpoint    | `https://api.explorer.provable.com/v1/testnet/program/unicornx_v2.aleo` |
| Explorer    | `https://testnet.aleo.info/program/unicornx_v2.aleo` *(placeholder — check current canonical explorer URL)* |
| Pack price  | 100 000 microcredits (0.1 ALEO)                                         |
| Supply caps | 10 000 packs, 50 000 cards                                              |

Admin-only transitions are enforced via a hard-coded address check at the top of each `final` block:

```leo
assert_eq(caller, aleo1d96ex9hc8j5hj3wwu7elyxsm4dzphw6u7t9vx5hnpg5mjh6anvxqeqcq64);
```

---

## 14. Tech Stack

**Smart contract**
- Leo (`leo` 4.0.0), snarkVM / Varuna-KZG
- `credits.aleo` stdlib for ALEO transfers
- BHP256 hash for commitments and mapping keys

**Frontend**
- React 19 + Vite
- `@provablehq/sdk` 0.10.1 (WASM for BHP256 + field arithmetic)
- `@provablehq/aleo-wallet-adaptor-*` for Leo / Shield / Fox / Puzzle wallets
- `@tanstack/react-query` for data fetching
- `recharts` + `lightweight-charts` for dashboards
- `three` + `@react-three/fiber` for card visuals
- Tailwind CSS

**Backend**
- Node 20 + Express 5
- `node-cron` for daily scorer
- `better-sqlite3` for local indexer state (jobs / open requests)
- `dotenv`, `uuid`
- Off-chain services: `daily-scorer` (Twitter/X), `ai-recommender` (OpenRouter fallback chain: arcee trinity → gemma-3 → stepfun → glm-4.5 → qwen-3), `pack-fulfiller`, `upgrade-fulfiller`

**Infra**
- pm2 (or systemd) for process supervision
- nginx reverse proxy + Let's Encrypt (certbot)
- GitHub (clone URL hard-coded in `deploy.sh`)

---

## 15. Limitations & Known Issues

- **Leaderboard is backend-indexed.** The contract stores per-player scores in a mapping (`player_score[entry_key]`) but has no ranking or enumeration primitive — reading the top N requires an off-chain indexer that iterates mapping entries via the explorer API. `/api/leaderboard/:tournamentId` is currently a stub; a full indexer is on the roadmap.
- **Marketplace reveals listed card data.** Listing a card publishes `{seller, card_id, salt, startup_id, rarity, level}` until it's sold or cancelled (see §8.1). This is a structural trade-off with the "Shield-friendly, no-record-inputs" architecture. Mitigation: owners can rotate their salt via `transfer_card(self, new_salt)` after cancelling a listing.
- **No native Aleo auctions / bids.** Only fixed-price listings are supported — a `buy_listing` with a stale `price` argument will revert if the seller has updated it. Dutch auctions, English auctions, or reserve prices are out of scope for v2.
- **Pack randomness is admin-side.** `open_pack` takes the 5 card definitions as admin inputs; randomness is generated in `server/services/pack-fulfiller.js` and anchored to rarity bucket assertions inside the circuit. The admin could bias draws in principle — a future version could use a VRF or commit-reveal on randomness. For now it's the same trust model as the admin private key.
- **Upgrade success is admin-side.** `upgrade_card(public success: bool)` is signed by the user, but `success` comes from an admin-decided roll (`server/services/upgrade-fulfiller.js`). Same mitigation direction as packs.
- **Scorer API dependence.** Daily scoring relies on an external Twitter/X scraper. Rate limits or API changes can stall the daily score (it logs and continues with zeros for failed handles — see `daily-scorer.js`).
- **Records are receipts, not inputs.** The v2 architecture emits `Card` records but never consumes them (documented at the top of `main.leo`: *"KEY PRINCIPLE: Custom records are ONLY outputs, NEVER inputs"*). All state verification flows through `CardProof + salt` against the `cards` mapping. This works around a Shield-wallet issue where record consumption triggers a "Commitment doesn't exist" error; the cost is that wallets must persist record plaintexts locally.
- **Entry-count / prize-pool unboundedness.** The contract caps global supply (10 000 packs, 50 000 cards) but doesn't cap per-tournament entries or `prize_pool` size. Not currently a practical concern at testnet scale.

---

## License

MIT — see `LICENSE`.
