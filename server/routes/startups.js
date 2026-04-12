const express = require('express');
const router = express.Router();
const {
    getDailyScores,
    getLatestScores,
    getAggregatedScores,
} = require('../services/daily-scorer');

/**
 * GET /api/startups/scores/daily?days=10
 * Last N days of per-startup totals. Newest first.
 */
router.get('/scores/daily', (req, res) => {
    try {
        const days = Math.max(1, Math.min(parseInt(req.query.days) || 10, 90));
        res.json({ success: true, data: getDailyScores(days) });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/startups/scores/latest
 * Today's entry (or most recent if today hasn't scored yet).
 */
router.get('/scores/latest', (req, res) => {
    try {
        res.json({ success: true, data: getLatestScores() });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/startups/scores/aggregated?days=10
 * Sum per startup over last N days: { s1: n, ..., s19: n }.
 */
router.get('/scores/aggregated', (req, res) => {
    try {
        const days = Math.max(1, Math.min(parseInt(req.query.days) || 10, 90));
        res.json({ success: true, data: getAggregatedScores(days), days });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
