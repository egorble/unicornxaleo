// Dynamic API base URL helper
import { getActiveNetwork } from './networks';

/**
 * Returns the full API URL for a given path based on the active network.
 * Usage: fetch(apiUrl('/tournaments/active'))
 * Aleo: /api/tournaments/active
 */
export function apiUrl(path: string): string {
    return `${getActiveNetwork().apiBase}${path}`;
}

/**
 * Returns the full metadata URL for a token based on the active network.
 * Usage: fetch(metadataUrl(`/${tokenId}`))
 * Aleo: /metadata/1
 */
export function metadataUrl(path: string): string {
    return `${getActiveNetwork().metadataBase}${path}`;
}

/**
 * Safe JSON fetch — throws clear error when server returns HTML instead of JSON.
 * Catches cases like API server being down (nginx serves index.html fallback).
 */
export async function fetchJson<T = any>(url: string, init?: RequestInit): Promise<T> {
    const res = await fetch(url, init);
    // Throw on rate limit or server errors so blockchainCache preserves last good data
    if (res.status === 429) throw new Error('Rate limited — serving cached data');
    if (res.status >= 500) throw new Error(`Server error ${res.status}`);
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('application/json')) {
        throw new Error(`API unavailable (got ${ct || 'no content-type'} instead of JSON)`);
    }
    return res.json();
}
