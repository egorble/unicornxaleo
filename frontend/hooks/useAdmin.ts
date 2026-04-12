// Admin hook — Aleo version. Admin ops go through backend (which holds admin key).
// Same API shape as original EVM hook.

import { useState, useCallback } from 'react';
import { readAleoMapping, getAleoBlockHeight, formatXTZ, STARTUPS } from '../lib/contracts';
import { ALEO_ADMIN, ALEO_ENDPOINT, ALEO_NETWORK } from '../lib/networks';

const API_URL = (import.meta as any).env?.VITE_API_URL || '';
function apiUrl(path: string) {
    return API_URL ? `${API_URL}${path}` : path;
}

// Admin addresses — Aleo admin from deployed contract
export const ADMIN_ADDRESSES = [ALEO_ADMIN.toLowerCase()];

export function isAdmin(address: string | null): boolean {
    if (!address) return false;
    return address.toLowerCase() === ALEO_ADMIN.toLowerCase();
}

export interface ContractBalances {
    nft: bigint;
    packOpener: bigint;
    tournament: bigint;
}

export interface RarityStats {
    common: number;
    rare: number;
    epic: number;
    legendary: number;
}

export interface AdminStats {
    packsSold: number;
    packPrice: bigint;
    totalNFTs: number;
    activeTournamentId: number;
    nextTournamentId: number;
    rarityStats: RarityStats;
    marketplaceVolume: bigint;
    marketplaceSales: number;
    royaltiesEarned: bigint;
    uniqueBuyers: number;
}

export interface TournamentData {
    id: number;
    registrationStart: number;
    startTime: number;
    endTime: number;
    prizePool: bigint;
    entryCount: number;
    status: number;
}

const NOT_SUPPORTED = 'Admin operation must be run via backend';

export function useAdmin() {
    const [isLoading, _setIsLoading] = useState(false);
    const [error, _setError] = useState<string | null>(null);

    const getContractBalances = useCallback(async (): Promise<ContractBalances> => {
        return { nft: 0n, packOpener: 0n, tournament: 0n };
    }, []);

    const getAdminStats = useCallback(async (): Promise<AdminStats> => {
        const [packsSoldStr, packPriceStr, totalCardsStr] = await Promise.all([
            readAleoMapping('total_packs_sold', '0u8'),
            readAleoMapping('pack_price', '0u8'),
            readAleoMapping('total_cards_minted', '0u8'),
        ]);
        const packsSold = parseInt((packsSoldStr || '0').replace(/u\d+/, ''));
        const packPrice = BigInt((packPriceStr || '100000').replace(/u\d+/, ''));
        const totalNFTs = parseInt((totalCardsStr || '0').replace(/u\d+/, ''));

        // Count per-rarity mints by summing startup_editions
        const rarityStats: RarityStats = { common: 0, rare: 0, epic: 0, legendary: 0 };
        for (let id = 1; id <= 19; id++) {
            try {
                const ed = await readAleoMapping('startup_editions', `${id}u8`);
                const count = parseInt((ed || '0').replace(/u\d+/, ''));
                const s = STARTUPS[id];
                if (!s) continue;
                if (s.rarity === 'Common') rarityStats.common += count;
                else if (s.rarity === 'Rare') rarityStats.rare += count;
                else if (s.rarity === 'Epic') rarityStats.epic += count;
                else if (s.rarity === 'Legendary') rarityStats.legendary += count;
            } catch { /* skip */ }
        }

        return {
            packsSold, packPrice, totalNFTs,
            activeTournamentId: 2,
            nextTournamentId: 3,
            rarityStats,
            marketplaceVolume: 0n,
            marketplaceSales: 0,
            royaltiesEarned: 0n,
            uniqueBuyers: 0,
        };
    }, []);

    const getTournaments = useCallback(async (): Promise<TournamentData[]> => {
        const list: TournamentData[] = [];
        // v10: read next_tournament_id counter → iterate 1..(next-1)
        const nextIdStr = await readAleoMapping('next_tournament_id', '0u8');
        const nextId = nextIdStr ? parseInt(nextIdStr.replace(/u\d+/, '')) : 1;

        for (let id = 1; id < nextId; id++) {
            const data = await readAleoMapping('tournaments', `${id}field`);
            if (!data) continue;
            const getField = (k: string) => {
                const m = data.match(new RegExp(`${k}:\\s*(\\d+)u\\d+`));
                return m ? parseInt(m[1]) : 0;
            };
            list.push({
                id,
                registrationStart: getField('registration_height'),
                startTime: getField('start_height'),
                endTime: getField('end_height'),
                prizePool: BigInt(getField('prize_pool')),
                entryCount: getField('entry_count'),
                status: getField('status'),
            });
        }
        return list;
    }, []);

    // Admin write ops — call backend
    const callBackend = async (path: string, body: any = {}) => {
        const res = await fetch(apiUrl(`/api/admin${path}`), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Admin-Key': localStorage.getItem('unicornx:admin-key') || '' },
            body: JSON.stringify(body),
        });
        return res.json();
    };

    const withdrawPackOpener = useCallback(async (_signer: any) => {
        return callBackend('/withdraw-pack-opener');
    }, []);

    const setPackPrice = useCallback(async (_signer: any, newPrice: bigint) => {
        return callBackend('/set-pack-price', { price: newPrice.toString() });
    }, []);

    const setActiveTournament = useCallback(async (_signer: any, _tournamentId: number) => {
        // v9: no-op, tournament is identified by ID used in enter_tournament directly
        return { success: true };
    }, []);

    const pausePackOpener = useCallback(async (_signer: any) => ({ error: NOT_SUPPORTED }), []);
    const unpausePackOpener = useCallback(async (_signer: any) => ({ error: NOT_SUPPORTED }), []);

    const createTournament = useCallback(async (
        signer: any,
        registrationStart: number,
        startTime: number,
        endTime: number
    ) => {
        try {
            if (!signer?._isAleoSigner) return { success: false, error: 'Aleo wallet required' };

            // Convert Unix timestamps → block heights (~1 block per 2s on Aleo)
            const now = Math.floor(Date.now() / 1000);
            const res = await fetch(`${ALEO_ENDPOINT}/${ALEO_NETWORK}/block/height/latest`);
            const currentHeight = parseInt(await res.text());
            const BLOCK_TIME = 2;

            const regHeight = Math.max(currentHeight + 1, currentHeight + Math.floor((registrationStart - now) / BLOCK_TIME));
            const startHeight = currentHeight + Math.floor((startTime - now) / BLOCK_TIME);
            const endHeight = currentHeight + Math.floor((endTime - now) / BLOCK_TIME);

            if (startHeight <= regHeight) return { success: false, error: 'Start must be after registration' };
            if (endHeight <= startHeight) return { success: false, error: 'End must be after start' };

            // v10: tournament_id auto-generated by contract via next_tournament_id counter
            // Read counter BEFORE tx to predict the new ID
            const nextIdStr = await readAleoMapping('next_tournament_id', '0u8');
            const nextId = nextIdStr ? parseInt(nextIdStr.replace(/u\d+/, '')) : 1;

            await signer.execute('create_tournament', [
                `${regHeight}u32`,
                `${startHeight}u32`,
                `${endHeight}u32`,
            ], 300000);

            return { success: true, tournamentId: nextId };
        } catch (e: any) {
            return { success: false, error: e?.message || 'Failed to create tournament' };
        }
    }, []);

    const finalizeTournament = useCallback(async (signer: any, tournamentId: number) => {
        try {
            if (!signer?._isAleoSigner) return { success: false, error: 'Aleo wallet required' };
            await signer.execute('finalize_tournament', [`${tournamentId}field`], 300000);
            return { success: true };
        } catch (e: any) {
            return { success: false, error: e?.message || 'Failed to finalize' };
        }
    }, []);

    const finalizeWithPoints = useCallback(async (signer: any, tournamentId: number, _points: number[]) => {
        // v9: use same finalize_tournament (scoring is separate via set_startup_scores + calculate_score)
        return finalizeTournament(signer, tournamentId);
    }, [finalizeTournament]);

    const cancelTournament = useCallback(async (signer: any, tournamentId: number) => {
        try {
            if (!signer?._isAleoSigner) return { success: false, error: 'Aleo wallet required' };
            await signer.execute('cancel_tournament', [`${tournamentId}field`], 300000);
            return { success: true };
        } catch (e: any) {
            return { success: false, error: e?.message || 'Failed to cancel' };
        }
    }, []);

    const withdrawFromPrizePool = useCallback(async () => ({ error: NOT_SUPPORTED }), []);
    const emergencyWithdrawTournament = useCallback(async () => ({ error: NOT_SUPPORTED }), []);
    const pauseTournament = useCallback(async () => ({ error: NOT_SUPPORTED }), []);
    const unpauseTournament = useCallback(async () => ({ error: NOT_SUPPORTED }), []);

    return {
        isLoading, error,
        getContractBalances, getAdminStats, getTournaments,
        withdrawPackOpener, setPackPrice, setActiveTournament,
        pausePackOpener, unpausePackOpener,
        createTournament, finalizeTournament, finalizeWithPoints,
        cancelTournament, withdrawFromPrizePool, emergencyWithdrawTournament,
        pauseTournament, unpauseTournament,
    };
}
