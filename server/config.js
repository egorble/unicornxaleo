require('dotenv').config();

module.exports = {
  PORT: process.env.PORT || 5170,
  ADMIN_PRIVATE_KEY: process.env.ADMIN_PRIVATE_KEY,
  ADMIN_ADDRESS: process.env.ADMIN_ADDRESS,
  PROGRAM_ID: process.env.PROGRAM_ID || 'unicornx_v3.aleo',
  NETWORK: process.env.NETWORK || 'testnet',
  ENDPOINT: process.env.ENDPOINT || 'https://api.explorer.provable.com/v1',
  LEO_PATH: process.env.LEO_PATH || 'leo',
  CONTRACT_PATH: process.env.CONTRACT_PATH || '../contracts/unicornx_v3',
  ADMIN_API_KEY: process.env.ADMIN_API_KEY,

  // 19 startups
  STARTUPS: [
    { id: 1, name: 'Openclaw', rarity: 3 },
    { id: 2, name: 'Lovable', rarity: 3 },
    { id: 3, name: 'Cursor', rarity: 3 },
    { id: 4, name: 'OpenAI', rarity: 3 },
    { id: 5, name: 'Anthropic', rarity: 3 },
    { id: 6, name: 'Browser Use', rarity: 2 },
    { id: 7, name: 'Dedalus Labs', rarity: 2 },
    { id: 8, name: 'Autumn', rarity: 2 },
    { id: 9, name: 'Axiom', rarity: 1 },
    { id: 10, name: 'Multifactor', rarity: 1 },
    { id: 11, name: 'Dome', rarity: 1 },
    { id: 12, name: 'GrazeMate', rarity: 1 },
    { id: 13, name: 'Tornyol Systems', rarity: 1 },
    { id: 14, name: 'Pocket', rarity: 0 },
    { id: 15, name: 'Caretta', rarity: 0 },
    { id: 16, name: 'AxionOrbital Space', rarity: 0 },
    { id: 17, name: 'Freeport Markets', rarity: 0 },
    { id: 18, name: 'Ruvo', rarity: 0 },
    { id: 19, name: 'Lightberry', rarity: 0 },
  ],

  // Pack rarity distribution: 70% Common, 25% Rare, 5% Epic, 0% Legendary
  RARITY_THRESHOLDS: { COMMON: 70, RARE: 95 }, // 0-69=common, 70-94=rare, 95-99=epic

  // Upgrade chances (basis points out of 10000)
  UPGRADE_CHANCES: { 1: 8000, 2: 7000, 3: 6000, 4: 5000 }, // level -> success chance
};
