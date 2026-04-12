// Tournament hook — Aleo version. Same API as the original EVM hook.
// Cards passed to enter_tournament are private records — ZK hides the lineup.

import { useState, useCallback } from 'react';
import { getTournamentContract, getPackOpenerContract, readAleoMapping, getAleoBlockHeight } from '../lib/contracts';
import { blockchainCache, CacheKeys, CacheTTL } from '../lib/cache';
import { parseCardRecord } from './usePacks';
import { computeEntryKey, readMapping } from '../lib/aleoCrypto';
import { ALEO_PROGRAM_ID, ALEO_NETWORK } from '../lib/networks';

// Persisted lineup record so we can rebuild CardProofs later for unlock_cards.
interface StoredLineupCard {
    rawCardId: string;
    salt: string;
    cardOwner: string;
    startupId: number;
    rarity: number;
    level: number;
}
function lineupKey(tournamentId: number, address: string) {
    return `lineup:${ALEO_NETWORK}:${ALEO_PROGRAM_ID}:${tournamentId}:${address}`;
}
export function saveLineup(tournamentId: number, address: string, cards: StoredLineupCard[]) {
    try { localStorage.setItem(lineupKey(tournamentId, address), JSON.stringify(cards)); } catch { /* quota */ }
}
export function loadLineup(tournamentId: number, address: string): StoredLineupCard[] | null {
    try {
        const raw = localStorage.getItem(lineupKey(tournamentId, address));
        if (!raw) return null;
        const arr = JSON.parse(raw);
        return Array.isArray(arr) && arr.length === 5 ? arr : null;
    } catch { return null; }
}
export function clearLineup(tournamentId: number, address: string) {
    try { localStorage.removeItem(lineupKey(tournamentId, address)); } catch { /* noop */ }
}

function cardToProofParts(c: any, fallbackOwner: string): StoredLineupCard {
    const card = typeof c === 'string' ? parseCardRecord(c) : c;
    if (!card) throw new Error('Invalid card data');
    const rarityMap: Record<string, number> = { 'Common': 0, 'Rare': 1, 'Epic': 2, 'EpicRare': 2, 'Legendary': 3 };
    return {
        rawCardId: card._rawCardId || '0',
        salt: card._salt || '0',
        cardOwner: card._cardOwner || fallbackOwner,
        startupId: card.startupId || 0,
        rarity: typeof card.rarity === 'string' ? (rarityMap[card.rarity] ?? 0) : card.rarity,
        level: card.level || 1,
    };
}
function proofLiteral(p: StoredLineupCard): string {
    return `{ card_id: ${p.rawCardId}field, card_owner: ${p.cardOwner}, startup_id: ${p.startupId}u8, rarity: ${p.rarity}u8, level: ${p.level}u8, salt: ${p.salt}field }`;
}

export interface Tournament {
    id: number;
    registrationStart: number;
    startTime: number;
    endTime: number;
    prizePool: bigint;
    entryCount: number;
    status: 'Created' | 'Active' | 'Finalized' | 'Cancelled';
}

export interface Lineup {
    cardIds: number[];
    owner: string;
    timestamp: number;
    cancelled: boolean;
    claimed: boolean;
}

const STATUS_MAP: Record<number, Tournament['status']> = {
    0: 'Created',
    1: 'Active',
    2: 'Finalized',
    3: 'Cancelled',
};

export function useTournament() {
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Get active tournament ID — find the latest tournament in "active" or "registration" phase
    // v10: iterate 1..next_tournament_id, return the first non-finalized one with status 0 (Open)
    const getActiveTournamentId = useCallback(async (): Promise<number> => {
        try {
            const nextIdStr = await readAleoMapping('next_tournament_id', '0u8');
            const nextId = nextIdStr ? parseInt(String(nextIdStr).replace(/u\d+/, '')) : 1;
            if (nextId <= 1) return 0; // no tournaments

            const currentHeight = await getAleoBlockHeight();

            // Find most recent active (not finalized/cancelled) tournament
            for (let id = nextId - 1; id >= 1; id--) {
                const data = await readAleoMapping('tournaments', `${id}field`);
                if (!data) continue;
                const statusMatch = data.match(/status:\s*(\d+)u8/);
                const endMatch = data.match(/end_height:\s*(\d+)u32/);
                const status = statusMatch ? parseInt(statusMatch[1]) : 0;
                const endHeight = endMatch ? parseInt(endMatch[1]) : 0;
                // status 0 = open, 2 = finalized, 3 = cancelled
                if (status === 0 && currentHeight < endHeight) {
                    return id;
                }
            }
            // No active — return latest even if ended
            return nextId - 1;
        } catch { return 0; }
    }, []);

    // Get tournament info (from Aleo mapping via contracts wrapper)
    const getTournament = useCallback(async (tournamentId: number): Promise<Tournament | null> => {
        const key = CacheKeys.tournament(tournamentId);
        const cached = blockchainCache.get<Tournament>(key);
        if (cached !== undefined) return cached;

        return blockchainCache.getOrFetch(key, async () => {
            try {
                const contract = getTournamentContract();
                const t = await contract.getTournament(tournamentId);
                return {
                    id: Number(t.id),
                    registrationStart: Number(t.registrationStart),
                    startTime: Number(t.startTime),
                    endTime: Number(t.endTime),
                    prizePool: t.prizePool,
                    entryCount: Number(t.entryCount),
                    status: STATUS_MAP[Number(t.status)] || 'Created',
                };
            } catch { return null; }
        }, CacheTTL.DEFAULT);
    }, []);

    // Can register right now? (block height based on Aleo contract)
    const canRegister = useCallback(async (tournamentId: number): Promise<boolean> => {
        const key = CacheKeys.canRegister(tournamentId);
        const cached = blockchainCache.get<boolean>(key);
        if (cached !== undefined) return cached;

        return blockchainCache.getOrFetch(key, async () => {
            try {
                const data = await readAleoMapping('tournaments', `${tournamentId}field`);
                if (!data) return false;
                const getField = (k: string) => {
                    const m = data.match(new RegExp(`${k}:\\s*(\\d+)u\\d+`));
                    return m ? parseInt(m[1]) : 0;
                };
                const blockHeight = await getAleoBlockHeight();
                const status = getField('status');
                const regHeight = getField('registration_height');
                const startHeight = getField('start_height');
                return status === 0 && blockHeight >= regHeight && blockHeight < startHeight;
            } catch { return false; }
        }, CacheTTL.SHORT);
    }, []);

    // Has the user entered? Computes entry_key = BHP256::hash_to_field(PlayerTournament { tournament_id, player })
    // and reads the `player_entered` mapping on-chain.
    const hasEntered = useCallback(async (tournamentId: number, address: string): Promise<boolean> => {
        try {
            if (!address || !tournamentId) return false;
            const key = await computeEntryKey(tournamentId, address);
            if (!key) return false;
            const val = await readMapping('player_entered', key);
            if (!val) return false;
            return String(val).trim() === 'true';
        } catch (e) {
            console.warn('[hasEntered] failed:', e);
            return false;
        }
    }, []);

    // User lineup is private on Aleo — return null (UI should read records directly)
    const getUserLineup = useCallback(async (_tournamentId: number, _address: string): Promise<Lineup | null> => {
        return null;
    }, []);

    // Enter tournament with 5 private card records
    // cardIds in original EVM are uint256; on Aleo we receive card record plaintexts from the caller.
    // The signer.execute call feeds these directly into enter_tournament.
    const enterTournament = useCallback(async (
        signer: any,
        tournamentId: number,
        cardIds: [any, any, any, any, any]
    ): Promise<{ success: boolean; error?: string }> => {
        setIsLoading(true);
        setError(null);

        try {
            if (!signer?._isAleoSigner) throw new Error('Aleo wallet required');

            // Block double-entry: check player_entered mapping first
            const entryKey = await computeEntryKey(tournamentId, signer.address);
            if (entryKey) {
                const already = await readMapping('player_entered', entryKey);
                if (already && String(already).trim() === 'true') {
                    throw new Error('You are already registered in this tournament');
                }
            }

            // Build CardProof structs from card data (NOT record plaintexts!)
            const parts = cardIds.map((c: any) => cardToProofParts(c, signer.address));
            const proofs = parts.map(proofLiteral);

            await signer.execute('enter_tournament', [
                ...proofs,
                `${tournamentId}field`,
            ], 700000);

            // Persist lineup so we can rebuild CardProofs for unlock_cards later,
            // even if the player's Card records rotate (merge/upgrade/etc).
            saveLineup(tournamentId, signer.address, parts);

            blockchainCache.invalidate(CacheKeys.tournament(tournamentId));
            return { success: true };
        } catch (e: any) {
            const msg = e?.message || 'Failed to enter tournament';
            setError(msg);
            return { success: false, error: msg };
        } finally {
            setIsLoading(false);
        }
    }, []);

    // Cancel tournament entry — consumes LineupCommitment record, returns 5 Card records
    const cancelEntry = useCallback(async (
        signer: any,
        tournamentId: number
    ): Promise<{ success: boolean; error?: string }> => {
        setIsLoading(true);
        setError(null);

        try {
            if (!signer?._isAleoSigner) throw new Error('Aleo wallet required');

            const records = await signer.requestRecords();
            const lineup = records.find((r: any) => {
                const pt = r.plaintext || r.data || '';
                return pt.includes('card1_id') && pt.includes(`tournament_id: ${tournamentId}field`);
            });
            if (!lineup) return { success: false, error: 'No tournament entry found' };

            await signer.execute('cancel_entry', [lineup.plaintext || lineup.data], 700000);

            blockchainCache.invalidate(CacheKeys.tournament(tournamentId));
            return { success: true };
        } catch (e: any) {
            const msg = e?.message || 'Failed to cancel entry';
            setError(msg);
            return { success: false, error: msg };
        } finally {
            setIsLoading(false);
        }
    }, []);

    // Fetch the public plaintext StartupScores object from backend (published after tournament end).
    const fetchFinalScores = useCallback(async (tournamentId: number): Promise<Record<string, number> | null> => {
        try {
            const base = (import.meta as any).env?.VITE_API_URL || '';
            const res = await fetch(`${base}/api/tournaments/${tournamentId}/final-scores`);
            if (!res.ok) return null;
            const json = await res.json();
            return json.scores || null;
        } catch { return null; }
    }, []);

    // Read my final score from player_score mapping (only populated after user calls calculate_score).
    const getMyScore = useCallback(async (tournamentId: number, address: string): Promise<bigint | null> => {
        try {
            if (!tournamentId || !address) return null;
            const key = await computeEntryKey(tournamentId, address);
            if (!key) return null;
            const v = await readMapping('player_score', key);
            if (!v) return null;
            const num = String(v).replace(/u\d+/, '');
            return BigInt(num);
        } catch { return null; }
    }, []);

    // Build a StartupScores Leo struct literal from a { s1..s19 } map.
    const buildScoresLiteral = (scores: Record<string, number>): string => {
        const parts: string[] = [];
        for (let i = 1; i <= 19; i++) {
            const v = scores[`s${i}`] ?? 0;
            parts.push(`s${i}: ${v}u64`);
        }
        return `{ ${parts.join(', ')} }`;
    };

    // Calculate my tournament score: fetches final scores from backend, builds 5 CardProofs
    // from stored lineup (or supplied cards fallback), calls calculate_score transition.
    const calculateScore = useCallback(async (
        signer: any,
        tournamentId: number,
        fallbackCards?: [any, any, any, any, any]
    ): Promise<{ success: boolean; error?: string }> => {
        setIsLoading(true);
        setError(null);
        try {
            if (!signer?._isAleoSigner) throw new Error('Aleo wallet required');

            // Scores must be published on-chain first (scores_hash set by admin)
            const hash = await readAleoMapping('scores_hash', `${tournamentId}field`);
            if (!hash) throw new Error('Admin has not published final scores yet');

            const scores = await fetchFinalScores(tournamentId);
            if (!scores) throw new Error('Backend does not have final scores plaintext');

            // Rebuild 5 CardProofs from stored lineup (preferred) or caller-supplied fallback.
            let parts = loadLineup(tournamentId, signer.address);
            if (!parts) {
                if (!fallbackCards || fallbackCards.length !== 5) {
                    throw new Error('No saved lineup — please pass 5 locked cards');
                }
                parts = fallbackCards.map((c: any) => cardToProofParts(c, signer.address));
            }

            const proofs = parts.map(proofLiteral);
            const scoresLit = buildScoresLiteral(scores);

            await signer.execute('calculate_score', [
                ...proofs,
                `${tournamentId}field`,
                scoresLit,
            ], 800000);

            return { success: true };
        } catch (e: any) {
            const msg = e?.message || 'Failed to calculate score';
            setError(msg);
            return { success: false, error: msg };
        } finally {
            setIsLoading(false);
        }
    }, [fetchFinalScores]);

    // Unlock cards from a Finalized (2) or Cancelled (3) tournament.
    // Requires 5 CardProof structs matching the locked commitments.
    // Priority: stored lineup (from enter) → caller-supplied cards fallback.
    const unlockCards = useCallback(async (
        signer: any,
        tournamentId: number,
        fallbackCards?: [any, any, any, any, any]
    ): Promise<{ success: boolean; error?: string }> => {
        setIsLoading(true);
        setError(null);

        try {
            if (!signer?._isAleoSigner) throw new Error('Aleo wallet required');

            // Verify tournament status on-chain so we fail fast
            const data = await readAleoMapping('tournaments', `${tournamentId}field`);
            if (!data) throw new Error('Tournament not found');
            const statusMatch = data.match(/status:\s*(\d+)u8/);
            const status = statusMatch ? parseInt(statusMatch[1]) : 0;
            if (status !== 2 && status !== 3) {
                throw new Error('Tournament must be Finalized or Cancelled to unlock');
            }

            let parts = loadLineup(tournamentId, signer.address);
            if (!parts) {
                if (!fallbackCards || fallbackCards.length !== 5) {
                    throw new Error('No saved lineup — please pass 5 locked cards to unlock');
                }
                parts = fallbackCards.map((c: any) => cardToProofParts(c, signer.address));
            }

            const proofs = parts.map(proofLiteral);
            await signer.execute('unlock_cards', [
                ...proofs,
                `${tournamentId}field`,
            ], 700000);

            clearLineup(tournamentId, signer.address);
            return { success: true };
        } catch (e: any) {
            const msg = e?.message || 'Failed to unlock cards';
            setError(msg);
            return { success: false, error: msg };
        } finally {
            setIsLoading(false);
        }
    }, []);

    // Phase string
    const getPhase = useCallback(async (tournamentId: number): Promise<string> => {
        try {
            const data = await readAleoMapping('tournaments', `${tournamentId}field`);
            if (!data) return 'Unknown';
            const getField = (k: string) => {
                const m = data.match(new RegExp(`${k}:\\s*(\\d+)u\\d+`));
                return m ? parseInt(m[1]) : 0;
            };
            const status = getField('status');
            if (status === 2) return 'Finalized';
            if (status === 3) return 'Cancelled';

            const blockHeight = await getAleoBlockHeight();
            const regH = getField('registration_height');
            const startH = getField('start_height');
            const endH = getField('end_height');

            if (blockHeight < regH) return 'Upcoming';
            if (blockHeight < startH) return 'Registration';
            if (blockHeight < endH) return 'Active';
            return 'Ended';
        } catch {
            return 'Unknown';
        }
    }, []);

    // Public per-player score (read from Aleo mapping by entry_key hash)
    // We don't have a way to compute hash client-side; return null.
    const getUserScoreInfo = useCallback(async (_tournamentId: number, _address: string): Promise<{ score: bigint; prize: bigint; totalScore: bigint } | null> => {
        return null;
    }, []);

    // v10: read from on-chain counter mapping
    const getNextTournamentId = useCallback(async (): Promise<number> => {
        try {
            const val = await readAleoMapping('next_tournament_id', '0u8');
            return val ? parseInt(String(val).replace(/u\d+/, '')) : 1;
        } catch {
            return 1;
        }
    }, []);

    // Claim prize — on Aleo, prize is distributed by admin via distribute_prize.
    // Frontend only waits for credits record to arrive in wallet.
    const claimPrize = useCallback(async (
        _signer: any,
        _tournamentId: number
    ): Promise<{ success: boolean; error?: string }> => {
        return {
            success: false,
            error: 'Prizes are distributed by admin on Aleo. Watch for credit records in your wallet.',
        };
    }, []);

    return {
        isLoading,
        error,
        getActiveTournamentId,
        getNextTournamentId,
        getTournament,
        canRegister,
        hasEntered,
        getUserLineup,
        enterTournament,
        cancelEntry,
        unlockCards,
        calculateScore,
        fetchFinalScores,
        getMyScore,
        getPhase,
        getUserScoreInfo,
        claimPrize,
    };
}
