/**
 * AI Card Recommender using OpenRouter API (UnicornX / Aleo edition).
 *
 * On Aleo, a player's card collection is private and held off-chain on the
 * frontend. The frontend therefore POSTs the player's decrypted card list
 * together with startup activity data — we never try to read cards from chain.
 *
 * Input (from caller):
 *   - playerCards: [{ startupId, level, tokenId?, name?, rarity?, multiplier? }]
 *   - startupScores: { s1: number, s2: number, ..., s19: number }
 *       Aggregate activity for the scoring window (e.g. last 10 days).
 *
 * Output:
 *   { recommended, reasoning, insights, source, model? }
 *   `recommended` is an array of 5 identifiers — tokenId if provided on the
 *   card, otherwise startupId — so the frontend can map back to its cards.
 *
 * CommonJS module (to match the rest of the Aleo server).
 */

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

// Model fallback chain — same priority as EVM reference.
const AI_MODELS = [
    'arcee-ai/trinity-large-preview:free',
    'google/gemma-3-4b-it:free',
    'stepfun/step-3.5-flash:free',
    'z-ai/glm-4.5-air:free',
    'qwen/qwen3-vl-235b-a22b-thinking',
];

const SYSTEM_PROMPT = `You are UnicornX AI — the chief analyst of the UnicornX fantasy startup league on Aleo. You are an expert in the tech startup ecosystem and specialize in predicting which startups will generate the most social media traction.

GAME CONTEXT:
Players compete in a fantasy league by selecting 5 private NFT cards representing real tech startups. Each day, startups are scored based on their Twitter/X activity — tweets about funding rounds, product launches, partnerships, team hires, community engagement, and viral moments all contribute points. On Aleo, card ownership is private, so players choose their lineup locally from their own collection.

SCORING MECHANICS:
- Daily card score = (startup's base activity points) x (card level multiplier)
- Card levels: 1 to 5 (players upgrade cards — higher level = bigger multiplier)
- Tournament score = cumulative sum of all 5 cards' daily scores
- More social media activity = more base points for that startup

YOUR TASK:
Analyze the provided startup activity data from the last 10 days and recommend the optimal 5 cards from this player's collection to maximize their expected tournament score.

ANALYSIS FRAMEWORK:
1. ACTIVITY RANKING — Which startups accumulated the most points? High-scorers are likely to stay active.
2. MOMENTUM — Is activity trending up or down? Prioritize uptrends.
3. LEVEL MATH — Calculate expected values. Example: Lvl 3 card on a 50-point startup = 150 pts beats Lvl 1 on 100-point startup = 100 pts. Higher level cards are always better for the same startup.
4. PORTFOLIO BALANCE — Weigh concentration on top performers vs spreading risk.
5. CATALYSTS — Look for signals of upcoming events that could spike activity.

RESPONSE FORMAT — Return ONLY valid JSON (no markdown, no code fences):
{
  "recommended": [id1, id2, id3, id4, id5],
  "reasoning": "Detailed 3-5 sentence strategy. Reference specific point totals, trends, and multiplier calculations. Explain WHY these cards beat alternatives.",
  "insights": [
    {"name": "StartupName", "outlook": "bullish|neutral|bearish", "reason": "Concrete data-driven reason, e.g. '52 pts across 8 events, volume increasing'"}
  ]
}

RULES:
- "recommended" must contain exactly 5 IDs from the player's collection
- Use the same ID type the player's cards use (tokenId if present, otherwise startupId)
- "insights" should cover the top 3-5 startups from the activity data
- Cite numbers: point totals, multiplier calculations
- If data is limited, acknowledge uncertainty and explain your heuristic`;

// Map startup id -> name, lazily loaded from config.
let STARTUP_NAME_BY_ID = null;
function getStartupNameMap() {
    if (STARTUP_NAME_BY_ID) return STARTUP_NAME_BY_ID;
    const config = require('../config');
    STARTUP_NAME_BY_ID = {};
    for (const s of config.STARTUPS) {
        STARTUP_NAME_BY_ID[s.id] = s.name;
    }
    return STARTUP_NAME_BY_ID;
}

/**
 * Pick the identifier we'll use when returning recommendations. Frontend
 * supplies tokenId for off-chain private cards; if not present we fall back
 * to startupId+level composite (unique per card on Aleo).
 */
function cardKey(card) {
    if (card.tokenId !== undefined && card.tokenId !== null) return card.tokenId;
    if (card.id !== undefined && card.id !== null) return card.id;
    return card.startupId; // may collide if duplicate startups — frontend should dedupe
}

/**
 * Generate AI card recommendation.
 *
 * @param {Array<{startupId: number, level: number, tokenId?: any, name?: string, rarity?: string|number, multiplier?: number}>} playerCards
 * @param {Object<string, number>} startupScores  — keys like "s1", "s2", ... "s19"
 * @returns {Promise<{recommended: any[], reasoning: string, insights: Array, source: string, model?: string}>}
 */
async function generateRecommendation(playerCards, startupScores) {
    const apiKey = process.env.OPENROUTER_API_KEY;
    const nameMap = getStartupNameMap();

    // Normalize cards — fill in the startup name if missing.
    const cards = (playerCards || []).map(c => ({
        ...c,
        name: c.name || nameMap[c.startupId] || `Startup #${c.startupId}`,
        level: c.level || 1,
        multiplier: c.multiplier || c.level || 1,
        _key: cardKey(c)
    }));

    if (cards.length < 5) {
        return {
            recommended: cards.map(c => c._key),
            reasoning: `You only have ${cards.length} card(s). You need at least 5 to enter. Buy more packs!`,
            insights: [],
            source: 'insufficient_cards'
        };
    }

    if (!apiKey) {
        console.warn('[AI Recommender] No OPENROUTER_API_KEY set — using heuristic fallback');
        return fallbackRecommendation(cards, startupScores);
    }

    // Build the cards list for the prompt.
    const cardsList = cards.map(c =>
        `- Card ${c._key}: ${c.name} (startupId=${c.startupId}, level=${c.level})`
    ).join('\n');

    // Build an activity summary sorted by score desc.
    const scores = startupScores || {};
    const scoreRows = Object.keys(nameMap).map(id => {
        const key = `s${id}`;
        return { id: Number(id), name: nameMap[id], points: Number(scores[key] || 0) };
    }).sort((a, b) => b.points - a.points);

    const activitySummary = scoreRows
        .map(r => `${r.name} (id=${r.id}): ${r.points} pts`)
        .join('\n');

    const prompt = `PLAYER'S CARDS:\n${cardsList}\n\nSTARTUP ACTIVITY (aggregate points, recent window):\n${activitySummary || 'No recent data available.'}\n\nRecommend the best 5 cards from the player's collection. Return ONLY valid JSON.`;

    // Try each model in fallback chain.
    for (const model of AI_MODELS) {
        const startTime = Date.now();
        try {
            console.log(`[AI Recommender] Trying model: ${model}`);
            const response = await fetch(OPENROUTER_URL, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    model,
                    messages: [
                        { role: 'system', content: SYSTEM_PROMPT },
                        { role: 'user', content: prompt },
                    ],
                    temperature: 0.3,
                    max_tokens: 1500,
                }),
            });

            const latencyMs = Date.now() - startTime;

            if (!response.ok) {
                const err = await response.text();
                console.error(`[AI Recommender] ${model} error ${response.status}: ${err.substring(0, 100)}`);
                continue;
            }

            const data = await response.json();
            const content = data.choices?.[0]?.message?.content?.trim();
            if (!content) {
                console.error(`[AI Recommender] ${model} empty response`);
                continue;
            }

            let result;
            try {
                const cleaned = content.replace(/^```json?\s*/, '').replace(/\s*```$/, '');
                result = JSON.parse(cleaned);
            } catch (parseErr) {
                console.error(`[AI Recommender] ${model} JSON parse failed:`, content.substring(0, 200));
                continue;
            }

            const validKeys = new Set(cards.map(c => c._key));

            if (!Array.isArray(result.recommended)) {
                console.warn(`[AI Recommender] ${model} missing recommended array`);
                continue;
            }

            // Filter invalid IDs, then top up from highest-expected-value cards.
            let recommended = result.recommended.filter(id => validKeys.has(id));
            if (recommended.length < 5) {
                const used = new Set(recommended);
                const fallback = rankCards(cards, startupScores)
                    .filter(c => !used.has(c._key));
                for (const c of fallback) {
                    if (recommended.length >= 5) break;
                    recommended.push(c._key);
                }
            } else if (recommended.length > 5) {
                recommended = recommended.slice(0, 5);
            }

            console.log(`[AI Recommender] ${model} succeeded (${latencyMs}ms)`);
            return {
                recommended,
                reasoning: result.reasoning || 'AI recommendation based on recent startup activity.',
                insights: result.insights || [],
                source: 'ai',
                model
            };

        } catch (err) {
            console.error(`[AI Recommender] ${model} error: ${err.message}`);
            continue;
        }
    }

    console.warn('[AI Recommender] All models failed, using heuristic fallback');
    return fallbackRecommendation(cards, startupScores);
}

/** Rank cards by expected value = level * startup_activity (fallback: level only). */
function rankCards(cards, startupScores) {
    const scores = startupScores || {};
    return [...cards]
        .map(c => ({
            ...c,
            expectedValue: (c.multiplier || c.level || 1) * (Number(scores[`s${c.startupId}`] || 0) + 1)
        }))
        .sort((a, b) => b.expectedValue - a.expectedValue);
}

/** Heuristic fallback when AI is unavailable. */
function fallbackRecommendation(cards, startupScores) {
    const ranked = rankCards(cards, startupScores);
    const top5 = ranked.slice(0, 5);
    return {
        recommended: top5.map(c => c._key),
        reasoning: 'Recommendation based on card levels and aggregate startup activity scores over the recent window.',
        insights: top5.map(c => ({
            name: c.name,
            outlook: (Number(startupScores?.[`s${c.startupId}`] || 0) > 0) ? 'bullish' : 'neutral',
            reason: `Level ${c.level} x ${Number(startupScores?.[`s${c.startupId}`] || 0)} pts = ${c.expectedValue} expected`
        })),
        source: 'heuristic'
    };
}

module.exports = { generateRecommendation };
