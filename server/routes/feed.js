/**
 * Feed routes — synthesize recent on-chain activity into a UI-friendly feed.
 *
 * Data source: read mappings on unicornx_v3.aleo via server/services/aleo.js.
 *   - total_packs_sold        (0u8 => u32)  — running pack sale count
 *   - total_cards_minted      (0u8 => u32)  — running card mint count
 *   - next_listing_id         (0u8 => u32)  — next card-listing id
 *   - listing_index           (u32 => field) — id -> listing commitment
 *   - listings                (field => CardListing{seller, price, card_id, startup_id, rarity, level, salt, listed_at})
 *   - next_pack_listing_id    (0u8 => u32)
 *   - pack_listings           (u32 => PackListing{seller, price, listed_at})
 *   - next_tournament_id      (0u8 => u32)
 *   - tournaments             (field => TournamentData)
 *
 * We reshape each event to the shape the Feed/LiveFeed components already
 * expect (startup/eventType/description/points/tweetId/date/createdAt/summary)
 * plus the actor/type/meta fields described in the task spec, so both the
 * existing UI and any future consumer can read it.
 *
 * Events are in-memory — no DB — and re-derived from chain state on each
 * request. A 20-second cache keeps this cheap under polling load.
 */

const express = require('express');
const router = express.Router();
const { readMapping, getBlockHeight } = require('../services/aleo');
const { getLiveFeed } = require('../services/daily-scorer');
const config = require('../config');

const STARTUP_BY_ID = Object.fromEntries(
    (config.STARTUPS || []).map(s => [s.id, s])
);
const RARITY_LABEL = { 0: 'Common', 1: 'Rare', 2: 'Epic', 3: 'Legendary' };

// ─── Helpers ────────────────────────────────────────────────────────────
function parseU(raw, key) {
    if (raw == null) return 0;
    const s = String(raw);
    const m = s.match(new RegExp(`${key}\\s*:\\s*(\\d+)u\\d+`));
    if (m) return parseInt(m[1]);
    const plain = s.match(/^(\d+)u\d+$/);
    return plain ? parseInt(plain[1]) : 0;
}

function parseScalar(raw) {
    if (raw == null) return 0;
    const s = String(raw).replace(/"/g, '').trim();
    const m = s.match(/^(\d+)(?:u\d+|field)?$/);
    return m ? parseInt(m[1]) : 0;
}

function parseAddress(raw, key) {
    if (raw == null) return null;
    const s = String(raw);
    const m = s.match(new RegExp(`${key}\\s*:\\s*(aleo1[0-9a-z]+)`));
    return m ? m[1] : null;
}

function parseField(raw, key) {
    if (raw == null) return null;
    const s = String(raw);
    const m = s.match(new RegExp(`${key}\\s*:\\s*(\\d+field)`));
    return m ? m[1] : null;
}

function shortAddr(a) {
    if (!a) return 'someone';
    return `${a.slice(0, 9)}…${a.slice(-4)}`;
}

function microToAleo(micro) {
    return (Number(micro) / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 4 });
}

/**
 * Approx wall-clock time for a past block height, given the current head.
 * Aleo testnet target is ~2s per block.
 */
function timeForBlock(blockHeight, currentHeight, nowMs) {
    const delta = Math.max(0, currentHeight - blockHeight);
    return nowMs - delta * 2000;
}

/** Ignore well-known Aleo "mapping key not found" shapes. */
async function safeRead(mapping, key) {
    try {
        const v = await readMapping(mapping, key);
        if (v == null) return null;
        if (typeof v === 'string' && /not found|null/i.test(v.trim())) return null;
        return v;
    } catch (_) {
        return null;
    }
}

// ─── Event builders ─────────────────────────────────────────────────────
function startupNameFromId(id) {
    const s = STARTUP_BY_ID[id];
    return s ? s.name : `Startup #${id}`;
}

function makeItem({ id, type, eventType, actor, startup, description, summary, timestampMs, points = 0, meta = {} }) {
    const iso = new Date(timestampMs).toISOString();
    return {
        id,
        // UI-facing shape (matches Feed.tsx / LiveFeed.tsx expectations)
        startup: startup || 'UnicornX',
        eventType: eventType || type,
        description,
        summary: summary || description,
        points,
        tweetId: null,
        date: iso.slice(0, 10),
        createdAt: iso,
        // Spec-facing shape (task description)
        type,
        actor,
        timestamp: Math.floor(timestampMs / 1000),
        meta,
    };
}

async function buildEvents() {
    const nowMs = Date.now();
    let blockHeight = 0;
    try { blockHeight = await getBlockHeight(); } catch (_) { blockHeight = 0; }

    const [
        packsSoldRaw,
        cardsMintedRaw,
        nextListingIdRaw,
        nextPackListingIdRaw,
        nextTournamentIdRaw,
    ] = await Promise.all([
        safeRead('total_packs_sold', '0u8'),
        safeRead('total_cards_minted', '0u8'),
        safeRead('next_listing_id', '0u8'),
        safeRead('next_pack_listing_id', '0u8'),
        safeRead('next_tournament_id', '0u8'),
    ]);

    const packsSold = parseScalar(packsSoldRaw);
    const cardsMinted = parseScalar(cardsMintedRaw);
    const nextListingId = parseScalar(nextListingIdRaw);
    const nextPackListingId = parseScalar(nextPackListingIdRaw);
    const nextTournamentId = parseScalar(nextTournamentIdRaw);

    const events = [];

    // ── Card listings ────────────────────────────────────────────────
    // Iterate backwards from the newest id. Cap how many we fetch so a
    // single feed request can't balloon into hundreds of RPC calls.
    const LISTING_LOOKBACK = 20;
    const firstListing = Math.max(1, nextListingId - LISTING_LOOKBACK);
    const listingPromises = [];
    for (let id = nextListingId - 1; id >= firstListing; id--) {
        listingPromises.push((async () => {
            const commitment = await safeRead('listing_index', `${id}u32`);
            if (!commitment) return null;
            const key = String(commitment).replace(/"/g, '').trim();
            const listing = await safeRead('listings', key);
            if (!listing) return null;
            const seller = parseAddress(listing, 'seller');
            const price = parseU(listing, 'price');
            const startupId = parseU(listing, 'startup_id');
            const rarity = parseU(listing, 'rarity');
            const level = parseU(listing, 'level');
            const listedAt = parseU(listing, 'listed_at');
            const startupName = startupNameFromId(startupId);
            const rarityLabel = RARITY_LABEL[rarity] || `R${rarity}`;
            const summary = `${shortAddr(seller)} listed a ${rarityLabel} ${startupName} card (lvl ${level || 1}) for ${microToAleo(price)} ALEO`;
            return makeItem({
                id: `card-list-${id}`,
                type: 'card_list',
                eventType: 'CARD_LIST',
                actor: seller,
                startup: startupName,
                description: summary,
                summary,
                timestampMs: timeForBlock(listedAt, blockHeight, nowMs),
                points: 0,
                meta: { listingId: id, price, rarity, level, startupId, commitment: key },
            });
        })());
    }

    // ── Pack listings ────────────────────────────────────────────────
    const PACK_LOOKBACK = 10;
    const firstPack = Math.max(1, nextPackListingId - PACK_LOOKBACK);
    const packListingPromises = [];
    for (let id = nextPackListingId - 1; id >= firstPack; id--) {
        packListingPromises.push((async () => {
            const listing = await safeRead('pack_listings', `${id}u32`);
            if (!listing) return null;
            const seller = parseAddress(listing, 'seller');
            const price = parseU(listing, 'price');
            const listedAt = parseU(listing, 'listed_at');
            const summary = `${shortAddr(seller)} listed a pack for ${microToAleo(price)} ALEO`;
            return makeItem({
                id: `pack-list-${id}`,
                type: 'pack_list',
                eventType: 'PACK_LIST',
                actor: seller,
                description: summary,
                summary,
                timestampMs: timeForBlock(listedAt, blockHeight, nowMs),
                meta: { packListingId: id, price },
            });
        })());
    }

    // ── Tournament metadata ─────────────────────────────────────────
    const TOURNAMENT_LOOKBACK = 5;
    const firstTourney = Math.max(1, nextTournamentId - TOURNAMENT_LOOKBACK);
    const tournamentPromises = [];
    for (let id = nextTournamentId - 1; id >= firstTourney; id--) {
        tournamentPromises.push((async () => {
            const t = await safeRead('tournaments', `${id}field`);
            if (!t) return null;
            const regHeight = parseU(t, 'registration_height');
            const startH = parseU(t, 'start_height');
            const endH = parseU(t, 'end_height');
            const entryCount = parseU(t, 'entry_count');
            const prizePool = parseU(t, 'prize_pool');
            // Use registration_height as the "created" moment.
            const createdSummary = `Tournament #${id} opened — ${entryCount} ${entryCount === 1 ? 'player' : 'players'} registered, ${microToAleo(prizePool)} ALEO pot`;
            const items = [];
            items.push(makeItem({
                id: `tournament-created-${id}`,
                type: 'tournament_created',
                eventType: 'TOURNAMENT',
                actor: null,
                description: createdSummary,
                summary: createdSummary,
                timestampMs: timeForBlock(regHeight || startH, blockHeight, nowMs),
                meta: { tournamentId: id, registrationHeight: regHeight, startHeight: startH, endHeight: endH, entryCount, prizePool },
            }));
            if (entryCount > 0) {
                const entrySummary = `Tournament #${id}: ${entryCount} ${entryCount === 1 ? 'player has' : 'players have'} entered`;
                items.push(makeItem({
                    id: `tournament-entries-${id}`,
                    type: 'tournament_entry',
                    eventType: 'TOURNAMENT',
                    actor: null,
                    description: entrySummary,
                    summary: entrySummary,
                    timestampMs: timeForBlock(startH || regHeight, blockHeight, nowMs),
                    meta: { tournamentId: id, entryCount },
                }));
            }
            return items;
        })());
    }

    const [listingResults, packResults, tournamentResults] = await Promise.all([
        Promise.all(listingPromises),
        Promise.all(packListingPromises),
        Promise.all(tournamentPromises),
    ]);

    for (const r of listingResults) if (r) events.push(r);
    for (const r of packResults) if (r) events.push(r);
    for (const r of tournamentResults) if (r) for (const e of r) events.push(e);

    // ── Twitter league events (populated by daily-scorer) ────────────
    try {
        const twitterEvents = getLiveFeed(200);
        for (const t of twitterEvents) {
            const createdMs = new Date(t.createdAt).getTime() || nowMs;
            events.push(makeItem({
                id: `tweet-${t.tweetId}`,
                type: 'tweet',
                eventType: t.eventType || 'ENGAGEMENT',
                actor: t.handle ? `@${t.handle}` : null,
                startup: t.startup,
                description: t.description,
                summary: t.summary || t.description,
                timestampMs: createdMs,
                points: t.points || 0,
                meta: { metrics: t.metrics, handle: t.handle },
            }));
            // Populate tweetId so UI can link to x.com
            events[events.length - 1].tweetId = t.tweetId;
        }
    } catch (err) {
        console.error('[feed] live-feed read failed:', err.message);
    }

    // ── Aggregate counters (rendered as single rolling events so the feed
    // isn't completely empty on a fresh chain with no listings yet) ───
    if (packsSold > 0) {
        const summary = `${packsSold} pack${packsSold === 1 ? '' : 's'} sold on-chain so far`;
        events.push(makeItem({
            id: `packs-sold-total-${packsSold}`,
            type: 'pack_sale',
            eventType: 'PACK_SALE',
            actor: null,
            description: summary,
            summary,
            timestampMs: nowMs - 5000,
            meta: { totalPacksSold: packsSold },
        }));
    }
    if (cardsMinted > 0) {
        const summary = `${cardsMinted} card${cardsMinted === 1 ? '' : 's'} minted across all packs`;
        events.push(makeItem({
            id: `cards-minted-total-${cardsMinted}`,
            type: 'card_mint',
            eventType: 'CARD_MINT',
            actor: null,
            description: summary,
            summary,
            timestampMs: nowMs - 10000,
            meta: { totalCardsMinted: cardsMinted },
        }));
    }

    // Newest-first
    events.sort((a, b) => b.timestamp - a.timestamp);
    // Give each event a stable numeric id too (UI type is `id: number`) —
    // fall back to hashing the string id if needed.
    let seq = events.length;
    for (const e of events) {
        if (typeof e.id !== 'number') {
            // Keep the descriptive id in `key`, assign a numeric id for the UI.
            e.key = e.id;
            e.id = seq--;
        }
    }
    return events;
}

// ─── Tiny in-process cache ──────────────────────────────────────────────
let _cache = { at: 0, items: [] };
const CACHE_TTL_MS = 20_000;

async function getCachedEvents() {
    const now = Date.now();
    if (now - _cache.at < CACHE_TTL_MS && _cache.items.length > 0) {
        return _cache.items;
    }
    try {
        const items = await buildEvents();
        _cache = { at: now, items };
        return items;
    } catch (err) {
        console.error('[feed] buildEvents failed:', err.message);
        // Serve stale cache rather than erroring out the UI.
        return _cache.items;
    }
}

// ─── Routes ─────────────────────────────────────────────────────────────
// GET /api/feed?limit=20&offset=0   — paginated, newest first
router.get('/feed', async (req, res) => {
    const limit = Math.max(1, Math.min(100, parseInt(req.query.limit) || 20));
    const offset = Math.max(0, parseInt(req.query.offset) || 0);
    const all = await getCachedEvents();
    const slice = all.slice(offset, offset + limit);
    res.json({
        success: true,
        data: slice,
        pagination: {
            total: all.length,
            limit,
            offset,
            hasMore: offset + slice.length < all.length,
        },
    });
});

// GET /api/live-feed?limit=15       — latest N, no pagination
router.get('/live-feed', async (req, res) => {
    const limit = Math.max(1, Math.min(50, parseInt(req.query.limit) || 15));
    const all = await getCachedEvents();
    res.json({
        success: true,
        data: all.slice(0, limit),
    });
});

module.exports = router;
