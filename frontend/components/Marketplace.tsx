import React, { useState, useEffect, useCallback } from 'react';
import { Search, ShoppingCart, Loader2, Gavel, Clock, Tag, X, User, Activity, DollarSign, History, Plus, Package, CheckCircle } from 'lucide-react';
import ModelViewer3D from './ModelViewer3D';
import { useMarketplaceV2, Listing, Auction, Bid, Sale } from '../hooks/useMarketplaceV2';
import { useNFT } from '../hooks/useNFT';
import { usePacks } from '../hooks/usePacks';
import { useWalletContext } from '../context/WalletContext';
import { usePollingData } from '../hooks/usePollingData';
import { formatXTZ } from '../lib/contracts';
import { currencySymbol } from '../lib/networks';
import { useNetwork } from '../context/NetworkContext';
import { blockchainCache, CacheKeys } from '../lib/cache';
import { CardData, Rarity, sortByRarity } from '../types';
import { useOnboarding } from '../hooks/useOnboarding';
import OnboardingGuide, { OnboardingStep } from './OnboardingGuide';
import { getMarketSyncing, subscribeMarketSyncing, marketKey } from '../lib/marketSync';

// Rarity colors
const RARITY_COLORS: Record<string, string> = {
    'Common': 'bg-gray-800 text-gray-300 border-white/20',
    'Rare': 'bg-green-600 text-white border-green-500',
    'Epic': 'bg-orange-600 text-white border-orange-500',
    'EpicRare': 'bg-orange-600 text-white border-orange-500',
    'Legendary': 'bg-orange-500 text-white border-orange-400',
};

// Safe formatting helpers
function safeFormatXTZ(amount: any): string {
    try {
        const formatted = formatXTZ(BigInt(amount));
        const num = parseFloat(formatted);
        if (isNaN(num) || num > 1_000_000) return '???';
        return num % 1 === 0 ? num.toString() : num.toFixed(2);
    } catch { return '???'; }
}

function safeFormatDate(timestamp: any): string {
    try {
        const date = new Date(Number(timestamp) * 1000);
        if (isNaN(date.getTime())) return '—';
        return date.toLocaleDateString();
    } catch { return '—'; }
}

type MarketTab = 'listings' | 'activity';

interface ListingWithMeta extends Listing {
    cardName?: string;
    cardImage?: string;
    rarity?: string;
    level?: number;
    multiplier?: number;
    priceFormatted?: string;
    isPack?: boolean;
}

interface AuctionWithMeta extends Auction {
    cardName?: string;
    cardImage?: string;
    rarity?: string;
    level?: number;
    multiplier?: number;
    timeLeft?: string;
    isEnded?: boolean;
    isPack?: boolean;
}

// Level badge overlay component
const LevelBadge: React.FC<{ level?: number; className?: string }> = ({ level, className = '' }) => {
    const lvl = level || 1;
    const colors = lvl >= 5 ? 'from-yellow-500 to-amber-600 text-white' :
                   lvl >= 4 ? 'from-orange-500 to-orange-600 text-white' :
                   lvl >= 3 ? 'from-blue-500 to-orange-600 text-white' :
                   lvl >= 2 ? 'from-green-500 to-emerald-600 text-white' :
                              'from-gray-500 to-gray-600 text-white';
    return (
        <div className={`absolute top-1.5 left-1.5 md:top-2 md:left-2 z-20 bg-gradient-to-r ${colors} text-[9px] md:text-[10px] font-black px-1.5 py-0.5 md:px-2 md:py-0.5 rounded shadow-lg ${className}`}>
            LVL {lvl}
        </div>
    );
};

// Pack visual component — renders the 3D pack model
const PackVisual: React.FC<{ tokenId: number | bigint; className?: string; style?: React.CSSProperties }> = ({ tokenId, className = '', style }) => (
    <div className={`relative bg-gradient-to-b from-yc-aleo/5 to-gray-50 dark:from-yc-aleo/[0.06] dark:to-[#0a0a0a] overflow-hidden ${className}`} style={style}>
        <ModelViewer3D mode="static" cameraZ={3} modelScale={0.8} />
        <div className="absolute bottom-2 left-0 right-0 flex flex-col items-center pointer-events-none">
            <span className="text-gray-700 dark:text-white/50 text-[10px] font-mono bg-white/60 dark:bg-black/40 px-2 py-0.5 rounded">#{String(tokenId)}</span>
        </div>
    </div>
);

// Helper to format time remaining
function formatTimeLeft(endTime: bigint): { text: string; isEnded: boolean } {
    const now = BigInt(Math.floor(Date.now() / 1000));
    if (endTime <= now) return { text: 'Ended', isEnded: true };

    const diff = Number(endTime - now);
    const hours = Math.floor(diff / 3600);
    const minutes = Math.floor((diff % 3600) / 60);
    const seconds = diff % 60;

    if (hours > 24) {
        const days = Math.floor(hours / 24);
        return { text: `${days}d ${hours % 24}h`, isEnded: false };
    }
    return { text: `${hours}h ${minutes}m ${seconds}s`, isEnded: false };
}

const MARKETPLACE_GUIDE: OnboardingStep[] = [
    {
        title: 'NFT Marketplace',
        description: 'Buy cards from other players or list yours for sale. Place bids through auctions to get the best deals and strengthen your deck.',
        icon: '\uD83D\uDECD\uFE0F',
    },
    {
        title: 'Auctions & Bidding',
        description: 'Place bids on cards you want. If you\'re the highest bidder when the timer runs out, the card is yours. Outbid others to secure rare cards.',
        icon: '\uD83D\uDD28',
    },
];

const Marketplace: React.FC = () => {
    // Re-render on market syncing changes so overlays appear/disappear across views
    const [, _forceMarketTick] = useState(0);
    useEffect(() => subscribeMarketSyncing(() => _forceMarketTick(v => v + 1)), []);

    const {
        getActiveListings,
        buyCard,
        getActiveAuctions,
        bidOnAuction,
        finalizeAuction,
        placeBid,
        acceptBid,
        getBidsForToken,
        getUserListings,
        getMyBids,
        cancelBid,
        listCard,
        listPack,
        createAuction,
        createPackAuction,
        cancelListing,
        cancelPackListing,
        buyPackListing,
        cancelAuction,
        getTokenStats,
        getTokenSaleHistory,
        getUserSoldItems,
        loading: isLoading,
        error
    } = useMarketplaceV2();
    const { getCardInfo, getCards, clearCache } = useNFT();
    const { getUserPacks } = usePacks();
    const { address, isConnected } = useWalletContext();
    const { networkId } = useNetwork();
    const { isVisible: showGuide, currentStep: guideStep, nextStep: guideNext, dismiss: guideDismiss } = useOnboarding('marketplace');

    // State
    const [activeTab, setActiveTab] = useState<MarketTab>('listings');
    type TypeFilter = 'all' | 'cards' | 'packs';
    const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
    const [listings, setListings] = useState<ListingWithMeta[]>([]);
    const [auctions, setAuctions] = useState<AuctionWithMeta[]>([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [sortBy, setSortBy] = useState<'price_asc' | 'price_desc' | 'recent'>('recent');
    const [rarityFilter, setRarityFilter] = useState<string>('All');
    const [buyingId, setBuyingId] = useState<number | null>(null);
    const [biddingId, setBiddingId] = useState<number | null>(null);
    const [cancellingId, setCancellingId] = useState<number | null>(null);
    const [loadingListings, setLoadingListings] = useState(true);
    const [loadingAuctions, setLoadingAuctions] = useState(true);

    // Modal state
    const [bidModal, setBidModal] = useState<{ auction?: AuctionWithMeta; listing?: ListingWithMeta } | null>(null);
    const [bidAmount, setBidAmount] = useState('');

    // Stats Modal state
    const [statsModalOpen, setStatsModalOpen] = useState(false);
    const [statsItem, setStatsItem] = useState<ListingWithMeta | AuctionWithMeta | null>(null);
    const [statsTab, setStatsTab] = useState<'bids' | 'sales' | 'stats'>('bids');
    const [cardBids, setCardBids] = useState<any[]>([]);
    const [cardSales, setCardSales] = useState<any[]>([]);
    const [cardStats, setCardStats] = useState<any | null>(null);
    const [loadingStats, setLoadingStats] = useState(false);

    // List/Sell Modal state
    const [listModalOpen, setListModalOpen] = useState(false);
    const [myNFTs, setMyNFTs] = useState<CardData[]>([]);
    const [myPackTokenIds, setMyPackTokenIds] = useState<number[]>([]);
    const [selectedNFT, setSelectedNFT] = useState<CardData | null>(null);
    const [selectedPackId, setSelectedPackId] = useState<number | null>(null);
    const [sellMode, setSellMode] = useState<'fixed' | 'auction'>('fixed');
    const [sellPrice, setSellPrice] = useState('');
    const [auctionStartPrice, setAuctionStartPrice] = useState('');
    const [auctionReservePrice, setAuctionReservePrice] = useState('');
    const [auctionDuration, setAuctionDuration] = useState('1');
    const [isSelling, setIsSelling] = useState(false);
    const [loadingNFTs, setLoadingNFTs] = useState(false);

    // Activity tab state
    type ActivityFilter = 'all' | 'listings' | 'auctions' | 'bids' | 'sold';
    const [activityFilter, setActivityFilter] = useState<ActivityFilter>('all');
    const [myListings, setMyListings] = useState<ListingWithMeta[]>([]);
    const [myAuctions, setMyAuctions] = useState<AuctionWithMeta[]>([]);
    const [myBids, setMyBids] = useState<(Bid & { cardName?: string; cardImage?: string; rarity?: string })[]>([]);
    const [mySales, setMySales] = useState<(Sale & { cardName?: string; cardImage?: string; rarity?: string })[]>([]);
    const [loadingActivity, setLoadingActivity] = useState(false);
    const [cancellingBidId, setCancellingBidId] = useState<number | null>(null);

    const rarityTabs = ['All', 'Common', 'Rare', 'Epic', 'Legendary'];
    const [levelFilter, setLevelFilter] = useState<number>(0); // 0 = All

    // Fetcher functions for polling
    const fetchListings = useCallback(async (): Promise<ListingWithMeta[]> => {
        try {
            const rawListings = await getActiveListings();
            const listingsWithMetadata = await Promise.all(
                rawListings.map(async (listing) => {
                    // Pack listings: use fixed metadata
                    if (listing.isPack) {
                        return {
                            ...listing,
                            cardName: `Pack #${listing.tokenId}`,
                            cardImage: undefined,
                            rarity: undefined,
                            multiplier: undefined,
                            priceFormatted: formatXTZ(listing.price),
                            isPack: true,
                        };
                    }
                    // Prefer data that the hook already resolved from the on-chain listing
                    // (name/image/rarity/level are public fields on CardListing). Fall back
                    // to getCardInfo only if hook didn't populate them.
                    const rarityStr = typeof (listing as any).rarity === 'number'
                        ? (['Common','Rare','Epic','Legendary'][(listing as any).rarity] || 'Common')
                        : ((listing as any).rarity || 'Common');
                    if ((listing as any).name && (listing as any).image) {
                        return {
                            ...listing,
                            cardName: (listing as any).name,
                            cardImage: (listing as any).image,
                            rarity: rarityStr,
                            level: (listing as any).level || 1,
                            multiplier: (listing as any).level || 1,
                            priceFormatted: formatXTZ(listing.price),
                        };
                    }
                    try {
                        const cardInfo = await getCardInfo(Number(listing.tokenId));
                        return {
                            ...listing,
                            cardName: cardInfo?.name || `Card #${listing.tokenId}`,
                            cardImage: cardInfo?.image || '/placeholder-card.png',
                            rarity: cardInfo?.rarity || 'Common',
                            level: cardInfo?.level || 1,
                            multiplier: cardInfo?.multiplier || 1,
                            priceFormatted: formatXTZ(listing.price),
                        };
                    } catch {
                        return {
                            ...listing,
                            cardName: `Card #${listing.tokenId}`,
                            cardImage: '/placeholder-card.png',
                            rarity: 'Common',
                            level: 1,
                            multiplier: 1,
                            priceFormatted: formatXTZ(listing.price),
                        };
                    }
                })
            );
            return listingsWithMetadata;
        } catch (e) {
            return [];
        }
    }, [getActiveListings, getCardInfo]);

    const fetchAuctions = useCallback(async (): Promise<AuctionWithMeta[]> => {
        try {
            const rawAuctions = await getActiveAuctions();
            const auctionsWithMetadata = await Promise.all(
                rawAuctions.map(async (auction) => {
                    // Pack auctions: use fixed metadata
                    if (auction.isPack) {
                        const { text, isEnded } = formatTimeLeft(auction.endTime);
                        return {
                            ...auction,
                            cardName: `Pack #${auction.tokenId}`,
                            cardImage: undefined,
                            rarity: undefined,
                            multiplier: undefined,
                            timeLeft: text,
                            isEnded,
                            isPack: true,
                        };
                    }
                    try {
                        const cardInfo = await getCardInfo(Number(auction.tokenId));
                        const { text, isEnded } = formatTimeLeft(auction.endTime);
                        return {
                            ...auction,
                            cardName: cardInfo?.name || `Card #${auction.tokenId}`,
                            cardImage: cardInfo?.image || '/placeholder-card.png',
                            rarity: cardInfo?.rarity || 'Common',
                            level: cardInfo?.level || 1,
                            multiplier: cardInfo?.multiplier || 1,
                            timeLeft: text,
                            isEnded,
                        };
                    } catch {
                        const { text, isEnded } = formatTimeLeft(auction.endTime);
                        return {
                            ...auction,
                            cardName: `Card #${auction.tokenId}`,
                            cardImage: '/placeholder-card.png',
                            rarity: 'Common',
                            level: 1,
                            multiplier: 1,
                            timeLeft: text,
                            isEnded,
                        };
                    }
                })
            );
            return auctionsWithMetadata;
        } catch (e) {
            return [];
        }
    }, [getActiveAuctions, getCardInfo]);

    // Auto-refresh listings with polling
    const {
        data: polledListings,
        isLoading: pollingListingsLoading,
        refresh: refreshListings
    } = usePollingData<ListingWithMeta[]>(fetchListings, {
        cacheKey: `marketplace:active-listings:${networkId}`,
        interval: 30000,
        enabled: true
    });

    // Auto-refresh auctions with polling
    const {
        data: polledAuctions,
        isLoading: pollingAuctionsLoading,
        refresh: refreshAuctions
    } = usePollingData<AuctionWithMeta[]>(fetchAuctions, {
        cacheKey: `marketplace:active-auctions:${networkId}`,
        interval: 30000,
        enabled: true
    });

    // Clear stale data on network switch
    useEffect(() => {
        setListings([]);
        setAuctions([]);
        setMyListings([]);
        setMyAuctions([]);
        setMyBids([]);
        setLoadingListings(true);
        setLoadingAuctions(true);
    }, [networkId]);

    // Update listings/auctions when polled data changes
    useEffect(() => {
        if (polledListings) {
            setListings(polledListings);
            setLoadingListings(false);
        }
    }, [polledListings]);

    useEffect(() => {
        if (polledAuctions) {
            setAuctions(polledAuctions);
            setLoadingAuctions(false);
        }
    }, [polledAuctions]);

    // Update auction timers every second
    useEffect(() => {
        if (activeTab !== 'auctions') return;
        const interval = setInterval(() => {
            setAuctions(prev => prev.map(a => {
                const { text, isEnded } = formatTimeLeft(a.endTime);
                return { ...a, timeLeft: text, isEnded };
            }));
        }, 1000);
        return () => clearInterval(interval);
    }, [activeTab]);

    // Refresh both listings and auctions with a delayed re-fetch for RPC lag.
    const refreshAfterAction = useCallback(async () => {
        // Invalidate cache so refresh fetches fresh data from blockchain
        blockchainCache.invalidate(CacheKeys.activeListings());
        blockchainCache.invalidate(CacheKeys.activeAuctions());
        if (address) blockchainCache.invalidate(CacheKeys.userListings(address));
        await Promise.all([refreshListings(), refreshAuctions()]);
        // Second fetch after 3s handles RPC node indexing lag
        setTimeout(() => {
            blockchainCache.invalidate(CacheKeys.activeListings());
            blockchainCache.invalidate(CacheKeys.activeAuctions());
            refreshListings();
            refreshAuctions();
        }, 3000);
    }, [refreshListings, refreshAuctions, address]);

    // Handle buy listing
    const handleBuy = async (listing: ListingWithMeta) => {
        if (!isConnected) {
            alert('Please connect your wallet first');
            return;
        }
        if (listing.seller.toLowerCase() === address?.toLowerCase()) {
            alert("You can't buy your own listing");
            return;
        }

        setBuyingId(Number(listing.listingId));
        try {
            const result = listing.isPack
                ? await buyPackListing(listing.listingId)
                : await buyCard(listing.listingId, listing.price);
            if (result && (result as any).success === false) {
                throw new Error((result as any).error || 'Purchase failed');
            }
            await refreshAfterAction();
            // Force refresh NFT cache so Portfolio shows new card
            if (address) {
                clearCache();
                getCards(address, true);
            }
            alert('Purchase successful! The card is now in your portfolio.');
        } catch (e: any) {
            alert(`Error: ${e.message}`);
        }
        setBuyingId(null);
    };

    // Handle listing bid (for offers on Buy Now listings)
    const handleListingBid = async () => {
        if (!bidModal?.listing || !bidAmount) return;

        setBiddingId(Number(bidModal.listing.listingId));
        try {
            await placeBid(bidModal.listing.tokenId, bidAmount);
            await refreshAfterAction();
            setBidModal(null);
            setBidAmount('');
            alert('Bid placed successfully!');
        } catch (e: any) {
            alert(`Error: ${e.message}`);
        }
        setBiddingId(null);
    };

    // Handle accept bid
    const handleAcceptBid = async (bidId: bigint) => {
        setLoadingStats(true);
        try {
            await acceptBid(bidId);
            await refreshAfterAction();
            setStatsModalOpen(false);
            alert('Bid accepted successfully!');
        } catch (e: any) {
            alert(`Error: ${e.message}`);
        }
        setLoadingStats(false);
    };

    // Handle cancel listing
    const handleCancelListing = async (listing: ListingWithMeta) => {
        setCancellingId(Number(listing.listingId));
        try {
            const result = listing.isPack
                ? await cancelPackListing(listing.listingId)
                : await cancelListing(listing.listingId);
            if (result && (result as any).success === false) {
                throw new Error((result as any).error || 'Cancel failed');
            }
            await refreshAfterAction();
            if (activeTab === 'activity') fetchActivity(true);
            alert('Listing cancelled successfully!');
        } catch (e: any) {
            alert(`Error: ${e.message}`);
        }
        setCancellingId(null);
    };

    // Handle auction bid
    const handleAuctionBid = async () => {
        if (!bidModal?.auction || !bidAmount) return;

        setBiddingId(Number(bidModal.auction.auctionId));
        try {
            await bidOnAuction(bidModal.auction.auctionId, bidAmount);
            await refreshAfterAction();
            setBidModal(null);
            setBidAmount('');
            alert('Bid placed successfully!');
        } catch (e: any) {
            const msg = e.message || '';
            if (msg.includes('0xa0d26eb6') || msg.includes('BidTooLow')) {
                const hb = bidModal.auction.highestBid;
                const min = hb === 0n ? bidModal.auction.startPrice : hb + hb / 20n;
                alert(`Bid too low! Minimum: ${safeFormatXTZ(min)} ${currencySymbol()} (+5% above current bid)`);
            } else if (msg.includes('user rejected') || msg.includes('denied')) {
                // User cancelled — no alert needed
            } else {
                alert(`Error: ${msg}`);
            }
        }
        setBiddingId(null);
    };

    // Handle finalize auction
    const handleFinalizeAuction = async (auction: AuctionWithMeta) => {
        setBiddingId(Number(auction.auctionId));
        try {
            await finalizeAuction(auction.auctionId);
            await refreshAfterAction();
            alert('Auction finalized successfully!');
        } catch (e: any) {
            alert(`Error: ${e.message}`);
        }
        setBiddingId(null);
    };

    // Handle cancel auction
    const handleCancelAuction = async (auction: AuctionWithMeta) => {
        if (!confirm('Cancel this auction? NFT will be returned to you.')) return;
        setCancellingId(Number(auction.auctionId));
        try {
            await cancelAuction(auction.auctionId);
            await refreshAfterAction();
            if (activeTab === 'activity') fetchActivity(true);
            alert('Auction cancelled!');
        } catch (e: any) {
            const msg = e.message || '';
            if (msg.includes('AuctionHasBids') || msg.includes('0x')) {
                alert('Cannot cancel — auction already has bids.');
            } else {
                alert(`Error: ${msg}`);
            }
        }
        setCancellingId(null);
    };

    // Open Stats modal
    const openStatsModal = async (item: ListingWithMeta | AuctionWithMeta) => {
        setStatsItem(item);
        setStatsModalOpen(true);
        setLoadingStats(true);
        setStatsTab('bids');
        setCardBids([]);
        setCardSales([]);
        setCardStats(null);

        try {
            const tokenId = BigInt(item.tokenId);
            const [bids, sales, stats] = await Promise.all([
                getBidsForToken(tokenId),
                getTokenSaleHistory(tokenId),
                getTokenStats(tokenId)
            ]);
            setCardBids(bids || []);
            setCardSales(sales || []);
            setCardStats(stats);
        } catch (e) {
        }
        setLoadingStats(false);
    };

    // Open List/Sell modal
    const openListModal = async () => {
        setListModalOpen(true);
        setLoadingNFTs(true);
        setSelectedNFT(null);
        setSelectedPackId(null);
        setSellPrice('');
        setAuctionStartPrice('');
        setAuctionReservePrice('');

        try {
            const [cards, packs] = await Promise.all([
                getCards(address || ''),
                getUserPacks(address || ''),
            ]);
            // Filter out cards that are already listed
            setMyNFTs(sortByRarity(cards.filter(c => !c.isLocked)));
            setMyPackTokenIds(packs);
        } catch (e) {
        }
        setLoadingNFTs(false);
    };

    // Handle listing NFT (card or pack)
    const handleListNFT = async () => {
        // Pack listing
        if (selectedPackId !== null) {
            setIsSelling(true);
            try {
                if (sellMode === 'fixed') {
                    if (!sellPrice || parseFloat(sellPrice) <= 0) {
                        alert('Please enter a valid price');
                        setIsSelling(false);
                        return;
                    }
                    const res = await listPack(BigInt(selectedPackId), sellPrice);
                    if (res && (res as any).success === false) throw new Error((res as any).error || 'Listing failed');
                    alert('Pack listed successfully!');
                } else {
                    if (!auctionStartPrice || parseFloat(auctionStartPrice) <= 0) {
                        alert('Please enter a valid start price');
                        setIsSelling(false);
                        return;
                    }
                    const duration = parseInt(auctionDuration) || 1;
                    await createPackAuction(
                        BigInt(selectedPackId),
                        auctionStartPrice,
                        auctionReservePrice || auctionStartPrice,
                        duration
                    );
                    alert('Pack auction created successfully!');
                }
                setListModalOpen(false);
                await refreshAfterAction();
                if (activeTab === 'activity') fetchActivity(true);
            } catch (e: any) {
                alert(`Error: ${e.message}`);
            }
            setIsSelling(false);
            return;
        }

        // Card listing
        if (!selectedNFT) return;
        setIsSelling(true);

        try {
            if (sellMode === 'fixed') {
                if (!sellPrice || parseFloat(sellPrice) <= 0) {
                    alert('Please enter a valid price');
                    setIsSelling(false);
                    return;
                }
                const res = await listCard(BigInt(selectedNFT.tokenId), sellPrice);
                if (res && (res as any).success === false) throw new Error((res as any).error || 'Listing failed');
                alert('NFT listed successfully!');
            } else {
                if (!auctionStartPrice || parseFloat(auctionStartPrice) <= 0) {
                    alert('Please enter a valid start price');
                    setIsSelling(false);
                    return;
                }
                const duration = parseInt(auctionDuration) || 1;
                await createAuction(
                    BigInt(selectedNFT.tokenId),
                    auctionStartPrice,
                    auctionReservePrice || auctionStartPrice,
                    duration
                );
                alert('Auction created successfully!');
            }
            setListModalOpen(false);
            await refreshAfterAction();
            if (activeTab === 'activity') fetchActivity(true);
        } catch (e: any) {
            alert(`Error: ${e.message}`);
        }
        setIsSelling(false);
    };

    // Fetch activity data when tab is active
    const fetchActivity = useCallback(async (forceRefresh = false) => {
        if (!isConnected || !address) return;
        setLoadingActivity(true);
        try {
            // Invalidate caches to get fresh data
            if (forceRefresh) {
                blockchainCache.invalidate(CacheKeys.userListings(address));
                blockchainCache.invalidate(CacheKeys.userBids(address));
                blockchainCache.invalidate(CacheKeys.activeAuctions());
            }
            const [userListings, userBids, allAuctions, soldItems] = await Promise.all([
                getUserListings(address),
                getMyBids(),
                getActiveAuctions(),
                getUserSoldItems(address),
            ]);

            // Enrich listings with card metadata
            const enrichedListings = await Promise.all(
                userListings.map(async (l) => {
                    if (l.isPack) {
                        return { ...l, cardName: `Pack #${l.tokenId}`, cardImage: undefined, rarity: undefined, priceFormatted: formatXTZ(l.price), isPack: true };
                    }
                    try {
                        const info = await getCardInfo(Number(l.tokenId));
                        return { ...l, cardName: info?.name || `Card #${l.tokenId}`, cardImage: info?.image, rarity: info?.rarity, priceFormatted: formatXTZ(l.price) };
                    } catch { return { ...l, cardName: `Card #${l.tokenId}`, priceFormatted: formatXTZ(l.price) }; }
                })
            );

            // Filter auctions where user is the seller
            const userAuctions = allAuctions.filter(a => a.seller.toLowerCase() === address.toLowerCase());
            const enrichedAuctions = await Promise.all(
                userAuctions.map(async (a) => {
                    if (a.isPack) {
                        const { text, isEnded } = formatTimeLeft(a.endTime);
                        return { ...a, cardName: `Pack #${a.tokenId}`, cardImage: undefined, rarity: undefined, timeLeft: text, isEnded, isPack: true };
                    }
                    try {
                        const info = await getCardInfo(Number(a.tokenId));
                        const { text, isEnded } = formatTimeLeft(a.endTime);
                        return { ...a, cardName: info?.name || `Card #${a.tokenId}`, cardImage: info?.image, rarity: info?.rarity, timeLeft: text, isEnded };
                    } catch {
                        const { text, isEnded } = formatTimeLeft(a.endTime);
                        return { ...a, cardName: `Card #${a.tokenId}`, timeLeft: text, isEnded };
                    }
                })
            );

            // Enrich bids with card metadata
            const enrichedBids = await Promise.all(
                userBids.map(async (b) => {
                    try {
                        const info = await getCardInfo(Number(b.tokenId));
                        return { ...b, cardName: info?.name || `Card #${b.tokenId}`, cardImage: info?.image, rarity: info?.rarity };
                    } catch { return { ...b, cardName: `Card #${b.tokenId}` }; }
                })
            );

            // Enrich sold items with card metadata
            const enrichedSales = await Promise.all(
                soldItems.map(async (s) => {
                    try {
                        const info = await getCardInfo(Number(s.tokenId));
                        return { ...s, cardName: info?.name || `Card #${s.tokenId}`, cardImage: info?.image, rarity: info?.rarity };
                    } catch { return { ...s, cardName: `Card #${s.tokenId}` }; }
                })
            );

            setMyListings(enrichedListings);
            setMyAuctions(enrichedAuctions);
            setMyBids(enrichedBids);
            setMySales(enrichedSales);
        } catch (e) {
        }
        setLoadingActivity(false);
    }, [isConnected, address, getUserListings, getMyBids, getActiveAuctions, getUserSoldItems, getCardInfo]);

    useEffect(() => {
        if (activeTab === 'activity') fetchActivity(true);
    }, [activeTab, fetchActivity, networkId]);

    // Handle cancel bid from activity
    const handleCancelBid = async (bidId: bigint) => {
        setCancellingBidId(Number(bidId));
        try {
            await cancelBid(bidId);
            await refreshAfterAction();
            await fetchActivity();
            alert('Bid cancelled successfully!');
        } catch (e: any) {
            alert(`Error: ${e.message}`);
        }
        setCancellingBidId(null);
    };

    // Filter and sort listings
    const filteredListings = listings
        .filter(l => {
            if (typeFilter === 'cards' && l.isPack) return false;
            if (typeFilter === 'packs' && !l.isPack) return false;
            if (typeFilter !== 'packs' && rarityFilter !== 'All' && l.rarity !== rarityFilter) return false;
            if (typeFilter !== 'packs' && levelFilter > 0 && (l.level || 1) !== levelFilter) return false;
            if (searchQuery && !l.cardName?.toLowerCase().includes(searchQuery.toLowerCase())) return false;
            return true;
        })
        .sort((a, b) => {
            if (sortBy === 'price_asc') return Number(a.price - b.price);
            if (sortBy === 'price_desc') return Number(b.price - a.price);
            return Number(b.listedAt - a.listedAt);
        });

    // Filter auctions
    const filteredAuctions = auctions
        .filter(a => {
            if (typeFilter === 'cards' && a.isPack) return false;
            if (typeFilter === 'packs' && !a.isPack) return false;
            if (typeFilter !== 'packs' && rarityFilter !== 'All' && a.rarity !== rarityFilter) return false;
            if (typeFilter !== 'packs' && levelFilter > 0 && (a.level || 1) !== levelFilter) return false;
            if (searchQuery && !a.cardName?.toLowerCase().includes(searchQuery.toLowerCase())) return false;
            return true;
        });

    // Sort activity items
    const sortedMyListings = [...myListings].sort((a, b) => {
        if (sortBy === 'price_asc') return Number(a.price - b.price);
        if (sortBy === 'price_desc') return Number(b.price - a.price);
        return Number(b.listedAt - a.listedAt);
    });

    const sortedMyAuctions = [...myAuctions].sort((a, b) => {
        const aPrice = a.highestBid > 0n ? a.highestBid : a.startPrice;
        const bPrice = b.highestBid > 0n ? b.highestBid : b.startPrice;
        if (sortBy === 'price_asc') return Number(aPrice - bPrice);
        if (sortBy === 'price_desc') return Number(bPrice - aPrice);
        return Number(b.startTime - a.startTime);
    });

    const sortedMyBids = [...myBids].sort((a, b) => {
        if (sortBy === 'price_asc') return Number(a.amount - b.amount);
        if (sortBy === 'price_desc') return Number(b.amount - a.amount);
        return Number(b.expiration - a.expiration);
    });

    const sortedMySales = [...mySales].sort((a, b) => {
        if (sortBy === 'price_asc') return Number(a.price - b.price);
        if (sortBy === 'price_desc') return Number(b.price - a.price);
        return Number(b.timestamp - a.timestamp);
    });

    return (
        <div className="overflow-x-hidden">

            {/* Header */}
            <div className="flex flex-col space-y-4 md:space-y-6 mb-6 md:mb-8">
                <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                        <h2 className="text-xl md:text-3xl font-black text-yc-text-primary dark:text-white uppercase tracking-tight">Marketplace</h2>
                        <p className="text-gray-500 dark:text-gray-400 text-xs md:text-sm mt-1">
                            Buy, bid, and auction NFT cards.
                        </p>
                    </div>
                    {isConnected && (
                        <button
                            onClick={openListModal}
                            className="flex items-center gap-1.5 px-3 py-2 md:px-4 md:py-2.5 bg-yc-aleo hover:bg-yc-aleo/80 text-white rounded-lg font-bold text-xs md:text-sm transition-all shrink-0"
                        >
                            <Plus className="w-4 h-4" />
                            <span className="hidden sm:inline">List NFT</span>
                            <span className="sm:hidden">List</span>
                        </button>
                    )}
                </div>

                {/* Tab navigation */}
                <div className="flex items-center space-x-1 bg-white/50 dark:bg-white/[0.04] backdrop-blur-xl border border-white/40 dark:border-white/[0.06] p-1 rounded-2xl w-full md:w-fit flex-wrap">
                    <button
                        onClick={() => setActiveTab('listings')}
                        className={`flex items-center gap-1.5 px-3 md:px-4 py-2 rounded-xl text-xs md:text-sm font-semibold transition-all whitespace-nowrap ${activeTab === 'listings'
                            ? 'bg-yc-aleo/10 dark:bg-yc-aleo/[0.12] text-yc-aleo'
                            : 'text-gray-500 dark:text-gray-500 hover:text-black dark:hover:text-gray-300'
                            }`}
                    >
                        <Tag className="w-3.5 h-3.5 md:w-4 md:h-4" />
                        Buy Now
                        {listings.length > 0 && <span className="bg-gray-200 dark:bg-white/10 text-gray-600 dark:text-gray-300 px-1.5 py-0.5 rounded text-[10px] md:text-xs">{listings.length}</span>}
                    </button>
                    <button
                        onClick={() => setActiveTab('activity')}
                        className={`flex items-center gap-1.5 px-3 md:px-4 py-2 rounded-xl text-xs md:text-sm font-semibold transition-all whitespace-nowrap ${activeTab === 'activity'
                            ? 'bg-yc-aleo/10 dark:bg-yc-aleo/[0.12] text-yc-aleo'
                            : 'text-gray-500 dark:text-gray-500 hover:text-black dark:hover:text-gray-300'
                            }`}
                    >
                        <User className="w-3.5 h-3.5 md:w-4 md:h-4" />
                        Activity
                    </button>
                </div>

                {/* Filters */}
                <div className="flex flex-col gap-3">
                    {/* Type filter */}
                    <div className="flex items-center gap-2">
                        {(['all', 'cards', 'packs'] as TypeFilter[]).map((t) => (
                            <button
                                key={t}
                                onClick={() => { setTypeFilter(t); if (t === 'packs') setRarityFilter('All'); }}
                                className={`
                                    whitespace-nowrap px-3 md:px-5 py-1.5 md:py-2 rounded-full text-[10px] md:text-sm font-bold transition-all duration-300 transform active:scale-95 flex items-center gap-1.5
                                    ${typeFilter === t
                                        ? 'bg-[#F97316] text-white shadow-lg shadow-[#F97316]/30'
                                        : 'bg-white/50 dark:bg-white/[0.04] backdrop-blur-xl text-gray-600 dark:text-gray-400 hover:bg-white/70 dark:hover:bg-white/10 hover:text-gray-900 dark:hover:text-white'}
                                `}
                            >
                                {t === 'packs' && <Package className="w-3.5 h-3.5" />}
                                {t === 'all' ? 'All' : t === 'cards' ? 'Cards' : 'Packs'}
                            </button>
                        ))}
                    </div>

                    {/* Rarity tabs (hidden when filtering packs only) */}
                    {typeFilter !== 'packs' && (
                        <div className="flex items-center flex-wrap gap-1.5">
                            {rarityTabs.map((tab) => (
                                <button
                                    key={tab}
                                    onClick={() => setRarityFilter(tab)}
                                    className={`
                                        whitespace-nowrap px-3 md:px-5 py-1 md:py-1.5 rounded-full text-[10px] md:text-xs font-bold transition-all duration-300 transform active:scale-95
                                        ${rarityFilter === tab
                                            ? 'bg-white/80 dark:bg-white/15 text-gray-900 dark:text-white border border-white/60 dark:border-white/20 backdrop-blur-xl'
                                            : 'bg-white/40 dark:bg-white/[0.04] text-gray-600 dark:text-gray-400 hover:bg-white/60 dark:hover:bg-white/10 hover:text-gray-900 dark:hover:text-white'}
                                    `}
                                >
                                    {tab}
                                </button>
                            ))}
                            <span className="text-gray-400 mx-1">|</span>
                            {[0, 1, 2, 3, 4, 5].map((lvl) => (
                                <button
                                    key={`lvl-${lvl}`}
                                    onClick={() => setLevelFilter(lvl)}
                                    className={`
                                        whitespace-nowrap px-3 md:px-5 py-1 md:py-1.5 rounded-full text-[10px] md:text-xs font-bold transition-all duration-300 transform active:scale-95
                                        ${levelFilter === lvl
                                            ? 'bg-white/80 dark:bg-white/15 text-gray-900 dark:text-white border border-white/60 dark:border-white/20 backdrop-blur-xl'
                                            : 'bg-white/40 dark:bg-white/[0.04] text-gray-600 dark:text-gray-400 hover:bg-white/60 dark:hover:bg-white/10 hover:text-gray-900 dark:hover:text-white'}
                                    `}
                                >
                                    {lvl === 0 ? 'All Lvl' : `Lvl ${lvl}`}
                                </button>
                            ))}
                        </div>
                    )}

                    {/* Search & Sort */}
                    <div className="flex items-center gap-2 md:gap-3">
                        <div className="relative flex-1 min-w-0 group">
                            <Search className="absolute left-3 md:left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 group-focus-within:text-yc-aleo transition-colors" />
                            <input
                                type="text"
                                placeholder="Search..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="w-full bg-white dark:bg-white/[0.02] border border-gray-200 dark:border-white/[0.06] rounded-full pl-9 md:pl-10 pr-3 md:pr-4 py-2 md:py-2.5 text-sm font-medium text-yc-text-primary dark:text-white focus:outline-none focus:border-yc-aleo focus:ring-1 focus:ring-yc-aleo transition-all placeholder-gray-400 shadow-sm"
                            />
                        </div>
                        <select
                            value={sortBy}
                            onChange={(e) => setSortBy(e.target.value as any)}
                            className="px-3 md:px-5 py-2 md:py-2.5 bg-white dark:bg-white/[0.02] border border-gray-200 dark:border-white/[0.06] rounded-full text-xs md:text-sm font-bold text-yc-text-primary dark:text-white hover:border-yc-aleo transition-all shadow-sm cursor-pointer shrink-0"
                        >
                            <option value="recent">Recent</option>
                            <option value="price_asc">Price ↑</option>
                            <option value="price_desc">Price ↓</option>
                        </select>
                    </div>
                </div>
            </div>

            {/* LISTINGS TAB */}
            {activeTab === 'listings' && (
                <>
                    {loadingListings && (
                        <div className="flex flex-col items-center justify-center py-20">
                            <Loader2 className="w-8 h-8 text-yc-aleo animate-spin mb-4" />
                            <p className="text-gray-400">Loading listings...</p>
                        </div>
                    )}

                    {!loadingListings && filteredListings.length === 0 && (
                        <div className="flex flex-col items-center justify-center py-20 glass-panel rounded-xl">
                            <ShoppingCart className="w-16 h-16 text-gray-400 dark:text-gray-600 mb-4" />
                            <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">No listings found</h3>
                            <p className="text-gray-500 dark:text-gray-400 text-center max-w-md">
                                {listings.length === 0
                                    ? "There are no cards listed for sale yet. Be the first to list!"
                                    : "No cards match your current filters."}
                            </p>
                        </div>
                    )}

                    {!loadingListings && filteredListings.length > 0 && (
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-1.5 md:gap-4">
                            {filteredListings.map((listing) => (
                                <div
                                    key={listing.listingId}
                                    className="glass-panel glass-panel-hover rounded-xl overflow-hidden transition-all duration-300 group"
                                >
                                    <div
                                        className="relative overflow-hidden cursor-pointer"
                                        style={{ aspectRatio: '591/1004' }}
                                        onClick={() => !listing.isPack && openStatsModal(listing)}
                                    >
                                        {listing.isPack ? (
                                            <PackVisual tokenId={listing.tokenId} className="w-full h-full rounded-none" />
                                        ) : (
                                            <>
                                                <LevelBadge level={listing.level} />
                                                <img
                                                    src={listing.cardImage}
                                                    alt={listing.cardName}
                                                    className="w-full h-full object-contain group-hover:scale-105 transition-transform duration-500"
                                                />
                                            </>
                                        )}
                                    </div>
                                    <div className="p-1.5 md:p-4">
                                        <p className="text-gray-900 dark:text-white font-bold text-[11px] md:text-lg leading-tight">{listing.priceFormatted} {currencySymbol()}</p>
                                        {listing.seller.toLowerCase() === address?.toLowerCase() ? (
                                            <button
                                                onClick={() => handleCancelListing(listing)}
                                                disabled={cancellingId === Number(listing.listingId)}
                                                className={`
                                                    w-full mt-1.5 md:mt-3 px-2 py-1 md:px-4 md:py-2 rounded-lg font-bold text-[10px] md:text-sm transition-all
                                                    ${cancellingId === Number(listing.listingId)
                                                        ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
                                                        : 'bg-red-500/20 text-red-400 hover:bg-red-500 hover:text-white active:scale-95'}
                                                `}
                                            >
                                                {cancellingId === Number(listing.listingId) ? (
                                                    <Loader2 className="w-3 h-3 animate-spin" />
                                                ) : (
                                                    'Cancel'
                                                )}
                                            </button>
                                        ) : (
                                            <button
                                                onClick={() => handleBuy(listing)}
                                                disabled={buyingId === Number(listing.listingId) || !isConnected}
                                                className={`
                                                    w-full mt-1.5 md:mt-3 px-2 py-1 md:px-4 md:py-2 rounded-lg font-bold text-[10px] md:text-sm transition-all
                                                    ${buyingId === Number(listing.listingId)
                                                        ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
                                                        : 'bg-yc-aleo text-white hover:bg-yc-aleo/80 active:scale-95'}
                                                `}
                                            >
                                                {buyingId === Number(listing.listingId) ? (
                                                    <Loader2 className="w-3 h-3 animate-spin" />
                                                ) : (
                                                    'Buy'
                                                )}
                                            </button>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </>
            )}

            {/* AUCTIONS TAB */}
            {activeTab === 'auctions' && (
                <>
                    {loadingAuctions && (
                        <div className="flex flex-col items-center justify-center py-20">
                            <Loader2 className="w-8 h-8 text-yc-aleo animate-spin mb-4" />
                            <p className="text-gray-400">Loading auctions...</p>
                        </div>
                    )}

                    {!loadingAuctions && filteredAuctions.length === 0 && (
                        <div className="flex flex-col items-center justify-center py-20 glass-panel rounded-xl">
                            <Gavel className="w-16 h-16 text-gray-400 dark:text-gray-600 mb-4" />
                            <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">No auctions found</h3>
                            <p className="text-gray-500 dark:text-gray-400 text-center max-w-md">
                                There are no active auctions. Create one from your Portfolio!
                            </p>
                        </div>
                    )}

                    {!loadingAuctions && filteredAuctions.length > 0 && (
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-1.5 md:gap-4">
                            {filteredAuctions.map((auction) => (
                                <div
                                    key={auction.auctionId}
                                    className="glass-panel glass-panel-hover rounded-xl overflow-hidden transition-all duration-300 group"
                                >
                                    <div
                                        className="relative overflow-hidden cursor-pointer"
                                        style={{ aspectRatio: '591/1004' }}
                                        onClick={() => !auction.isPack && openStatsModal(auction)}
                                    >
                                        {auction.isPack ? (
                                            <PackVisual tokenId={auction.tokenId} className="w-full h-full rounded-none" />
                                        ) : (
                                            <>
                                                <LevelBadge level={auction.level} />
                                                <img
                                                    src={auction.cardImage}
                                                    alt={auction.cardName}
                                                    className="w-full h-full object-contain group-hover:scale-105 transition-transform duration-500"
                                                />
                                            </>
                                        )}
                                        {/* Timer */}
                                        <div className={`absolute top-2 right-2 flex items-center gap-1 px-2 py-0.5 text-xs font-bold rounded ${auction.isEnded ? 'bg-red-600 text-white' : 'bg-black/80 dark:bg-black/80 text-yc-aleo'}`}>
                                            <Clock className="w-3 h-3" />
                                            {auction.timeLeft}
                                        </div>
                                    </div>
                                    <div className="p-1.5 md:p-4">
                                        <p className="text-gray-900 dark:text-white font-bold text-[11px] md:text-base leading-tight">{safeFormatXTZ(auction.highestBid)} {currencySymbol()}</p>
                                        {auction.isEnded ? (
                                            <button
                                                onClick={() => handleFinalizeAuction(auction)}
                                                disabled={biddingId === Number(auction.auctionId)}
                                                className="w-full mt-1.5 md:mt-3 px-2 py-1 md:px-4 md:py-2 rounded-lg font-bold text-[10px] md:text-sm bg-green-600 text-white hover:bg-green-700 transition-all"
                                            >
                                                {biddingId === Number(auction.auctionId) ? (
                                                    <Loader2 className="w-3 h-3 animate-spin mx-auto" />
                                                ) : 'Finalize'}
                                            </button>
                                        ) : auction.seller.toLowerCase() === address?.toLowerCase() ? (
                                            // Seller: show Cancel (no bids) or Yours (has bids)
                                            auction.highestBidder === '0x0000000000000000000000000000000000000000' || !auction.highestBidder ? (
                                                <button
                                                    onClick={() => handleCancelAuction(auction)}
                                                    disabled={cancellingId === Number(auction.auctionId)}
                                                    className="w-full mt-1.5 md:mt-3 px-2 py-1 md:px-4 md:py-2 rounded-lg font-bold text-[10px] md:text-sm bg-red-500/20 text-red-400 hover:bg-red-500 hover:text-white transition-all"
                                                >
                                                    {cancellingId === Number(auction.auctionId) ? <Loader2 className="w-3 h-3 animate-spin mx-auto" /> : 'Cancel'}
                                                </button>
                                            ) : (
                                                <p className="mt-1.5 md:mt-3 px-2 py-1 md:px-4 md:py-2 text-center font-bold text-[10px] md:text-sm text-gray-400">Has bids</p>
                                            )
                                        ) : (
                                            <button
                                                onClick={() => { setBidModal({ auction }); setBidAmount(''); }}
                                                className="w-full mt-1.5 md:mt-3 px-2 py-1 md:px-4 md:py-2 rounded-lg font-bold text-[10px] md:text-sm transition-all bg-white dark:bg-white/[0.08] text-black dark:text-white border border-gray-200 dark:border-white/[0.1] hover:bg-gray-100 dark:hover:bg-white/[0.15]"
                                            >
                                                {'Bid'}
                                            </button>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </>
            )}

            {/* ACTIVITY TAB */}
            {activeTab === 'activity' && (
                <>
                    <>
                        {/* Activity sub-filters */}
                        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
                            <div className="flex items-center gap-1.5 flex-wrap w-full sm:w-auto">
                                {([
                                    { key: 'all', label: 'All', count: myListings.length + myAuctions.length + myBids.length + mySales.length },
                                    { key: 'listings', label: 'Listings', count: myListings.length },
                                    { key: 'auctions', label: 'Auctions', count: myAuctions.length },
                                    { key: 'bids', label: 'Bids', count: myBids.length },
                                    { key: 'sold', label: 'Sold', count: mySales.length },
                                ] as { key: ActivityFilter; label: string; count: number }[]).map(f => (
                                    <button
                                        key={f.key}
                                        onClick={() => setActivityFilter(f.key)}
                                        className={`px-3 md:px-4 py-1 md:py-1.5 rounded-full text-[10px] md:text-xs font-bold transition-all ${activityFilter === f.key
                                                ? 'bg-[#F97316] text-white shadow-lg shadow-[#F97316]/30'
                                                : 'bg-white/50 dark:bg-white/[0.04] text-gray-600 dark:text-gray-400 hover:bg-white/70 dark:hover:bg-white/10'
                                            }`}
                                    >
                                        {f.label}
                                        {!loadingActivity && f.count > 0 && (
                                            <span className="ml-1.5 bg-black/20 px-1.5 py-0.5 rounded text-[10px]">{f.count}</span>
                                        )}
                                    </button>
                                ))}
                            </div>

                            {/* Sort dropdown for activity */}
                            <select
                                value={sortBy}
                                onChange={(e) => setSortBy(e.target.value as any)}
                                className="px-4 py-2 bg-white dark:bg-white/[0.02] border border-gray-200 dark:border-white/[0.06] rounded-full text-xs font-bold text-yc-text-primary dark:text-white hover:border-yc-aleo focus:border-yc-aleo focus:ring-1 focus:ring-yc-aleo transition-all shadow-sm cursor-pointer shrink-0 w-full sm:w-auto"
                            >
                                <option value="recent">Recent First</option>
                                <option value="price_asc">Price: Low to High</option>
                                <option value="price_desc">Price: High to Low</option>
                            </select>
                        </div>

                        {loadingActivity ? (
                            <div className="flex flex-col items-center justify-center py-20">
                                <Loader2 className="w-8 h-8 text-yc-aleo animate-spin mb-4" />
                                <p className="text-gray-400">Loading your activity...</p>
                            </div>
                        ) : (
                            <div className="space-y-6">
                                {/* My Listings */}
                                {(activityFilter === 'all' || activityFilter === 'listings') && sortedMyListings.length > 0 && (
                                    <div>
                                        {activityFilter === 'all' && <h3 className="text-sm font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-2"><Tag className="w-3.5 h-3.5" /> My Listings</h3>}
                                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-1.5 md:gap-4">
                                            {sortedMyListings.map(listing => (
                                                <div key={`l-${listing.listingId}`} className="glass-panel glass-panel-hover rounded-xl overflow-hidden transition-all group">
                                                    <div className="relative overflow-hidden" style={{ aspectRatio: '591/1004' }}>
                                                        {listing.isPack ? (
                                                            <PackVisual tokenId={listing.tokenId} className="w-full h-full rounded-none" />
                                                        ) : (
                                                            <img src={listing.cardImage || '/placeholder-card.png'} alt={listing.cardName} className="w-full h-full object-contain group-hover:scale-105 transition-transform duration-500" />
                                                        )}
                                                        <div className="absolute top-2 left-2 bg-yc-aleo/90 text-white text-[9px] font-bold px-2 py-0.5 rounded">Listed</div>
                                                    </div>
                                                    <div className="p-1.5 md:p-3">
                                                        <p className="text-gray-900 dark:text-white font-bold text-[11px] md:text-sm">{listing.priceFormatted} {currencySymbol()}</p>
                                                        <button
                                                            onClick={() => handleCancelListing(listing)}
                                                            disabled={cancellingId === Number(listing.listingId)}
                                                            className="w-full mt-1.5 px-2 py-1 md:py-1.5 rounded-lg font-bold text-[10px] md:text-xs bg-red-500/20 text-red-400 hover:bg-red-500 hover:text-white transition-all"
                                                        >
                                                            {cancellingId === Number(listing.listingId) ? <Loader2 className="w-3 h-3 animate-spin mx-auto" /> : 'Cancel Listing'}
                                                        </button>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* My Auctions */}
                                {(activityFilter === 'all' || activityFilter === 'auctions') && sortedMyAuctions.length > 0 && (
                                    <div>
                                        {activityFilter === 'all' && <h3 className="text-sm font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-2"><Gavel className="w-3.5 h-3.5" /> My Auctions</h3>}
                                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-1.5 md:gap-4">
                                            {sortedMyAuctions.map(auction => (
                                                <div key={`a-${auction.auctionId}`} className="glass-panel glass-panel-hover rounded-xl overflow-hidden transition-all group">
                                                    <div className="relative overflow-hidden" style={{ aspectRatio: '591/1004' }}>
                                                        {auction.isPack ? (
                                                            <PackVisual tokenId={auction.tokenId} className="w-full h-full rounded-none" />
                                                        ) : (
                                                            <img src={auction.cardImage || '/placeholder-card.png'} alt={auction.cardName} className="w-full h-full object-contain group-hover:scale-105 transition-transform duration-500" />
                                                        )}
                                                        <div className={`absolute top-2 right-2 flex items-center gap-1 px-2 py-0.5 text-[9px] font-bold rounded ${auction.isEnded ? 'bg-red-600 text-white' : 'bg-black/80 text-yc-aleo'}`}>
                                                            <Clock className="w-2.5 h-2.5" />
                                                            {auction.timeLeft}
                                                        </div>
                                                        <div className="absolute top-2 left-2 bg-orange-600/90 text-white text-[9px] font-bold px-2 py-0.5 rounded">Auction</div>
                                                    </div>
                                                    <div className="p-1.5 md:p-3">
                                                        <p className="text-gray-900 dark:text-white font-bold text-[11px] md:text-sm">{safeFormatXTZ(auction.highestBid > 0n ? auction.highestBid : auction.startPrice)} {currencySymbol()}</p>
                                                        <p className="text-[9px] text-gray-400">{auction.highestBid > 0n ? 'Current bid' : 'Starting price'}</p>
                                                        {auction.isEnded ? (
                                                            <button
                                                                onClick={() => handleFinalizeAuction(auction)}
                                                                disabled={biddingId === Number(auction.auctionId)}
                                                                className="w-full mt-1.5 px-2 py-1 md:py-1.5 rounded-lg font-bold text-[10px] md:text-xs bg-green-600 text-white hover:bg-green-700 transition-all"
                                                            >
                                                                {biddingId === Number(auction.auctionId) ? <Loader2 className="w-3 h-3 animate-spin mx-auto" /> : 'Finalize'}
                                                            </button>
                                                        ) : auction.highestBidder === '0x0000000000000000000000000000000000000000' || !auction.highestBidder ? (
                                                            <button
                                                                onClick={() => handleCancelAuction(auction)}
                                                                disabled={cancellingId === Number(auction.auctionId)}
                                                                className="w-full mt-1.5 px-2 py-1 md:py-1.5 rounded-lg font-bold text-[10px] md:text-xs bg-red-500/20 text-red-400 hover:bg-red-500 hover:text-white transition-all"
                                                            >
                                                                {cancellingId === Number(auction.auctionId) ? <Loader2 className="w-3 h-3 animate-spin mx-auto" /> : 'Cancel Auction'}
                                                            </button>
                                                        ) : (
                                                            <p className="mt-1.5 text-[10px] text-gray-400 text-center">Has bids</p>
                                                        )}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* My Bids */}
                                {(activityFilter === 'all' || activityFilter === 'bids') && sortedMyBids.length > 0 && (
                                    <div>
                                        {activityFilter === 'all' && <h3 className="text-sm font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-2"><DollarSign className="w-3.5 h-3.5" /> My Bids</h3>}
                                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-1.5 md:gap-4">
                                            {sortedMyBids.map(bid => (
                                                <div key={`b-${bid.bidId}`} className="glass-panel glass-panel-hover rounded-xl overflow-hidden transition-all group">
                                                    <div className="relative overflow-hidden" style={{ aspectRatio: '591/1004' }}>
                                                        <img src={bid.cardImage || '/placeholder-card.png'} alt={bid.cardName} className="w-full h-full object-contain group-hover:scale-105 transition-transform duration-500" />
                                                        <div className="absolute top-2 left-2 bg-blue-600/90 text-white text-[9px] font-bold px-2 py-0.5 rounded">Bid</div>
                                                    </div>
                                                    <div className="p-1.5 md:p-3">
                                                        <p className="text-gray-900 dark:text-white font-bold text-[11px] md:text-sm">{safeFormatXTZ(bid.amount)} {currencySymbol()}</p>
                                                        <p className="text-[9px] text-gray-400">Expires: {safeFormatDate(bid.expiration)}</p>
                                                        <button
                                                            onClick={() => handleCancelBid(bid.bidId)}
                                                            disabled={cancellingBidId === Number(bid.bidId)}
                                                            className="w-full mt-1.5 px-2 py-1 md:py-1.5 rounded-lg font-bold text-[10px] md:text-xs bg-red-500/20 text-red-400 hover:bg-red-500 hover:text-white transition-all"
                                                        >
                                                            {cancellingBidId === Number(bid.bidId) ? <Loader2 className="w-3 h-3 animate-spin mx-auto" /> : 'Cancel Bid'}
                                                        </button>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* Sold Items */}
                                {(activityFilter === 'all' || activityFilter === 'sold') && sortedMySales.length > 0 && (
                                    <div>
                                        {activityFilter === 'all' && <h3 className="text-sm font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-2"><CheckCircle className="w-3.5 h-3.5 text-green-500" /> Sold</h3>}
                                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-1.5 md:gap-4">
                                            {sortedMySales.map((sale, idx) => (
                                                <div key={`sold-${idx}`} className="glass-panel rounded-xl overflow-hidden">
                                                    <div className="relative overflow-hidden" style={{ aspectRatio: '591/1004' }}>
                                                        <img src={(sale as any).cardImage || '/placeholder-card.png'} alt={(sale as any).cardName} className="w-full h-full object-contain opacity-75" />
                                                        <div className="absolute top-2 left-2 bg-green-600/90 text-white text-[9px] font-bold px-2 py-0.5 rounded">Sold</div>
                                                        <div className="absolute top-2 right-2 bg-black/60 text-white text-[9px] px-2 py-0.5 rounded">{sale.saleType === 0 ? 'Listing' : 'Bid'}</div>
                                                    </div>
                                                    <div className="p-1.5 md:p-3">
                                                        <p className="text-gray-900 dark:text-white font-bold text-[11px] md:text-sm">{safeFormatXTZ(sale.price)} {currencySymbol()}</p>
                                                        <p className="text-[9px] text-gray-400 truncate">To: {sale.buyer.slice(0, 6)}…{sale.buyer.slice(-4)}</p>
                                                        <p className="text-[9px] text-gray-500">{new Date(Number(sale.timestamp) * 1000).toLocaleDateString()}</p>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* Empty state */}
                                {!loadingActivity && (
                                    (activityFilter === 'all' && myListings.length === 0 && myAuctions.length === 0 && myBids.length === 0 && mySales.length === 0) ||
                                    (activityFilter === 'listings' && myListings.length === 0) ||
                                    (activityFilter === 'auctions' && myAuctions.length === 0) ||
                                    (activityFilter === 'bids' && myBids.length === 0) ||
                                    (activityFilter === 'sold' && mySales.length === 0)
                                ) && (
                                        <div className="flex flex-col items-center justify-center py-16 glass-panel rounded-xl">
                                            <Activity className="w-12 h-12 text-gray-400 dark:text-gray-600 mb-3" />
                                            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-1">No Activity</h3>
                                            <p className="text-gray-500 dark:text-gray-400 text-sm text-center max-w-sm">
                                                {!isConnected ? 'Connect your wallet to see your marketplace activity.' :
                                                    activityFilter === 'listings' ? "You haven't listed any NFTs yet." :
                                                        activityFilter === 'auctions' ? "You haven't created any auctions yet." :
                                                            activityFilter === 'bids' ? "You haven't placed any bids yet." :
                                                                activityFilter === 'sold' ? "No sold NFTs found." :
                                                                    "No marketplace activity yet. List an NFT or place a bid to get started!"}
                                            </p>
                                        </div>
                                    )}
                            </div>
                        )}
                    </>
                </>
            )}

            {/* BID MODAL */}
            {bidModal && (
                <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" onClick={() => setBidModal(null)}>
                    <div className="glass-panel rounded-2xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-between mb-6">
                            <h3 className="text-xl font-bold text-gray-900 dark:text-white">{bidModal.auction ? 'Place Bid' : 'Make Offer'}</h3>
                            <button onClick={() => setBidModal(null)} className="text-gray-400 hover:text-gray-900 dark:hover:text-white">
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        {bidModal.auction ? (
                            <>
                                <div className="flex items-center gap-4 mb-6">
                                    <img src={bidModal.auction.cardImage} alt="" className="w-20 h-20 rounded-lg object-cover" />
                                    <div>
                                        <h4 className="text-gray-900 dark:text-white font-bold">{bidModal.auction.cardName}</h4>
                                        <p className="text-gray-500 dark:text-gray-400 text-sm">Current: {safeFormatXTZ(bidModal.auction.highestBid)} {currencySymbol()}</p>
                                    </div>
                                </div>

                                <div className="mb-6">
                                    <label className="text-gray-500 dark:text-gray-400 text-sm mb-2 block">Your Bid ({currencySymbol()})</label>
                                    <input
                                        type="number"
                                        step="0.01"
                                        value={bidAmount}
                                        onChange={(e) => setBidAmount(e.target.value)}
                                        placeholder={(() => {
                                            const hb = bidModal.auction!.highestBid;
                                            const min = hb === 0n ? bidModal.auction!.startPrice : hb + hb / 20n;
                                            return safeFormatXTZ(min);
                                        })()}
                                        className="w-full bg-gray-50 dark:bg-white/[0.02] border border-gray-200 dark:border-white/[0.06] rounded-lg px-4 py-3 text-gray-900 dark:text-white font-bold text-lg focus:border-yc-aleo focus:outline-none"
                                    />
                                    <p className="text-gray-500 dark:text-gray-500 text-xs mt-1">
                                        Min bid: {(() => {
                                            const hb = bidModal.auction!.highestBid;
                                            const min = hb === 0n ? bidModal.auction!.startPrice : hb + hb / 20n;
                                            return safeFormatXTZ(min);
                                        })()} {currencySymbol()} {bidModal.auction!.highestBid > 0n && '(+5%)'}
                                    </p>
                                </div>

                                <button
                                    onClick={handleAuctionBid}
                                    disabled={!bidAmount || biddingId !== null}
                                    className="w-full bg-yc-aleo text-white font-bold py-3 rounded-2xl hover:bg-yc-aleo/80 disabled:bg-gray-300 dark:disabled:bg-gray-800 disabled:text-gray-500 disabled:cursor-not-allowed transition-all"
                                >
                                    {biddingId !== null ? (
                                        <Loader2 className="w-5 h-5 animate-spin mx-auto" />
                                    ) : 'Confirm Bid'}
                                </button>
                            </>
                        ) : bidModal.listing && (
                            <>
                                <div className="flex items-center gap-4 mb-4">
                                    <img src={bidModal.listing.cardImage} alt="" className="w-20 h-20 rounded-lg object-cover" />
                                    <div>
                                        <h4 className="text-gray-900 dark:text-white font-bold">{bidModal.listing.cardName}</h4>
                                        <p className="text-gray-500 dark:text-gray-400 text-sm">Listed: {bidModal.listing.priceFormatted} {currencySymbol()}</p>
                                    </div>
                                </div>

                                <div className="mb-4 p-3 bg-orange-500/10 border border-orange-500/30 rounded-lg">
                                    <p className="text-orange-600 dark:text-orange-300 text-xs">
                                        💡 Make an offer below the listing price. The seller can accept your offer at any time.
                                    </p>
                                </div>

                                <div className="mb-6">
                                    <label className="text-gray-500 dark:text-gray-400 text-sm mb-2 block">Your Offer ({currencySymbol()})</label>
                                    <input
                                        type="number"
                                        step="0.01"
                                        value={bidAmount}
                                        onChange={(e) => setBidAmount(e.target.value)}
                                        placeholder="0.00"
                                        className="w-full bg-gray-50 dark:bg-white/[0.02] border border-gray-200 dark:border-white/[0.06] rounded-lg px-4 py-3 text-gray-900 dark:text-white font-bold text-lg focus:border-yc-aleo focus:outline-none"
                                    />
                                    <p className="text-gray-500 dark:text-gray-500 text-xs mt-1">Offer valid for 7 days</p>
                                </div>

                                <button
                                    onClick={handleListingBid}
                                    disabled={!bidAmount || biddingId !== null}
                                    className="w-full bg-orange-600 text-white font-bold py-3 rounded-lg hover:bg-orange-700 disabled:bg-gray-700 disabled:text-gray-400 disabled:cursor-not-allowed transition-all"
                                >
                                    {biddingId !== null ? (
                                        <Loader2 className="w-5 h-5 animate-spin mx-auto" />
                                    ) : 'Submit Offer'}
                                </button>
                            </>
                        )}
                    </div>
                </div>
            )}

            {/* Stats Modal */}
            {statsModalOpen && statsItem && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                    <div className="glass-panel rounded-2xl max-w-lg w-full max-h-[80vh] overflow-hidden">
                        <div className="p-4 border-b border-gray-200 dark:border-white/[0.06] flex justify-between items-center">
                            <h3 className="text-gray-900 dark:text-white font-bold text-lg">NFT Statistics</h3>
                            <button onClick={() => setStatsModalOpen(false)} className="text-gray-400 hover:text-gray-900 dark:hover:text-white">
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        {/* Card preview */}
                        <div className="p-4 flex gap-4 border-b border-gray-200 dark:border-white/[0.06]">
                            <img src={statsItem.cardImage} alt={statsItem.cardName} className="w-20 h-20 rounded-lg object-cover" />
                            <div>
                                <h4 className="text-gray-900 dark:text-white font-bold">{statsItem.cardName}</h4>
                                <p className="text-gray-500 dark:text-gray-400 text-sm">Token #{String(statsItem.tokenId)}</p>
                                <span className={`text-xs px-2 py-0.5 rounded ${RARITY_COLORS[statsItem.rarity || 'Common']}`}>{statsItem.rarity}</span>
                            </div>
                        </div>

                        {/* Tabs */}
                        <div className="flex border-b border-gray-200 dark:border-white/[0.06]">
                            {['bids', 'sales', 'stats'].map(tab => (
                                <button
                                    key={tab}
                                    onClick={() => setStatsTab(tab as any)}
                                    className={`flex-1 py-3 text-sm font-bold transition-colors ${statsTab === tab ? 'text-yc-aleo border-b-2 border-yc-aleo' : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'}`}
                                >
                                    {tab === 'bids' && <><Activity className="w-4 h-4 inline mr-1" />Bids</>}
                                    {tab === 'sales' && <><History className="w-4 h-4 inline mr-1" />Sales</>}
                                    {tab === 'stats' && <><DollarSign className="w-4 h-4 inline mr-1" />Stats</>}
                                </button>
                            ))}
                        </div>

                        {/* Content */}
                        <div className="p-4 max-h-64 overflow-y-auto">
                            {loadingStats ? (
                                <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 text-yc-aleo animate-spin" /></div>
                            ) : (
                                <>
                                    {statsTab === 'bids' && (
                                        cardBids.length === 0 ? (
                                            <div className="py-4">
                                                {/* Show auction bid if this is an auction with a bid */}
                                                {statsItem && 'highestBid' in statsItem && (statsItem as AuctionWithMeta).highestBid > 0n ? (
                                                    <div className="p-3 bg-gray-50 dark:bg-white/[0.02] rounded-lg border border-gray-200 dark:border-white/[0.06]">
                                                        <div className="flex items-center gap-2">
                                                            <span className="text-gray-900 dark:text-white font-bold">{safeFormatXTZ((statsItem as AuctionWithMeta).highestBid)} {currencySymbol()}</span>
                                                            <span className="text-gray-500 dark:text-gray-500 text-xs">from</span>
                                                            <span className="text-gray-500 dark:text-gray-400 text-xs">{(statsItem as AuctionWithMeta).highestBidder?.slice(0, 6)}...{(statsItem as AuctionWithMeta).highestBidder?.slice(-4)}</span>
                                                            <span className="text-xs bg-yc-aleo/20 text-yc-aleo px-2 py-0.5 rounded-full font-bold">Auction bid</span>
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <p className="text-gray-500 dark:text-gray-500 text-center">No active offers</p>
                                                )}
                                            </div>
                                        ) : (
                                            <div className="space-y-2">
                                                {cardBids.map((bid: any, i: number) => (
                                                    <div key={i} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-white/[0.02] rounded-lg border border-gray-200 dark:border-white/[0.06]">
                                                        <div className="flex-1">
                                                            <div className="flex items-center gap-2">
                                                                <span className="text-gray-900 dark:text-white font-bold">{safeFormatXTZ(bid.amount)} {currencySymbol()}</span>
                                                                <span className="text-gray-500 dark:text-gray-500 text-xs">from</span>
                                                                <span className="text-gray-500 dark:text-gray-400 text-xs">{bid.bidder?.slice(0, 6)}...{bid.bidder?.slice(-4)}</span>
                                                            </div>
                                                            <p className="text-gray-500 dark:text-gray-500 text-xs mt-1">
                                                                Expires: {safeFormatDate(bid.expiration)}
                                                            </p>
                                                        </div>
                                                        {statsItem && 'seller' in statsItem && statsItem.seller?.toLowerCase() === address?.toLowerCase() && (
                                                            <button
                                                                onClick={() => handleAcceptBid(bid.bidId)}
                                                                className="ml-3 px-3 py-1.5 bg-yc-aleo text-white rounded-lg text-xs font-bold hover:bg-yc-aleo/80 transition-all"
                                                            >
                                                                Accept
                                                            </button>
                                                        )}
                                                    </div>
                                                ))}
                                            </div>
                                        )
                                    )}
                                    {statsTab === 'sales' && (
                                        cardSales.length === 0 ? <p className="text-gray-500 dark:text-gray-500 text-center py-4">No sales history</p> :
                                            cardSales.map((sale, i) => (
                                                <div key={i} className="py-2 border-b border-gray-200 dark:border-white/[0.06] last:border-0">
                                                    <div className="flex justify-between">
                                                        <span className="text-gray-900 dark:text-white font-bold">{safeFormatXTZ(sale.price)} {currencySymbol()}</span>
                                                        <span className="text-gray-500 dark:text-gray-400 text-xs">{safeFormatDate(sale.timestamp)}</span>
                                                    </div>
                                                    <p className="text-gray-500 dark:text-gray-500 text-xs">{sale.seller?.slice(0, 6)}... → {sale.buyer?.slice(0, 6)}...</p>
                                                </div>
                                            ))
                                    )}
                                    {statsTab === 'stats' && cardStats && (
                                        <div className="space-y-3">
                                            <div className="flex justify-between"><span className="text-gray-500 dark:text-gray-400">Total Sales</span><span className="text-gray-900 dark:text-white font-bold">{String(cardStats.totalSales || 0)}</span></div>
                                            <div className="flex justify-between"><span className="text-gray-500 dark:text-gray-400">Total Volume</span><span className="text-gray-900 dark:text-white font-bold">{safeFormatXTZ(cardStats.totalVolume || 0n)} {currencySymbol()}</span></div>
                                            <div className="flex justify-between"><span className="text-gray-500 dark:text-gray-400">Highest Sale</span><span className="text-yc-green font-bold">{safeFormatXTZ(cardStats.highestSale || 0n)} {currencySymbol()}</span></div>
                                            <div className="flex justify-between"><span className="text-gray-500 dark:text-gray-400">Lowest Sale</span><span className="text-red-400 font-bold">{safeFormatXTZ(cardStats.lowestSale || 0n)} {currencySymbol()}</span></div>
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* List NFT Modal */}
            {listModalOpen && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                    <div className="glass-panel rounded-2xl max-w-lg w-full max-h-[85vh] overflow-hidden">
                        <div className="p-4 border-b border-gray-200 dark:border-white/[0.06] flex justify-between items-center">
                            <h3 className="text-gray-900 dark:text-white font-bold text-lg">List NFT for Sale</h3>
                            <button onClick={() => setListModalOpen(false)} className="text-gray-400 hover:text-gray-900 dark:hover:text-white">
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        <div className="p-4 max-h-[calc(85vh-120px)] overflow-y-auto">
                            {loadingNFTs ? (
                                <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 text-yc-aleo animate-spin" /></div>
                            ) : !selectedNFT && selectedPackId === null ? (
                                <>
                                    <p className="text-gray-500 dark:text-gray-400 text-sm mb-4">Select an NFT to list:</p>
                                    {myNFTs.length === 0 && myPackTokenIds.length === 0 ? <p className="text-gray-500 dark:text-gray-500 text-center py-4">No NFTs available to list</p> : (
                                        <div className="grid grid-cols-2 gap-3">
                                            {/* Packs first */}
                                            {myPackTokenIds.map(packId => (
                                                <div
                                                    key={`pack-${packId}`}
                                                    onClick={() => { setSelectedPackId(packId); setSelectedNFT(null); }}
                                                    className="cursor-pointer rounded-xl glass-panel glass-panel-hover overflow-hidden transition-colors"
                                                >
                                                    <PackVisual tokenId={packId} className="w-full" style={{ aspectRatio: '591/1004' }} />
                                                </div>
                                            ))}
                                            {/* Cards */}
                                            {myNFTs.map(nft => (
                                                <div
                                                    key={nft.tokenId}
                                                    onClick={() => { setSelectedNFT(nft); setSelectedPackId(null); }}
                                                    className="cursor-pointer rounded-xl glass-panel glass-panel-hover overflow-hidden transition-colors"
                                                >
                                                    <img src={nft.image} alt={nft.name} className="w-full object-contain" style={{ aspectRatio: '591/1004' }} />
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </>
                            ) : (
                                <>
                                    <div className="flex gap-4 mb-4">
                                        {selectedPackId !== null ? (
                                            <>
                                                <div className="w-20 h-20 rounded-lg overflow-hidden shrink-0 bg-gradient-to-b from-gray-100 to-gray-50 dark:from-[#111] dark:to-[#0a0a0a]">
                                                    <ModelViewer3D mode="static" cameraZ={3.2} modelScale={0.7} />
                                                </div>
                                                <div>
                                                    <h4 className="text-gray-900 dark:text-white font-bold">UnicornX Pack</h4>
                                                    <p className="text-gray-500 dark:text-gray-400 text-sm">Pack #{selectedPackId}</p>
                                                    <button onClick={() => setSelectedPackId(null)} className="text-yc-aleo text-xs hover:underline">Change</button>
                                                </div>
                                            </>
                                        ) : selectedNFT && (
                                            <>
                                                <img src={selectedNFT.image} alt={selectedNFT.name} className="w-20 h-20 rounded-lg object-contain" />
                                                <div>
                                                    <h4 className="text-gray-900 dark:text-white font-bold">{selectedNFT.name}</h4>
                                                    <p className="text-gray-500 dark:text-gray-400 text-sm">#{selectedNFT.tokenId}</p>
                                                    <button onClick={() => setSelectedNFT(null)} className="text-yc-aleo text-xs hover:underline">Change</button>
                                                </div>
                                            </>
                                        )}
                                    </div>

                                    {/* Sale Mode Tabs */}
                                    <div className="flex bg-gray-100 dark:bg-white/[0.03] rounded-2xl p-1 mb-4 border border-transparent dark:border-white/[0.06]">
                                        <button onClick={() => setSellMode('fixed')} className={`flex-1 py-2 rounded-xl text-sm font-semibold transition-all ${sellMode === 'fixed' ? 'bg-yc-aleo/10 dark:bg-yc-aleo/[0.12] text-yc-aleo' : 'text-gray-500 dark:text-gray-500'}`}>
                                            <Tag className="w-4 h-4 inline mr-1" />Fixed Price
                                        </button>
                                        <button onClick={() => setSellMode('auction')} className={`flex-1 py-2 rounded-xl text-sm font-semibold transition-all ${sellMode === 'auction' ? 'bg-yc-aleo/10 dark:bg-yc-aleo/[0.12] text-yc-aleo' : 'text-gray-500 dark:text-gray-500'}`}>
                                            <Gavel className="w-4 h-4 inline mr-1" />Auction
                                        </button>
                                    </div>

                                    {sellMode === 'fixed' ? (
                                        <div>
                                            <label className="text-gray-500 dark:text-gray-400 text-sm mb-2 block">Price ({currencySymbol()})</label>
                                            <input type="number" step="0.01" value={sellPrice} onChange={e => setSellPrice(e.target.value)} placeholder="0.00" className="w-full bg-gray-50 dark:bg-white/[0.02] border border-gray-200 dark:border-white/[0.06] rounded-lg px-4 py-3 text-gray-900 dark:text-white font-bold focus:border-yc-aleo focus:outline-none" />
                                        </div>
                                    ) : (
                                        <div className="space-y-3">
                                            <div>
                                                <label className="text-gray-500 dark:text-gray-400 text-sm mb-1 block">Start Price ({currencySymbol()})</label>
                                                <input type="number" step="0.01" value={auctionStartPrice} onChange={e => setAuctionStartPrice(e.target.value)} placeholder="0.00" className="w-full bg-gray-50 dark:bg-white/[0.02] border border-gray-200 dark:border-white/[0.06] rounded-lg px-4 py-3 text-gray-900 dark:text-white font-bold focus:border-yc-aleo focus:outline-none" />
                                            </div>
                                            <div>
                                                <label className="text-gray-500 dark:text-gray-400 text-sm mb-1 block">Reserve Price ({currencySymbol()}, optional)</label>
                                                <input type="number" step="0.01" value={auctionReservePrice} onChange={e => setAuctionReservePrice(e.target.value)} placeholder="0.00" className="w-full bg-gray-50 dark:bg-white/[0.02] border border-gray-200 dark:border-white/[0.06] rounded-lg px-4 py-3 text-gray-900 dark:text-white font-bold focus:border-yc-aleo focus:outline-none" />
                                            </div>
                                            <div>
                                                <label className="text-gray-500 dark:text-gray-400 text-sm mb-1 block">Duration (days)</label>
                                                <select value={auctionDuration} onChange={e => setAuctionDuration(e.target.value)} className="w-full bg-gray-50 dark:bg-white/[0.02] border border-gray-200 dark:border-white/[0.06] rounded-lg px-4 py-3 text-gray-900 dark:text-white font-bold focus:border-yc-aleo focus:outline-none">
                                                    <option value="1">1 day</option>
                                                    <option value="3">3 days</option>
                                                    <option value="7">7 days</option>
                                                    <option value="14">14 days</option>
                                                </select>
                                            </div>
                                        </div>
                                    )}

                                    <button
                                        onClick={handleListNFT}
                                        disabled={isSelling || (sellMode === 'fixed' ? !sellPrice : !auctionStartPrice)}
                                        className="w-full mt-4 bg-yc-aleo text-white font-bold py-3 rounded-2xl hover:bg-yc-aleo/80 disabled:bg-gray-300 dark:disabled:bg-gray-800 disabled:text-gray-500 transition-all"
                                    >
                                        {isSelling ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : sellMode === 'fixed' ? 'List for Sale' : 'Create Auction'}
                                    </button>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Onboarding Guide */}
            {showGuide && (
                <OnboardingGuide
                    steps={MARKETPLACE_GUIDE}
                    currentStep={guideStep}
                    onNext={() => guideNext(MARKETPLACE_GUIDE.length)}
                    onDismiss={guideDismiss}
                />
            )}
        </div>
    );
};

export default Marketplace;