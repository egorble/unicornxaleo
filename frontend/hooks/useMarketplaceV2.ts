// Marketplace hook — Aleo v2 (unicornx_v2.aleo).
// Card listings (atomic buy with public card data) + pack listings (count-based).
// All transactions go through Shield wallet (signer.execute).

import { useState, useCallback } from 'react';
import { formatXTZ, readAleoMapping, getAleoBlockHeight, STARTUPS } from '../lib/contracts';
import { useWalletContext } from '../context/WalletContext';
import { parseCardRecord, tokenIdToRawCardId, rawCardIdToTokenId } from './usePacks';
import { Rarity } from '../types';
import { markMarketSyncing, clearMarketSyncing, marketKey } from '../lib/marketSync';

// ─── Types ────────────────────────────────────────────────────────────────
export interface Bid { bidId: bigint; bidder: string; tokenId: bigint; amount: bigint; expiration: bigint; active: boolean; nftAddr?: string; }
export interface Auction { auctionId: bigint; seller: string; tokenId: bigint; startPrice: bigint; reservePrice: bigint; highestBid: bigint; highestBidder: string; startTime: bigint; endTime: bigint; status: number; nftAddr?: string; isPack?: boolean; }
export interface Sale { tokenId: bigint; seller: string; buyer: string; price: bigint; timestamp: bigint; saleType: number; }
export interface TokenStats { totalSales: bigint; totalVolume: bigint; highestSale: bigint; lowestSale: bigint; lastSalePrice: bigint; lastSaleTime: bigint; }
export interface MarketplaceStats { totalListings: bigint; activeBids: bigint; activeAuctions: bigint; totalVolume: bigint; totalSales: bigint; }

export interface Listing {
    listingId: bigint;
    seller: string;
    tokenId: bigint;
    price: bigint;
    listedAt: bigint;
    active: boolean;
    nftAddr?: string;
    isPack?: boolean;
    // v2 extras — full card data (needed to build CardProof for atomic buy)
    commitment?: string;
    cardId?: string;
    startupId?: number;
    rarity?: number;
    level?: number;
    salt?: string;
    name?: string;
    image?: string;
}

const RARITY_U8_TO_ENUM: Record<number, Rarity> = {
    0: Rarity.COMMON, 1: Rarity.RARE, 2: Rarity.EPIC, 3: Rarity.LEGENDARY,
};

function rarityToU8(r: Rarity | string | number): number {
    if (typeof r === 'number') return r;
    const m: Record<string, number> = { 'Common': 0, 'Rare': 1, 'Epic': 2, 'EpicRare': 2, 'Legendary': 3 };
    return m[String(r)] ?? 0;
}

function getField(data: string, key: string): string | null {
    const m = data.match(new RegExp(`${key}:\\s*(\\S+?)[,}]`));
    return m ? m[1].replace(/u\d+$|field$/, '') : null;
}

// Parse CardListing struct (from on-chain mapping value)
function parseCardListing(data: string): Omit<Listing, 'listingId' | 'tokenId' | 'active'> | null {
    try {
        const seller = data.match(/seller:\s*(aleo1[a-z0-9]+)/)?.[1];
        const price = data.match(/price:\s*(\d+)u64/)?.[1];
        const cardId = data.match(/card_id:\s*(\d+)field/)?.[1];
        const startupId = data.match(/startup_id:\s*(\d+)u8/)?.[1];
        const rarity = data.match(/rarity:\s*(\d+)u8/)?.[1];
        const level = data.match(/level:\s*(\d+)u8/)?.[1];
        const salt = data.match(/salt:\s*(\d+)field/)?.[1];
        const listedAt = data.match(/listed_at:\s*(\d+)u32/)?.[1];
        if (!seller || !price || !cardId) return null;
        const sid = parseInt(startupId || '0');
        const startup = STARTUPS[sid];
        return {
            seller,
            price: BigInt(price),
            listedAt: BigInt(listedAt || '0'),
            cardId,
            startupId: sid,
            rarity: parseInt(rarity || '0'),
            level: parseInt(level || '1'),
            salt: salt || '0',
            name: startup?.name || `Startup #${sid}`,
            image: `/images/${sid}.png`,
        };
    } catch { return null; }
}

function parsePackListing(data: string): { seller: string; price: bigint; listedAt: bigint } | null {
    try {
        const seller = data.match(/seller:\s*(aleo1[a-z0-9]+)/)?.[1];
        const price = data.match(/price:\s*(\d+)u64/)?.[1];
        const listedAt = data.match(/listed_at:\s*(\d+)u32/)?.[1];
        if (!seller || !price) return null;
        return { seller, price: BigInt(price), listedAt: BigInt(listedAt || '0') };
    } catch { return null; }
}

export function useMarketplaceV2() {
    const { isConnected, address, cardRecords } = useWalletContext() as any;
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // ─── READS ───────────────────────────────────────────────────────────

    const getActiveListings = useCallback(async (): Promise<Listing[]> => {
        const out: Listing[] = [];
        try {
            const nextIdStr = await readAleoMapping('next_listing_id', '0u8');
            const nextId = nextIdStr ? parseInt(String(nextIdStr).replace(/u\d+/, '')) : 1;

            if (nextId > 1) {
                const ids = Array.from({ length: nextId - 1 }, (_, i) => i + 1);
                const results = await Promise.all(ids.map(async (id) => {
                    const cm = await readAleoMapping('listing_index', `${id}u32`);
                    if (!cm) return null;
                    const listingData = await readAleoMapping('listings', cm);
                    if (!listingData) return null;
                    const parsed = parseCardListing(listingData);
                    if (!parsed) return null;
                    // UI uses JS-safe tokenIds. Map raw 38-digit card_id → tokenId sequence.
                    const jsTokenId = BigInt(rawCardIdToTokenId(parsed.cardId || '0'));
                    return {
                        listingId: BigInt(id),
                        tokenId: jsTokenId,
                        active: true,
                        commitment: cm,
                        ...parsed,
                    } as Listing;
                }));
                for (const r of results) if (r) out.push(r);
            }
        } catch (e) {
            console.warn('[getActiveListings/cards] failed:', e);
        }

        // Also fetch pack listings and append (flagged isPack=true, tokenId = 0 sentinel)
        try {
            const nextPackIdStr = await readAleoMapping('next_pack_listing_id', '0u8');
            const nextPackId = nextPackIdStr ? parseInt(String(nextPackIdStr).replace(/u\d+/, '')) : 1;
            if (nextPackId > 1) {
                const ids = Array.from({ length: nextPackId - 1 }, (_, i) => i + 1);
                const results = await Promise.all(ids.map(async (id) => {
                    const data = await readAleoMapping('pack_listings', `${id}u32`);
                    if (!data) return null;
                    const parsed = parsePackListing(data);
                    if (!parsed) return null;
                    return {
                        listingId: BigInt(id),
                        tokenId: 0n,
                        seller: parsed.seller,
                        price: parsed.price,
                        listedAt: parsed.listedAt,
                        active: true,
                        isPack: true,
                        name: 'UnicornX Pack',
                        image: '/aleo-pack.png',
                    } as Listing;
                }));
                for (const r of results) if (r) out.push(r);
            }
        } catch (e) {
            console.warn('[getActiveListings/packs] failed:', e);
        }

        return out;
    }, []);

    const getUserListings = useCallback(async (user: string): Promise<Listing[]> => {
        const all = await getActiveListings();
        return all.filter(l => l.seller.toLowerCase() === user.toLowerCase());
    }, [getActiveListings]);

    const getMarketplaceStats = useCallback(async (): Promise<MarketplaceStats> => {
        const listings = await getActiveListings();
        const totalVolume = listings.reduce((s, l) => s + l.price, 0n);
        return {
            totalListings: BigInt(listings.length),
            activeBids: 0n, activeAuctions: 0n,
            totalVolume, totalSales: 0n,
        };
    }, [getActiveListings]);

    // ─── WRITES ──────────────────────────────────────────────────────────

    // Find the Card record in wallet that matches a tokenId.
    // UI uses JS-safe tokenIds (1, 2, 3...) but records store 38-digit raw card_id.
    // We convert via the tokenId ↔ rawId map maintained in usePacks.
    const findCardRecord = useCallback((tokenId: bigint | number): any | null => {
        const raw = tokenIdToRawCardId(Number(tokenId)) || String(tokenId);
        for (const r of cardRecords || []) {
            const pt = r.plaintext || r.data || '';
            if (pt.includes(`card_id: ${raw}field`)) return r;
        }
        // Fallback: search by whatever idStr we have
        const idStr = String(tokenId);
        for (const r of cardRecords || []) {
            const pt = r.plaintext || r.data || '';
            if (pt.includes(`card_id: ${idStr}field`)) return r;
        }
        return null;
    }, [cardRecords]);

    // listCard(tokenId, price) — price accepted as "0.1" ALEO string or microcredits number/bigint.
    const listCard = useCallback(async (
        tokenIdArg: bigint | number,
        priceArg: any,
    ): Promise<{ success: boolean; error?: string }> => {
        setLoading(true); setError(null);
        try {
            const tokenId = BigInt(tokenIdArg as any);
            // UI passes price in ALEO ("0.5", "1"); always convert to microcredits.
            let microcredits: bigint;
            if (typeof priceArg === 'string') {
                const v = parseFloat(priceArg);
                if (!isFinite(v) || v <= 0) throw new Error('Invalid price');
                microcredits = BigInt(Math.round(v * 1_000_000));
            } else {
                microcredits = BigInt(priceArg);
            }
            if (microcredits <= 0n) throw new Error('Price must be > 0');

            const { getAleoSigner } = await import('../lib/contracts');
            const signer = await getAleoSigner();
            if (!signer?._isAleoSigner) throw new Error('Aleo wallet required');

            const rec = findCardRecord(tokenId);
            if (!rec) throw new Error(`Card ${tokenId} not found in wallet`);
            const card = parseCardRecord(rec.plaintext || rec.data);
            if (!card) throw new Error('Cannot parse card');
            const rarityU8 = rarityToU8(card.rarity);
            const proof = `{ card_id: ${card._rawCardId}field, card_owner: ${(card as any)._cardOwner || signer.address}, startup_id: ${card.startupId}u8, rarity: ${rarityU8}u8, level: ${card.level}u8, salt: ${(card as any)._salt || '0'}field }`;

            const cardKey = marketKey.card(tokenId);
            markMarketSyncing(cardKey, 'card-list', 'Listing on marketplace…');
            try {
                await signer.execute('list_card', [proof, `${microcredits}u64`], 500000);
                setTimeout(() => clearMarketSyncing(cardKey), 15000);
                return { success: true };
            } catch (e) {
                clearMarketSyncing(cardKey);
                throw e;
            }
        } catch (e: any) {
            const msg = e?.message || 'Failed to list card';
            setError(msg);
            return { success: false, error: msg };
        } finally { setLoading(false); }
    }, [findCardRecord]);

    const cancelListing = useCallback(async (
        listingIdOrTokenId: bigint | number
    ): Promise<{ success: boolean; error?: string }> => {
        setLoading(true); setError(null);
        try {
            const { getAleoSigner } = await import('../lib/contracts');
            const signer = await getAleoSigner();
            if (!signer?._isAleoSigner) throw new Error('Aleo wallet required');

            // Our UI passes the listingId; but the contract takes proof. Find the commitment via listing_index → listings → then find the card in user's wallet.
            const cm = await readAleoMapping('listing_index', `${listingIdOrTokenId}u32`);
            if (!cm) throw new Error('Listing not found on-chain');
            const listingData = await readAleoMapping('listings', cm);
            if (!listingData) throw new Error('Listing data missing');
            const parsed = parseCardListing(listingData);
            if (!parsed) throw new Error('Failed to parse listing');
            const rarityU8 = parsed.rarity ?? 0;
            const proof = `{ card_id: ${parsed.cardId}field, card_owner: ${parsed.seller}, startup_id: ${parsed.startupId}u8, rarity: ${rarityU8}u8, level: ${parsed.level}u8, salt: ${parsed.salt}field }`;

            const listKey = marketKey.listing(listingIdOrTokenId);
            const cardKey = marketKey.card(parsed.cardId || '0');
            markMarketSyncing(listKey, 'card-cancel', 'Cancelling listing…');
            markMarketSyncing(cardKey, 'card-cancel', 'Cancelling listing…');
            try {
                await signer.execute('cancel_listing', [proof], 500000);
                setTimeout(() => { clearMarketSyncing(listKey); clearMarketSyncing(cardKey); }, 15000);
                return { success: true };
            } catch (e) {
                clearMarketSyncing(listKey);
                clearMarketSyncing(cardKey);
                throw e;
            }
        } catch (e: any) {
            const msg = e?.message || 'Failed to cancel listing';
            setError(msg);
            return { success: false, error: msg };
        } finally { setLoading(false); }
    }, []);

    const buyCard = useCallback(async (
        listingIdOrTokenId: bigint | number
    ): Promise<{ success: boolean; error?: string }> => {
        setLoading(true); setError(null);
        try {
            const { getAleoSigner } = await import('../lib/contracts');
            const signer = await getAleoSigner();
            if (!signer?._isAleoSigner) throw new Error('Aleo wallet required');

            const cm = await readAleoMapping('listing_index', `${listingIdOrTokenId}u32`);
            if (!cm) throw new Error('Listing not found');
            const listingData = await readAleoMapping('listings', cm);
            if (!listingData) throw new Error('Listing data missing');
            const parsed = parseCardListing(listingData);
            if (!parsed) throw new Error('Failed to parse listing');

            const rarityU8 = parsed.rarity ?? 0;
            const sellerProof = `{ card_id: ${parsed.cardId}field, card_owner: ${parsed.seller}, startup_id: ${parsed.startupId}u8, rarity: ${rarityU8}u8, level: ${parsed.level}u8, salt: ${parsed.salt}field }`;
            const newSalt = `${Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)}field`;

            const listKey = marketKey.listing(listingIdOrTokenId);
            markMarketSyncing(listKey, 'card-buy', 'Buying card…');
            try {
                await signer.execute('buy_listing', [
                    sellerProof, newSalt,
                    parsed.seller,
                    `${parsed.price}u64`,
                ], 700000);
                setTimeout(() => clearMarketSyncing(listKey), 15000);
                return { success: true };
            } catch (e) {
                clearMarketSyncing(listKey);
                throw e;
            }
        } catch (e: any) {
            const msg = e?.message || 'Failed to buy card';
            setError(msg);
            return { success: false, error: msg };
        } finally { setLoading(false); }
    }, []);

    // ─── PACK LISTINGS ──────────────────────────────────────────────────

    // listPack(packIdOrPrice, priceOptional)
    // Marketplace UI calls listPack(packId, price) where packId is informational (packs
    // are a counter on Aleo, not distinct records). We take the LAST arg as the price.
    const listPack = useCallback(async (
        arg1: any,
        arg2?: any,
    ): Promise<{ success: boolean; error?: string }> => {
        setLoading(true); setError(null);
        try {
            const { getAleoSigner } = await import('../lib/contracts');
            const signer = await getAleoSigner();
            if (!signer?._isAleoSigner) throw new Error('Aleo wallet required');

            // Parse price — accept "0.1" (ALEO) string or microcredits bigint
            const rawPrice = arg2 !== undefined ? arg2 : arg1;
            // UI passes price in ALEO (string like "0.5" or "1"); convert to microcredits.
            let microcredits: bigint;
            if (typeof rawPrice === 'string') {
                const v = parseFloat(rawPrice);
                if (!isFinite(v) || v <= 0) throw new Error('Invalid price');
                microcredits = BigInt(Math.round(v * 1_000_000));
            } else {
                microcredits = BigInt(rawPrice);
            }
            if (microcredits <= 0n) throw new Error('Price must be > 0');

            // Packs are fungible (counter), so we key the syncing by the packId that the UI passed
            // (or 'any' if not provided) — this lets the Unopened Packs grid dim a single tile.
            const packIdForKey = (arg2 !== undefined) ? String(arg1) : 'pending';
            const pKey = marketKey.pack(packIdForKey);
            markMarketSyncing(pKey, 'pack-list', 'Listing on marketplace…');
            try {
                await signer.execute('list_pack', [`${microcredits}u64`], 300000);
                setTimeout(() => clearMarketSyncing(pKey), 15000);
                return { success: true };
            } catch (e) {
                clearMarketSyncing(pKey);
                throw e;
            }
        } catch (e: any) {
            const msg = e?.message || 'Failed to list pack';
            setError(msg);
            return { success: false, error: msg };
        } finally { setLoading(false); }
    }, []);

    const buyPackListing = useCallback(async (
        listingId: bigint | number,
    ): Promise<{ success: boolean; error?: string }> => {
        setLoading(true); setError(null);
        try {
            const { getAleoSigner } = await import('../lib/contracts');
            const signer = await getAleoSigner();
            if (!signer?._isAleoSigner) throw new Error('Aleo wallet required');
            const data = await readAleoMapping('pack_listings', `${listingId}u32`);
            if (!data) throw new Error('Pack listing not found');
            const parsed = parsePackListing(data);
            if (!parsed) throw new Error('Failed to parse pack listing');
            const listKey = marketKey.listing(listingId);
            markMarketSyncing(listKey, 'pack-buy', 'Buying pack…');
            try {
                await signer.execute('buy_pack_listing', [
                    `${listingId}u32`,
                    parsed.seller,
                    `${parsed.price}u64`,
                ], 500000);
                setTimeout(() => clearMarketSyncing(listKey), 15000);
                return { success: true };
            } catch (e) {
                clearMarketSyncing(listKey);
                throw e;
            }
        } catch (e: any) {
            const msg = e?.message || 'Failed to buy pack';
            setError(msg);
            return { success: false, error: msg };
        } finally { setLoading(false); }
    }, []);

    const cancelPackListing = useCallback(async (
        listingId: bigint | number,
    ): Promise<{ success: boolean; error?: string }> => {
        setLoading(true); setError(null);
        try {
            const { getAleoSigner } = await import('../lib/contracts');
            const signer = await getAleoSigner();
            if (!signer?._isAleoSigner) throw new Error('Aleo wallet required');
            const listKey = marketKey.listing(listingId);
            markMarketSyncing(listKey, 'pack-cancel', 'Cancelling listing…');
            try {
                await signer.execute('cancel_pack_listing', [`${listingId}u32`], 300000);
                setTimeout(() => clearMarketSyncing(listKey), 15000);
                return { success: true };
            } catch (e) {
                clearMarketSyncing(listKey);
                throw e;
            }
        } catch (e: any) {
            const msg = e?.message || 'Failed to cancel pack listing';
            setError(msg);
            return { success: false, error: msg };
        } finally { setLoading(false); }
    }, []);

    // ─── STUBS (not implemented on Aleo: bids/auctions) ─────────────────
    const NOT_SUPPORTED = { success: false, error: 'Bids/auctions not available on Aleo' };
    const getBidsForToken = useCallback(async (_t: bigint | number): Promise<Bid[]> => [], []);
    const getMyBids = useCallback(async (): Promise<Bid[]> => [], []);
    const getUserBids = useCallback(async (_u: string): Promise<Bid[]> => [], []);
    const getActiveAuctions = useCallback(async (): Promise<Auction[]> => [], []);
    const getUserSoldItems = useCallback(async (_u: string): Promise<Sale[]> => [], []);
    const getTokenSaleHistory = useCallback(async (_t: bigint | number): Promise<Sale[]> => [], []);
    const getTokenStats = useCallback(async (_t: bigint | number): Promise<TokenStats | null> => null, []);
    const placeBid = useCallback(async () => NOT_SUPPORTED, []);
    const cancelBid = useCallback(async () => NOT_SUPPORTED, []);
    const acceptBid = useCallback(async () => NOT_SUPPORTED, []);
    const createAuction = useCallback(async () => NOT_SUPPORTED, []);
    const createPackAuction = useCallback(async () => NOT_SUPPORTED, []);
    const bidOnAuction = useCallback(async () => NOT_SUPPORTED, []);
    const finalizeAuction = useCallback(async () => NOT_SUPPORTED, []);
    const cancelAuction = useCallback(async () => NOT_SUPPORTED, []);

    return {
        loading, error, isConnected, address,
        getActiveListings, getUserListings, listCard, listPack, buyCard, cancelListing,
        buyPackListing, cancelPackListing,
        placeBid, cancelBid, acceptBid, getBidsForToken, getMyBids, getUserBids,
        createAuction, createPackAuction, bidOnAuction, finalizeAuction, cancelAuction, getActiveAuctions,
        getUserSoldItems, getTokenSaleHistory, getTokenStats, getMarketplaceStats,
        formatXTZ,
    };
}
