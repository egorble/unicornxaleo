const express = require('express');
const router = express.Router();
const { execSync } = require('child_process');
const path = require('path');
const { readMapping } = require('../services/aleo');
const config = require('../config');

const HASH_HELPER_DIR = path.resolve(__dirname, '..', '..', 'contracts', 'hash_helper');

// In-memory cache for commitments (cardId:salt:level → commitment)
const commitmentCache = new Map();
// In-memory cache for alive status (commitment → { alive: bool, checkedAt: number })
const aliveCache = new Map();
const ALIVE_CACHE_TTL = 300000; // 5 minutes — reduces Aleo API load

/**
 * Compute card commitment via hash_helper Leo program (local, no deploy needed).
 */
function computeCardCommitment(card_id, card_owner, startup_id, rarity, level, salt) {
  const cacheKey = `${card_id}:${card_owner}:${startup_id}:${rarity}:${level}:${salt}`;
  if (commitmentCache.has(cacheKey)) return commitmentCache.get(cacheKey);
  const cmd = `${config.LEO_PATH} run compute_card_commitment "${card_id}" "${card_owner}" "${startup_id}" "${rarity}" "${level}" "${salt}"`;
  try {
    const stdout = execSync(cmd, {
      cwd: HASH_HELPER_DIR,
      timeout: 30000,
      encoding: 'utf8',
      env: { ...process.env, PATH: `${process.env.HOME}/.cargo/bin:${process.env.PATH}` },
    });
    const m = stdout.match(/•\s*(\d+field)/);
    const commitment = m ? m[1] : null;
    if (commitment) commitmentCache.set(cacheKey, commitment);
    return commitment;
  } catch (err) {
    console.error('[cards] computeCardCommitment failed:', err.message?.slice(0, 200));
    return null;
  }
}

/**
 * GET /api/cards/startup/:id
 * Get startup info by ID (1-19).
 */
router.get('/startup/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const startup = config.STARTUPS.find(s => s.id === id);
  if (!startup) return res.status(404).json({ error: 'Invalid startup ID' });

  const rarityNames = ['Common', 'Rare', 'Epic', 'Legendary'];
  const multipliers = [1, 3, 5, 10];

  res.json({
    ...startup,
    rarityName: rarityNames[startup.rarity],
    baseMultiplier: multipliers[startup.rarity],
  });
});

/**
 * GET /api/cards/editions/:startupId
 * Get total editions minted for a startup.
 */
router.get('/editions/:startupId', async (req, res) => {
  try {
    const ed = await readMapping('startup_editions', `${req.params.startupId}u8`);
    res.json({ startup_id: parseInt(req.params.startupId), editions: ed ? parseInt(ed.replace(/[u"\d]*$/g, '').replace(/"/g, '')) : 0 });
  } catch (err) {
    res.json({ startup_id: parseInt(req.params.startupId), editions: 0 });
  }
});

/**
 * GET /api/cards/total
 * Get total cards minted.
 */
router.get('/total', async (req, res) => {
  try {
    const total = await readMapping('total_cards_minted', '0u8');
    const val = total ? parseInt(total.replace('u32', '').replace(/"/g, '')) : 0;
    res.json({ total: val, max: 50000 });
  } catch (err) {
    res.json({ total: 0, max: 50000 });
  }
});

/**
 * GET /api/cards/exists/:cardId
 * Check if a card ID exists.
 */
router.get('/exists/:cardId', async (req, res) => {
  try {
    const exists = await readMapping('card_exists', `${req.params.cardId}field`);
    res.json({ card_id: req.params.cardId, exists: exists === 'true' || exists === '"true"' });
  } catch (err) {
    res.json({ card_id: req.params.cardId, exists: false });
  }
});

/**
 * POST /api/cards/address-hash
 * Compute BHP256::hash_to_field(addr as field) for mapping lookups.
 */
router.post('/address-hash', (req, res) => {
  try {
    const { address } = req.body;
    if (!address || !address.startsWith('aleo1')) {
      return res.status(400).json({ error: 'valid address required' });
    }
    const cmd = `${config.LEO_PATH} run hash_address "${address}"`;
    const stdout = execSync(cmd, {
      cwd: HASH_HELPER_DIR,
      timeout: 30000,
      encoding: 'utf8',
      env: { ...process.env, PATH: `${process.env.HOME}/.cargo/bin:${process.env.PATH}` },
    });
    const m = stdout.match(/•\s*(\d+field)/);
    res.json({ hash: m ? m[1] : null });
  } catch (err) {
    console.error('[cards/address-hash] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/cards/alive
 * Check which cards are still alive on-chain.
 * Body: { cards: [{ card_id, card_owner, startup_id, rarity, level, salt }, ...] }
 * Returns: { alive: ["rawId1"], dead: ["rawId2"] }
 */
router.post('/alive', async (req, res) => {
  try {
    const { cards } = req.body;
    if (!Array.isArray(cards) || cards.length === 0) {
      return res.status(400).json({ error: 'cards array required' });
    }

    // Process all cards in parallel
    const now = Date.now();
    const results = await Promise.all(cards.map(async (c) => {
      const cid = String(c.card_id).endsWith('field') ? c.card_id : `${c.card_id}field`;
      const sid = String(c.startup_id).endsWith('u8') ? c.startup_id : `${c.startup_id}u8`;
      const rid = String(c.rarity).endsWith('u8') ? c.rarity : `${c.rarity}u8`;
      const lid = String(c.level).endsWith('u8') ? c.level : `${c.level}u8`;
      const sal = String(c.salt).endsWith('field') ? c.salt : `${c.salt}field`;
      const rawId = String(c.card_id).replace('field', '');

      const commitment = computeCardCommitment(cid, c.card_owner, sid, rid, lid, sal);
      if (!commitment) return { rawId, alive: true };

      // Check cache first (only cached if we got a definitive answer)
      const cached = aliveCache.get(commitment);
      if (cached && (now - cached.checkedAt) < ALIVE_CACHE_TTL) {
        return { rawId, alive: cached.alive };
      }

      try {
        const value = await readMapping('cards', commitment);
        // null = commitment not in mapping = truly dead
        // non-null = commitment exists = alive
        const isAlive = value !== null && value !== undefined;
        aliveCache.set(commitment, { alive: isAlive, checkedAt: now });
        return { rawId, alive: isAlive };
      } catch (err) {
        // API error → don't cache, assume alive (safer than hiding real cards)
        console.warn(`[cards/alive] readMapping error for ${rawId}: ${err.message}`);
        return { rawId, alive: true };
      }
    }));

    const alive = results.filter(r => r.alive).map(r => r.rawId);
    const dead = results.filter(r => !r.alive).map(r => r.rawId);

    console.log(`[cards/alive] ${alive.length} alive, ${dead.length} dead (cache size: ${aliveCache.size})`);
    if (dead.length > 0) {
      console.log('[cards/alive] DEAD cards:');
      for (const r of results.filter(r => !r.alive)) {
        const c = cards.find(cc => String(cc.card_id).replace('field', '') === r.rawId);
        console.log(`  - rawId=${r.rawId}, startup=${c?.startup_id}, rarity=${c?.rarity}, level=${c?.level}, salt=${c?.salt}, owner=${c?.card_owner}`);
      }
    }
    if (alive.length > 0) {
      console.log('[cards/alive] ALIVE cards:');
      for (const r of results.filter(r => r.alive)) {
        const c = cards.find(cc => String(cc.card_id).replace('field', '') === r.rawId);
        console.log(`  - rawId=${r.rawId}, startup=${c?.startup_id}, level=${c?.level}`);
      }
    }
    res.json({ alive, dead });
  } catch (err) {
    console.error('[cards/alive] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
