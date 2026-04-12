const express = require('express');
const router = express.Router();
const { generateRecommendation } = require('../services/ai-recommender');
const { getAggregatedScores } = require('../services/daily-scorer');

/**
 * POST /api/ai/card-recommendation
 *
 * Body:
 *   {
 *     address:       string,                              // player address (informational)
 *     cards:         [{ startupId, level, tokenId?, ... }],
 *     startupScores: { s1..s19: number }                  // optional — we fallback to stored daily scores
 *   }
 *
 * On Aleo the player's card list is private, so the FRONTEND must provide it.
 * If `startupScores` is omitted we aggregate the last 10 days of stored daily
 * scores from disk.
 */
router.post('/card-recommendation', async (req, res) => {
    try {
        const { address, cards, startupScores } = req.body || {};

        if (!address || typeof address !== 'string') {
            return res.status(400).json({ success: false, error: 'address required' });
        }
        if (!Array.isArray(cards)) {
            return res.status(400).json({ success: false, error: 'cards array required' });
        }

        // Fall back to backend-stored daily activity when frontend omits it.
        let scores = startupScores;
        if (!scores || typeof scores !== 'object') {
            scores = getAggregatedScores(10);
        }

        const recommendation = await generateRecommendation(cards, scores);
        return res.json({ success: true, data: recommendation });
    } catch (error) {
        console.error('[AI Recommender] Endpoint error:', error.message);
        return res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
