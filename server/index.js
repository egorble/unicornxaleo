const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const config = require('./config');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// ─── Stub endpoints (registered BEFORE the tournaments router so :id route doesn't shadow them) ───
// In-memory user store (replace with DB later)
const userStore = new Map();

// Get user profile by address
app.get('/api/users/:address', (req, res) => {
  const addr = req.params.address.toLowerCase();
  const cached = userStore.get(addr);
  if (cached) {
    return res.json({ success: true, data: cached });
  }
  // Not registered yet — return success:false so UI shows registration modal
  res.json({ success: false, data: null });
});

// Register new user
app.post('/api/users/register', (req, res) => {
  const { address, username, avatar, referrer } = req.body || {};
  if (!address) {
    return res.json({ success: false, error: 'address required' });
  }
  const addr = address.toLowerCase();
  const isNew = !userStore.has(addr);
  const profile = {
    address: addr,
    username: username || addr.slice(0, 12),
    avatar: avatar || null,
    referrer: referrer || null,
    createdAt: isNew ? Date.now() : (userStore.get(addr)?.createdAt || Date.now()),
  };
  userStore.set(addr, profile);
  res.json({ success: true, data: profile, isNew });
});

// Update profile
app.put('/api/users/:address', (req, res) => {
  const addr = req.params.address.toLowerCase();
  const { username, avatar } = req.body || {};
  const existing = userStore.get(addr) || { address: addr };
  const updated = { ...existing, username: username || existing.username, avatar: avatar || existing.avatar };
  userStore.set(addr, updated);
  res.json({ success: true, data: updated });
});

// Active tournament — return tournament 2 by default
app.get('/api/tournaments/active', async (req, res) => {
  const { readMapping, getBlockHeight } = require('./services/aleo');
  try {
    const data = await readMapping('tournaments', '2field');
    if (!data) return res.json({ id: 2, status: 'none' });
    const blockHeight = await getBlockHeight();
    const get = (k) => {
      const m = data.match(new RegExp(`${k}:\\s*(\\d+)u\\d+`));
      return m ? parseInt(m[1]) : 0;
    };
    res.json({
      id: 2,
      registrationStart: get('registration_height'),
      startTime: get('start_height'),
      endTime: get('end_height'),
      status: get('status'),
      entryCount: get('entry_count'),
      prizePool: get('prize_pool'),
      blockHeight,
    });
  } catch (err) {
    res.json({ id: 2, status: 'none' });
  }
});

// Active tournaments list
app.get('/api/tournaments', (req, res) => res.json([]));

// Contracts info (frontend cache check)
app.get('/api/contracts', (req, res) => {
  res.json({
    program: config.PROGRAM_ID,
    network: config.NETWORK,
    admin: config.ADMIN_ADDRESS,
  });
});

// Leaderboard (empty stub)
app.get('/api/leaderboard/:tournamentId', (req, res) => {
  res.json({ tournamentId: req.params.tournamentId, leaderboard: [] });
});

// Live feed (empty stub)
app.get('/api/feed', (req, res) => res.json([]));
app.get('/api/live-feed', (req, res) => res.json([]));

// Top startups (stub)
app.get('/api/top-startups', (req, res) => {
  res.json(config.STARTUPS.map(s => ({ ...s, score: 0, change: 0 })));
});

// Card scores by address (stub)
app.get('/api/card-scores/:address', (req, res) => {
  res.json({ address: req.params.address, scores: [] });
});

// Routes (registered AFTER stubs so /active and /info don't get caught by /:id)
app.use('/api/packs', require('./routes/packs'));
app.use('/api/upgrades', require('./routes/upgrades'));
app.use('/api/tournaments', require('./routes/tournaments'));
app.use('/api/cards', require('./routes/cards'));

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    program: config.PROGRAM_ID,
    network: config.NETWORK,
    admin: config.ADMIN_ADDRESS,
  });
});

// Info endpoint
app.get('/api/info', async (req, res) => {
  const { readMapping, getBlockHeight } = require('./services/aleo');
  try {
    const [blockHeight, packsSold, totalCards] = await Promise.all([
      getBlockHeight(),
      readMapping('total_packs_sold', '0u8'),
      readMapping('total_cards_minted', '0u8'),
    ]);
    res.json({
      program: config.PROGRAM_ID,
      network: config.NETWORK,
      blockHeight,
      packsSold: packsSold ? parseInt(String(packsSold).replace(/[u"\d]*$/g, '').replace(/"/g, '')) : 0,
      totalCards: totalCards ? parseInt(String(totalCards).replace(/[u"\d]*$/g, '').replace(/"/g, '')) : 0,
      packPrice: '0.1 ALEO',
      maxPacks: 10000,
      maxCards: 50000,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Daily scorer cron — runs at 00:00 UTC
// Uncomment and set ACTIVE_TOURNAMENT_ID when a tournament is running
// cron.schedule('0 0 * * *', async () => {
//   const { runDailyScorer } = require('./services/scorer');
//   console.log('[cron] Running daily scorer...');
//   await runDailyScorer('2field'); // Replace with active tournament ID
// });

// Start server
app.listen(config.PORT, () => {
  console.log(`
╔══════════════════════════════════════════════╗
║      UnicornX Backend Server v2            ║
╠══════════════════════════════════════════════╣
║  Port:     ${config.PORT}                            ║
║  Program:  ${config.PROGRAM_ID}          ║
║  Network:  ${config.NETWORK}                         ║
╠══════════════════════════════════════════════╣
║  Endpoints:                                  ║
║  POST /api/packs/fulfill-open                ║
║  POST /api/upgrades/fulfill                  ║
║  POST /api/tournaments/:id/run-scorer        ║
║  POST /api/tournaments/:id/finalize          ║
║  GET  /api/info                              ║
║  GET  /api/packs/price                       ║
║  GET  /api/packs/sold                        ║
║  GET  /api/cards/total                       ║
║  GET  /api/tournaments/:id                   ║
╚══════════════════════════════════════════════╝
  `);
});
