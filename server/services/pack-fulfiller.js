const crypto = require('crypto');
const { execSync } = require('child_process');
const path = require('path');
const config = require('../config');
const { executeTransition, readMapping } = require('./aleo');

const HASH_HELPER_DIR = path.resolve(__dirname, '..', '..', 'contracts', 'hash_helper');

/**
 * Compute hash of address for mapping lookup.
 */
function hashAddress(address) {
  const cmd = `${config.LEO_PATH} run hash_address "${address}"`;
  try {
    const stdout = execSync(cmd, {
      cwd: HASH_HELPER_DIR,
      timeout: 30000,
      encoding: 'utf8',
      env: { ...process.env, PATH: `${process.env.HOME}/.cargo/bin:${process.env.PATH}` },
    });
    const m = stdout.match(/•\s*(\d+field)/);
    return m ? m[1] : null;
  } catch { return null; }
}

/**
 * Compute pack_id = BHP256::hash_to_field(caller as field + salt)
 * Uses local hash_helper Leo program (no deployment needed).
 */
function computePackId(player, salt) {
  const cmd = `${config.LEO_PATH} run compute_pack_id "${player}" "${salt}"`;
  try {
    const stdout = execSync(cmd, {
      cwd: HASH_HELPER_DIR,
      timeout: 30000,
      encoding: 'utf8',
      env: { ...process.env, PATH: `${process.env.HOME}/.cargo/bin:${process.env.PATH}` },
    });
    const m = stdout.match(/•\s*(\d+field)/);
    return m ? m[1] : null;
  } catch (err) {
    console.error('[pack-fulfiller] computePackId failed:', err.message);
    return null;
  }
}

/**
 * Generate 5 random cards for a pack opening.
 * Distribution: 70% Common (14-19), 25% Rare (9-13), 5% Epic (6-8), 0% Legendary
 */
function generatePackCards() {
  const cards = [];

  for (let i = 0; i < 5; i++) {
    const roll = crypto.randomInt(100);
    let startupId, rarity;

    if (roll < config.RARITY_THRESHOLDS.COMMON) {
      rarity = 0;
      startupId = 14 + crypto.randomInt(6);
    } else if (roll < config.RARITY_THRESHOLDS.RARE) {
      rarity = 1;
      startupId = 9 + crypto.randomInt(5);
    } else {
      rarity = 2;
      startupId = 6 + crypto.randomInt(3);
    }

    const cardIdBytes = crypto.randomBytes(16);
    const cardId = BigInt('0x' + cardIdBytes.toString('hex')) % BigInt('8444461749428370424248824938781546531375899335154063827935233455917409239040');

    const saltBytes = crypto.randomBytes(16);
    const salt = BigInt('0x' + saltBytes.toString('hex')) % BigInt('8444461749428370424248824938781546531375899335154063827935233455917409239040');

    cards.push({
      card_id: `${cardId}field`,
      startup_id: `${startupId}u8`,
      rarity: `${rarity}u8`,
      salt: `${salt}field`,
    });
  }

  return cards;
}

/**
 * Fulfill a pack opening using open_pack (3 cards) + open_pack_2 (2 cards).
 * Only 2 transactions instead of 5.
 *
 * @param {string} player - Player's Aleo address
 * @param {string} salt - Salt used in buy_pack (for pack_id computation)
 * @returns {object} Result with success flag and card details
 */
async function fulfillOpenPack(player) {
  if (!player || !player.startsWith('aleo1')) {
    return { success: false, output: 'Invalid player address' };
  }

  // v9: Check open_requests >= 1 before trying to fulfill
  const playerHash = hashAddress(player);
  if (playerHash) {
    const requests = await readMapping('open_requests', playerHash);
    const reqCount = requests ? parseInt(String(requests).replace(/u\d+|"/g, '')) : 0;
    if (reqCount < 1) {
      console.log(`[pack-fulfiller] No open_requests for ${player} (count=${reqCount})`);
      return { success: false, output: 'No pending open request. Sign request_open_pack first.' };
    }
    console.log(`[pack-fulfiller] ${player} has ${reqCount} open_requests, fulfilling...`);
  }

  const cards = generatePackCards();

  console.log('[pack-fulfiller] v9: 1 transaction for 5 cards');

  const inputs = [
    player,
    `{ card_id: ${cards[0].card_id}, startup_id: ${cards[0].startup_id}, rarity: ${cards[0].rarity}, salt: ${cards[0].salt} }`,
    `{ card_id: ${cards[1].card_id}, startup_id: ${cards[1].startup_id}, rarity: ${cards[1].rarity}, salt: ${cards[1].salt} }`,
    `{ card_id: ${cards[2].card_id}, startup_id: ${cards[2].startup_id}, rarity: ${cards[2].rarity}, salt: ${cards[2].salt} }`,
    `{ card_id: ${cards[3].card_id}, startup_id: ${cards[3].startup_id}, rarity: ${cards[3].rarity}, salt: ${cards[3].salt} }`,
    `{ card_id: ${cards[4].card_id}, startup_id: ${cards[4].startup_id}, rarity: ${cards[4].rarity}, salt: ${cards[4].salt} }`,
  ];

  console.log('[pack-fulfiller] Executing open_pack...');
  const result = executeTransition('open_pack', inputs);
  if (!result.success) {
    console.error('[pack-fulfiller] open_pack failed:', result.output?.slice(0, 300));
    return { success: false, output: `open_pack failed: ${result.output?.slice(0, 300)}`, cards: [] };
  }
  console.log(`[pack-fulfiller] open_pack OK: tx=${result.txId}`);

  return {
    success: true,
    txId: result.txId,
    cards: cards.map(c => ({
      card_id: c.card_id,
      startup_id: parseInt(c.startup_id),
      rarity: parseInt(c.rarity),
      salt: c.salt,
      startup_name: config.STARTUPS.find(s => s.id === parseInt(c.startup_id))?.name,
    })),
  };
}

module.exports = { fulfillOpenPack, generatePackCards };
