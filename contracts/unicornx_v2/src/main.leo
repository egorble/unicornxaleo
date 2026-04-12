import credits.aleo;

// ═══════════════════════════════════════════════════════════════════════
//  UnicornX v1 — NullPay-style architecture
//
//  KEY PRINCIPLE: Custom records are ONLY outputs, NEVER inputs.
//  All state verification goes through mappings + salt (like NullPay invoices).
//  No records consumed as inputs — uses transfer_public_as_signer for payments.
//  This avoids Shield wallet's "Commitment doesn't exist" bug.
//
//  Card ownership proved via: commitment = BHP256(owner + card_id + salt)
//  Only the owner knows the salt → only they can prove ownership.
// ═══════════════════════════════════════════════════════════════════════

program unicornx_v2.aleo {

    @admin(address="aleo1d96ex9hc8j5hj3wwu7elyxsm4dzphw6u7t9vx5hnpg5mjh6anvxqeqcq64")
    constructor() {}

    // ─── STRUCTS ────────────────────────────────────────────────────────

    // Card proof: user provides this to prove ownership (private)
    struct CardProof {
        card_id: field,
        card_owner: address,
        startup_id: u8,
        rarity: u8,
        level: u8,
        salt: field
    }

    // On-chain card metadata (stored in mapping)
    struct CardData {
        startup_id: u8,
        rarity: u8,
        level: u8,
        locked: bool
    }

    struct TournamentData {
        registration_height: u32,
        start_height: u32,
        end_height: u32,
        status: u8,
        entry_count: u32,
        prize_pool: u64
    }

    struct StartupScores {
        s1: u64, s2: u64, s3: u64, s4: u64, s5: u64,
        s6: u64, s7: u64, s8: u64, s9: u64, s10: u64,
        s11: u64, s12: u64, s13: u64, s14: u64, s15: u64,
        s16: u64, s17: u64, s18: u64, s19: u64
    }

    struct PlayerTournament {
        tournament_id: field,
        player: address
    }

    // Full card data is public while listed so buyer can build CardProof atomically.
    struct CardListing {
        seller: address,
        price: u64,
        card_id: field,
        startup_id: u8,
        rarity: u8,
        level: u8,
        salt: field,
        listed_at: u32
    }

    struct PackListing {
        seller: address,
        price: u64,
        listed_at: u32
    }

    // ─── RECORDS (outputs only, never consumed as inputs) ───────────────

    // Card receipt — proof of ownership, kept by player
    record Card {
        owner: address,
        card_id: field,
        startup_id: u8,
        rarity: u8,
        level: u8,
        salt: field
    }

    // ─── MAPPINGS ───────────────────────────────────────────────────────

    // Card commitment → CardData (proves card exists + stores metadata)
    // commitment = BHP256(CardProof { owner, card_id, startup_id, rarity, level, salt })
    mapping cards: field => CardData;

    // Global counters
    mapping total_cards_minted: u8 => u32;
    mapping total_packs_sold: u8 => u32;
    mapping pack_price: u8 => u64;

    // Pending packs per user (fungible — all packs are identical random draws)
    // Key: hash(user_address), Value: number of unopened packs
    mapping pending_packs: field => u32;

    // Open requests: user decrements pending_packs, admin then mints 5 cards
    // Key: hash(user_address), Value: number of pending open requests awaiting fulfillment
    mapping open_requests: field => u32;

    // Referrals
    mapping referrer_of: field => address;
    mapping referral_count: field => u32;
    mapping referral_earnings: field => u64;  // total microcredits earned by each referrer

    // Tournaments
    mapping tournaments: field => TournamentData;
    mapping next_tournament_id: u8 => u32;  // key 0u8 holds next tournament ID (1, 2, 3...)
    mapping player_entered: field => bool;
    mapping player_score: field => u64;
    mapping player_scored: field => bool;
    mapping scores_hash: field => field;
    mapping total_tournament_score: field => u64;
    mapping prize_claimed: field => bool;

    // Marketplace (v2): card + pack listings
    mapping listings: field => CardListing;               // key = commitment
    mapping listing_index: u32 => field;                  // iteration: id → commitment
    mapping commitment_to_listing_id: field => u32;       // reverse lookup
    mapping next_listing_id: u8 => u32;                   // counter (starts at 1)

    mapping pack_listings: u32 => PackListing;            // pack listings by id
    mapping next_pack_listing_id: u8 => u32;

    // ═════════════════════════════════════════════════════════════════
    //  1. MINT CARD — admin mints card, outputs Card receipt to player
    // ═════════════════════════════════════════════════════════════════

    fn mint_card(
        private player: address,
        private card_id: field,
        private startup_id: u8,
        private rarity: u8,
        private level: u8,
        private salt: field
    ) -> (Card, Final) {
        assert(startup_id >= 1u8);
        assert(startup_id <= 19u8);
        assert(rarity <= 3u8);
        assert(level >= 1u8);
        assert(level <= 5u8);

        let expected_rarity: u8 =
            startup_id <= 5u8 ? 3u8 :
            startup_id <= 8u8 ? 2u8 :
            startup_id <= 13u8 ? 1u8 : 0u8;
        assert_eq(rarity, expected_rarity);

        let caller: address = self.caller;

        let proof: CardProof = CardProof {
            card_id: card_id, card_owner: player,
            startup_id: startup_id, rarity: rarity, level: level, salt: salt
        };
        let commitment: field = BHP256::hash_to_field(proof);

        return (
            Card { owner: player, card_id: card_id, startup_id: startup_id, rarity: rarity, level: level, salt: salt },
            final {
                assert_eq(caller, aleo1d96ex9hc8j5hj3wwu7elyxsm4dzphw6u7t9vx5hnpg5mjh6anvxqeqcq64);

                let exists: bool = cards.contains(commitment);
                assert(!exists);
                cards.set(commitment, CardData { startup_id: startup_id, rarity: rarity, level: level, locked: false });

                let minted: u32 = total_cards_minted.get_or_use(0u8, 0u32);
                assert(minted < 50000u32);
                total_cards_minted.set(0u8, minted + 1u32);
            }
        );
    }

    // ═════════════════════════════════════════════════════════════════
    //  2. BUY PACK — pay credits, get pack_id in mapping
    // ═════════════════════════════════════════════════════════════════

    // v11: split funds — 10% platform (admin), 10% referral (if valid), rest → tournament prize_pool.
    // Admin custodies prize funds on their public balance; prize_pool mapping tracks allocation.
    fn buy_pack(
        public amount: u64,
        private referrer: address,
        public tournament_id: field
    ) -> Final {
        let admin_addr: address = aleo1d96ex9hc8j5hj3wwu7elyxsm4dzphw6u7t9vx5hnpg5mjh6anvxqeqcq64;
        let caller: address = self.caller;
        assert(amount > 0u64);

        // Split: 10% platform, 10% referral (only if referrer is a different real user),
        // rest (80% with referrer, 90% without) → prize pool tracked in mapping.
        let has_ref: bool = referrer != caller && referrer != admin_addr;
        let platform_share: u64 = amount / 10u64;
        let referral_share: u64 = has_ref ? (amount / 10u64) : 0u64;
        let prize_share: u64 = amount - platform_share - referral_share;

        // Pay admin: platform share + prize share (admin custodies prize until distribute_prize).
        // Referrer: their share (if any) — we always issue a transfer so Leo can stay linear,
        // but when no referrer we send 0 microcredits (no-op recipient=admin).
        let admin_amount: u64 = platform_share + prize_share;
        let ref_target: address = has_ref ? referrer : admin_addr;
        let f_admin: Final = credits.aleo::transfer_public_as_signer(admin_addr, admin_amount);
        let f_ref: Final = credits.aleo::transfer_public_as_signer(ref_target, referral_share);

        let caller_hash: field = BHP256::hash_to_field(caller as field);
        let referrer_hash: field = BHP256::hash_to_field(referrer as field);

        return final {
            f_admin.run();
            f_ref.run();

            let stored_price: u64 = pack_price.get_or_use(0u8, 100000u64);
            assert_eq(amount, stored_price);

            let sold: u32 = total_packs_sold.get_or_use(0u8, 0u32);
            assert(sold < 10000u32);
            total_packs_sold.set(0u8, sold + 1u32);

            let pending: u32 = pending_packs.get_or_use(caller_hash, 0u32);
            pending_packs.set(caller_hash, pending + 1u32);

            // Credit prize_pool of the given tournament (must be in registration/active phase).
            let t: TournamentData = tournaments.get(tournament_id);
            assert_eq(t.status, 0u8);
            assert(block.height < t.end_height);
            tournaments.set(tournament_id, TournamentData {
                registration_height: t.registration_height,
                start_height: t.start_height,
                end_height: t.end_height,
                status: t.status,
                entry_count: t.entry_count,
                prize_pool: t.prize_pool + prize_share
            });

            // Track referral relationship + earnings (first-time only for referrer_of).
            if has_ref {
                let existing: bool = referrer_of.contains(caller_hash);
                if !existing {
                    referrer_of.set(caller_hash, referrer);
                    let rc: u32 = referral_count.get_or_use(referrer_hash, 0u32);
                    referral_count.set(referrer_hash, rc + 1u32);
                }
                let earned: u64 = referral_earnings.get_or_use(referrer_hash, 0u64);
                referral_earnings.set(referrer_hash, earned + referral_share);
            }
        };
    }

    // ═════════════════════════════════════════════════════════════════
    //  3a. REQUEST OPEN PACK — user-signed: decrements pending_packs,
    //      creates open_request that admin will fulfill with random cards
    // ═════════════════════════════════════════════════════════════════

    fn request_open_pack() -> Final {
        let caller: address = self.caller;
        let caller_hash: field = BHP256::hash_to_field(caller as field);
        return final {
            let pending: u32 = pending_packs.get(caller_hash);
            assert(pending >= 1u32);
            pending_packs.set(caller_hash, pending - 1u32);

            let requests: u32 = open_requests.get_or_use(caller_hash, 0u32);
            open_requests.set(caller_hash, requests + 1u32);
        };
    }

    // ═════════════════════════════════════════════════════════════════
    //  3b. OPEN PACK — admin fulfills user's open_request with 5 random cards
    //     Uses CardInput struct to fit 5 cards within 16-param limit.
    // ═════════════════════════════════════════════════════════════════

    struct CardInput {
        card_id: field,
        startup_id: u8,
        rarity: u8,
        salt: field
    }

    fn open_pack(
        private player: address,
        private c1: CardInput,
        private c2: CardInput,
        private c3: CardInput,
        private c4: CardInput,
        private c5: CardInput
    ) -> (Card, Card, Card, Card, Card, Final) {
        let caller: address = self.caller;

        let p1: CardProof = CardProof { card_id: c1.card_id, card_owner: player, startup_id: c1.startup_id, rarity: c1.rarity, level: 1u8, salt: c1.salt };
        let p2: CardProof = CardProof { card_id: c2.card_id, card_owner: player, startup_id: c2.startup_id, rarity: c2.rarity, level: 1u8, salt: c2.salt };
        let p3: CardProof = CardProof { card_id: c3.card_id, card_owner: player, startup_id: c3.startup_id, rarity: c3.rarity, level: 1u8, salt: c3.salt };
        let p4: CardProof = CardProof { card_id: c4.card_id, card_owner: player, startup_id: c4.startup_id, rarity: c4.rarity, level: 1u8, salt: c4.salt };
        let p5: CardProof = CardProof { card_id: c5.card_id, card_owner: player, startup_id: c5.startup_id, rarity: c5.rarity, level: 1u8, salt: c5.salt };

        let cm1: field = BHP256::hash_to_field(p1);
        let cm2: field = BHP256::hash_to_field(p2);
        let cm3: field = BHP256::hash_to_field(p3);
        let cm4: field = BHP256::hash_to_field(p4);
        let cm5: field = BHP256::hash_to_field(p5);

        return (
            Card { owner: player, card_id: c1.card_id, startup_id: c1.startup_id, rarity: c1.rarity, level: 1u8, salt: c1.salt },
            Card { owner: player, card_id: c2.card_id, startup_id: c2.startup_id, rarity: c2.rarity, level: 1u8, salt: c2.salt },
            Card { owner: player, card_id: c3.card_id, startup_id: c3.startup_id, rarity: c3.rarity, level: 1u8, salt: c3.salt },
            Card { owner: player, card_id: c4.card_id, startup_id: c4.startup_id, rarity: c4.rarity, level: 1u8, salt: c4.salt },
            Card { owner: player, card_id: c5.card_id, startup_id: c5.startup_id, rarity: c5.rarity, level: 1u8, salt: c5.salt },
            final {
                assert_eq(caller, aleo1d96ex9hc8j5hj3wwu7elyxsm4dzphw6u7t9vx5hnpg5mjh6anvxqeqcq64);

                // Fulfill player's open request (user must have signed request_open_pack first)
                let player_hash: field = BHP256::hash_to_field(player as field);
                let requests: u32 = open_requests.get(player_hash);
                assert(requests >= 1u32);
                open_requests.set(player_hash, requests - 1u32);

                let minted: u32 = total_cards_minted.get_or_use(0u8, 0u32);
                assert(minted + 5u32 <= 50000u32);
                total_cards_minted.set(0u8, minted + 5u32);

                assert(!cards.contains(cm1)); cards.set(cm1, CardData { startup_id: c1.startup_id, rarity: c1.rarity, level: 1u8, locked: false });
                assert(!cards.contains(cm2)); cards.set(cm2, CardData { startup_id: c2.startup_id, rarity: c2.rarity, level: 1u8, locked: false });
                assert(!cards.contains(cm3)); cards.set(cm3, CardData { startup_id: c3.startup_id, rarity: c3.rarity, level: 1u8, locked: false });
                assert(!cards.contains(cm4)); cards.set(cm4, CardData { startup_id: c4.startup_id, rarity: c4.rarity, level: 1u8, locked: false });
                assert(!cards.contains(cm5)); cards.set(cm5, CardData { startup_id: c5.startup_id, rarity: c5.rarity, level: 1u8, locked: false });
            }
        );
    }

    // ═════════════════════════════════════════════════════════════════
    //  4. MERGE CARDS — 3 same-rarity → 1 higher-rarity
    //     Uses CardProof structs (no record consumption — Shield can't handle it)
    // ═════════════════════════════════════════════════════════════════

    fn merge_cards(
        private proof_a: CardProof,
        private proof_b: CardProof,
        private proof_c: CardProof,
        private new_card_id: field,
        private new_startup_id: u8,
        private new_salt: field
    ) -> (Card, Final) {
        assert_eq(proof_a.rarity, proof_b.rarity);
        assert_eq(proof_b.rarity, proof_c.rarity);
        assert(proof_a.rarity < 3u8);

        let caller: address = self.caller;
        assert_eq(proof_a.card_owner, caller);
        assert_eq(proof_b.card_owner, caller);
        assert_eq(proof_c.card_owner, caller);

        let new_rarity: u8 = proof_a.rarity + 1u8;

        if new_rarity == 3u8 { assert(new_startup_id >= 1u8); assert(new_startup_id <= 5u8); }
        if new_rarity == 2u8 { assert(new_startup_id >= 6u8); assert(new_startup_id <= 8u8); }
        if new_rarity == 1u8 { assert(new_startup_id >= 9u8); assert(new_startup_id <= 13u8); }

        let cm_a: field = BHP256::hash_to_field(proof_a);
        let cm_b: field = BHP256::hash_to_field(proof_b);
        let cm_c: field = BHP256::hash_to_field(proof_c);

        let new_proof: CardProof = CardProof {
            card_id: new_card_id, card_owner: caller,
            startup_id: new_startup_id, rarity: new_rarity, level: 1u8, salt: new_salt
        };
        let cm_new: field = BHP256::hash_to_field(new_proof);

        return (
            Card { owner: caller, card_id: new_card_id, startup_id: new_startup_id, rarity: new_rarity, level: 1u8, salt: new_salt },
            final {
                let da: CardData = cards.get(cm_a);
                assert(!da.locked);
                let db: CardData = cards.get(cm_b);
                assert(!db.locked);
                let dc: CardData = cards.get(cm_c);
                assert(!dc.locked);

                cards.remove(cm_a);
                cards.remove(cm_b);
                cards.remove(cm_c);

                assert(!cards.contains(cm_new));
                cards.set(cm_new, CardData { startup_id: new_startup_id, rarity: new_rarity, level: 1u8, locked: false });
            }
        );
    }

    // ═════════════════════════════════════════════════════════════════
    //  5. UPGRADE CARD — CardProof based, outputs new Card
    // ═════════════════════════════════════════════════════════════════

    fn upgrade_card(
        private proof: CardProof,
        private new_salt: field,
        public success: bool
    ) -> (Card, Final) {
        assert(proof.level < 5u8);

        let cm_old: field = BHP256::hash_to_field(proof);

        let new_level: u8 = success ? (proof.level + 1u8) : proof.level;
        let burn_addr: address = aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc;
        let target: address = success ? proof.card_owner : burn_addr;

        let new_proof: CardProof = CardProof {
            card_id: proof.card_id, card_owner: target,
            startup_id: proof.startup_id, rarity: proof.rarity, level: new_level, salt: new_salt
        };
        let cm_new: field = BHP256::hash_to_field(new_proof);

        return (
            Card { owner: target, card_id: proof.card_id, startup_id: proof.startup_id, rarity: proof.rarity, level: new_level, salt: new_salt },
            final {
                let old_data: CardData = cards.get(cm_old);
                assert(!old_data.locked);

                cards.remove(cm_old);
                if success {
                    cards.set(cm_new, CardData { startup_id: proof.startup_id, rarity: proof.rarity, level: new_level, locked: false });
                }
            }
        );
    }

    // ═════════════════════════════════════════════════════════════════
    //  6. TRANSFER CARD
    // ═════════════════════════════════════════════════════════════════

    fn transfer_card(
        private proof: CardProof,
        private to: address,
        private new_salt: field
    ) -> (Card, Final) {
        let caller: address = self.caller;
        assert_eq(proof.card_owner, caller);

        let cm_old: field = BHP256::hash_to_field(proof);
        let new_proof: CardProof = CardProof {
            card_id: proof.card_id, card_owner: to,
            startup_id: proof.startup_id, rarity: proof.rarity, level: proof.level, salt: new_salt
        };
        let cm_new: field = BHP256::hash_to_field(new_proof);

        return (
            Card { owner: to, card_id: proof.card_id, startup_id: proof.startup_id, rarity: proof.rarity, level: proof.level, salt: new_salt },
            final {
                let data: CardData = cards.get(cm_old);
                assert(!data.locked);
                cards.remove(cm_old);
                cards.set(cm_new, CardData { startup_id: proof.startup_id, rarity: proof.rarity, level: proof.level, locked: false });
            }
        );
    }

    // ═════════════════════════════════════════════════════════════════
    //  7. CREATE TOURNAMENT
    // ═════════════════════════════════════════════════════════════════

    fn create_tournament(
        public registration_height: u32,
        public start_height: u32,
        public end_height: u32
    ) -> Final {
        assert(start_height > registration_height);
        assert(end_height > start_height);
        let caller: address = self.caller;
        return final {
            assert_eq(caller, aleo1d96ex9hc8j5hj3wwu7elyxsm4dzphw6u7t9vx5hnpg5mjh6anvxqeqcq64);
            let next_id: u32 = next_tournament_id.get_or_use(0u8, 1u32);
            let tournament_id: field = next_id as field;
            let exists: bool = tournaments.contains(tournament_id);
            assert(!exists);
            tournaments.set(tournament_id, TournamentData {
                registration_height: registration_height, start_height: start_height, end_height: end_height,
                status: 0u8, entry_count: 0u32, prize_pool: 0u64
            });
            next_tournament_id.set(0u8, next_id + 1u32);
        };
    }

    // ═════════════════════════════════════════════════════════════════
    //  8. ENTER TOURNAMENT — 5 card proofs (private), verified via mapping
    //     Cards locked in mapping. Score computed privately via ZK.
    // ═════════════════════════════════════════════════════════════════

    fn enter_tournament(
        private p1: CardProof, private p2: CardProof, private p3: CardProof,
        private p4: CardProof, private p5: CardProof,
        public tournament_id: field
    ) -> Final {
        let caller: address = self.caller;
        assert_eq(p1.card_owner, caller);
        assert_eq(p2.card_owner, caller);
        assert_eq(p3.card_owner, caller);
        assert_eq(p4.card_owner, caller);
        assert_eq(p5.card_owner, caller);

        // All cards unique
        let cm1: field = BHP256::hash_to_field(p1);
        let cm2: field = BHP256::hash_to_field(p2);
        let cm3: field = BHP256::hash_to_field(p3);
        let cm4: field = BHP256::hash_to_field(p4);
        let cm5: field = BHP256::hash_to_field(p5);
        assert(cm1 != cm2); assert(cm1 != cm3); assert(cm1 != cm4); assert(cm1 != cm5);
        assert(cm2 != cm3); assert(cm2 != cm4); assert(cm2 != cm5);
        assert(cm3 != cm4); assert(cm3 != cm5);
        assert(cm4 != cm5);

        let entry_key: field = BHP256::hash_to_field(PlayerTournament { tournament_id: tournament_id, player: caller });

        return final {
            let t: TournamentData = tournaments.get(tournament_id);
            assert_eq(t.status, 0u8);
            assert(block.height >= t.registration_height);
            assert(block.height < t.start_height);

            let already: bool = player_entered.get_or_use(entry_key, false);
            assert(!already);
            player_entered.set(entry_key, true);

            // Lock all 5 cards
            let d1: CardData = cards.get(cm1); assert(!d1.locked);
            cards.set(cm1, CardData { startup_id: d1.startup_id, rarity: d1.rarity, level: d1.level, locked: true });
            let d2: CardData = cards.get(cm2); assert(!d2.locked);
            cards.set(cm2, CardData { startup_id: d2.startup_id, rarity: d2.rarity, level: d2.level, locked: true });
            let d3: CardData = cards.get(cm3); assert(!d3.locked);
            cards.set(cm3, CardData { startup_id: d3.startup_id, rarity: d3.rarity, level: d3.level, locked: true });
            let d4: CardData = cards.get(cm4); assert(!d4.locked);
            cards.set(cm4, CardData { startup_id: d4.startup_id, rarity: d4.rarity, level: d4.level, locked: true });
            let d5: CardData = cards.get(cm5); assert(!d5.locked);
            cards.set(cm5, CardData { startup_id: d5.startup_id, rarity: d5.rarity, level: d5.level, locked: true });

            tournaments.set(tournament_id, TournamentData {
                registration_height: t.registration_height, start_height: t.start_height, end_height: t.end_height,
                status: t.status, entry_count: t.entry_count + 1u32, prize_pool: t.prize_pool
            });
        };
    }

    // ═════════════════════════════════════════════════════════════════
    //  9. SET SCORES + CALCULATE SCORE (ZK privacy preserved)
    // ═════════════════════════════════════════════════════════════════

    fn set_startup_scores(public tournament_id: field, public scores: StartupScores) -> Final {
        let caller: address = self.caller;
        let h: field = BHP256::hash_to_field(scores);
        return final {
            assert_eq(caller, aleo1d96ex9hc8j5hj3wwu7elyxsm4dzphw6u7t9vx5hnpg5mjh6anvxqeqcq64);
            let t: TournamentData = tournaments.get(tournament_id);
            assert_eq(t.status, 0u8);
            assert(block.height >= t.start_height);
            scores_hash.set(tournament_id, h);
        };
    }

    fn calculate_score(
        private p1: CardProof, private p2: CardProof, private p3: CardProof,
        private p4: CardProof, private p5: CardProof,
        public tournament_id: field,
        public scores: StartupScores
    ) -> Final {
        let caller: address = self.caller;

        // Private ZK computation — nobody sees which cards were selected
        let base1: u64 = p1.startup_id == 1u8 ? scores.s1 : p1.startup_id == 2u8 ? scores.s2 : p1.startup_id == 3u8 ? scores.s3 : p1.startup_id == 4u8 ? scores.s4 : p1.startup_id == 5u8 ? scores.s5 : p1.startup_id == 6u8 ? scores.s6 : p1.startup_id == 7u8 ? scores.s7 : p1.startup_id == 8u8 ? scores.s8 : p1.startup_id == 9u8 ? scores.s9 : p1.startup_id == 10u8 ? scores.s10 : p1.startup_id == 11u8 ? scores.s11 : p1.startup_id == 12u8 ? scores.s12 : p1.startup_id == 13u8 ? scores.s13 : p1.startup_id == 14u8 ? scores.s14 : p1.startup_id == 15u8 ? scores.s15 : p1.startup_id == 16u8 ? scores.s16 : p1.startup_id == 17u8 ? scores.s17 : p1.startup_id == 18u8 ? scores.s18 : p1.startup_id == 19u8 ? scores.s19 : 0u64;
        let base2: u64 = p2.startup_id == 1u8 ? scores.s1 : p2.startup_id == 2u8 ? scores.s2 : p2.startup_id == 3u8 ? scores.s3 : p2.startup_id == 4u8 ? scores.s4 : p2.startup_id == 5u8 ? scores.s5 : p2.startup_id == 6u8 ? scores.s6 : p2.startup_id == 7u8 ? scores.s7 : p2.startup_id == 8u8 ? scores.s8 : p2.startup_id == 9u8 ? scores.s9 : p2.startup_id == 10u8 ? scores.s10 : p2.startup_id == 11u8 ? scores.s11 : p2.startup_id == 12u8 ? scores.s12 : p2.startup_id == 13u8 ? scores.s13 : p2.startup_id == 14u8 ? scores.s14 : p2.startup_id == 15u8 ? scores.s15 : p2.startup_id == 16u8 ? scores.s16 : p2.startup_id == 17u8 ? scores.s17 : p2.startup_id == 18u8 ? scores.s18 : p2.startup_id == 19u8 ? scores.s19 : 0u64;
        let base3: u64 = p3.startup_id == 1u8 ? scores.s1 : p3.startup_id == 2u8 ? scores.s2 : p3.startup_id == 3u8 ? scores.s3 : p3.startup_id == 4u8 ? scores.s4 : p3.startup_id == 5u8 ? scores.s5 : p3.startup_id == 6u8 ? scores.s6 : p3.startup_id == 7u8 ? scores.s7 : p3.startup_id == 8u8 ? scores.s8 : p3.startup_id == 9u8 ? scores.s9 : p3.startup_id == 10u8 ? scores.s10 : p3.startup_id == 11u8 ? scores.s11 : p3.startup_id == 12u8 ? scores.s12 : p3.startup_id == 13u8 ? scores.s13 : p3.startup_id == 14u8 ? scores.s14 : p3.startup_id == 15u8 ? scores.s15 : p3.startup_id == 16u8 ? scores.s16 : p3.startup_id == 17u8 ? scores.s17 : p3.startup_id == 18u8 ? scores.s18 : p3.startup_id == 19u8 ? scores.s19 : 0u64;
        let base4: u64 = p4.startup_id == 1u8 ? scores.s1 : p4.startup_id == 2u8 ? scores.s2 : p4.startup_id == 3u8 ? scores.s3 : p4.startup_id == 4u8 ? scores.s4 : p4.startup_id == 5u8 ? scores.s5 : p4.startup_id == 6u8 ? scores.s6 : p4.startup_id == 7u8 ? scores.s7 : p4.startup_id == 8u8 ? scores.s8 : p4.startup_id == 9u8 ? scores.s9 : p4.startup_id == 10u8 ? scores.s10 : p4.startup_id == 11u8 ? scores.s11 : p4.startup_id == 12u8 ? scores.s12 : p4.startup_id == 13u8 ? scores.s13 : p4.startup_id == 14u8 ? scores.s14 : p4.startup_id == 15u8 ? scores.s15 : p4.startup_id == 16u8 ? scores.s16 : p4.startup_id == 17u8 ? scores.s17 : p4.startup_id == 18u8 ? scores.s18 : p4.startup_id == 19u8 ? scores.s19 : 0u64;
        let base5: u64 = p5.startup_id == 1u8 ? scores.s1 : p5.startup_id == 2u8 ? scores.s2 : p5.startup_id == 3u8 ? scores.s3 : p5.startup_id == 4u8 ? scores.s4 : p5.startup_id == 5u8 ? scores.s5 : p5.startup_id == 6u8 ? scores.s6 : p5.startup_id == 7u8 ? scores.s7 : p5.startup_id == 8u8 ? scores.s8 : p5.startup_id == 9u8 ? scores.s9 : p5.startup_id == 10u8 ? scores.s10 : p5.startup_id == 11u8 ? scores.s11 : p5.startup_id == 12u8 ? scores.s12 : p5.startup_id == 13u8 ? scores.s13 : p5.startup_id == 14u8 ? scores.s14 : p5.startup_id == 15u8 ? scores.s15 : p5.startup_id == 16u8 ? scores.s16 : p5.startup_id == 17u8 ? scores.s17 : p5.startup_id == 18u8 ? scores.s18 : p5.startup_id == 19u8 ? scores.s19 : 0u64;

        let total: u64 = base1 * (p1.level as u64) + base2 * (p2.level as u64) + base3 * (p3.level as u64) + base4 * (p4.level as u64) + base5 * (p5.level as u64);

        let provided_hash: field = BHP256::hash_to_field(scores);
        let entry_key: field = BHP256::hash_to_field(PlayerTournament { tournament_id: tournament_id, player: caller });

        return final {
            let t: TournamentData = tournaments.get(tournament_id);
            assert_eq(t.status, 0u8);
            assert(block.height >= t.start_height);

            let entered: bool = player_entered.get(entry_key);
            assert(entered);

            let already_scored: bool = player_scored.get_or_use(entry_key, false);
            assert(!already_scored);

            let stored_hash: field = scores_hash.get(tournament_id);
            assert_eq(provided_hash, stored_hash);

            player_score.set(entry_key, total);
            player_scored.set(entry_key, true);

            let prev_total: u64 = total_tournament_score.get_or_use(tournament_id, 0u64);
            total_tournament_score.set(tournament_id, prev_total + total);
        };
    }

    // ═════════════════════════════════════════════════════════════════
    //  10. FINALIZE + DISTRIBUTE + UNLOCK + CANCEL
    // ═════════════════════════════════════════════════════════════════

    fn finalize_tournament(public tournament_id: field) -> Final {
        let caller: address = self.caller;
        return final {
            assert_eq(caller, aleo1d96ex9hc8j5hj3wwu7elyxsm4dzphw6u7t9vx5hnpg5mjh6anvxqeqcq64);
            let t: TournamentData = tournaments.get(tournament_id);
            assert_eq(t.status, 0u8);
            assert(block.height >= t.end_height);
            tournaments.set(tournament_id, TournamentData {
                registration_height: t.registration_height, start_height: t.start_height, end_height: t.end_height,
                status: 2u8, entry_count: t.entry_count, prize_pool: t.prize_pool
            });
        };
    }

    // v11: distribute_prize pays winner from admin's public balance (where prize funds live)
    // and decrements tournament prize_pool accordingly. Returns winner's private credits record.
    fn distribute_prize(
        public winner: address,
        public amount: u64,
        public tournament_id: field
    ) -> (credits.aleo::credits, Final) {
        let caller: address = self.caller;
        let entry_key: field = BHP256::hash_to_field(PlayerTournament { tournament_id: tournament_id, player: winner });
        // Admin transfers amount from their public balance → winner (private record).
        let (winner_record, f_pay): (credits.aleo::credits, Final) =
            credits.aleo::transfer_public_to_private(winner, amount);
        return (winner_record, final {
            assert_eq(caller, aleo1d96ex9hc8j5hj3wwu7elyxsm4dzphw6u7t9vx5hnpg5mjh6anvxqeqcq64);
            let t: TournamentData = tournaments.get(tournament_id);
            assert_eq(t.status, 2u8);
            assert(t.prize_pool >= amount);
            let scored: bool = player_scored.get_or_use(entry_key, false);
            assert(scored);
            let claimed: bool = prize_claimed.get_or_use(entry_key, false);
            assert(!claimed);
            prize_claimed.set(entry_key, true);
            tournaments.set(tournament_id, TournamentData {
                registration_height: t.registration_height,
                start_height: t.start_height,
                end_height: t.end_height,
                status: t.status,
                entry_count: t.entry_count,
                prize_pool: t.prize_pool - amount
            });
            f_pay.run();
        });
    }

    fn unlock_cards(
        private p1: CardProof, private p2: CardProof, private p3: CardProof,
        private p4: CardProof, private p5: CardProof,
        public tournament_id: field
    ) -> Final {
        let cm1: field = BHP256::hash_to_field(p1);
        let cm2: field = BHP256::hash_to_field(p2);
        let cm3: field = BHP256::hash_to_field(p3);
        let cm4: field = BHP256::hash_to_field(p4);
        let cm5: field = BHP256::hash_to_field(p5);
        return final {
            let t: TournamentData = tournaments.get(tournament_id);
            assert(t.status == 2u8 || t.status == 3u8);
            let d1: CardData = cards.get(cm1); cards.set(cm1, CardData { startup_id: d1.startup_id, rarity: d1.rarity, level: d1.level, locked: false });
            let d2: CardData = cards.get(cm2); cards.set(cm2, CardData { startup_id: d2.startup_id, rarity: d2.rarity, level: d2.level, locked: false });
            let d3: CardData = cards.get(cm3); cards.set(cm3, CardData { startup_id: d3.startup_id, rarity: d3.rarity, level: d3.level, locked: false });
            let d4: CardData = cards.get(cm4); cards.set(cm4, CardData { startup_id: d4.startup_id, rarity: d4.rarity, level: d4.level, locked: false });
            let d5: CardData = cards.get(cm5); cards.set(cm5, CardData { startup_id: d5.startup_id, rarity: d5.rarity, level: d5.level, locked: false });
        };
    }

    fn cancel_tournament(public tournament_id: field) -> Final {
        let caller: address = self.caller;
        return final {
            assert_eq(caller, aleo1d96ex9hc8j5hj3wwu7elyxsm4dzphw6u7t9vx5hnpg5mjh6anvxqeqcq64);
            let t: TournamentData = tournaments.get(tournament_id);
            assert(t.status == 0u8);
            tournaments.set(tournament_id, TournamentData {
                registration_height: t.registration_height, start_height: t.start_height, end_height: t.end_height,
                status: 3u8, entry_count: t.entry_count, prize_pool: t.prize_pool
            });
        };
    }

    // ═════════════════════════════════════════════════════════════════
    //  MARKETPLACE — card listings (v2)
    //  Seller publishes full CardProof data (including salt) so buyer
    //  can build a new CardProof atomically in buy_listing.
    // ═════════════════════════════════════════════════════════════════

    fn list_card(private proof: CardProof, public price: u64) -> Final {
        let caller: address = self.caller;
        assert_eq(proof.card_owner, caller);
        assert(price > 0u64);
        let cm: field = BHP256::hash_to_field(proof);
        return final {
            let data: CardData = cards.get(cm);
            assert(!data.locked);
            cards.set(cm, CardData { startup_id: data.startup_id, rarity: data.rarity, level: data.level, locked: true });

            let id: u32 = next_listing_id.get_or_use(0u8, 1u32);
            listings.set(cm, CardListing {
                seller: caller, price: price,
                card_id: proof.card_id,
                startup_id: proof.startup_id,
                rarity: proof.rarity,
                level: proof.level,
                salt: proof.salt,
                listed_at: block.height
            });
            listing_index.set(id, cm);
            commitment_to_listing_id.set(cm, id);
            next_listing_id.set(0u8, id + 1u32);
        };
    }

    fn cancel_listing(private proof: CardProof) -> Final {
        let caller: address = self.caller;
        assert_eq(proof.card_owner, caller);
        let cm: field = BHP256::hash_to_field(proof);
        return final {
            let listing: CardListing = listings.get(cm);
            assert_eq(listing.seller, caller);
            let data: CardData = cards.get(cm);
            cards.set(cm, CardData { startup_id: data.startup_id, rarity: data.rarity, level: data.level, locked: false });
            listings.remove(cm);
            let id: u32 = commitment_to_listing_id.get(cm);
            listing_index.remove(id);
            commitment_to_listing_id.remove(cm);
        };
    }

    // Atomic card purchase: 4% platform fee, 96% to seller, new Card record for buyer.
    fn buy_listing(
        private seller_proof: CardProof,
        private new_salt: field,
        public seller: address,
        public price: u64
    ) -> (Card, Final) {
        let buyer: address = self.caller;
        assert_eq(seller_proof.card_owner, seller);
        assert(price > 0u64);

        let admin_addr: address = aleo1d96ex9hc8j5hj3wwu7elyxsm4dzphw6u7t9vx5hnpg5mjh6anvxqeqcq64;
        let platform_fee: u64 = price / 25u64;        // 4%
        let seller_amount: u64 = price - platform_fee;

        let f_seller: Final = credits.aleo::transfer_public_as_signer(seller, seller_amount);
        let f_admin: Final = credits.aleo::transfer_public_as_signer(admin_addr, platform_fee);

        let old_cm: field = BHP256::hash_to_field(seller_proof);
        let new_proof: CardProof = CardProof {
            card_id: seller_proof.card_id,
            card_owner: buyer,
            startup_id: seller_proof.startup_id,
            rarity: seller_proof.rarity,
            level: seller_proof.level,
            salt: new_salt
        };
        let new_cm: field = BHP256::hash_to_field(new_proof);

        return (
            Card {
                owner: buyer,
                card_id: seller_proof.card_id,
                startup_id: seller_proof.startup_id,
                rarity: seller_proof.rarity,
                level: seller_proof.level,
                salt: new_salt
            },
            final {
                f_seller.run();
                f_admin.run();
                let listing: CardListing = listings.get(old_cm);
                assert_eq(listing.seller, seller);
                assert_eq(listing.price, price);

                cards.remove(old_cm);
                cards.set(new_cm, CardData {
                    startup_id: seller_proof.startup_id,
                    rarity: seller_proof.rarity,
                    level: seller_proof.level,
                    locked: false
                });
                listings.remove(old_cm);
                let id: u32 = commitment_to_listing_id.get(old_cm);
                listing_index.remove(id);
                commitment_to_listing_id.remove(old_cm);
            }
        );
    }

    // ═════════════════════════════════════════════════════════════════
    //  MARKETPLACE — pack listings (v2)
    //  Packs are a counter per user (pending_packs), not records.
    //  list_pack moves 1 pending slot into escrow (pack_listings mapping).
    //  buy_pack_listing transfers escrowed slot to buyer + pays seller.
    // ═════════════════════════════════════════════════════════════════

    fn list_pack(public price: u64) -> Final {
        let caller: address = self.caller;
        assert(price > 0u64);
        let caller_hash: field = BHP256::hash_to_field(caller as field);
        return final {
            let pending: u32 = pending_packs.get_or_use(caller_hash, 0u32);
            assert(pending >= 1u32);
            pending_packs.set(caller_hash, pending - 1u32);

            let id: u32 = next_pack_listing_id.get_or_use(0u8, 1u32);
            pack_listings.set(id, PackListing {
                seller: caller, price: price, listed_at: block.height
            });
            next_pack_listing_id.set(0u8, id + 1u32);
        };
    }

    fn cancel_pack_listing(public listing_id: u32) -> Final {
        let caller: address = self.caller;
        let caller_hash: field = BHP256::hash_to_field(caller as field);
        return final {
            let listing: PackListing = pack_listings.get(listing_id);
            assert_eq(listing.seller, caller);
            pack_listings.remove(listing_id);
            let pending: u32 = pending_packs.get_or_use(caller_hash, 0u32);
            pending_packs.set(caller_hash, pending + 1u32);
        };
    }

    fn buy_pack_listing(
        public listing_id: u32,
        public seller: address,
        public price: u64
    ) -> Final {
        let buyer: address = self.caller;
        assert(price > 0u64);

        let admin_addr: address = aleo1d96ex9hc8j5hj3wwu7elyxsm4dzphw6u7t9vx5hnpg5mjh6anvxqeqcq64;
        let platform_fee: u64 = price / 25u64;
        let seller_amount: u64 = price - platform_fee;

        let f_seller: Final = credits.aleo::transfer_public_as_signer(seller, seller_amount);
        let f_admin: Final = credits.aleo::transfer_public_as_signer(admin_addr, platform_fee);

        let buyer_hash: field = BHP256::hash_to_field(buyer as field);
        return final {
            f_seller.run();
            f_admin.run();
            let listing: PackListing = pack_listings.get(listing_id);
            assert_eq(listing.seller, seller);
            assert_eq(listing.price, price);
            pack_listings.remove(listing_id);
            let pending: u32 = pending_packs.get_or_use(buyer_hash, 0u32);
            pending_packs.set(buyer_hash, pending + 1u32);
        };
    }
}
