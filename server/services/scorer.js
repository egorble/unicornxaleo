const config = require('../config');
const { executeTransition, readMapping, getBlockHeight } = require('./aleo');
const path = require('path');

// ─── Twitter scorer import (from original UnicornX) ─────────────────────
// The twitter-league-scorer.js is an ESM module — we lazy-import it.
let twitterScorer = null;
async function getTwitterScorer() {
  if (twitterScorer) return twitterScorer;
  try {
    const scorerPath = path.resolve(__dirname, '../jobs/twitter-league-scorer.js');
    twitterScorer = await import(`file:///${scorerPath.replace(/\\/g, '/')}`);
    return twitterScorer;
  } catch (e) {
    console.warn('[scorer] Twitter scorer not available, using simulated scores:', e.message);
    return null;
  }
}

// Startup name → startup_id (1-19) mapping
const STARTUP_NAME_TO_ID = {};
config.STARTUPS.forEach(s => { STARTUP_NAME_TO_ID[s.name] = s.id; });

/**
 * Fetch Twitter engagement scores for all 19 startups.
 * Uses the real Twitter API scorer from the original UnicornX if available,
 * falls back to simulated scores.
 *
 * @returns {object} StartupScores struct values { s1..s19 }
 */
async function fetchTwitterScores() {
  const scorer = await getTwitterScorer();

  if (scorer && scorer.processStartupForDate && scorer.STARTUP_MAPPING) {
    // ── Real Twitter scoring ──
    console.log('[scorer] Using real Twitter API scorer...');
    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const dateStr = yesterday.toISOString().split('T')[0]; // YYYY-MM-DD

    if (scorer.setLogContext) scorer.setLogContext(dateStr);
    if (scorer.aiStats?.reset) scorer.aiStats.reset();

    const scores = {};
    for (const [handle, startupName] of Object.entries(scorer.STARTUP_MAPPING)) {
      const startupId = STARTUP_NAME_TO_ID[startupName];
      if (!startupId) continue;

      try {
        const result = await scorer.processStartupForDate(handle, dateStr);
        const totalScore = result?.totalScore || result?.score || 0;
        scores[`s${startupId}`] = Math.max(1, Math.floor(totalScore));
        console.log(`  [scorer] ${startupName} (@${handle}): ${scores[`s${startupId}`]} points`);
      } catch (e) {
        console.warn(`  [scorer] ${startupName} (@${handle}): failed — ${e.message}`);
        scores[`s${startupId}`] = 1; // Minimum score
      }
    }

    // Fill missing startups with minimum
    for (let i = 1; i <= 19; i++) {
      if (!scores[`s${i}`]) scores[`s${i}`] = 1;
    }

    // Log AI stats if available
    if (scorer.aiStats) {
      console.log('[scorer] AI stats:', JSON.stringify(scorer.aiStats, null, 2));
    }

    return scores;
  }

  // ── Fallback: simulated scores ──
  console.log('[scorer] Using simulated scores (Twitter API not available)...');
  const baseScores = {
    1: 5000, 2: 4200, 3: 8500, 4: 12000, 5: 11000,  // Legendary
    6: 3800, 7: 2100, 8: 1900,                         // Epic
    9: 1500, 10: 800, 11: 600, 12: 400, 13: 350,       // Rare
    14: 200, 15: 180, 16: 150, 17: 120, 18: 100, 19: 80 // Common
  };
  const scores = {};
  for (let i = 1; i <= 19; i++) {
    const variance = 0.7 + Math.random() * 0.6;
    scores[`s${i}`] = Math.floor(baseScores[i] * variance);
  }
  return scores;
}

/**
 * Submit startup scores to the tournament on-chain.
 */
async function setStartupScores(tournamentId, scores) {
  const scoresStruct = `{ s1: ${scores.s1}u64, s2: ${scores.s2}u64, s3: ${scores.s3}u64, s4: ${scores.s4}u64, s5: ${scores.s5}u64, s6: ${scores.s6}u64, s7: ${scores.s7}u64, s8: ${scores.s8}u64, s9: ${scores.s9}u64, s10: ${scores.s10}u64, s11: ${scores.s11}u64, s12: ${scores.s12}u64, s13: ${scores.s13}u64, s14: ${scores.s14}u64, s15: ${scores.s15}u64, s16: ${scores.s16}u64, s17: ${scores.s17}u64, s18: ${scores.s18}u64, s19: ${scores.s19}u64 }`;
  return executeTransition('set_startup_scores', [tournamentId, scoresStruct]);
}

/**
 * Finalize a tournament.
 */
async function finalizeTournament(tournamentId) {
  return executeTransition('finalize_tournament', [tournamentId]);
}

/**
 * Distribute prize to a winner.
 */
async function distributePrize(creditsRecord, winner, amount, tournamentId) {
  return executeTransition('distribute_prize', [
    creditsRecord,
    winner,
    `${amount}u64`,
    tournamentId,
  ]);
}

/**
 * Run the daily scoring job for an active tournament.
 * 1. Fetches Twitter engagement for all 19 startups (real API or simulated)
 * 2. Submits scores to Aleo blockchain via set_startup_scores
 * 3. Players then call calculate_score with their private lineup → ZK proof
 */
async function runDailyScorer(tournamentId) {
  console.log(`[scorer] ════════════════════════════════════════`);
  console.log(`[scorer] Running daily scorer for tournament ${tournamentId}`);
  console.log(`[scorer] ════════════════════════════════════════`);

  const scores = await fetchTwitterScores();
  console.log('[scorer] Final scores:', scores);

  const result = await setStartupScores(tournamentId, scores);
  if (result.success) {
    console.log('[scorer] ✅ Scores submitted on-chain successfully.');
    console.log('[scorer] Players can now call calculate_score with their private lineup.');
    console.log('[scorer] Nobody can see which cards they picked — ZK proof guarantees privacy.');
  } else {
    console.error('[scorer] ❌ Failed to submit scores:', result.output);
  }
  return { scores, result };
}

module.exports = { fetchTwitterScores, setStartupScores, finalizeTournament, distributePrize, runDailyScorer };
