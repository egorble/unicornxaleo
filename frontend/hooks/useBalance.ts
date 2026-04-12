// Balance hook — Aleo version. Reads public balance from credits.aleo mapping.
// Returns microcredits as bigint (same API as EVM hook).

import { useState, useEffect, useCallback, useMemo } from 'react';
import { blockchainCache, CacheKeys, POLLING_INTERVALS } from '../lib/cache';
import { getAleoBalance } from '../lib/contracts';

type UseBalanceResult = {
    balance: bigint;
    formatted: string;
    isLoading: boolean;
    error: string | null;
    refresh: () => Promise<void>;
};

export function useBalance(address?: string): UseBalanceResult {
    const cacheKey = address ? CacheKeys.balance(address) : '';

    const [balance, setBalance] = useState<bigint>(() => {
        if (!address) return 0n;
        return blockchainCache.get<bigint>(cacheKey) ?? 0n;
    });
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Format microcredits → ALEO string
    const formatted = useMemo(() => {
        try {
            const aleo = Number(balance) / 1_000_000;
            if (aleo === 0) return '0';
            if (aleo < 0.0001) return '<0.0001';
            return aleo.toFixed(4).replace(/\.?0+$/, '');
        } catch {
            return '0';
        }
    }, [balance]);

    const refresh = useCallback(async () => {
        if (!address) return;
        setIsLoading(true);
        setError(null);
        try {
            const bal = await getAleoBalance(address);
            setBalance(bal);
            blockchainCache.set(cacheKey, bal);
        } catch (e: any) {
            setError(e?.message || 'Failed to fetch balance');
        } finally {
            setIsLoading(false);
        }
    }, [address, cacheKey]);

    useEffect(() => {
        if (!address) {
            setBalance(0n);
            return;
        }
        refresh();
        const interval = setInterval(refresh, POLLING_INTERVALS?.balance || 10000);
        return () => clearInterval(interval);
    }, [address, refresh]);

    return { balance, formatted, isLoading, error, refresh };
}
