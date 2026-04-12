/**
 * Daily scorer for the UnicornX Aleo server.
 *
 * Wraps jobs/twitter-league-scorer.js (ESM) via a dynamic import and persists
 * per-day totals per startup to server/data/daily-scores.json.
 *
 * Shape of the store file:
 *   {
 *     "2026-04-12": { "s1": 123, "s2": 45, ..., "s19": 0 },
 *     "2026-04-11": { ... },
 *     ...
 *   }
 *
 * Exposes:
 *   runDailyScorer()                 — fetch + score + persist today's entry
 *   getDailyScores(days = 10)        — last N days of entries (desc by date)
 *   getLatestScores()                — today's entry (or most recent)
 *   getAggregatedScores(days = 10)   — sum per startup over last N days
 *   todayKey()                       — "YYYY-MM-DD" UTC
 */

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const config = require('../config');

const DATA_DIR = path.join(__dirname, '..', 'data');
const SCORES_FILE = path.join(DATA_DIR, 'daily-scores.json');

// ── Twitter handle lookup ────────────────────────────────────────────────
// We must know each startup's Twitter handle to call the scorer. The ESM
// scorer exports STARTUP_MAPPING (handle -> display name), which we invert
// and join against config.STARTUPS (id <-> name) at runtime.
let _twitterScorerPromise = null;
function loadTwitterScorer() {
    if (!_twitterScorerPromise) {
        const abs = path.join(__dirname, '..', 'jobs', 'twitter-league-scorer.mjs');
        _twitterScorerPromise = import(pathToFileURL(abs).href).catch(err => {
            // Reset cached promise so next call retries instead of being
            // permanently stuck with a rejected promise.
            _twitterScorerPromise = null;
            throw err;
        });
    }
    return _twitterScorerPromise;
}

// ── File persistence ─────────────────────────────────────────────────────
function ensureDataDir() {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadStore() {
    try {
        ensureDataDir();
        if (!fs.existsSync(SCORES_FILE)) return {};
        const raw = fs.readFileSync(SCORES_FILE, 'utf8');
        return raw.trim() ? JSON.parse(raw) : {};
    } catch (err) {
        console.error('[daily-scorer] Failed to read store:', err.message);
        return {};
    }
}

function saveStore(store) {
    ensureDataDir();
    fs.writeFileSync(SCORES_FILE, JSON.stringify(store, null, 2));
}

function todayKey() {
    return new Date().toISOString().split('T')[0];
}

// ── Public getters ───────────────────────────────────────────────────────

/** Return an array of { date, scores } for the last N days, newest first. */
function getDailyScores(days = 10) {
    const store = loadStore();
    const dates = Object.keys(store).sort().reverse().slice(0, days);
    return dates.map(date => ({ date, scores: store[date] }));
}

/** Today's entry, or the most recent one if today hasn't run yet. */
function getLatestScores() {
    const store = loadStore();
    const today = todayKey();
    if (store[today]) return { date: today, scores: store[today] };
    const dates = Object.keys(store).sort().reverse();
    if (dates.length === 0) return { date: today, scores: emptyScores() };
    return { date: dates[0], scores: store[dates[0]] };
}

/** Sum per startup across the last N days — returns { s1..s19: number }. */
function getAggregatedScores(days = 10) {
    const rows = getDailyScores(days);
    const out = emptyScores();
    for (const { scores } of rows) {
        for (const key of Object.keys(scores || {})) {
            out[key] = (out[key] || 0) + Number(scores[key] || 0);
        }
    }
    return out;
}

function emptyScores() {
    const out = {};
    for (const s of config.STARTUPS) out[`s${s.id}`] = 0;
    return out;
}

// ── Main run ─────────────────────────────────────────────────────────────

/**
 * Fetch & score tweets for all startups, write today's entry to the store.
 * Returns the stored entry `{ date, scores }`.
 */
async function runDailyScorer({ force = false } = {}) {
    const date = todayKey();
    const store = loadStore();

    if (!force && store[date]) {
        console.log(`[daily-scorer] Entry for ${date} already exists — skipping (pass force:true to overwrite)`);
        return { date, scores: store[date] };
    }

    let processStartupForDate, STARTUP_MAPPING, setLogContext;
    try {
        ({ processStartupForDate, STARTUP_MAPPING, setLogContext } = await loadTwitterScorer());
    } catch (err) {
        console.error('[daily-scorer] Failed to load twitter-league-scorer:', err.message);
        return null;
    }

    if (typeof setLogContext === 'function') {
        try { setLogContext(date); } catch (_) { /* noop */ }
    }

    // Build: startupName -> id, then handle -> id via STARTUP_MAPPING.
    const nameToId = {};
    for (const s of config.STARTUPS) nameToId[s.name] = s.id;
    const handleToId = {};
    for (const [handle, name] of Object.entries(STARTUP_MAPPING || {})) {
        if (nameToId[name] !== undefined) handleToId[handle] = nameToId[name];
    }

    const scores = emptyScores();
    const handles = Object.keys(handleToId);
    console.log(`[daily-scorer] Scoring ${handles.length} startups for ${date}`);

    for (const handle of handles) {
        const id = handleToId[handle];
        try {
            const result = await processStartupForDate(handle, date);
            const points = Number(result?.totalPoints || 0);
            scores[`s${id}`] = points;
            console.log(`  [@${handle} -> s${id}] ${points} pts (${result?.tweetCount || 0} tweets)`);
        } catch (err) {
            console.error(`  [@${handle} -> s${id}] FAILED: ${err.message}`);
            // keep scores[`s${id}`] = 0, continue
        }
    }

    // Re-read store right before writing (minimize race with concurrent reads).
    const latest = loadStore();
    latest[date] = scores;
    saveStore(latest);
    console.log(`[daily-scorer] Wrote ${date} entry to ${SCORES_FILE}`);

    return { date, scores };
}

module.exports = {
    runDailyScorer,
    getDailyScores,
    getLatestScores,
    getAggregatedScores,
    todayKey,
};
