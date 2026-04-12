// Tournament history hook — Aleo version. Reads tournaments from mapping.
// Same API as original EVM hook.

import { useState, useEffect, useCallback } from 'react';
import { readAleoMapping } from '../lib/contracts';
import { useTournament, loadLineup } from './useTournament';
import { computeEntryKey, readMapping } from '../lib/aleoCrypto';
import { useWalletContext } from '../context/WalletContext';
import { useNetwork } from '../context/NetworkContext';

const STATUS_MAP: Record<number, string> = {
    0: 'Created',
    1: 'Active',
    2: 'Finalized',
    3: 'Cancelled',
};

export interface PastTournamentEntry {
    tournamentId: number;
    startTime: number;
    endTime: number;
    prizePool: bigint;
    entryCount: number;
    status: string;
    userScore: bigint;
    userPrize: bigint;
    claimed: boolean;
    entered: boolean;       // did this address register?
    canUnlock: boolean;     // status is Finalized|Cancelled AND entered
    hasSavedLineup: boolean; // can unlock with stored lineup (no manual card pick)
}

export function useTournamentHistory(activeTournamentId: number) {
    const [entries, setEntries] = useState<PastTournamentEntry[]>([]);
    const [loading, setLoading] = useState(false);

    const { address } = useWalletContext();
    const { networkId } = useNetwork();
    const { claimPrize: contractClaimPrize, unlockCards: contractUnlockCards } = useTournament();

    useEffect(() => {
        if (!address || activeTournamentId <= 0) {
            setEntries([]);
            return;
        }

        let cancelled = false;

        const load = async () => {
            setLoading(true);
            const list: PastTournamentEntry[] = [];
            try {
                console.log('[useTournamentHistory] loading tournaments 1..', activeTournamentId, 'for', address);
                // Sequential to avoid any WASM/network race quirks
                for (let id = 1; id <= activeTournamentId; id++) {
                    try {
                        const data = await readAleoMapping('tournaments', `${id}field`);
                        if (!data) { console.log('[useTournamentHistory] t#', id, 'no data'); continue; }
                        const getField = (k: string) => {
                            const m = data.match(new RegExp(`${k}:\\s*(\\d+)u\\d+`));
                            return m ? parseInt(m[1]) : 0;
                        };
                        const status = getField('status');
                        const statusStr = STATUS_MAP[status] || 'Unknown';

                        let entered = false;
                        try {
                            const key = await computeEntryKey(id, address);
                            if (key) {
                                const v = await readMapping('player_entered', key);
                                entered = !!v && String(v).trim() === 'true';
                                console.log(`[useTournamentHistory] t#${id} entry_key=${key.slice(0, 16)}... entered=${entered} (raw="${v}")`);
                            } else {
                                console.warn(`[useTournamentHistory] t#${id} computeEntryKey returned null`);
                            }
                        } catch (e) {
                            console.warn(`[useTournamentHistory] t#${id} entry check failed:`, e);
                        }

                        const canUnlock = entered && (status === 2 || status === 3);
                        const hasSavedLineup = entered && !!loadLineup(id, address);

                        list.push({
                            tournamentId: id,
                            startTime: getField('start_height'),
                            endTime: getField('end_height'),
                            prizePool: BigInt(getField('prize_pool')),
                            entryCount: getField('entry_count'),
                            status: statusStr,
                            userScore: 0n,
                            userPrize: 0n,
                            claimed: false,
                            entered,
                            canUnlock,
                            hasSavedLineup,
                        });
                    } catch (e) {
                        console.warn(`[useTournamentHistory] t#${id} load failed:`, e);
                    }
                }
                console.log('[useTournamentHistory] done, total:', list.length);
                if (!cancelled) setEntries(list);
            } catch (e) {
                console.error('[useTournamentHistory] load crashed:', e);
                if (!cancelled) setEntries([]);
            } finally {
                if (!cancelled) setLoading(false);
            }
        };

        load();
        return () => { cancelled = true; };
    }, [activeTournamentId, address, networkId]);

    const claimPrize = useCallback(async (
        signer: any,
        tournamentId: number
    ): Promise<{ success: boolean; error?: string }> => {
        const result = await contractClaimPrize(signer, tournamentId);
        if (result.success) {
            setEntries(prev =>
                prev.map(e =>
                    e.tournamentId === tournamentId ? { ...e, claimed: true } : e
                )
            );
        }
        return result;
    }, [contractClaimPrize]);

    const unlockCards = useCallback(async (
        signer: any,
        tournamentId: number,
        fallbackCards?: [any, any, any, any, any]
    ): Promise<{ success: boolean; error?: string }> => {
        const result = await contractUnlockCards(signer, tournamentId, fallbackCards);
        if (result.success) {
            setEntries(prev =>
                prev.map(e =>
                    e.tournamentId === tournamentId ? { ...e, canUnlock: false, hasSavedLineup: false } : e
                )
            );
        }
        return result;
    }, [contractUnlockCards]);

    return { entries, loading, claimPrize, unlockCards };
}
