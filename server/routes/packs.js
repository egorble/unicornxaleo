const express = require('express');
const router = express.Router();
const { fulfillOpenPack } = require('../services/pack-fulfiller');
const { readMapping } = require('../services/aleo');
const config = require('../config');

/**
 * POST /api/packs/fulfill-open
 * v5: Called by frontend after buy_pack succeeds.
 * Backend mints 5 random cards to the player via mint_card.
 *
 * Body: { player: "aleo1..." }
 */
router.post('/fulfill-open', async (req, res) => {
  try {
    const { player } = req.body;
    if (!player || !player.startsWith('aleo1')) {
      return res.status(400).json({ error: 'Valid player address is required' });
    }

    console.log(`[packs] Fulfilling pack for player ${player}...`);
    const result = await fulfillOpenPack(player);

    if (result.success) {
      res.json({
        success: true,
        txId: result.txId,
        cards: result.cards,
        message: 'Pack opened! 5 cards minted.',
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Failed to mint cards',
        details: result.output,
      });
    }
  } catch (err) {
    console.error('[packs] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/packs/price
 * Returns current pack price.
 */
router.get('/price', async (req, res) => {
  try {
    const price = await readMapping('pack_price', '0u8');
    const priceVal = price ? parseInt(price.replace('u64', '').replace(/"/g, '')) : 100000;
    res.json({ price: priceVal, priceAleo: priceVal / 1000000 });
  } catch (err) {
    res.json({ price: 100000, priceAleo: 0.1 });
  }
});

/**
 * GET /api/packs/sold
 * Returns total packs sold.
 */
router.get('/sold', async (req, res) => {
  try {
    const sold = await readMapping('total_packs_sold', '0u8');
    const val = sold ? parseInt(sold.replace('u32', '').replace(/"/g, '')) : 0;
    res.json({ sold: val, max: 10000 });
  } catch (err) {
    res.json({ sold: 0, max: 10000 });
  }
});

module.exports = router;
