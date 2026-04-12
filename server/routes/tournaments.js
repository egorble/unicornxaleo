const express = require('express');
const router = express.Router();
const { readMapping, getBlockHeight, executeTransition } = require('../services/aleo');
const { runDailyScorer, finalizeTournament, distributePrize } = require('../services/scorer');
const config = require('../config');

// Auth middleware for admin routes
function adminAuth(req, res, next) {
  const key = req.headers['x-admin-key'];
  if (key !== config.ADMIN_API_KEY) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  next();
}

/**
 * GET /api/tournaments/:id
 * Get tournament data from on-chain mapping.
 */
router.get('/:id', async (req, res) => {
  try {
    const data = await readMapping('tournaments', `${req.params.id}field`);
    if (!data) return res.status(404).json({ error: 'Tournament not found' });

    // Parse the struct string
    const parsed = {};
    const fields = data.replace(/[{}"]/g, '').split(',');
    for (const f of fields) {
      const [key, val] = f.split(':').map(s => s.trim());
      if (key && val) {
        parsed[key] = val.replace(/u\d+$/, '');
      }
    }

    const blockHeight = await getBlockHeight();
    let phase = 'Upcoming';
    if (parsed.status === '3') phase = 'Cancelled';
    else if (parsed.status === '2') phase = 'Finalized';
    else if (blockHeight >= parseInt(parsed.start_height)) phase = 'Active';
    else if (blockHeight >= parseInt(parsed.registration_height)) phase = 'Registration';

    res.json({ ...parsed, phase, currentBlockHeight: blockHeight });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/tournaments/:id/leaderboard
 * Returns player scores for a tournament.
 * Note: Scores are public on-chain. Frontend queries them via mapping reads.
 */
router.get('/:id/leaderboard', async (req, res) => {
  try {
    const totalScore = await readMapping('total_tournament_score', `${req.params.id}field`);
    res.json({
      tournament_id: req.params.id,
      total_score: totalScore ? parseInt(totalScore.replace(/[u"\d]*$/g, '').replace(/"/g, '')) : 0,
      note: 'Individual scores are read from player_score mapping using hash(PlayerTournament{tournament_id, player})',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/tournaments/:id/run-scorer
 * Admin: Run the daily scorer for a tournament.
 */
router.post('/:id/run-scorer', adminAuth, async (req, res) => {
  try {
    const result = await runDailyScorer(`${req.params.id}field`);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/tournaments/:id/finalize
 * Admin: Finalize a tournament.
 */
router.post('/:id/finalize', adminAuth, async (req, res) => {
  try {
    const result = await finalizeTournament(`${req.params.id}field`);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/tournaments/:id/distribute-prize
 * Admin: Distribute prize to a winner.
 * Body: { creditsRecord, winner, amount }
 */
router.post('/:id/distribute-prize', adminAuth, async (req, res) => {
  try {
    const { creditsRecord, winner, amount } = req.body;
    const result = await distributePrize(creditsRecord, winner, amount, `${req.params.id}field`);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/tournaments/:id/scores
 * Get startup scores hash (to verify client-side calculation).
 */
router.get('/:id/scores', async (req, res) => {
  try {
    const hash = await readMapping('scores_hash', `${req.params.id}field`);
    res.json({ tournament_id: req.params.id, scores_hash: hash });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── SCORE STORE ──────────────────────────────────────────────────────
// Daily + final per-startup scores. For the hackathon demo we keep them
// in-memory seeded with test data; a real deploy would persist to disk
// or a DB and update from the Twitter scorer service.

const _tournamentScores = new Map();
// Seed tournament #2 (test data we already published on-chain via CLI).
_tournamentScores.set(2, {
  final: { s1: 1000, s2: 900, s3: 800, s4: 700, s5: 600, s6: 550, s7: 500, s8: 450, s9: 400, s10: 350, s11: 300, s12: 250, s13: 200, s14: 150, s15: 120, s16: 100, s17: 80, s18: 60, s19: 40 },
  daily: [
    // Day 1 (simulated): roughly half of final; Day 2: rest.
    { day: 1, scores: { s1: 500, s2: 450, s3: 400, s4: 350, s5: 300, s6: 280, s7: 250, s8: 230, s9: 200, s10: 180, s11: 150, s12: 125, s13: 100, s14: 75, s15: 60, s16: 50, s17: 40, s18: 30, s19: 20 } },
    { day: 2, scores: { s1: 500, s2: 450, s3: 400, s4: 350, s5: 300, s6: 270, s7: 250, s8: 220, s9: 200, s10: 170, s11: 150, s12: 125, s13: 100, s14: 75, s15: 60, s16: 50, s17: 40, s18: 30, s19: 20 } },
  ],
});

/**
 * GET /api/tournaments/:id/final-scores
 * Returns the StartupScores object (plaintext) that the admin published on-chain.
 * Frontend hashes it client-side to verify vs scores_hash before calling calculate_score.
 */
router.get('/:id/final-scores', async (req, res) => {
  const tid = parseInt(req.params.id);
  const rec = _tournamentScores.get(tid);
  if (!rec) return res.status(404).json({ error: 'Final scores not published for this tournament' });
  res.json({ tournament_id: tid, scores: rec.final });
});

/**
 * GET /api/tournaments/:id/daily-scores
 * Returns day-by-day per-startup scores (public, updated during the tournament).
 * Not written on-chain — only the final aggregate is.
 */
router.get('/:id/daily-scores', async (req, res) => {
  const tid = parseInt(req.params.id);
  const rec = _tournamentScores.get(tid);
  if (!rec) return res.json({ tournament_id: tid, days: [] });
  res.json({ tournament_id: tid, days: rec.daily || [] });
});

/**
 * POST /api/admin/tournaments/:id/final-scores
 * Admin: set the final scores that will be published on-chain.
 * Body: { scores: { s1..s19 } }
 * Does NOT broadcast set_startup_scores — use a separate admin action / CLI for that.
 */
router.post('/:id/final-scores', adminAuth, async (req, res) => {
  const tid = parseInt(req.params.id);
  const scores = req.body && req.body.scores;
  if (!scores) return res.status(400).json({ error: 'Missing scores body' });
  const existing = _tournamentScores.get(tid) || { daily: [] };
  _tournamentScores.set(tid, { ...existing, final: scores });
  res.json({ ok: true, tournament_id: tid, scores });
});

/**
 * GET /api/startups
 * Get all 19 startups info.
 */
router.get('/info/startups', async (req, res) => {
  res.json(config.STARTUPS);
});

module.exports = router;
