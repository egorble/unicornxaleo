// NFT hook — Aleo version. Reads card records from WalletContext (auto-polled).
// Same API as the original EVM hook.

import { useState, useCallback, useEffect } from 'react';
import { STARTUPS, getAleoSigner } from '../lib/contracts';
import { CardData, Rarity } from '../types';
import { blockchainCache, CacheKeys, CacheTTL } from '../lib/cache';
import { parseCardRecord, tokenIdToRawCardId, rawCardIdToTokenId, getSyncingCards, removeSyncedCard, subscribeSyncingCards, addSyncingCards } from './usePacks';
import { useWalletContext } from '../context/WalletContext';
import { batchCheckAliveCached } from '../lib/aleoCrypto';

// Deduplication for getCards — if a fetch for an address is already running, reuse its promise
const pendingGetCards = new Map<string, Promise<CardData[]>>();

export function resetNFTModuleState(): void {
    pendingGetCards.clear();
}

// Map rarity strings to enum (for merge result fallback)
const RARITY_STRING_MAP: Record<string, Rarity> = {
    'Common': Rarity.COMMON,
    'Rare': Rarity.RARE,
    'Epic': Rarity.EPIC,
    'EpicRare': Rarity.EPIC_RARE,
    'Legendary': Rarity.LEGENDARY,
};

export function useNFT() {
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const { cardRecords, packRecords, refreshRecords } = useWalletContext();

    // Get all card token IDs from context (no extra fetch)
    const getOwnedTokens = useCallback(async (_address: string): Promise<number[]> => {
        return cardRecords
            .map((r: any) => {
                const pt = r.plaintext || r.data || '';
                const m = pt.match(/card_id:\s*(\d+)field/);
                return m ? parseInt(m[1]) : null;
            })
            .filter((id: number | null): id is number => id !== null);
    }, [cardRecords]);

    // Get a single card's info — read from context
    const getCardInfo = useCallback(async (tokenId: number): Promise<CardData | null> => {
        const key = CacheKeys.cardMetadata(tokenId);
        const cached = blockchainCache.get<CardData>(key);
        if (cached !== undefined) return cached;
        for (const r of cardRecords) {
            const pt = r.plaintext || r.data || '';
            if (pt.includes(`card_id: ${tokenId}field`)) {
                const card = parseCardRecord(pt);
                if (card) {
                    blockchainCache.set(key, card, CacheTTL.DEFAULT);
                    return card;
                }
            }
        }
        return null;
    }, [cardRecords]);

    // Same as getCardInfo (no retry needed — it's a local wallet call)
    const getCardInfoWithRetry = getCardInfo;

    // Subscribe to syncing cards changes → trigger re-render
    const [, forceUpdate] = useState(0);
    useEffect(() => subscribeSyncingCards(() => forceUpdate(v => v + 1)), []);

    // Get ALL cards — parse from wallet records, then verify on-chain
    const getCards = useCallback(async (_address: string, forceRefresh?: boolean): Promise<CardData[]> => {
        // If caller requested a forced refresh, drop all cached card metadata first.
        if (forceRefresh) {
            blockchainCache.invalidatePrefix('nft:card:');
        }
        // 1. Parse and deduplicate locally (by cardId+salt)
        // No client-side dead cache — backend /api/cards/alive has 60s TTL cache.
        const seen = new Map<number, CardData>();
        const shieldCardKeys = new Set<string>();
        for (const r of cardRecords) {
            const pt = r.plaintext || r.data || '';
            const card = parseCardRecord(pt);
            if (!card) continue;
            shieldCardKeys.add(`${card._rawCardId}:${card._salt}`);
            const existing = seen.get(card.tokenId);
            if (!existing || (card.level || 1) > (existing.level || 1)) {
                seen.set(card.tokenId, card);
            }
        }

        // 1b. Remove syncing cards ONLY when Shield has the matching salt version
        // (prevents removing L2 syncing card when Shield still has L1)
        for (const c of getSyncingCards()) {
            const rawId = (c as any)._rawCardId;
            const salt = (c as any)._salt;
            if (rawId && salt && shieldCardKeys.has(`${rawId}:${salt}`)) {
                removeSyncedCard(rawId, salt);
            }
        }

        let cards = Array.from(seen.values());

        // 2. Verify on-chain directly from frontend (WASM BHP256 + public mapping API)
        if (cards.length > 0) {
            try {
                const rarityMap: Record<string, number> = { 'Common': 0, 'Rare': 1, 'Epic': 2, 'EpicRare': 2, 'Legendary': 3 };
                const payload = cards.map(c => ({
                    card_id: c._rawCardId || '0',
                    card_owner: (c as any)._cardOwner || _address,
                    startup_id: c.startupId,
                    rarity: typeof c.rarity === 'string' ? (rarityMap[c.rarity] ?? 0) : c.rarity,
                    level: c.level || 1,
                    salt: (c as any)._salt || '0',
                }));
                const { dead, locked } = await batchCheckAliveCached(payload);
                if (dead.length > 0) {
                    const deadSet = new Set(dead);
                    cards = cards.filter(c => !c._rawCardId || !deadSet.has(c._rawCardId));
                    console.log(`[useNFT.getCards] Filtered ${dead.length} dead cards on-chain`);
                }
                if (locked.length > 0) {
                    const lockedSet = new Set(locked);
                    cards = cards.map(c => c._rawCardId && lockedSet.has(c._rawCardId) ? { ...c, isLocked: true } : c);
                    console.log(`[useNFT.getCards] Marked ${locked.length} cards as locked (in tournament)`);
                }
            } catch (e) {
                console.warn('[useNFT.getCards] On-chain check failed, showing all:', e);
            }
        }

        // 3. Append syncing cards (minted but Shield hasn't indexed yet)
        // Skip syncing cards whose tokenId already exists in `cards` to avoid React key dupes
        const existingTokenIds = new Set(cards.map(c => c.tokenId));
        const syncing = getSyncingCards().filter(c => !existingTokenIds.has(c.tokenId));
        if (syncing.length > 0) {
            console.log(`[useNFT.getCards] Adding ${syncing.length} syncing cards`);
            cards = [...cards, ...syncing];
        }

        console.log(`[useNFT.getCards] ${cardRecords.length} records → ${cards.length} cards (${syncing.length} syncing)`);
        cards.forEach(c => blockchainCache.set(CacheKeys.cardMetadata(c.tokenId), c));
        return cards;
    }, [cardRecords]);

    // Merge 3 same-rarity cards into 1 higher-rarity card
    const mergeCards = useCallback(async (
        signer: any,
        tokenIds: [number, number, number]
    ): Promise<{ success: boolean; newTokenId?: number; error?: string }> => {
        setIsLoading(true);
        setError(null);

        try {
            if (!signer?._isAleoSigner) throw new Error('Aleo wallet required');

            // Find 3 card records matching the tokenIds (via raw card_id mapping)
            const plaintexts: string[] = [];
            let mergeRarity = 0;
            let nextRarity = 0;

            for (const id of tokenIds) {
                const rawCardId = tokenIdToRawCardId(id);
                if (!rawCardId) throw new Error(`Card #${id} has no raw id mapping (refresh page)`);
                const rec = cardRecords.find((r: any) => {
                    const pt = r.plaintext || r.data || '';
                    return pt.includes(`card_id: ${rawCardId}field`);
                });
                if (!rec) throw new Error(`Card with raw id ${rawCardId} not found in wallet`);
                // Build CardProof struct from record data
                const card = parseCardRecord(rec.plaintext || rec.data);
                if (!card) throw new Error(`Failed to parse card #${id}`);
                const rarityU8 = ({'Common':0,'Rare':1,'Epic':2,'EpicRare':2,'Legendary':3} as any)[card.rarity] ?? 0;
                const proofStr = `{ card_id: ${card._rawCardId}field, card_owner: ${(card as any)._cardOwner || signer.address}, startup_id: ${card.startupId}u8, rarity: ${rarityU8}u8, level: ${card.level}u8, salt: ${(card as any)._salt || '0'}field }`;
                console.log(`[mergeCards] CardProof ${id}: ${proofStr}`);
                plaintexts.push(proofStr);

                const rm = (rec.plaintext || rec.data).match(/rarity:\s*(\d+)u8/);
                if (rm) mergeRarity = parseInt(rm[1]);
            }
            if (mergeRarity >= 3) throw new Error('Cannot merge Legendary cards');
            nextRarity = mergeRarity + 1;

            // Pick a random startup ID in the target rarity range
            const ranges: Record<number, [number, number]> = {
                1: [9, 13],   // Rare
                2: [6, 8],    // Epic
                3: [1, 5],    // Legendary
            };
            const [lo, hi] = ranges[nextRarity];
            const newStartupId = lo + Math.floor(Math.random() * (hi - lo + 1));

            // Use a card_id in JS safe-integer range (≤ 2^53) so parseInt works correctly
            const newTokenId = Math.floor(Math.random() * 9_000_000_000_000_000) + 1_000_000_000_000_000;
            const newCardIdStr = `${newTokenId}field`;
            const newSalt = `${Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)}field`;

            await signer.execute('merge_cards', [
                ...plaintexts,
                newCardIdStr,
                `${newStartupId}u8`,
                newSalt,
            ], 600000);

            // v6: Card records are consumed by the contract — Shield removes them automatically

            // Pre-populate cache with the new card so getCardInfoWithRetry finds it instantly
            const startup = STARTUPS[newStartupId];
            const RARITY_MAP: Record<string, Rarity> = {
                'Common': Rarity.COMMON, 'Rare': Rarity.RARE,
                'Epic': Rarity.EPIC, 'Legendary': Rarity.LEGENDARY,
            };
            const newCardData: CardData = {
                tokenId: newTokenId,
                startupId: newStartupId,
                name: startup?.name || `Startup #${newStartupId}`,
                rarity: RARITY_MAP[startup?.rarity || 'Common'] || Rarity.COMMON,
                level: 1,
                multiplier: 1,
                isLocked: false,
                image: `/images/${newStartupId}.png`,
                edition: 0,
            };
            blockchainCache.set(CacheKeys.cardMetadata(newTokenId), newCardData);

            // Add merged card to syncing list — shown with grayscale overlay until Shield indexes
            const rarityU8 = { 'Common': 0, 'Rare': 1, 'Epic': 2, 'Legendary': 3 }[startup?.rarity || 'Common'] ?? 1;
            const newSaltClean = newSalt.replace('field', '');
            addSyncingCards([{ card_id: String(newTokenId), startup_id: newStartupId, rarity: rarityU8, salt: newSaltClean }], () => newCardData);

            // Invalidate stale data
            tokenIds.forEach(id => blockchainCache.invalidate(CacheKeys.cardMetadata(id)));
            blockchainCache.invalidatePrefix(`nft:cards:${signer.address}`);

            // Refresh wallet records AFTER the fusion animation completes (~4s)
            // — gives the UI time to show the 3 cards merging into 1.
            setTimeout(() => { refreshRecords().catch(() => {}); }, 4500);

            return { success: true, newTokenId };
        } catch (e: any) {
            const msg = e?.message || 'Merge failed';
            setError(msg);
            return { success: false, error: msg };
        } finally {
            setIsLoading(false);
        }
    }, [cardRecords, refreshRecords]);

    // isLocked on Aleo = card is consumed into a LineupCommitment. Records are UTXOs.
    const isLocked = useCallback(async (_tokenId: number): Promise<boolean> => {
        return false;
    }, []);

    const clearCache = useCallback(() => {
        blockchainCache.invalidatePrefix('nft:');
        blockchainCache.clearPersistedKeys('nft:');
    }, []);

    // Push cards to server cache (no-op on Aleo — cards are private)
    const pushCardsToServer = useCallback(async (_address: string, _cards: CardData[]) => {
        return;
    }, []);

    const updateServerCache = useCallback(async (_address: string, _cards: CardData[]) => {
        return;
    }, []);

    return {
        isLoading,
        error,
        getOwnedTokens,
        getCardInfo,
        getCardInfoWithRetry,
        getCards,
        mergeCards,
        isLocked,
        clearCache,
        pushCardsToServer,
        updateServerCache,
    };
}
