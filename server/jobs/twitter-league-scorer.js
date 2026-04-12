/**
 * Twitter League Scorer
 * Fetches tweets from startups and calculates league points based on events.
 * Uses twitterapi.io advanced_search with date filtering.
 */

import { appendFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const LOG_DIR = join(__dirname, '../server/logs');

if (!existsSync(LOG_DIR)) {
    mkdirSync(LOG_DIR, { recursive: true });
}

// Log context — set by setLogContext() before each scoring run
let _logCtx = { scoringDate: 'unknown', runTag: '' };

function setLogContext(scoringDate) {
    const now = new Date();
    const hh = String(now.getUTCHours()).padStart(2, '0');
    const mm = String(now.getUTCMinutes()).padStart(2, '0');
    _logCtx = {
        scoringDate,
        runTag: `${now.toISOString().split('T')[0]}_${hh}${mm}`,
    };
}

function logTweet(userName, tweet, analysis) {
    const logFile = join(LOG_DIR, `tweets_${_logCtx.scoringDate}_run${_logCtx.runTag}.log`);
    const logEntry = {
        timestamp: new Date().toISOString(),
        scoringDate: _logCtx.scoringDate,
        userName,
        tweetId: tweet.id,
        tweetText: tweet.text,
        likes: tweet.likeCount || 0,
        retweets: tweet.retweetCount || 0,
        analysis
    };
    appendFileSync(logFile, JSON.stringify(logEntry) + '\n');
}

// AI-specific logging
function logAI(entry) {
    const logFile = join(LOG_DIR, `ai-scorer_${_logCtx.scoringDate}_run${_logCtx.runTag}.log`);
    appendFileSync(logFile, JSON.stringify({
        timestamp: new Date().toISOString(),
        scoringDate: _logCtx.scoringDate,
        ...entry
    }) + '\n');
}

// Tracks AI stats across a full scoring run
const aiStats = {
    totalStartups: 0,
    aiSuccessStartups: 0,
    keywordFallbackStartups: 0,
    totalTweetsAnalyzed: 0,
    aiScoredTweets: 0,
    keywordScoredTweets: 0,
    modelAttempts: {},   // model -> { tried, succeeded, failed }
    errors: [],
    reset() {
        this.totalStartups = 0;
        this.aiSuccessStartups = 0;
        this.keywordFallbackStartups = 0;
        this.totalTweetsAnalyzed = 0;
        this.aiScoredTweets = 0;
        this.keywordScoredTweets = 0;
        this.modelAttempts = {};
        this.errors = [];
    }
};

const API_KEY = 'new1_d1be13bf77c84f1886c5a79cdb692816';
const API_BASE_URL = 'https://api.twitterapi.io/twitter';

// Twitter handle -> game startup name
const STARTUP_MAPPING = {
    'openclaw': 'Openclaw',
    'Lovable': 'Lovable',
    'cursor_ai': 'Cursor',
    'OpenAI': 'OpenAI',
    'AnthropicAI': 'Anthropic',
    'browser_use': 'Browser Use',
    'dedaluslabs': 'Dedalus Labs',
    'autumnpricing': 'Autumn',
    'AxiomExchange': 'Axiom',
    'MultifactorCOM': 'Multifactor',
    'getdomeapi': 'Dome',
    'GrazeMate': 'GrazeMate',
    'tornyolsystems': 'Tornyol Systems',
    'heypocket': 'Pocket',
    'Caretta': 'Caretta',
    'axionorbital': 'AxionOrbital Space',
    'freeportmrkts': 'Freeport Markets',
    'ruvopay': 'Ruvo',
    'lightberryai': 'Lightberry'
};

// Event scoring rules
const EVENT_SCORES = {
    FUNDING: {
        base: 500,
        perMillion: 10,
        seedMax: 800,
        seriesAPlus: 1500,
        maxScore: 3000,
        keywords: [
            'raised $', 'funding', 'seed round', 'series a', 'series b', 'series c', 'series d',
            'funding round', 'investment', 'investors', 'backed by', 'led by', 'capital',
            'venture', 'financing', 'fundraise', 'fundraising', 'raise $', 'closed $',
            'pre-seed', 'angel round', 'vc funding', 'valuation', 'invested', 'raised a $',
            // Portuguese
            'investimento', 'investidores', 'rodada', 'captação', 'financiamento',
            'levantou', 'aporte', 'capitalização', 'investiu'
        ]
    },
    PARTNERSHIP: {
        base: 300,
        perMajorPartner: 50,
        majorPartners: ['aws', 'amazon', 'google', 'microsoft', 'meta', 'apple', 'nvidia', 'ibm', 'oracle', 'salesforce'],
        keywords: [
            'partner', 'partnership', 'collaboration', 'collab', 'integrated with',
            'integration', 'teaming up', 'team up', 'working with', 'partnering',
            'joined forces', 'alliance', 'strategic', 'cooperate', 'cooperation',
            'working together', 'announce partnership', 'proud to partner',
            // Portuguese
            'parceria', 'parceiro', 'colaboração', 'integração', 'integrado com',
            'aliança', 'cooperação', 'trabalhando com', 'juntos'
        ]
    },
    KEY_HIRE: {
        base: 150,
        cLevel: 50,
        titles: ['cto', 'ceo', 'cpo', 'cfo', 'vp', 'chief', 'head of', 'director', 'lead'],
        keywords: [
            'hired', 'joined', 'welcome', 'joining', 'new hire', 'joins',
            'welcoming', 'onboarding', 'brought on', 'appointed', 'promoting',
            'excited to announce', 'thrilled to have', 'joins the team',
            'new team member', 'joining our team', 'pleased to announce',
            // Portuguese
            'contratou', 'contratação', 'bem-vindo', 'novo membro', 'entrou para',
            'nomeado', 'promovido', 'nossa equipe'
        ]
    },
    REVENUE: {
        base: 400,
        perMillion: 10,
        maxScore: 2000,
        keywords: [
            'arr', 'mrr', 'revenue', 'sales', 'annual recurring revenue',
            'monthly recurring revenue', 'run rate', 'bookings', 'billing',
            'profitable', 'profitability', 'earnings', 'income',
            // Portuguese
            'receita', 'faturamento', 'vendas', 'lucrativo', 'lucro', 'renda'
        ]
    },
    PRODUCT_LAUNCH: {
        base: 250,
        viral: 100,
        viralThreshold: 1000,
        keywords: [
            'launched', 'launch', 'live', 'beta', 'announcing', 'released',
            'introducing', 'new feature', 'now available', 'shipping',
            'rollout', 'rolling out', 'unveiling', 'debut', 'going live',
            'available now', 'just shipped', 'excited to share',
            // Portuguese
            'lançamento', 'lançou', 'lançamos', 'disponível', 'nova funcionalidade',
            'novidade', 'apresentando', 'estreia', 'ao vivo'
        ]
    },
    ACQUISITION: {
        base: 2000,
        keywords: [
            'acquired', 'acquisition', 'merger', 'acquired by', 'merge',
            'acquiring', 'bought', 'purchase', 'purchasing', 'takeover',
            'join forces', 'combining with', 'merging with',
            // Portuguese
            'adquiriu', 'aquisição', 'fusão', 'compra', 'comprou'
        ]
    },
    MEDIA_MENTION: {
        base: 200,
        major: 100,
        majorOutlets: ['techcrunch', 'forbes', 'wsj', 'wall street journal', 'nytimes', 'new york times', 'bloomberg', 'cnbc', 'reuters', 'wired', 'verge'],
        keywords: [
            'featured', 'covered', 'article', 'mentioned', 'press',
            'interview', 'story', 'spotlight', 'highlighted', 'profiled',
            'wrote about', 'coverage', 'appeared on', 'featured in',
            // Portuguese
            'destaque', 'matéria', 'artigo', 'mencionado', 'entrevista',
            'imprensa', 'reportagem', 'cobertura'
        ]
    },
    GROWTH: {
        base: 200,
        per10x: 50,
        keywords: [
            'users', 'signups', 'growth', 'milestone', 'customers', 'reached',
            'surpassed', 'hit', 'crossed', 'achieved', 'grown to',
            'doubled', 'tripled', '10x', '100x', 'scale', 'scaling',
            // Portuguese
            'usuários', 'clientes', 'crescimento', 'marco', 'alcançou',
            'superou', 'atingiu', 'dobrou', 'triplicou', 'escala'
        ]
    },
    ENGAGEMENT: {
        base: 50,
        perThousandLikes: 1,
        perRetweet: 2,
        perThousandViews: 0.1,
        maxDaily: 500
    }
};

// ============ Helper functions ============

function containsKeywords(text, keywords) {
    const lowerText = text.toLowerCase();
    return keywords.some(keyword => lowerText.includes(keyword.toLowerCase()));
}

function extractAmount(text) {
    const patterns = [
        /\$(\d+\.?\d*)\s*([MB])/i,
        /(\d+\.?\d*)\s*million/i,
        /(\d+\.?\d*)\s*billion/i
    ];
    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match) {
            const value = parseFloat(match[1]);
            const unit = match[2] || (text.toLowerCase().includes('billion') ? 'B' : 'M');
            return unit.toUpperCase() === 'B' ? value * 1000 : value;
        }
    }
    return 0;
}

function extractGrowth(text) {
    const patterns = [
        /(\d+)x\s*growth/i,
        /(\d+)%\s*(increase|growth)/i
    ];
    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match) return parseInt(match[1]);
    }
    return 0;
}

// ============ Tweet analysis ============

function analyzeTweet(tweet) {
    const text = tweet.text;
    const points = { total: 0, events: [] };

    if (containsKeywords(text, EVENT_SCORES.FUNDING.keywords)) {
        const amount = extractAmount(text);
        let score = EVENT_SCORES.FUNDING.base;
        if (amount > 0) {
            score += Math.floor(amount) * EVENT_SCORES.FUNDING.perMillion;
            if (text.toLowerCase().includes('seed')) {
                score = Math.min(score, EVENT_SCORES.FUNDING.seedMax);
            } else if (text.toLowerCase().match(/series [a-z]/)) {
                score = Math.min(score, EVENT_SCORES.FUNDING.seriesAPlus);
            }
        }
        score = Math.min(score, EVENT_SCORES.FUNDING.maxScore);
        points.events.push({ type: 'FUNDING', score, details: `Amount: $${amount}M` });
        points.total += score;
    }

    if (containsKeywords(text, EVENT_SCORES.PARTNERSHIP.keywords)) {
        let score = EVENT_SCORES.PARTNERSHIP.base;
        const foundPartners = EVENT_SCORES.PARTNERSHIP.majorPartners.filter(p =>
            text.toLowerCase().includes(p)
        );
        score += foundPartners.length * EVENT_SCORES.PARTNERSHIP.perMajorPartner;
        points.events.push({ type: 'PARTNERSHIP', score, details: `Partners: ${foundPartners.join(', ') || 'generic'}` });
        points.total += score;
    }

    if (containsKeywords(text, EVENT_SCORES.KEY_HIRE.keywords)) {
        let score = EVENT_SCORES.KEY_HIRE.base;
        const isCLevel = EVENT_SCORES.KEY_HIRE.titles.some(t => text.toLowerCase().includes(t));
        if (isCLevel) score += EVENT_SCORES.KEY_HIRE.cLevel;
        points.events.push({ type: 'KEY_HIRE', score, details: isCLevel ? 'C-level' : 'Regular' });
        points.total += score;
    }

    if (containsKeywords(text, EVENT_SCORES.REVENUE.keywords)) {
        const amount = extractAmount(text);
        let score = EVENT_SCORES.REVENUE.base;
        if (amount > 0) score += Math.floor(amount) * EVENT_SCORES.REVENUE.perMillion;
        score = Math.min(score, EVENT_SCORES.REVENUE.maxScore);
        points.events.push({ type: 'REVENUE', score, details: `Amount: $${amount}M` });
        points.total += score;
    }

    if (containsKeywords(text, EVENT_SCORES.PRODUCT_LAUNCH.keywords)) {
        let score = EVENT_SCORES.PRODUCT_LAUNCH.base;
        if (tweet.likeCount >= EVENT_SCORES.PRODUCT_LAUNCH.viralThreshold) {
            score += EVENT_SCORES.PRODUCT_LAUNCH.viral;
        }
        points.events.push({ type: 'PRODUCT_LAUNCH', score, details: `Likes: ${tweet.likeCount}` });
        points.total += score;
    }

    if (containsKeywords(text, EVENT_SCORES.ACQUISITION.keywords)) {
        const score = EVENT_SCORES.ACQUISITION.base;
        points.events.push({ type: 'ACQUISITION', score, details: 'Acquisition event' });
        points.total += score;
    }

    if (containsKeywords(text, EVENT_SCORES.MEDIA_MENTION.keywords)) {
        let score = EVENT_SCORES.MEDIA_MENTION.base;
        const majorOutlet = EVENT_SCORES.MEDIA_MENTION.majorOutlets.some(o => text.toLowerCase().includes(o));
        if (majorOutlet) score += EVENT_SCORES.MEDIA_MENTION.major;
        points.events.push({ type: 'MEDIA_MENTION', score, details: majorOutlet ? 'Major outlet' : 'General' });
        points.total += score;
    }

    if (containsKeywords(text, EVENT_SCORES.GROWTH.keywords)) {
        const growthRate = extractGrowth(text);
        let score = EVENT_SCORES.GROWTH.base;
        if (growthRate >= 10) score += Math.floor(growthRate / 10) * EVENT_SCORES.GROWTH.per10x;
        points.events.push({ type: 'GROWTH', score, details: `Growth: ${growthRate}x` });
        points.total += score;
    }

    let engagementScore = EVENT_SCORES.ENGAGEMENT.base;
    engagementScore += Math.floor((tweet.likeCount || 0) / 1000) * EVENT_SCORES.ENGAGEMENT.perThousandLikes;
    engagementScore += (tweet.retweetCount || 0) * EVENT_SCORES.ENGAGEMENT.perRetweet;
    engagementScore += Math.floor((tweet.viewCount || 0) / 1000) * EVENT_SCORES.ENGAGEMENT.perThousandViews;
    engagementScore = Math.min(engagementScore, EVENT_SCORES.ENGAGEMENT.maxDaily);

    if (engagementScore > EVENT_SCORES.ENGAGEMENT.base) {
        points.events.push({ type: 'ENGAGEMENT', score: engagementScore, details: `L:${tweet.likeCount} RT:${tweet.retweetCount}` });
        points.total += engagementScore;
    }

    return points;
}

// ============ AI-based tweet analysis ============

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

// Model fallback chain — try each in order until one succeeds
const AI_MODELS = [
    process.env.AI_SCORER_MODEL || 'google/gemma-3-4b-it:free',
    'google/gemma-3-4b-it:free',
    'stepfun/step-3.5-flash:free',
    'arcee-ai/trinity-large-preview:free',
    'z-ai/glm-4.5-air:free',
    'qwen/qwen3-vl-235b-a22b-thinking',
].filter((v, i, arr) => arr.indexOf(v) === i); // deduplicate

const AI_SCORER_PROMPT = `You are a senior financial news analyst covering the tech startup ecosystem. Your job is to analyze tweets from startups and:
1. Determine the news significance (event type and score)
2. Write a professional headline in the style of Bloomberg, BBC Business, or NYT

EVENT TYPES AND SCORING GUIDE:
- FUNDING (200-3000): Company raised money, investment round, valuation. Score based on amount: seed <$5M=500, Series A $5-20M=1000, Series B+ $20M+=1500, mega-round $1B+=3000
- PARTNERSHIP (200-800): Strategic partnership, integration with another company. 300 base, +200 for major tech partner (Google, AWS, Microsoft, etc.)
- PRODUCT_LAUNCH (200-500): New product, feature launch, beta release. 250 base, +100 if major update
- KEY_HIRE (100-300): Hiring announcement, new team member. 150 base, +100 for C-level
- ACQUISITION (1000-2000): Company acquired or merged with another
- REVENUE (200-2000): Revenue milestone, profitability, ARR numbers
- GROWTH (100-500): User growth, milestone numbers, scaling achievement
- MEDIA_MENTION (100-300): Press coverage, interview, article mention
- ENGAGEMENT (50-500): General post with high social engagement but no specific news event. Score based on likes/retweets

SCORING RULES:
- Score ONLY events that directly involve the tweeting company itself. If the company is merely reporting, reposting, or commenting on another company's news (e.g. "BREAKING: Microsoft partners with Starlink"), that is NOT the tweeting company's own partnership — score it as ENGAGEMENT (50-100).
- News aggregation, market commentary, or sharing other companies' achievements = ENGAGEMENT (50-100), never FUNDING/PARTNERSHIP/ACQUISITION.
- Score ONLY based on information actually in the tweet. Never invent facts.
- A routine product update with no significant news = ENGAGEMENT with low score (50-150)
- Mundane tweets (greetings, memes, polls, casual posts) = ENGAGEMENT with score 50
- Major announcements about the company's OWN achievements deserve higher scores
- One tweet can only have ONE event type (pick the most significant)

HEADLINE RULES:
- Write like Bloomberg Terminal or BBC News
- Active voice, present tense ("Raises", "Launches", "Partners With")
- Include specific numbers/names from the tweet when available
- 60-100 characters. No emojis, no hashtags, no exclamation marks
- Be factual — never add information not in the tweet

Respond with a JSON array. For each tweet, return:
{"type": "EVENT_TYPE", "score": number, "headline": "Professional headline here"}

Order must match the input tweets.`;

/**
 * Analyze tweets using AI — returns event type, score, and headline for each tweet.
 * Falls back to keyword analysis if AI fails.
 */
async function analyzeTweetsWithAI(startupName, tweets) {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
        console.log('   [AI] No API key — using keyword fallback');
        logAI({ type: 'scorer_skip', startup: startupName, reason: 'no_api_key' });
        return null; // signals to use keyword fallback
    }

    if (tweets.length === 0) return [];

    const tweetList = tweets.map((t, i) => {
        const metrics = `[Likes: ${t.likeCount || 0}, RT: ${t.retweetCount || 0}, Views: ${t.viewCount || 0}]`;
        return `${i + 1}. ${metrics}\n"${(t.text || '').substring(0, 280)}"`;
    }).join('\n\n');

    const prompt = `Analyze these ${tweets.length} tweets from ${startupName}:\n\n${tweetList}`;

    // Try each model in fallback chain
    for (const model of AI_MODELS) {
        const startTime = Date.now();
        // Track model stats
        if (!aiStats.modelAttempts[model]) aiStats.modelAttempts[model] = { tried: 0, succeeded: 0, failed: 0 };
        aiStats.modelAttempts[model].tried++;

        try {
            console.log(`   [AI] Trying model: ${model}`);
            const response = await fetch(OPENROUTER_URL, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    model,
                    messages: [
                        { role: 'user', content: AI_SCORER_PROMPT + '\n\n---\n\n' + prompt },
                    ],
                    temperature: 0.3,
                    max_tokens: 2000,
                }),
            });

            const latencyMs = Date.now() - startTime;

            if (!response.ok) {
                const err = await response.text();
                console.log(`   [AI] ${model} error ${response.status}: ${err.substring(0, 100)}`);
                aiStats.modelAttempts[model].failed++;
                logAI({
                    type: 'scorer_model_fail', startup: startupName, model,
                    reason: 'http_error', status: response.status,
                    error: err.substring(0, 200), latencyMs, tweetCount: tweets.length
                });
                continue; // try next model
            }

            const data = await response.json();
            const content = data.choices?.[0]?.message?.content?.trim();
            if (!content) {
                console.log(`   [AI] ${model} empty response`);
                aiStats.modelAttempts[model].failed++;
                logAI({
                    type: 'scorer_model_fail', startup: startupName, model,
                    reason: 'empty_response', latencyMs, tweetCount: tweets.length
                });
                continue;
            }

            const cleaned = content.replace(/^```json?\s*/, '').replace(/\s*```$/, '');
            const results = JSON.parse(cleaned);

            if (!Array.isArray(results) || results.length !== tweets.length) {
                console.log(`   [AI] ${model} result count mismatch (got ${results?.length}, expected ${tweets.length})`);
                aiStats.modelAttempts[model].failed++;
                logAI({
                    type: 'scorer_model_fail', startup: startupName, model,
                    reason: 'count_mismatch', expected: tweets.length,
                    got: results?.length, latencyMs
                });
                continue;
            }

            // Validate and cap scores
            console.log(`   [AI] ${model} succeeded (${latencyMs}ms)`);
            aiStats.modelAttempts[model].succeeded++;

            const validated = results.map((r, i) => ({
                type: r.type || 'ENGAGEMENT',
                score: Math.min(Math.max(Number(r.score) || 50, 0), 3000),
                headline: (r.headline || '').substring(0, 120) || null,
            }));

            // Log detailed per-tweet AI results
            logAI({
                type: 'scorer_success', startup: startupName, model, latencyMs,
                tweetCount: tweets.length,
                results: validated.map((r, i) => ({
                    tweetId: tweets[i]?.id,
                    tweetPreview: (tweets[i]?.text || '').substring(0, 80),
                    eventType: r.type,
                    score: r.score,
                    headline: r.headline
                }))
            });

            return validated;

        } catch (err) {
            const latencyMs = Date.now() - startTime;
            console.log(`   [AI] ${model} error: ${err.message}`);
            aiStats.modelAttempts[model].failed++;
            aiStats.errors.push({ model, startup: startupName, error: err.message });
            logAI({
                type: 'scorer_model_fail', startup: startupName, model,
                reason: 'exception', error: err.message, latencyMs, tweetCount: tweets.length
            });
            continue;
        }
    }

    console.log('   [AI] All models failed, falling back to keyword scoring');
    logAI({
        type: 'scorer_all_failed', startup: startupName,
        modelsAttempted: AI_MODELS, tweetCount: tweets.length
    });
    return null;
}

// ============ API functions ============

/**
 * Fetch all tweets from a user for a specific date (YYYY-MM-DD).
 * Uses advanced_search with from: since: until: operators.
 * Paginates through all pages (20 tweets per page).
 */
async function fetchTweetsByDate(userName, date) {
    const nextDate = getNextDate(date);
    const query = `from:${userName} since:${date}_00:00:00_UTC until:${nextDate}_00:00:00_UTC -filter:replies`;
    const allTweets = [];
    let cursor = '';
    let page = 0;
    const MAX_PAGES = 5; // safety limit

    while (page < MAX_PAGES) {
        const params = new URLSearchParams({
            query,
            queryType: 'Latest',
        });
        if (cursor) params.set('cursor', cursor);

        const url = `${API_BASE_URL}/tweet/advanced_search?${params}`;
        console.log(`   Fetching page ${page + 1}: ${userName} (${date})`);

        try {
            const RETRY_DELAYS = [1 * 3600000, 5 * 3600000]; // retry after 1h, then 5h
            let verified = [];
            let hasNextPage = false;
            let nextCursor = '';

            for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
                const response = await fetch(url, {
                    headers: { 'X-API-Key': API_KEY }
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    console.error(`   API error: ${response.status} - ${errorText}`);
                    break;
                }

                const data = await response.json();

                if (!data.tweets && data.status !== 'success') {
                    console.error(`   API returned: ${data.msg || data.message || 'Unknown error'}`);
                    break;
                }

                const tweets = data.tweets || data.data?.tweets || [];
                hasNextPage = !!data.has_next_page && !!data.next_cursor;
                nextCursor = data.next_cursor || '';

                // Validate author — API sometimes ignores `from:` and returns random tweets
                const nameLower = userName.toLowerCase();
                verified = tweets.filter(t => {
                    const author = (t.author?.userName || t.user?.screen_name || '').toLowerCase();
                    return author === nameLower;
                });

                const wrongCount = tweets.length - verified.length;
                if (wrongCount === 0 || tweets.length === 0) break; // clean response

                // Wrong-author tweets detected — retry if attempts remain
                if (attempt < RETRY_DELAYS.length) {
                    const delay = RETRY_DELAYS[attempt];
                    console.warn(`   ⚠ ${wrongCount}/${tweets.length} wrong-author tweets, retrying in ${delay / 3600000}h (attempt ${attempt + 2}/3)...`);
                    await new Promise(r => setTimeout(r, delay));
                } else {
                    console.warn(`   ⚠ Filtered ${wrongCount}/${tweets.length} wrong-author tweets after 3 attempts`);
                }
            }

            allTweets.push(...verified);

            if (!hasNextPage) break;
            cursor = nextCursor;
            page++;

            // rate limit between pages
            await new Promise(r => setTimeout(r, 1000));
        } catch (error) {
            console.error(`   Fetch error: ${error.message}`);
            break;
        }
    }

    return allTweets;
}

/**
 * Get the next date string (YYYY-MM-DD) after the given date.
 */
function getNextDate(dateStr) {
    const d = new Date(dateStr + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().split('T')[0];
}

/**
 * Process a startup's tweets for a specific date.
 * Returns scoring result with all analyzed tweets.
 */
async function processStartupForDate(userName, date) {
    const rawTweets = await fetchTweetsByDate(userName, date);

    // Filter out replies and comments — only keep original tweets
    const tweets = rawTweets.filter(tweet => {
        // Skip if it's a reply to another user
        if (tweet.inReplyToId || tweet.in_reply_to_status_id || tweet.in_reply_to_user_id) return false;
        // Skip if text starts with @mention (reply pattern)
        if (tweet.text && /^@\w/.test(tweet.text.trim())) return false;
        // Skip retweets (text starts with "RT @")
        if (tweet.text && tweet.text.trim().startsWith('RT @')) return false;
        return true;
    });

    if (tweets.length === 0) {
        return {
            userName,
            date,
            tweets: [],
            totalPoints: 0,
            tweetCount: 0
        };
    }

    const startupName = STARTUP_MAPPING[userName] || userName;
    const filtered = rawTweets.length - tweets.length;
    console.log(`   Found ${tweets.length} tweets for @${userName} on ${date}${filtered > 0 ? ` (filtered ${filtered} replies/RTs)` : ''}`);

    // Try AI analysis first, fall back to keyword matching
    const aiResults = await analyzeTweetsWithAI(startupName, tweets);
    const useAI = aiResults !== null;
    if (useAI) console.log('   [AI] Analysis complete');

    // Track stats
    aiStats.totalStartups++;
    aiStats.totalTweetsAnalyzed += tweets.length;
    if (useAI) {
        aiStats.aiSuccessStartups++;
        aiStats.aiScoredTweets += tweets.length;
    } else {
        aiStats.keywordFallbackStartups++;
        aiStats.keywordScoredTweets += tweets.length;
    }

    const results = tweets.map((tweet, i) => {
        let eventType, score, headline;

        if (useAI && aiResults[i]) {
            eventType = aiResults[i].type;
            score = aiResults[i].score;
            headline = aiResults[i].headline;
        } else {
            // Keyword fallback — use primary event score only (not sum of all events)
            const analysis = analyzeTweet(tweet);
            const primary = analysis.events.reduce((best, e) => (e.score > best.score ? e : best), analysis.events[0] || { type: 'ENGAGEMENT', score: 50 });
            eventType = primary.type;
            score = Math.min(primary.score, 3000);
            headline = null;

            // Log keyword fallback per tweet
            logAI({
                type: 'keyword_fallback', startup: startupName,
                tweetId: tweet.id,
                tweetPreview: (tweet.text || '').substring(0, 80),
                eventType, score,
                reason: useAI ? 'ai_missing_index' : 'ai_unavailable'
            });
        }

        logTweet(userName, tweet, { points: score, events: [{ type: eventType, score }] });

        return {
            id: tweet.id,
            text: (tweet.text || '').substring(0, 200),
            createdAt: tweet.createdAt,
            metrics: {
                likes: tweet.likeCount || 0,
                retweets: tweet.retweetCount || 0,
                replies: tweet.replyCount || 0
            },
            points: score,
            events: [{ type: eventType, score, details: useAI ? 'AI' : 'keywords' }],
            headline
        };
    });

    const totalPoints = results.reduce((sum, r) => sum + r.points, 0);

    // Log startup summary
    logAI({
        type: 'startup_summary', startup: startupName,
        method: useAI ? 'AI' : 'keywords',
        tweetCount: tweets.length,
        totalPoints,
        events: results.map(r => ({ type: r.events[0].type, score: r.points, hasHeadline: !!r.headline }))
    });

    return {
        userName,
        date,
        tweets: results,
        totalPoints,
        tweetCount: tweets.length
    };
}

export { processStartupForDate, analyzeTweet, STARTUP_MAPPING, aiStats, logAI, setLogContext };
