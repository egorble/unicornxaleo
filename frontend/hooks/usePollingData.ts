// Universal hook for cache-first data with auto-polling
// Shows cached data immediately, refreshes in background

import { useState, useEffect, useCallback, useRef } from 'react';
import { blockchainCache, POLLING_INTERVALS } from '../lib/cache';

type UsePollingDataOptions = {
    interval?: number;       // Polling interval in ms
    enabled?: boolean;       // Whether to enable polling
    cacheKey: string;        // Unique cache key for this data
};

type UsePollingDataResult<T> = {
    data: T | undefined;
    isLoading: boolean;
    isStale: boolean;
    error: string | null;
    refresh: () => Promise<void>;
    lastUpdated: Date | null;
};

export function usePollingData<T>(
    fetcher: () => Promise<T>,
    options: UsePollingDataOptions
): UsePollingDataResult<T> {
    const {
        interval = POLLING_INTERVALS.NORMAL,
        enabled = true,
        cacheKey
    } = options;

    // Use ref to store fetcher to avoid infinite loops from dependency changes
    const fetcherRef = useRef(fetcher);
    useEffect(() => {
        fetcherRef.current = fetcher;
    }, [fetcher]);

    const [data, setData] = useState<T | undefined>(() => blockchainCache.get<T>(cacheKey));
    const [isLoading, setIsLoading] = useState(false);
    const [isStale, setIsStale] = useState(blockchainCache.isStale(cacheKey));
    const [error, setError] = useState<string | null>(null);
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

    // Manual refresh function
    const refresh = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            const freshData = await fetcherRef.current();
            blockchainCache.set(cacheKey, freshData);
            setData(freshData);
            setIsStale(false);
            setLastUpdated(new Date());
        } catch (e: any) {
            setError(e.message || 'Failed to fetch data');
            // Keep showing stale data if available
        } finally {
            setIsLoading(false);
        }
    }, [cacheKey]);

    useEffect(() => {
        if (!enabled) return;

        // Subscribe to cache updates
        const unsubscribe = blockchainCache.subscribe<T>(
            cacheKey,
            () => fetcherRef.current(),
            (newData) => {
                setData(newData);
                setIsStale(false);
                setLastUpdated(new Date());
            },
            interval
        );

        // Initial fetch if no cached data
        const cached = blockchainCache.get<T>(cacheKey);
        if (cached === undefined) {
            setIsLoading(true);
            fetcherRef.current()
                .then(freshData => {
                    blockchainCache.set(cacheKey, freshData);
                    setData(freshData);
                    setLastUpdated(new Date());
                })
                .catch(e => setError(e.message))
                .finally(() => setIsLoading(false));
        } else {
            setData(cached);
            setIsStale(blockchainCache.isStale(cacheKey, interval));
        }

        // Cleanup subscription on unmount
        return () => {
            unsubscribe();
        };
    }, [cacheKey, interval, enabled]);

    return {
        data,
        isLoading,
        isStale,
        error,
        refresh,
        lastUpdated
    };
}

// Convenience hook for simple use cases
export function useAutoRefresh<T>(
    fetcher: () => Promise<T>,
    cacheKey: string,
    intervalMs: number = POLLING_INTERVALS.NORMAL
): [T | undefined, boolean, () => Promise<void>] {
    const { data, isLoading, refresh } = usePollingData(fetcher, {
        cacheKey,
        interval: intervalMs,
        enabled: true
    });
    return [data, isLoading, refresh];
}
