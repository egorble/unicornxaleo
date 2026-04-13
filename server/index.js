const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const config = require('./config');

const app = express();

// Middleware
const ALLOWED_ORIGINS = [
  'http://localhost:5171',
  'http://localhost:5170',
  'https://aleo.unicornx.fun',
  'http://aleo.unicornx.fun',
];
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // server-to-server / curl
    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    if (/^https?:\/\/localhost(:\d+)?$/.test(origin)) return cb(null, true);
    cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
}));
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

// Helpers for tournament mapping parsing
function parseTournamentField(data, key) {
  const m = data.match(new RegExp(`${key}:\\s*(\\d+)u\\d+`));
  return m ? parseInt(m[1]) : 0;
}

async function readNextTournamentId(readMapping) {
  const raw = await readMapping('next_tournament_id', '0u8');
  if (!raw) return 1;
  const m = String(raw).match(/(\d+)/);
  return m ? parseInt(m[1]) : 1;
}

// Active tournament — iterate from next_tournament_id-1 downward, first with status=0 & block<end_height
app.get('/api/tournaments/active', async (req, res) => {
  const { readMapping, getBlockHeight } = require('./services/aleo');
  try {
    const blockHeight = await getBlockHeight();
    const nextId = await readNextTournamentId(readMapping);
    let mostRecent = null;
    for (let id = nextId - 1; id >= 1; id--) {
      const data = await readMapping('tournaments', `${id}field`);
      if (!data) continue;
      const parsed = {
        id,
        registrationStart: parseTournamentField(data, 'registration_height'),
        startTime: parseTournamentField(data, 'start_height'),
        endTime: parseTournamentField(data, 'end_height'),
        status: parseTournamentField(data, 'status'),
        entryCount: parseTournamentField(data, 'entry_count'),
        prizePool: parseTournamentField(data, 'prize_pool'),
        blockHeight,
      };
      if (!mostRecent) mostRecent = parsed;
      if (parsed.status === 0 && blockHeight < parsed.endTime) {
        return res.json(parsed);
      }
    }
    if (mostRecent) return res.json(mostRecent);
    return res.json({ id: 0, status: 'none' });
  } catch (err) {
    res.json({ id: 0, status: 'none' });
  }
});

// Active tournaments list
app.get('/api/tournaments', async (req, res) => {
  const { readMapping } = require('./services/aleo');
  try {
    const nextId = await readNextTournamentId(readMapping);
    const out = [];
    for (let id = 1; id < nextId; id++) {
      const data = await readMapping('tournaments', `${id}field`);
      if (!data) continue;
      out.push({
        id,
        status: parseTournamentField(data, 'status'),
        prize_pool: parseTournamentField(data, 'prize_pool'),
        entry_count: parseTournamentField(data, 'entry_count'),
        reg_height: parseTournamentField(data, 'registration_height'),
        start_height: parseTournamentField(data, 'start_height'),
        end_height: parseTournamentField(data, 'end_height'),
      });
    }
    res.json(out);
  } catch (err) {
    res.json([]);
  }
});

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

// Feed & live-feed — backed by on-chain mappings (see routes/feed.js)
app.use('/api', require('./routes/feed'));

// Top startups — ranked by aggregated points across recent days.
// `:tournamentId` is accepted but currently ignored (single global ranking).
function topStartupsHandler(req, res) {
  const limit = Math.max(1, Math.min(50, parseInt(req.query.limit) || 5));
  const days = Math.max(1, Math.min(30, parseInt(req.query.days) || 10));
  const { getAggregatedScores } = require('./services/daily-scorer');
  const agg = getAggregatedScores(days);
  const ranked = config.STARTUPS
    .map(s => ({ name: s.name, points: Number(agg[`s${s.id}`] || 0) }))
    .sort((a, b) => b.points - a.points)
    .slice(0, limit);
  res.json({ success: true, data: ranked });
}
app.get('/api/top-startups', topStartupsHandler);
app.get('/api/top-startups/:tournamentId', topStartupsHandler);

// Card scores by address (stub)
app.get('/api/card-scores/:address', (req, res) => {
  res.json({ address: req.params.address, scores: [] });
});

// Routes (registered AFTER stubs so /active and /info don't get caught by /:id)
app.use('/api/packs', require('./routes/packs'));
app.use('/api/upgrades', require('./routes/upgrades'));
app.use('/api/tournaments', require('./routes/tournaments'));
app.use('/api/cards', require('./routes/cards'));
app.use('/api/startups', require('./routes/startups'));
app.use('/api/ai', require('./routes/ai'));

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
      packsSold: packsSold ? parseInt(String(packsSold).match(/(\d+)/)?.[1] || '0') : 0,
      totalCards: totalCards ? parseInt(String(totalCards).match(/(\d+)/)?.[1] || '0') : 0,
      packPrice: '0.1 ALEO',
      maxPacks: 10000,
      maxCards: 50000,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Daily startup scorer ────────────────────────────────────────────────
// Fetches tweets for each startup, scores them, and appends to
// server/data/daily-scores.json. Runs at 00:10 UTC every day.
const { runDailyScorer, getLatestScores, todayKey } = require('./services/daily-scorer');

cron.schedule('10 0 * * *', async () => {
  try {
    console.log('[cron] Running daily scorer at', new Date().toISOString());
    await runDailyScorer();
  } catch (err) {
    console.error('[cron] Daily scorer failed:', err.message);
  }
}, { timezone: 'UTC' });

// Run once on boot if today's entry is missing — avoids a full-day gap after
// a deploy. Fire-and-forget so server startup isn't blocked.
(async () => {
  try {
    const latest = getLatestScores();
    if (latest.date !== todayKey()) {
      console.log('[startup] No entry for today yet — running daily scorer in background');
      runDailyScorer().catch(err => console.error('[startup] Scorer failed:', err.message));
    } else {
      console.log(`[startup] Daily scores present for ${latest.date}`);
    }
  } catch (err) {
    console.error('[startup] Scorer bootstrap failed:', err.message);
  }
})();

// Note: tournament-scoped scorer cron (the legacy EVM pattern) is disabled.
// Re-enable & wire in an active tournament ID if tournament-level daily
// scoring is needed:
// cron.schedule('0 0 * * *', async () => {
//   const { runDailyScorer: runTournamentScorer } = require('./services/scorer');
//   await runTournamentScorer('2field');
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
║  GET  /api/startups/scores/daily             ║
║  GET  /api/startups/scores/latest            ║
║  GET  /api/startups/scores/aggregated        ║
║  POST /api/ai/card-recommendation            ║
╚══════════════════════════════════════════════╝
  `);
});
