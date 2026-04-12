// Shared data hooks — single source of truth for data used by multiple components.
// Multiple components subscribe to the same blockchainCache key → only 1 fetch per interval.

import { usePollingData } from './usePollingData';
import { POLLING_INTERVALS } from '../lib/cache';
import { apiUrl, fetchJson } from '../lib/api';
import { getActiveNetworkId } from '../lib/networks';
import { blockchainCache } from '../lib/cache';

// ── Types ──

export interface TournamentData {
    id: number;
    startTime: number;
    endTime: number;
    prizePool: string;
    entryCount: number;
    status: string;
}

export interface LeaderboardPlayer {
    rank: number;
    address: string;
    score: number;
    lastUpdated: string;
    username?: string | null;
    avatar?: string | null;
}

export interface TopStartup {
    name: string;
    points: number;
}

// ── Cache key builders (network-prefixed) ──

const sharedKeys = {
    activeTournament: () => `${getActiveNetworkId()}:shared:tournament`,
    leaderboard: (id: number) => `${getActiveNetworkId()}:shared:leaderboard:${id}`,
    topStartups: (id: number) => `${getActiveNetworkId()}:shared:topStartups:${id}`,
};

// ── Fetchers ──

async function fetchActiveTournament(): Promise<TournamentData | null> {
    const json = await fetchJson(apiUrl('/tournaments/active'));
    if (json.success) return json.data;
    return null;
}

async function fetchLeaderboard(tournamentId: number): Promise<LeaderboardPlayer[]> {
    const json = await fetchJson(apiUrl(`/leaderboard/${tournamentId}?limit=10`));
    if (json.success) return json.data;
    return [];
}

async function fetchTopStartups(tournamentId: number): Promise<TopStartup[]> {
    const json = await fetchJson(apiUrl(`/top-startups/${tournamentId}?limit=5`));
    if (json.success) return json.data;
    return [];
}

// ── Hooks ──

/**
 * Shared active tournament data — replaces 4+ independent /tournaments/active fetches.
 * Polls every 60s. All components sharing this hook use the same cache entry.
 */
export function useActiveTournament() {
    return usePollingData<TournamentData | null>(
        fetchActiveTournament,
        {
            cacheKey: sharedKeys.activeTournament(),
            interval: POLLING_INTERVALS.ONCE, // fetch once on load, data changes only when scorer runs
        }
    );
}

/**
 * Shared leaderboard data for a specific tournament.
 * Fetched once on load (preloaded). No auto-polling — scores update daily via scorer.
 */
export function useSharedLeaderboard(tournamentId: number | null) {
    return usePollingData<LeaderboardPlayer[]>(
        () => fetchLeaderboard(tournamentId!),
        {
            cacheKey: tournamentId ? sharedKeys.leaderboard(tournamentId) : 'disabled:leaderboard',
            interval: POLLING_INTERVALS.ONCE,
            enabled: !!tournamentId,
        }
    );
}

/**
 * Shared top startups data for a specific tournament.
 * Fetched once on load (preloaded). No auto-polling — data changes only when scorer runs.
 */
export function useSharedTopStartups(tournamentId: number | null) {
    return usePollingData<TopStartup[]>(
        () => fetchTopStartups(tournamentId!),
        {
            cacheKey: tournamentId ? sharedKeys.topStartups(tournamentId) : 'disabled:topStartups',
            interval: POLLING_INTERVALS.ONCE,
            enabled: !!tournamentId,
        }
    );
}

// ── Preload seeding ──
// Call once from preload.ts to seed shared cache keys with preloaded data
// so usePollingData finds data immediately on first render (no spinner).

export function seedSharedCache(
    tournament: TournamentData | null,
    leaderboard?: LeaderboardPlayer[],
    topStartups?: TopStartup[]
) {
    if (tournament) {
        blockchainCache.set(sharedKeys.activeTournament(), tournament);
        if (leaderboard) {
            blockchainCache.set(sharedKeys.leaderboard(tournament.id), leaderboard);
        }
        if (topStartups) {
            blockchainCache.set(sharedKeys.topStartups(tournament.id), topStartups);
        }
    }
}
