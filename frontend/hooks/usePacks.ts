// Pack hook — Aleo version. Two-step: buy Pack record, then open it.
// Preserves the same API as the original EVM hook (signer param, return shape).

import { useState, useCallback } from 'react';
import { STARTUPS, readAleoMapping, getAleoSigner, getAleoBlockHeight, invalidateMappingCache } from '../lib/contracts';
import { hashAddressField, readMapping } from '../lib/aleoCrypto';
import { CardData, Rarity } from '../types';
import { blockchainCache, CacheKeys } from '../lib/cache';

const API_URL = (import.meta as any).env?.VITE_API_URL || '';

function apiUrl(path: string) {
    return API_URL ? `${API_URL}${path}` : path;
}

// Map rarity strings → Rarity enum
const RARITY_STRING_MAP: Record<string, Rarity> = {
    'Common': Rarity.COMMON,
    'Rare': Rarity.RARE,
    'Epic': Rarity.EPIC,
    'EpicRare': Rarity.EPIC_RARE,
    'Legendary': Rarity.LEGENDARY,
};

// Map Aleo rarity u8 → Rarity enum
const RARITY_U8_MAP: Record<number, Rarity> = {
    0: Rarity.COMMON,
    1: Rarity.RARE,
    2: Rarity.EPIC,
    3: Rarity.LEGENDARY,
};

// Bidirectional map: raw card_id (string) ↔ safe-integer tokenId
// Aleo card_ids are 38+ digit numbers; we map them to JS-safe integers for UI use.
const _rawIdToTokenId = new Map<string, number>();
const _tokenIdToRawId = new Map<number, string>();
let _nextTokenIdSeq = 1;

// Syncing cards: minted by backend but not yet indexed by Shield wallet
// Key: "rawCardId:salt" (salt needed to distinguish L1 from L2 of same card after upgrade)
// Auto-expires after 2 minutes (Shield should index by then; if not, we'd rather not show stale syncing)
const SYNCING_TTL = 2 * 60 * 1000;
const _syncingCards = new Map<string, { data: CardData; addedAt: number }>();
const _syncingListeners = new Set<() => void>();

function pruneExpiredSyncing() {
    const now = Date.now();
    let changed = false;
    for (const [key, entry] of _syncingCards.entries()) {
        if (now - entry.addedAt > SYNCING_TTL) {
            _syncingCards.delete(key);
            changed = true;
        }
    }
    if (changed) _syncingListeners.forEach(cb => cb());
}

export function addSyncingCards(
    cards: { card_id: string; startup_id: number; rarity: number; salt?: string }[],
    getCardData: (c: any) => CardData
) {
    pruneExpiredSyncing();
    for (const c of cards) {
        const rawId = String(c.card_id).replace('field', '');
        const salt = String(c.salt || '0').replace('field', '');
        const data = getCardData(c);
        (data as any)._syncing = true;
        (data as any)._rawCardId = rawId;
        (data as any)._salt = salt;
        _syncingCards.set(`${rawId}:${salt}`, { data, addedAt: Date.now() });
        console.log(`[addSyncingCards] ${rawId.slice(0,10)}...:${salt.slice(0,8)} (total syncing: ${_syncingCards.size})`);
    }
    _syncingListeners.forEach(cb => cb());
}

export function removeSyncedCard(rawCardId: string, salt?: string) {
    if (salt !== undefined) {
        if (_syncingCards.delete(`${rawCardId}:${salt}`)) _syncingListeners.forEach(cb => cb());
        return;
    }
    // No salt given — remove all versions of this card_id
    let changed = false;
    for (const key of Array.from(_syncingCards.keys())) {
        if (key.startsWith(`${rawCardId}:`)) { _syncingCards.delete(key); changed = true; }
    }
    if (changed) _syncingListeners.forEach(cb => cb());
}

export function hasSyncingMatch(rawCardId: string, salt: string): boolean {
    return _syncingCards.has(`${rawCardId}:${salt}`);
}

export function getSyncingCards(): CardData[] {
    pruneExpiredSyncing();
    return Array.from(_syncingCards.values()).map(e => e.data);
}

export function subscribeSyncingCards(cb: () => void) {
    _syncingListeners.add(cb);
    return () => { _syncingListeners.delete(cb); };
}

export function rawCardIdToTokenId(rawId: string): number {
    if (_rawIdToTokenId.has(rawId)) return _rawIdToTokenId.get(rawId)!;
    const tokenId = _nextTokenIdSeq++;
    _rawIdToTokenId.set(rawId, tokenId);
    _tokenIdToRawId.set(tokenId, rawId);
    return tokenId;
}

export function tokenIdToRawCardId(tokenId: number): string | null {
    return _tokenIdToRawId.get(tokenId) || null;
}

// Parse a Card record plaintext into CardData
export function parseCardRecord(plaintext: string): CardData | null {
    if (!plaintext) return null;
    try {
        const get = (key: string) => {
            const m = plaintext.match(new RegExp(`${key}:\\s*(\\d+)(?:u\\d+|field)`));
            return m ? parseInt(m[1]) : 0;
        };
        const startupId = get('startup_id');
        if (!startupId) return null;

        const rarity = get('rarity');
        const level = get('level') || 1;
        const cardIdMatch = plaintext.match(/card_id:\s*(\d+)field/);
        const rawCardId = cardIdMatch ? cardIdMatch[1] : '0';
        const tokenId = rawCardIdToTokenId(rawCardId);

        // v4: Card record has salt field for commitment-based verification
        const saltMatch = plaintext.match(/salt:\s*(\d+)field/);
        const salt = saltMatch ? saltMatch[1] : '0';
        const ownerMatch = plaintext.match(/owner:\s*(aleo1[a-z0-9]+)/);
        const cardOwner = ownerMatch ? ownerMatch[1] : '';

        const startup = STARTUPS[startupId];
        return {
            tokenId,
            startupId,
            name: startup?.name || `Startup #${startupId}`,
            rarity: RARITY_U8_MAP[rarity] || Rarity.COMMON,
            level,
            multiplier: level,
            isLocked: false,
            image: `/images/${startupId}.png`,
            edition: 0,
            // @ts-ignore — v4: CardProof data for transactions (no record input needed!)
            _plaintext: plaintext,
            _rawCardId: rawCardId,
            _salt: salt,
            _cardOwner: cardOwner,
        };
    } catch {
        return null;
    }
}

// Parse a Pack record plaintext → { packId, plaintext }
function parsePackRecord(plaintext: string): { packId: string; plaintext: string } | null {
    if (!plaintext) return null;
    const m = plaintext.match(/pack_id:\s*(\d+)field/);
    if (!m) return null;
    return { packId: m[1], plaintext };
}

export function usePacks() {
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [statusMessage, setStatusMessage] = useState<string>('');

    // Get current pack price (microcredits) — hardcoded for now
    const getPackPrice = useCallback(async (): Promise<bigint> => {
        return 100000n; // 0.1 ALEO
    }, []);

    // Total packs sold
    const getPacksSold = useCallback(async (): Promise<number> => {
        try {
            const t = await readAleoMapping('total_packs_sold', '0u8');
            return Number((t || '0').replace(/u\d+/, ''));
        } catch { return 0; }
    }, []);

    // User's unopened packs — read from on-chain pending_packs mapping (v9)
    // Fully client-side: compute hash(address) via WASM, fetch mapping via public API
    const getUserPacks = useCallback(async (address: string): Promise<number[]> => {
        try {
            const hash = await hashAddressField(address);
            if (!hash) return [];
            const val = await readMapping('pending_packs', hash);
            const count = val ? parseInt(String(val).replace(/u\d+|"/g, '')) : 0;
            return Array.from({ length: count }, (_, i) => Date.now() + i);
        } catch (e) {
            console.warn('[getUserPacks] failed:', e);
            return [];
        }
    }, []);

    // Step 1: Buy Pack — uses transfer_public_as_signer (no private records needed!)
    const buyPack = useCallback(async (
        signer: any,
        count: number = 1
    ): Promise<{ success: boolean; packTokenIds?: number[]; error?: string; rawError?: string }> => {
        setIsLoading(true);
        setError(null);

        try {
            if (!signer?._isAleoSigner) {
                throw new Error('Aleo wallet required');
            }
            if (count !== 1) {
                return { success: false, error: 'Only 1 pack at a time on Aleo' };
            }

            // Get referrer from localStorage or URL
            let referrer = localStorage.getItem('unicornx_referrer_aleo');
            if (!referrer) {
                const params = new URLSearchParams(window.location.search);
                const ref = params.get('ref');
                if (ref && ref.startsWith('aleo1')) referrer = ref;
            }
            if (referrer === signer.address) referrer = null;
            const referrerAddr = referrer || signer.address;
            console.log('[buyPack] referrerAddr:', referrerAddr);

            const price = 100000n; // 0.1 ALEO

            // v11: resolve the active tournament on-chain so its prize_pool receives the 80-90% share.
            const nextIdStr = await readAleoMapping('next_tournament_id', '0u8');
            const nextId = nextIdStr ? parseInt(String(nextIdStr).replace(/u\d+/, '')) : 1;
            let activeTid = 0;
            for (let id = nextId - 1; id >= 1; id--) {
                const data = await readAleoMapping('tournaments', `${id}field`);
                if (!data) continue;
                const stMatch = data.match(/status:\s*(\d+)u8/);
                const endMatch = data.match(/end_height:\s*(\d+)u32/);
                const st = stMatch ? parseInt(stMatch[1]) : 0;
                const endH = endMatch ? parseInt(endMatch[1]) : 0;
                const nowH = await getAleoBlockHeight();
                if (st === 0 && nowH < endH) { activeTid = id; break; }
            }
            if (!activeTid) {
                return { success: false, error: 'No active tournament to fund — admin must create one first' };
            }

            setStatusMessage('Purchasing pack on Aleo blockchain...');
            console.log(`[buyPack] price=${price}, referrer=${referrerAddr}, tournament=${activeTid}`);

            // v11: buy_pack takes (amount, referrer, tournament_id)
            const txId = await signer.execute('buy_pack', [
                `${price}u64`,
                referrerAddr,
                `${activeTid}field`,
            ], 500000);

            console.log('[buyPack] ✓ buy_pack txId:', txId);
            setStatusMessage('Pack purchased! Updating wallet...');

            blockchainCache.invalidate(CacheKeys.packsSold());
            blockchainCache.invalidatePrefix(`pack:user:${signer.address}`);
            // v11: buy_pack grows tournament prize_pool — drop both layer caches so UI refetches fresh data
            blockchainCache.invalidate(CacheKeys.tournament(activeTid));
            invalidateMappingCache('tournaments');
            invalidateMappingCache('total_packs_sold');

            return { success: true, packTokenIds: [Date.now()] };
        } catch (e: any) {
            const msg = e?.message || 'Failed to buy pack';
            setError(msg);
            return { success: false, error: msg, rawError: String(e) };
        } finally {
            setIsLoading(false);
        }
    }, []);

    // Step 2: Open Pack → backend mints 5 cards via mint_card (admin function)
    // v5: buy_pack only sets pending_packs mapping, no records output.
    // Backend mints cards directly to the player.
    const openPack = useCallback(async (
        signer: any,
        _packTokenId: number
    ): Promise<{ success: boolean; cards?: CardData[]; error?: string; rawError?: string }> => {
        setIsLoading(true);
        setError(null);

        try {
            if (!signer?._isAleoSigner) throw new Error('Aleo wallet required');

            // v9: Step 1 — user signs request_open_pack (decrements pending_packs, creates open_request)
            setStatusMessage('Sign transaction to open pack...');
            console.log('[openPack] User signing request_open_pack...');
            await signer.execute('request_open_pack', [], 300000);
            console.log('[openPack] ✓ request_open_pack confirmed');

            // Step 2 — backend fulfills with 5 random cards
            setStatusMessage('Minting 5 random cards... (70% Common, 25% Rare, 5% Epic)');
            console.log('[openPack] Asking backend to mint cards for', signer.address);
            const fulfillRes = await fetch(apiUrl('/api/packs/fulfill-open'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ player: signer.address }),
            });
            const data = await fulfillRes.json();
            console.log('[openPack] Backend response:', data);

            if (data.success) {
                setStatusMessage('Cards minted on blockchain! Loading your new cards...');
            } else {
                setStatusMessage('');
                return { success: false, error: data.error || 'Failed to mint cards' };
            }

            const cards: CardData[] = (data?.cards || []).map((c: any, i: number) => {
                const startup = STARTUPS[c.startup_id];
                return {
                    tokenId: Date.now() + i,
                    startupId: c.startup_id,
                    name: startup?.name || `Startup #${c.startup_id}`,
                    rarity: RARITY_STRING_MAP[startup?.rarity || 'Common'] || Rarity.COMMON,
                    level: 1,
                    multiplier: startup?.multiplier || 1,
                    isLocked: false,
                    image: `/images/${c.startup_id}.png`,
                    edition: 0,
                };
            });

            // Optimistic UI: add cards to syncing list — shown with grayscale+overlay
            // until Shield wallet indexes them
            addSyncingCards(
                (data.cards || []).map((c: any) => ({
                    card_id: String(c.card_id).replace('field', ''),
                    startup_id: c.startup_id,
                    rarity: c.rarity,
                    salt: String(c.salt || '0').replace('field', ''),
                })),
                (c: any) => {
                    const startup = STARTUPS[c.startup_id];
                    const rawId = String(c.card_id).replace('field', '');
                    return {
                        tokenId: rawCardIdToTokenId(rawId),
                        startupId: c.startup_id,
                        name: startup?.name || `Startup #${c.startup_id}`,
                        rarity: RARITY_STRING_MAP[startup?.rarity || 'Common'] || Rarity.COMMON,
                        level: 1,
                        multiplier: startup?.multiplier || 1,
                        isLocked: false,
                        image: `/images/${c.startup_id}.png`,
                        edition: 0,
                    };
                }
            );

            blockchainCache.invalidatePrefix(`nft:owned:${signer.address}`);
            blockchainCache.invalidatePrefix(`nft:cards:${signer.address}`);
            blockchainCache.invalidatePrefix(`pack:user:${signer.address}`);

            return { success: true, cards };
        } catch (e: any) {
            const msg = e?.message || 'Failed to open pack';
            setError(msg);
            return { success: false, error: msg, rawError: String(e) };
        } finally {
            setIsLoading(false);
        }
    }, []);

    // Batch open — on Aleo open packs one at a time
    const batchOpenPacks = useCallback(async (
        signer: any,
        packTokenIds: number[]
    ): Promise<{ success: boolean; cards?: CardData[]; error?: string; rawError?: string }> => {
        const allCards: CardData[] = [];
        for (const id of packTokenIds) {
            const res = await openPack(signer, id);
            if (!res.success) return res;
            if (res.cards) allCards.push(...res.cards);
        }
        return { success: true, cards: allCards };
    }, [openPack]);

    return {
        isLoading,
        error,
        statusMessage,
        getPackPrice,
        getPacksSold,
        getUserPacks,
        buyPack,
        openPack,
        batchOpenPacks,
    };
}
