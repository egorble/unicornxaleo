// Marketplace hook — stub. Marketplace not yet ported to Aleo.
// Same API shape as the original EVM hook so UI keeps rendering.

import { useState, useCallback } from 'react';
import { formatXTZ } from '../lib/contracts';
import { useWalletContext } from '../context/WalletContext';

// ─── Types (same as EVM hook) ──────────────────────────────────────────────
export interface Bid {
    bidId: bigint;
    bidder: string;
    tokenId: bigint;
    amount: bigint;
    expiration: bigint;
    active: boolean;
    nftAddr?: string;
}

export interface Auction {
    auctionId: bigint;
    seller: string;
    tokenId: bigint;
    startPrice: bigint;
    reservePrice: bigint;
    highestBid: bigint;
    highestBidder: string;
    startTime: bigint;
    endTime: bigint;
    status: number;
    nftAddr?: string;
    isPack?: boolean;
}

export interface Sale {
    tokenId: bigint;
    seller: string;
    buyer: string;
    price: bigint;
    timestamp: bigint;
    saleType: number;
}

export interface TokenStats {
    totalSales: bigint;
    totalVolume: bigint;
    highestSale: bigint;
    lowestSale: bigint;
    lastSalePrice: bigint;
    lastSaleTime: bigint;
}

export interface MarketplaceStats {
    totalListings: bigint;
    activeBids: bigint;
    activeAuctions: bigint;
    totalVolume: bigint;
    totalSales: bigint;
}

export interface Listing {
    listingId: bigint;
    seller: string;
    tokenId: bigint;
    price: bigint;
    listedAt: bigint;
    active: boolean;
    nftAddr?: string;
    isPack?: boolean;
}

const NOT_SUPPORTED = { success: false, error: 'Marketplace not yet available on Aleo' };

export function useMarketplaceV2() {
    const { isConnected, address } = useWalletContext();
    const [loading, _setLoading] = useState(false);
    const [error, _setError] = useState<string | null>(null);

    // All marketplace read methods return empty
    const getActiveListings = useCallback(async (): Promise<Listing[]> => [], []);
    const getUserListings = useCallback(async (_user: string): Promise<Listing[]> => [], []);
    const getBidsForToken = useCallback(async (_tokenId: bigint | number): Promise<Bid[]> => [], []);
    const getMyBids = useCallback(async (): Promise<Bid[]> => [], []);
    const getUserBids = useCallback(async (_user: string): Promise<Bid[]> => [], []);
    const getActiveAuctions = useCallback(async (): Promise<Auction[]> => [], []);
    const getUserSoldItems = useCallback(async (_user: string): Promise<Sale[]> => [], []);
    const getTokenSaleHistory = useCallback(async (_tokenId: bigint | number): Promise<Sale[]> => [], []);
    const getTokenStats = useCallback(async (_tokenId: bigint | number): Promise<TokenStats | null> => null, []);
    const getMarketplaceStats = useCallback(async (): Promise<MarketplaceStats> => ({
        totalListings: 0n, activeBids: 0n, activeAuctions: 0n, totalVolume: 0n, totalSales: 0n,
    }), []);

    // All write methods return "not supported"
    const listCard = useCallback(async () => NOT_SUPPORTED, []);
    const listPack = useCallback(async () => NOT_SUPPORTED, []);
    const buyCard = useCallback(async () => NOT_SUPPORTED, []);
    const cancelListing = useCallback(async () => NOT_SUPPORTED, []);
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
        placeBid, cancelBid, acceptBid, getBidsForToken, getMyBids, getUserBids,
        createAuction, createPackAuction, bidOnAuction, finalizeAuction, cancelAuction, getActiveAuctions,
        getUserSoldItems, getTokenSaleHistory, getTokenStats, getMarketplaceStats,
        formatXTZ,
    };
}
