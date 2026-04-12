const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const config = require('../config');

/**
 * POST /api/upgrades/roll
 * v4: Server rolls the dice BEFORE user executes transaction.
 * Returns success/failure. User then calls upgrade_card(proof, new_salt, success).
 *
 * Body: { currentLevel: 1 }
 */
router.post('/roll', (req, res) => {
  try {
    const { currentLevel } = req.body;
    if (currentLevel == null || currentLevel < 1 || currentLevel >= 5) {
      return res.status(400).json({ error: 'Invalid level. Must be 1-4.' });
    }

    const chance = config.UPGRADE_CHANCES[currentLevel];
    const roll = crypto.randomInt(10000);
    const success = roll < chance;

    console.log(`[upgrades] Roll for level ${currentLevel}: ${roll}/${chance} → ${success ? 'SUCCESS' : 'FAIL'}`);

    res.json({
      success,
      roll,
      chance: `${chance / 100}%`,
      message: success
        ? `Upgrade will succeed! (${chance / 100}% chance)`
        : `Upgrade will fail. Card will be burned. (${chance / 100}% chance)`,
    });
  } catch (err) {
    console.error('[upgrades] Roll error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/upgrades/fulfill (legacy v3, kept for backward compat)
 */
router.post('/fulfill', async (req, res) => {
  res.json({ error: 'Use /api/upgrades/roll with v4 contract' });
});

module.exports = router;
