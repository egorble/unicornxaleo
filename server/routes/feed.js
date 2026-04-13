/**
 * Feed routes — surface Twitter-league startup news (per-tweet events
 * persisted by daily-scorer to data/live-feed.json).
 *
 * No on-chain marketplace/tournament events are exposed here — the feed is
 * exclusively startup news.
 */

const express = require('express');
const router = express.Router();
const { getLiveFeed } = require('../services/daily-scorer');

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
    const events = [];

    // ── Twitter league events (populated by daily-scorer) ────────────
    try {
        const twitterEvents = getLiveFeed(200);
        for (const t of twitterEvents) {
            const createdMs = new Date(t.createdAt).getTime() || nowMs;
            const item = makeItem({
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
            });
            item.tweetId = t.tweetId;
            events.push(item);
        }
    } catch (err) {
        console.error('[feed] live-feed read failed:', err.message);
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
