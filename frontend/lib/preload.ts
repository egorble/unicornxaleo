// Preloader: fires all dashboard API calls in parallel on import
// Import this BEFORE App.tsx to start fetching while React is still mounting
//
// Flow:
// 1. Module imported → all fetches fire immediately (parallel)
// 2. React mounts → components check preloaded data → instant render (no spinner)
// 3. Components still poll on their own intervals for updates

import { blockchainCache } from './cache';
import { apiUrl } from './api';
import { useGLTF } from '@react-three/drei';
import { seedSharedCache } from '../hooks/useSharedData';

// ── Preload 3D assets (fire-and-forget) ──
// These start downloading immediately on import but DON'T block splash.
// GLB: drei's GLTFLoader parses + caches (useGLTF() is instant later)
// HDR: browser-cached so useEnvironment() gets a cache hit later
const GLB_PATH = '/aleo-pack.glb';
const BOOST_GLB_PATH = '/boost-pack.glb';
const ENV_HDR = '/env-city.hdr';
useGLTF.preload(GLB_PATH, false, true);
useGLTF.preload(BOOST_GLB_PATH, false, true);
fetch(ENV_HDR).catch(() => {}); // warm browser cache, don't await

// ── Cache keys for preloaded data ──
export const PreloadKeys = {
    activeTournament: 'preload:tournament',
    liveFeed: 'preload:livefeed',
    leaderboard: (id: number) => `preload:leaderboard:${id}`,
    topStartups: (id: number) => `preload:topStartups:${id}`,
};

// ── Preload state ──
let _tournamentId: number | null = null;

/** Get preloaded tournament ID (null if not yet loaded) */
export function getPreloadedTournamentId(): number | null {
    return _tournamentId;
}

/** Reset preload state and re-fetch network-specific data only.
 *  Live feed + images are shared across networks — skip them.
 *  Old cached data stays so components don't flash blank. */
export function resetPreloadState(): void {
    _tournamentId = null;
    preloadNetworkData();
}

// ── Preload all 19 startup images into browser cache ──
function preloadImages(): Promise<void> {
    const STARTUP_COUNT = 19;
    const promises: Promise<void>[] = [];
    for (let i = 1; i <= STARTUP_COUNT; i++) {
        promises.push(new Promise((resolve) => {
            const img = new Image();
            img.onload = () => resolve();
            img.onerror = () => resolve();
            img.src = `/images/${i}.png`;
        }));
    }
    return Promise.all(promises).then(() => {});
}

// ── Network-switch preload (tournament + leaderboard only) ──
// Live feed & top startups are shared across networks — skip them.
async function preloadNetworkData() {
    try {
        const tournamentRes = await fetch(apiUrl('/tournaments/active')).then(r => r.json()).catch(() => null);
        if (tournamentRes?.success) {
            blockchainCache.set(PreloadKeys.activeTournament, tournamentRes.data);
            _tournamentId = tournamentRes.data.id;
        }
        let leaderboardData;
        if (_tournamentId) {
            const leaderboardRes = await fetch(apiUrl(`/leaderboard/${_tournamentId}?limit=10`)).then(r => r.json()).catch(() => null);
            if (leaderboardRes?.success) {
                leaderboardData = leaderboardRes.data;
                blockchainCache.set(PreloadKeys.leaderboard(_tournamentId), leaderboardData);
            }
        }
        // Seed shared hooks so useActiveTournament/useSharedLeaderboard find data instantly
        if (tournamentRes?.success) {
            seedSharedCache(tournamentRes.data, leaderboardData);
        }
    } catch {}
}

// ── Full preload (first load only — includes live feed + images) ──
async function preloadAll() {
    // Fire images in parallel with API calls
    const imagePromise = preloadImages();

    try {
        // Phase 1: tournament + live feed in parallel
        const [tournamentRes, feedRes] = await Promise.all([
            fetch(apiUrl('/tournaments/active')).then(r => r.json()).catch(() => null),
            fetch('/api/live-feed?limit=15').then(r => r.json()).catch(() => null),
        ]);

        if (tournamentRes?.success) {
            blockchainCache.set(PreloadKeys.activeTournament, tournamentRes.data);
            _tournamentId = tournamentRes.data.id;
        }

        if (feedRes?.success) {
            blockchainCache.set(PreloadKeys.liveFeed, feedRes.data);
        }

        // Phase 2: leaderboard + top startups (need tournament ID)
        let leaderboardData, startupsData;
        if (_tournamentId) {
            const [leaderboardRes, startupsRes] = await Promise.all([
                fetch(apiUrl(`/leaderboard/${_tournamentId}?limit=10`)).then(r => r.json()).catch(() => null),
                fetch(apiUrl(`/top-startups/${_tournamentId}?limit=5`)).then(r => r.json()).catch(() => null),
            ]);

            if (leaderboardRes?.success) {
                leaderboardData = leaderboardRes.data;
                blockchainCache.set(PreloadKeys.leaderboard(_tournamentId), leaderboardData);
            }
            if (startupsRes?.success) {
                startupsData = startupsRes.data;
                blockchainCache.set(PreloadKeys.topStartups(_tournamentId), startupsData);
            }
        }

        // Seed shared hooks so useActiveTournament/useSharedLeaderboard/useSharedTopStartups
        // find data instantly on first render (no spinner)
        if (tournamentRes?.success) {
            seedSharedCache(tournamentRes.data, leaderboardData, startupsData);
        }

        // Wait for images to finish
        await imagePromise;
    } catch (e) {
    }
}

// Fire immediately on module import
export const preloadPromise = preloadAll();
