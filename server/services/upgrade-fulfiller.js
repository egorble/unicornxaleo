const crypto = require('crypto');
const config = require('../config');
const { executeTransition } = require('./aleo');

/**
 * Determine upgrade success based on current level.
 * Level 1→2: 80%, Level 2→3: 70%, Level 3→4: 60%, Level 4→5: 50%
 *
 * @param {number} currentLevel - Card's current level (1-4)
 * @returns {boolean} Whether the upgrade succeeds
 */
function rollUpgrade(currentLevel) {
  const chance = config.UPGRADE_CHANCES[currentLevel];
  if (!chance) return false; // level 5 can't upgrade
  const roll = crypto.randomInt(10000); // 0-9999
  return roll < chance;
}

/**
 * Fulfill an upgrade request.
 * Admin determines success/failure based on random roll, then executes the transition.
 *
 * @param {string} upgradeRequestPlaintext - The UpgradeRequest record plaintext
 * @param {number} currentLevel - Card's current level
 * @returns {object} Result with success, upgraded flag, and tx details
 */
async function fulfillUpgrade(upgradeRequestPlaintext, currentLevel) {
  const success = rollUpgrade(currentLevel);

  const inputs = [upgradeRequestPlaintext, success ? 'true' : 'false'];

  const result = executeTransition('fulfill_upgrade', inputs);

  return {
    ...result,
    upgraded: success,
    newLevel: success ? currentLevel + 1 : null,
    message: success
      ? `Upgrade successful! Level ${currentLevel} → ${currentLevel + 1}`
      : `Upgrade failed! Card burned. (${config.UPGRADE_CHANCES[currentLevel] / 100}% chance)`,
  };
}

module.exports = { fulfillUpgrade, rollUpgrade };
