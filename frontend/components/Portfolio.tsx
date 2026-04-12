import React, { useState, useEffect, useRef, useLayoutEffect } from 'react';
import { CardData, Rarity, sortByRarity } from '../types';
import CardDetailModal, { CardDetailData } from './CardDetailModal';
import Analytics from './Analytics';
import { Wallet, ArrowUpRight, TrendingUp, Plus, ShoppingCart, Layers, X, Check, RefreshCw, Tag, Loader2, Gavel, Clock, Activity, DollarSign, History, Package, PackageOpen, ArrowUp } from 'lucide-react';
import { useWalletContext } from '../context/WalletContext';
import { useNFT } from '../hooks/useNFT';
import { usePacks } from '../hooks/usePacks';
import { useUpgrade, UpgradeConfig } from '../hooks/useUpgrade';
import { useMarketplaceV2 } from '../hooks/useMarketplaceV2';
import { usePollingData } from '../hooks/usePollingData';
import { formatXTZ } from '../lib/contracts';
import { currencySymbol, getActiveNetworkId } from '../lib/networks';
import gsap from 'gsap';
import { useOnboarding } from '../hooks/useOnboarding';
import OnboardingGuide, { OnboardingStep } from './OnboardingGuide';
import { blockchainCache, CacheKeys } from '../lib/cache';
import { getMarketSyncing, subscribeMarketSyncing, marketKey } from '../lib/marketSync';

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

const PORTFOLIO_GUIDE: OnboardingStep[] = [
    {
        title: 'Your Collection',
        description: 'Buy your first pack and unlock your squad to compete in Leagues. Each pack contains 5 random startup NFT cards.',
        icon: '\uD83C\uDCCF',
    },
    {
        title: 'Upgrade Cards',
        description: 'All cards start at Level 1. Tap the UP button to upgrade (Lvl 1-5). Higher level = bigger score multiplier. But beware: if the upgrade fails, your card is burned forever!',
        icon: '\u26A1',
    },
    {
        title: 'Merge Cards',
        description: 'Combine 3 cards of the same rarity to forge a higher rarity card. Use the Merge button to select cards.',
        icon: '\u2728',
    },
    {
        title: 'Sell & Trade',
        description: 'List unwanted cards on the Marketplace or create auctions. Use the profits to buy the cards you really need.',
        icon: '\uD83D\uDCB0',
    },
];

interface PortfolioProps {
    onBuyPack: (packId?: number) => void;
    /** Open modal with multiple packs pre-selected for batch opening */
    onOpenPacks?: (packIds: number[]) => void;
    /** Increment to force an immediate pack refresh (e.g. after buying packs) */
    packRefreshSignal?: number;
}

const Portfolio: React.FC<PortfolioProps> = ({ onBuyPack, onOpenPacks, packRefreshSignal }) => {
    const packPriceLabel = '0.1';
    const networkId = getActiveNetworkId();
    // Re-render on marketplace syncing state changes so overlays appear/disappear
    const [, _forceMarketTick] = useState(0);
    useEffect(() => subscribeMarketSyncing(() => _forceMarketTick(v => v + 1)), []);
    const [activeTab, setActiveTab] = useState<'cards' | 'performance'>('cards');
    const [myCards, setMyCards] = useState<CardData[]>([]);
    const [isMergeMode, setIsMergeMode] = useState(false);
    const [selectedCardIds, setSelectedCardIds] = useState<number[]>([]);
    const [isUpgradeMode, setIsUpgradeMode] = useState(false);
    const [selectedUpgradeCardId, setSelectedUpgradeCardId] = useState<number | null>(null);
    const [mergeStatus, setMergeStatus] = useState<'idle' | 'confirming' | 'processing' | 'success'>('idle');
    const [newlyForgedCard, setNewlyForgedCard] = useState<CardData | null>(null);
    const [viewingCard, setViewingCard] = useState<CardDetailData | null>(null);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [mergeError, setMergeError] = useState<string | null>(null);
    const [pendingNewTokenId, setPendingNewTokenId] = useState<number | null>(null);

    // Sell modal state
    const [sellModalOpen, setSellModalOpen] = useState(false);
    const [cardToSell, setCardToSell] = useState<CardData | null>(null);
    const [sellMode, setSellMode] = useState<'fixed' | 'auction'>('fixed');
    const [sellPrice, setSellPrice] = useState('');
    const [auctionStartPrice, setAuctionStartPrice] = useState('');
    const [auctionReservePrice, setAuctionReservePrice] = useState('');
    const [auctionDuration, setAuctionDuration] = useState('24'); // hours
    const [isSelling, setIsSelling] = useState(false);

    // NFT Stats Modal state
    const [statsModalOpen, setStatsModalOpen] = useState(false);
    const [statsCard, setStatsCard] = useState<CardData | null>(null);
    const [statsTab, setStatsTab] = useState<'bids' | 'sales' | 'stats'>('bids');
    const [cardBids, setCardBids] = useState<any[]>([]);
    const [cardSales, setCardSales] = useState<any[]>([]);
    const [cardStats, setCardStats] = useState<any | null>(null);
    const [loadingStats, setLoadingStats] = useState(false);

    // Refs for animation
    const fusionContainerRef = useRef<HTMLDivElement>(null);
    const fusionCardsRef = useRef<HTMLDivElement[]>([]);
    const coreRef = useRef<HTMLDivElement>(null);
    const flashRef = useRef<HTMLDivElement>(null);
    const animationRanRef = useRef(false); // Prevent animation from running twice
    const pendingCardFetchRef = useRef<Promise<CardData | null> | null>(null); // Pre-fetched card during animation

    // Pack open selection mode
    const [isPackSelectMode, setIsPackSelectMode] = useState(false);
    const [selectedPackOpenIds, setSelectedPackOpenIds] = useState<number[]>([]);

    // Pack sell modal state
    const [myPacks, setMyPacks] = useState<number[]>([]);
    const [packSellModalOpen, setPackSellModalOpen] = useState(false);
    const [packToSell, setPackToSell] = useState<number | null>(null);
    const [packSellMode, setPackSellMode] = useState<'fixed' | 'auction'>('fixed');
    const [packSellPrice, setPackSellPrice] = useState('');
    const [packAuctionStartPrice, setPackAuctionStartPrice] = useState('');
    const [packAuctionReservePrice, setPackAuctionReservePrice] = useState('');
    const [packAuctionDuration, setPackAuctionDuration] = useState('24');
    const [isSellingPack, setIsSellingPack] = useState(false);

    // Upgrade state
    const [upgradeModalCard, setUpgradeModalCard] = useState<CardData | null>(null);
    const [upgradeConfig, setUpgradeConfig] = useState<UpgradeConfig | null>(null);
    const [upgradeStatus, setUpgradeStatus] = useState<'idle' | 'confirming' | 'processing' | 'success' | 'failed'>('idle');
    const [upgradeResultLevel, setUpgradeResultLevel] = useState<number | null>(null);

    // Refs for upgrade animation
    const upgradeContainerRef = useRef<HTMLDivElement>(null);
    const upgradeCardRef = useRef<HTMLImageElement>(null);
    const upgradeBgRef = useRef<HTMLDivElement>(null);
    const upgradeRanRef = useRef(false);
    const upgradeResultRef = useRef<{success: boolean, newLevel?: number, error?: string} | null>(null);

    // Hooks
    const { isConnected, address, getSigner, connect } = useWalletContext();
    const { getCards, getCardInfo, getCardInfoWithRetry, mergeCards, isLoading, clearCache, updateServerCache } = useNFT();
    const { getUserPacks } = usePacks();
    const { upgradeCard, getUpgradeConfig, isLoading: upgradeLoading, statusMessage: upgradeStatusMsg } = useUpgrade();
    const { listCard, listPack, createAuction, createPackAuction, getBidsForToken, getTokenStats, getTokenSaleHistory, loading: marketplaceLoading } = useMarketplaceV2();
    const { isVisible: showGuide, currentStep: guideStep, nextStep: guideNext, dismiss: guideDismiss } = useOnboarding('portfolio');

    // Auto-refresh cards with polling (disabled when not connected)
    const {
        data: polledCards,
        isLoading: pollingLoading,
        refresh: refreshCards
    } = usePollingData<CardData[]>(
        async () => {
            if (!address) return [];
            return await getCards(address);
        },
        {
            cacheKey: `portfolio:cards:${networkId}:${address || 'none'}`,
            interval: 30000,
            enabled: isConnected && !!address
        }
    );

    // Auto-refresh packs
    const {
        data: polledPacks,
        refresh: refreshPacks
    } = usePollingData<number[]>(
        async () => {
            if (!address) return [];
            return await getUserPacks(address);
        },
        {
            cacheKey: `portfolio:packs:${networkId}:${address || 'none'}`,
            interval: 30000,
            enabled: isConnected && !!address
        }
    );

    // Update myPacks when polled data changes
    useEffect(() => {
        if (polledPacks) setMyPacks(polledPacks);
    }, [polledPacks]);

    // Update myCards when polled data changes (sorted by rarity, rarest first)
    useEffect(() => {
        if (polledCards) {
            setMyCards(sortByRarity(polledCards));
        }
    }, [polledCards]);

    // Clear refreshing spinner when polling finishes (success or error)
    useEffect(() => {
        if (!pollingLoading) {
            setIsRefreshing(false);
        }
    }, [pollingLoading]);

    // Reload cards and packs when address or network changes
    useEffect(() => {
        if (isConnected && address) {
            setIsRefreshing(true);
            refreshCards();
            refreshPacks();
        } else {
            setMyCards([]);
            setMyPacks([]);
        }
    }, [isConnected, address, networkId]);

    // Immediately refresh packs when signal changes (e.g. after buying packs in modal)
    useEffect(() => {
        if (!packRefreshSignal || !address) return;
        blockchainCache.invalidate(CacheKeys.userUnopenedPacks(address));
        refreshPacks();
    }, [packRefreshSignal]);

    const loadCards = async (forceBlockchain = false) => {
        if (!address) return;
        setIsRefreshing(true);
        if (forceBlockchain) {
            clearCache();
            blockchainCache.invalidate(CacheKeys.userUnopenedPacks(address));
            const [fresh] = await Promise.all([
                getCards(address, true),
                refreshPacks(),
            ]);
            setMyCards(sortByRarity(fresh));
            setIsRefreshing(false);
        } else {
            await Promise.all([refreshCards(), refreshPacks()]);
        }
    };

    const uniqueStartups = new Set(myCards.map(card => card.startupId)).size;

    // Toggle Selection
    const toggleCardSelection = (tokenId: number) => {
        if (!isMergeMode) return;

        const card = myCards.find(c => c.tokenId === tokenId);
        if (!card || card.isLocked) return; // Can't select locked cards
        if (card.rarity === Rarity.LEGENDARY) return; // Legendary cards can't be merged

        if (selectedCardIds.includes(tokenId)) {
            setSelectedCardIds(prev => prev.filter(id => id !== tokenId));
        } else {
            if (selectedCardIds.length < 3) {
                // Check rarity matches
                if (selectedCardIds.length > 0) {
                    const firstCard = myCards.find(c => c.tokenId === selectedCardIds[0]);
                    if (firstCard && firstCard.rarity !== card.rarity) {
                        return; // Must be same rarity
                    }
                }
                setSelectedCardIds(prev => [...prev, tokenId]);
            }
        }
    };

    // Store full card data for detail modal
    const [viewingCardData, setViewingCardData] = useState<CardData | null>(null);

    // Handle Card Click
    const handleCardClick = (card: CardData) => {
        if (isMergeMode) {
            toggleCardSelection(card.tokenId);
        } else if (isUpgradeMode) {
            if (card.isLocked || (card.level || card.multiplier || 1) >= 5) return;
            if (selectedUpgradeCardId === card.tokenId) {
                setSelectedUpgradeCardId(null);
            } else {
                setSelectedUpgradeCardId(card.tokenId);
            }
        } else {
            setViewingCardData(card); // Store full card data
            setViewingCard({
                id: card.tokenId.toString(),
                name: card.name,
                image: card.image,
                value: card.multiplier.toString(),
                rarity: card.rarity,
                multiplier: `${card.multiplier}x`,
                batch: 'W24',
                stage: card.isLocked ? 'Locked' : 'Available'
            });
        }
    };

    // Open upgrade modal for a card
    const openUpgradeModal = async (card: CardData) => {
        setUpgradeModalCard(card);
        setUpgradeStatus('idle');
        setUpgradeResultLevel(null);
        upgradeResultRef.current = null;
        upgradeRanRef.current = false;
        // Fetch config
        const config = await getUpgradeConfig();
        setUpgradeConfig(config);
    };

    // Execute upgrade
    const handleUpgrade = async () => {
        if (!upgradeModalCard || !upgradeConfig) return;
        const signer = await getSigner();
        if (!signer) return;

        setUpgradeStatus('confirming');
        upgradeRanRef.current = false;
        const result = await upgradeCard(signer, upgradeModalCard);

        upgradeResultRef.current = result;
        setUpgradeStatus('processing');
    };

    const finalizeUpgrade = () => {
        const result = upgradeResultRef.current;
        if (result && result.success && result.newLevel) {
            setUpgradeStatus('success');
            setUpgradeResultLevel(result.newLevel);
            loadCards(true); // refresh from blockchain to get new level
        } else if (result && result.burned) {
            // TX went through but upgrade failed — card is burned on-chain
            setUpgradeStatus('failed');
            loadCards(true); // refresh from blockchain — card will be gone
        } else {
            // TX error (rejected, reverted, gas issue) — card is still alive
            setUpgradeStatus('idle');
            // Don't reload — nothing changed on-chain
        }
    };

    // GSAP Animation Effect for Upgrade
    useLayoutEffect(() => {
        if (upgradeStatus === 'processing' && upgradeContainerRef.current && !upgradeRanRef.current) {
            upgradeRanRef.current = true;

            const ctx = gsap.context(() => {
                const tl = gsap.timeline();

                // Blinking background gradient
                gsap.to(upgradeBgRef.current, {
                    opacity: 1,
                    duration: 0.15,
                    yoyo: true,
                    repeat: 15,
                    ease: "power2.inOut"
                });

                // Spin the card and scale
                tl.to(upgradeCardRef.current, {
                    rotationY: 1080, // 3 full spins
                    scale: 1.25,
                    duration: 2.5,
                    ease: "power1.inOut"
                }).to(upgradeCardRef.current, {
                    scale: 1,
                    duration: 0.3,
                    ease: "back.out(1.7)"
                });
            }, upgradeContainerRef);

            const animationDuration = 2800; // time it takes to finish animation
            const timer = setTimeout(() => {
                finalizeUpgrade();
            }, animationDuration);

            return () => {
                clearTimeout(timer);
                ctx.revert(); // clean up gsap timeline
            };
        }
    }, [upgradeStatus]);

    // Execute Merge - transaction first, animation after success
    const handleForge = async () => {
        if (selectedCardIds.length !== 3) return;

        setMergeStatus('confirming'); // Waiting for wallet signature
        setMergeError(null);
        animationRanRef.current = false; // Reset animation flag

        const signer = await getSigner();
        if (!signer) {
            setMergeStatus('idle');
            setMergeError('Could not get wallet signer');
            return;
        }

        // Execute transaction and WAIT for it to complete
        const result = await mergeCards(signer, selectedCardIds as [number, number, number]);

        if (result.success && result.newTokenId) {
            // Start fetching card metadata IMMEDIATELY (parallel with animation)
            pendingCardFetchRef.current = getCardInfoWithRetry(result.newTokenId, 3, 2000);
            setPendingNewTokenId(result.newTokenId);
            setMergeStatus('processing'); // This triggers the animation
        } else {
            // Decode common errors
            let errorMsg = result.error || 'Merge failed';
            if (errorMsg.includes('reinitializeStartups')) {
                // Pass through the detailed message from pre-merge verification
                errorMsg = result.error!;
            } else if (errorMsg.includes('On-chain rarity mismatch')) {
                // Pass through the detailed message from pre-merge verification
                errorMsg = result.error!;
            } else if (errorMsg.includes('0x7c0aec15')) {
                errorMsg = 'Cards have different rarities on-chain. Try refreshing your cards — cached data may be stale.';
            } else if (errorMsg.includes('NotCardOwner')) {
                errorMsg = 'You do not own all selected cards';
            } else if (errorMsg.includes('CannotMergeLegendary')) {
                errorMsg = 'Cannot merge Legendary cards';
            } else if (errorMsg.includes('CardIsLocked')) {
                errorMsg = 'One or more cards are locked in tournament';
            }
            setMergeError(errorMsg);
            setMergeStatus('idle');
            setSelectedCardIds([]);
        }
    };

    // GSAP Animation Effect - only runs ONCE when processing (after transaction success)
    useLayoutEffect(() => {
        if (mergeStatus === 'processing' && fusionContainerRef.current && pendingNewTokenId && !animationRanRef.current) {
            animationRanRef.current = true; // Mark animation as started

            const ctx = gsap.context(() => {
                const tl = gsap.timeline();

                gsap.set(fusionCardsRef.current, { scale: 0, opacity: 0 });
                gsap.set(coreRef.current, { scale: 0, opacity: 0 });
                gsap.set(flashRef.current, { opacity: 0 });

                tl.to(fusionCardsRef.current, {
                    scale: 1,
                    opacity: 1,
                    duration: 0.5,
                    stagger: 0.1,
                    ease: "back.out(1.7)"
                })
                    .to(coreRef.current, {
                        scale: 1,
                        opacity: 1,
                        duration: 0.5,
                        ease: "power2.out"
                    }, "-=0.3")
                    .to(fusionCardsRef.current, {
                        rotation: 360,
                        duration: 2,
                        ease: "power1.in",
                        scale: 0.5,
                        opacity: 0.8
                    }, "orbit")
                    .to(fusionCardsRef.current, {
                        x: 0,
                        y: 0,
                        duration: 1.5,
                        ease: "expo.in",
                        delay: 0.5
                    }, "orbit")
                    .to(coreRef.current, {
                        scale: 3,
                        duration: 1.5,
                        ease: "expo.in",
                        boxShadow: "0 0 100px 50px rgba(249, 115, 22, 0.8)"
                    }, "orbit+=0.5")
                    .to(flashRef.current, {
                        opacity: 1,
                        duration: 0.1,
                        ease: "power4.in"
                    })
                    .set([fusionCardsRef.current, coreRef.current], { opacity: 0 })
                    .to(flashRef.current, {
                        opacity: 0,
                        duration: 0.8,
                        ease: "power2.out"
                    });

            }, fusionContainerRef);

            // After animation completes, finalize the merge
            const animationDuration = 3500; // ~3.5s for full animation
            const timer = setTimeout(() => {
                finalizeMerge(pendingNewTokenId);
                setPendingNewTokenId(null);
            }, animationDuration);

            return () => {
                clearTimeout(timer);
            };
        }
    }, [mergeStatus, pendingNewTokenId]);

    const finalizeMerge = async (newTokenId: number) => {
        // Use the pre-started fetch (kicked off before animation) or fetch now as fallback
        const newCard = pendingCardFetchRef.current
            ? await pendingCardFetchRef.current
            : await getCardInfoWithRetry(newTokenId, 3, 2000);
        pendingCardFetchRef.current = null;

        if (newCard) {
            // Preload the image fully before showing success screen
            await new Promise<void>((resolve) => {
                const img = new Image();
                img.onload = () => resolve();
                img.onerror = () => resolve();
                img.src = newCard.image;
            });
            setNewlyForgedCard(newCard);
        }

        setMergeStatus('success');

        // Surgical local update: remove 3 burned cards, add 1 new card (instant, no refetch)
        const burnedIds = new Set(selectedCardIds);
        setSelectedCardIds([]);
        setMyCards(prev => {
            const remaining = prev.filter(c => !burnedIds.has(c.tokenId));
            if (newCard) remaining.push(newCard);
            return sortByRarity(remaining);
        });

        // Push incremental changes to server cache in background
        if (address) {
            updateServerCache(address, newCard ? [newCard] : undefined, [...burnedIds]);
        }
    };

    const closeSuccessModal = () => {
        setMergeStatus('idle');
        setNewlyForgedCard(null);
        setIsMergeMode(false);
    };

    const selectedCardsData = myCards.filter(c => selectedCardIds.includes(c.tokenId));

    // Get available cards for merge (same rarity as first selected, not locked)
    const getAvailableForMerge = (card: CardData): boolean => {
        if (card.isLocked) return false;
        if (card.rarity === Rarity.LEGENDARY) return false; // Legendary can't be merged
        if (selectedCardIds.length === 0) return true;
        const firstCard = myCards.find(c => c.tokenId === selectedCardIds[0]);
        return firstCard ? firstCard.rarity === card.rarity : true;
    };

    // Open sell modal for a card
    const openSellModal = (card: CardData) => {
        if (card.isLocked) {
            alert('This card is locked and cannot be sold.');
            return;
        }
        setCardToSell(card);
        setSellPrice('');
        setAuctionStartPrice('');
        setAuctionReservePrice('');
        setAuctionDuration('24');
        setSellMode('fixed');
        setSellModalOpen(true);
    };

    // Handle listing a card for sale (fixed price)
    const handleSellCard = async () => {
        if (!cardToSell || !sellPrice || parseFloat(sellPrice) <= 0) {
            alert('Please enter a valid price');
            return;
        }

        setIsSelling(true);
        try {
            const signer = await getSigner();
            if (!signer) {
                alert('Please connect your wallet');
                setIsSelling(false);
                return;
            }

            await listCard(BigInt(cardToSell.tokenId), sellPrice);

            alert(`Card listed for ${sellPrice} ${currencySymbol()}!`);
            setSellModalOpen(false);
            setCardToSell(null);
            setSellPrice('');
            await loadCards(true);
        } catch (e: any) {
            alert(`Failed to list: ${e.message}`);
        }
        setIsSelling(false);
    };

    // Handle creating an auction
    const handleCreateAuction = async () => {
        if (!cardToSell) return;
        if (!auctionStartPrice || parseFloat(auctionStartPrice) <= 0) {
            alert('Please enter a valid start price');
            return;
        }

        const reservePrice = auctionReservePrice || auctionStartPrice;
        const durationHours = parseFloat(auctionDuration);
        const durationDays = durationHours / 24; // Convert hours to days

        setIsSelling(true);
        try {
            const signer = await getSigner();
            if (!signer) {
                alert('Please connect your wallet');
                setIsSelling(false);
                return;
            }

            await createAuction(
                BigInt(cardToSell.tokenId),
                auctionStartPrice,
                reservePrice,
                durationDays
            );

            alert(`Auction created! Starting at ${auctionStartPrice} ${currencySymbol()} for ${auctionDuration} hours.`);
            setSellModalOpen(false);
            setCardToSell(null);
            await loadCards(true);
        } catch (e: any) {
            alert(`Failed to create auction: ${e.message}`);
        }
        setIsSelling(false);
    };

    // Open pack sell modal
    const openPackSellModal = (packTokenId: number) => {
        setPackToSell(packTokenId);
        setPackSellPrice('');
        setPackAuctionStartPrice('');
        setPackAuctionReservePrice('');
        setPackAuctionDuration('24');
        setPackSellMode('fixed');
        setPackSellModalOpen(true);
    };

    // Handle listing a pack for sale (fixed price)
    const handleSellPack = async () => {
        if (packToSell === null || !packSellPrice || parseFloat(packSellPrice) <= 0) {
            alert('Please enter a valid price');
            return;
        }

        setIsSellingPack(true);
        try {
            await listPack(BigInt(packToSell), packSellPrice);

            alert(`Pack listed for ${packSellPrice} ${currencySymbol()}!`);
            setPackSellModalOpen(false);
            setPackToSell(null);
            refreshPacks();
        } catch (e: any) {
            alert(`Failed to list pack: ${e.message}`);
        }
        setIsSellingPack(false);
    };

    // Handle creating a pack auction
    const handleCreatePackAuction = async () => {
        if (packToSell === null) return;
        if (!packAuctionStartPrice || parseFloat(packAuctionStartPrice) <= 0) {
            alert('Please enter a valid start price');
            return;
        }

        const reservePrice = packAuctionReservePrice || packAuctionStartPrice;
        const durationHours = parseFloat(packAuctionDuration);
        const durationDays = durationHours / 24;

        setIsSellingPack(true);
        try {
            await createPackAuction(
                BigInt(packToSell),
                packAuctionStartPrice,
                reservePrice,
                durationDays
            );

            alert(`Pack auction created! Starting at ${packAuctionStartPrice} ${currencySymbol()} for ${packAuctionDuration} hours.`);
            setPackSellModalOpen(false);
            setPackToSell(null);
            refreshPacks();
        } catch (e: any) {
            alert(`Failed to create pack auction: ${e.message}`);
        }
        setIsSellingPack(false);
    };

    // Open NFT Stats modal
    const openStatsModal = async (card: CardData) => {
        setStatsCard(card);
        setStatsModalOpen(true);
        setLoadingStats(true);
        setStatsTab('bids');
        setCardBids([]);
        setCardSales([]);
        setCardStats(null);

        try {
            const [bids, sales, stats] = await Promise.all([
                getBidsForToken(BigInt(card.tokenId)),
                getTokenSaleHistory(BigInt(card.tokenId)),
                getTokenStats(BigInt(card.tokenId))
            ]);
            setCardBids(bids || []);
            setCardSales(sales || []);
            setCardStats(stats);
        } catch (e) {
        }
        setLoadingStats(false);
    };

    return (
        <div className="relative min-h-[80vh] overflow-x-hidden">

            {/* Header Stats */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6 mb-8">
                <div className="col-span-1 md:col-span-2 p-4 md:p-6 bg-gradient-to-br from-orange-50 via-white to-orange-50 dark:from-yc-aleo/[0.08] dark:via-white/[0.03] dark:to-orange-500/[0.04] border border-orange-200/60 dark:border-yc-aleo/[0.15] rounded-2xl text-yc-text-primary dark:text-white relative overflow-hidden backdrop-blur-xl shadow-sm">
                    {/* Decorative blob */}
                    <div className="absolute -top-16 -right-16 w-48 h-48 bg-yc-aleo/10 dark:bg-yc-aleo/[0.08] rounded-full blur-3xl pointer-events-none" />
                    <div className="absolute -bottom-10 -left-10 w-32 h-32 bg-orange-400/10 dark:bg-orange-500/[0.06] rounded-full blur-2xl pointer-events-none" />
                    <div className="relative z-10">
                        <p className="text-gray-500 text-xs font-medium uppercase tracking-[0.2em] mb-1">Total Cards</p>
                        <h2 className="text-4xl font-black font-mono">{myCards.length}</h2>
                        <div className="flex items-center gap-3 mt-2">
                            <div className="flex items-center text-sm font-medium text-yc-aleo dark:text-gray-400 bg-orange-100 dark:bg-white/[0.05] w-fit px-2 py-1 rounded-lg">
                                <TrendingUp className="w-4 h-4 mr-1" />
                                {uniqueStartups} / 19 Startups
                            </div>
                            {myPacks.length > 0 && (
                                <div className="flex items-center text-sm font-medium text-yc-aleo dark:text-gray-400 bg-orange-100 dark:bg-white/[0.05] w-fit px-2 py-1 rounded-lg">
                                    <Package className="w-4 h-4 mr-1" />
                                    {myPacks.length} Pack{myPacks.length !== 1 ? 's' : ''}
                                </div>
                            )}
                        </div>
                    </div>
                    <Wallet className="absolute right-[-20px] bottom-[-40px] w-64 h-64 text-orange-200/40 dark:text-white/[0.03] rotate-[-15deg]" />
                </div>

                {/* Buy Pack Card */}
                <div
                    onClick={() => onBuyPack()}
                    className="bg-gradient-to-br from-yc-aleo via-lime-700 to-orange-800 dark:from-yc-aleo dark:via-lime-800 dark:to-orange-900 border border-orange-400/30 dark:border-yc-aleo/30 rounded-2xl p-6 flex flex-col justify-between cursor-pointer group hover:shadow-[0_8px_30px_rgba(249, 115, 22,0.25)] transition-all relative overflow-hidden"
                >
                    {/* Decorative elements */}
                    <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full blur-2xl pointer-events-none" />
                    <div className="absolute bottom-0 left-0 w-24 h-24 bg-orange-400/20 rounded-full blur-xl pointer-events-none" />
                    <div className="relative z-10">
                        <div className="flex justify-between items-start">
                            <div className="p-2 bg-white/15 rounded-xl text-white">
                                <ShoppingCart className="w-6 h-6" />
                            </div>
                            <span className="bg-white/20 backdrop-blur-sm text-white text-xs font-bold px-2.5 py-1 rounded-lg border border-white/10">{packPriceLabel} {currencySymbol()}</span>
                        </div>
                        <h3 className="text-xl font-bold text-white mt-4">Buy Starter Pack</h3>
                        <p className="text-sm text-white/60 mt-1">Contains 5 random startup cards.</p>
                    </div>
                    <div className="flex items-center text-sm font-bold text-white mt-4 relative z-10">
                        Mint Now <ArrowUpRight className="w-4 h-4 ml-1 group-hover:translate-x-1 group-hover:-translate-y-1 transition-transform" />
                    </div>
                </div>
            </div>

            {/* Tab Switcher */}
            <div className="mb-6">
                <div className="inline-flex bg-white/60 dark:bg-zinc-900/60 backdrop-blur-2xl rounded-2xl p-1 border border-white/40 dark:border-white/[0.08] shadow-[0_4px_16px_rgba(0,0,0,0.06),inset_0_1px_0_rgba(255,255,255,0.4)] dark:shadow-[0_4px_16px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.05)]">
                    <button
                        onClick={() => { setActiveTab('cards'); setIsMergeMode(false); setSelectedCardIds([]); }}
                        className={`px-5 py-2 rounded-xl text-sm font-semibold transition-all ${activeTab === 'cards'
                                ? 'bg-yc-aleo/10 dark:bg-yc-aleo/[0.12] text-yc-aleo'
                                : 'text-gray-500 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
                            }`}
                    >
                        My Cards
                    </button>
                    <button
                        onClick={() => { setActiveTab('performance'); setIsMergeMode(false); setSelectedCardIds([]); }}
                        className={`px-5 py-2 rounded-xl text-sm font-semibold transition-all flex items-center gap-1.5 ${activeTab === 'performance'
                                ? 'bg-yc-aleo/10 dark:bg-yc-aleo/[0.12] text-yc-aleo'
                                : 'text-gray-500 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
                            }`}
                    >
                        <TrendingUp className="w-4 h-4" />
                        Performance
                    </button>
                </div>
            </div>

            {/* Performance Tab: Analytics */}
            {activeTab === 'performance' && <Analytics />}

            {/* Cards Tab Content */}
            {activeTab === 'cards' && (<>
                {/* My Packs Section */}
                {!isMergeMode && myPacks.length > 0 && (
                    <div className="mb-8">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-lg font-bold text-yc-text-primary dark:text-white flex items-center">
                                <Package className="w-5 h-5 mr-2 text-gray-400" />
                                Unopened Packs ({myPacks.length})
                            </h3>
                            {myPacks.length > 1 && (
                                <button
                                    onClick={() => {
                                        setIsPackSelectMode(!isPackSelectMode);
                                        setSelectedPackOpenIds([]);
                                    }}
                                    className={`
                                        flex items-center px-4 py-2 rounded-xl text-sm font-bold transition-all border
                                        ${isPackSelectMode
                                            ? 'bg-white/70 dark:bg-zinc-900/70 backdrop-blur-2xl text-black dark:text-white border-white/40 dark:border-white/[0.15] shadow-[0_4px_16px_rgba(0,0,0,0.06),inset_0_1px_0_rgba(255,255,255,0.4)] dark:shadow-[0_4px_16px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.05)]'
                                            : 'bg-white/60 dark:bg-zinc-900/60 backdrop-blur-2xl text-gray-500 hover:text-yc-text-primary dark:hover:text-white border-white/40 dark:border-white/[0.08] shadow-[0_4px_16px_rgba(0,0,0,0.06),inset_0_1px_0_rgba(255,255,255,0.4)] dark:shadow-[0_4px_16px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.05)]'}
                                    `}
                                >
                                    {isPackSelectMode ? <X className="w-4 h-4 mr-2" /> : <PackageOpen className="w-4 h-4 mr-2" />}
                                    {isPackSelectMode ? 'Cancel' : 'Open Packs'}
                                </button>
                            )}
                        </div>
                        {isPackSelectMode && (
                            <div className="mb-3 p-3 bg-white/60 dark:bg-zinc-900/60 backdrop-blur-2xl border border-white/40 dark:border-white/[0.08] rounded-2xl flex items-center justify-between shadow-[0_4px_16px_rgba(0,0,0,0.06),inset_0_1px_0_rgba(255,255,255,0.4)] dark:shadow-[0_4px_16px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.05)]">
                                <p className="text-xs text-gray-500 dark:text-gray-400">
                                    {selectedPackOpenIds.length === 0
                                        ? 'Tap packs to select'
                                        : <><span className="text-yc-aleo font-bold">{selectedPackOpenIds.length}</span> selected</>}
                                </p>
                                <button
                                    onClick={() => setSelectedPackOpenIds(prev =>
                                        prev.length === myPacks.length ? [] : [...myPacks]
                                    )}
                                    className="text-xs font-bold text-gray-400 hover:text-yc-aleo transition-colors"
                                >
                                    {selectedPackOpenIds.length === myPacks.length ? 'Deselect All' : 'Select All'}
                                </button>
                            </div>
                        )}
                        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 md:gap-4">
                            {myPacks.map((packId) => {
                                const isSelected = isPackSelectMode && selectedPackOpenIds.includes(packId);
                                const packSync =
                                    getMarketSyncing(marketKey.pack(packId)) ||
                                    getMarketSyncing(marketKey.pack('pending'));
                                return (
                                    <div
                                        key={`pack-${packId}`}
                                        className={`group bg-white/60 dark:bg-zinc-900/60 backdrop-blur-2xl border rounded-xl overflow-hidden hover:-translate-y-1 hover:shadow-lg transition-all duration-300 shadow-[0_4px_16px_rgba(0,0,0,0.06),inset_0_1px_0_rgba(255,255,255,0.4)] dark:shadow-[0_4px_16px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.05)] ${
                                            isSelected
                                                ? 'border-yc-aleo shadow-yc-aleo/20 ring-2 ring-yc-aleo/30'
                                                : 'border-white/40 dark:border-white/[0.08] hover:border-yc-aleo/40 dark:hover:border-yc-aleo/30 hover:shadow-yc-aleo/10'
                                        }`}
                                    >
                                        <div
                                            className="relative bg-gradient-to-b from-yc-aleo/5 to-gray-50 dark:from-yc-aleo/[0.04] dark:to-transparent cursor-pointer"
                                            style={{ aspectRatio: '1/1' }}
                                            onClick={() => {
                                                if (isPackSelectMode) {
                                                    setSelectedPackOpenIds(prev =>
                                                        prev.includes(packId)
                                                            ? prev.filter(id => id !== packId)
                                                            : [...prev, packId]
                                                    );
                                                } else {
                                                    onBuyPack(packId);
                                                }
                                            }}
                                        >
                                            <img src="/aleo-pack.png" alt="Pack" className={`absolute inset-0 w-full h-full object-contain p-1.5 ${packSync ? 'opacity-60 grayscale' : ''}`} loading="lazy" />
                                            {/* Market syncing overlay */}
                                            {packSync && (
                                                <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/40 backdrop-blur-[2px] pointer-events-none">
                                                    <div className="bg-black/70 text-white text-[10px] sm:text-xs font-medium px-2 py-1.5 rounded-md flex items-center gap-1.5 text-center max-w-[90%]">
                                                        <div className="w-3 h-3 border-2 border-white/80 border-t-transparent rounded-full animate-spin"/>
                                                        <span>{packSync.label}</span>
                                                    </div>
                                                </div>
                                            )}
                                            {/* Selection badge */}
                                            {isPackSelectMode && isSelected && (
                                                <div className="absolute top-2 right-2 w-6 h-6 bg-yc-aleo rounded-full flex items-center justify-center z-10 shadow-lg">
                                                    <Check className="w-3.5 h-3.5 text-white" />
                                                </div>
                                            )}
                                            <div className="absolute bottom-1 left-0 right-0 flex flex-col items-center pointer-events-none group-hover:opacity-0 transition-opacity duration-200">
                                                <span className="text-gray-700 dark:text-white/50 text-[10px] font-mono bg-white/60 dark:bg-black/40 px-1.5 py-0.5 rounded">#{packId}</span>
                                            </div>
                                            {/* Glass overlay Open button (only in normal mode) */}
                                            {!isPackSelectMode && (
                                                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none">
                                                    <span className="px-6 py-3 rounded-2xl font-bold text-white text-sm backdrop-blur-xl bg-white/10 border border-white/20 shadow-lg">
                                                        Open Pack
                                                    </span>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                        {/* Floating action bar for batch open */}
                        {isPackSelectMode && selectedPackOpenIds.length > 0 && (
                            <div className="fixed bottom-20 sm:bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 sm:gap-3 px-3 sm:px-5 py-2 sm:py-3 bg-white/80 dark:bg-zinc-900/90 backdrop-blur-2xl border border-white/40 dark:border-white/[0.15] rounded-xl sm:rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.15),inset_0_1px_0_rgba(255,255,255,0.4)] dark:shadow-[0_8px_32px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.05)] animate-[fadeInUp_0.3s_ease-out]">
                                <span className="text-xs sm:text-sm font-bold text-gray-900 dark:text-white">
                                    {selectedPackOpenIds.length}/{myPacks.length}
                                </span>
                                <button
                                    onClick={() => {
                                        // Invalidate pack cache so modal gets fresh data
                                        if (address) blockchainCache.invalidate(CacheKeys.userUnopenedPacks(address));
                                        if (onOpenPacks) {
                                            onOpenPacks(selectedPackOpenIds);
                                        } else {
                                            onBuyPack(selectedPackOpenIds[0]);
                                        }
                                        setIsPackSelectMode(false);
                                        setSelectedPackOpenIds([]);
                                    }}
                                    className="bg-yc-aleo hover:bg-orange-600 text-white px-4 sm:px-6 py-1.5 sm:py-2 rounded-lg sm:rounded-xl font-black text-xs sm:text-sm uppercase tracking-wider transition-all active:scale-95 shadow-lg shadow-lime-500/20"
                                >
                                    <PackageOpen className="w-3.5 h-3.5 sm:w-4 sm:h-4 inline-block mr-1 sm:mr-1.5 -mt-0.5" />
                                    Open {selectedPackOpenIds.length}
                                </button>
                            </div>
                        )}
                    </div>
                )}

                {/* Assets Header & Controls */}
                <div className="flex items-center justify-between mb-6">
                    <h3 className="text-xl font-bold text-yc-text-primary dark:text-white flex items-center gap-2">
                        Your Assets ({myCards.length})
                        <button
                            onClick={() => loadCards(true)}
                            disabled={isRefreshing}
                            title="Refresh cards & packs"
                            className="p-1.5 rounded-lg text-gray-400 hover:text-yc-aleo hover:bg-gray-100 dark:hover:bg-white/[0.06] transition-colors"
                        >
                            <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                        </button>
                    </h3>

                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => {
                                setIsUpgradeMode(!isUpgradeMode);
                                setSelectedUpgradeCardId(null);
                                setIsMergeMode(false);
                                setSelectedCardIds([]);
                                setViewingCard(null);
                                setViewingCardData(null);
                            }}
                            className={`
                            flex items-center px-4 py-2 rounded-xl text-sm font-bold transition-all border
                            ${isUpgradeMode
                                    ? 'bg-gradient-to-r from-orange-500 to-orange-500 text-white border-transparent shadow-[0_4px_16px_rgba(249, 115, 22,0.3)]'
                                    : 'bg-white/60 dark:bg-zinc-900/60 backdrop-blur-2xl text-gray-500 hover:text-yc-text-primary dark:hover:text-white border-white/40 dark:border-white/[0.08] shadow-[0_4px_16px_rgba(0,0,0,0.06)]'
                            }
                        `}
                        >
                            {isUpgradeMode ? <X className="w-4 h-4 mr-2" /> : <ArrowUp className="w-4 h-4 mr-2" />}
                            {isUpgradeMode ? 'Cancel Upgrade' : 'Upgrade Card'}
                        </button>
                        <button
                            onClick={() => {
                                setIsMergeMode(!isMergeMode);
                                setSelectedCardIds([]);
                                setIsUpgradeMode(false);
                                setSelectedUpgradeCardId(null);
                                setViewingCard(null);
                                setViewingCardData(null);
                            }}
                            className={`
                            flex items-center px-4 py-2 rounded-xl text-sm font-bold transition-all border
                            ${isMergeMode
                                    ? 'bg-white/70 dark:bg-zinc-900/70 backdrop-blur-2xl text-black dark:text-white border-white/40 dark:border-white/[0.15] shadow-[0_4px_16px_rgba(0,0,0,0.06),inset_0_1px_0_rgba(255,255,255,0.4)] dark:shadow-[0_4px_16px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.05)]'
                                    : 'bg-white/60 dark:bg-zinc-900/60 backdrop-blur-2xl text-gray-500 hover:text-yc-text-primary dark:hover:text-white border-white/40 dark:border-white/[0.08] shadow-[0_4px_16px_rgba(0,0,0,0.06),inset_0_1px_0_rgba(255,255,255,0.4)] dark:shadow-[0_4px_16px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.05)]'}
                        `}
                        >
                            {isMergeMode ? <X className="w-4 h-4 mr-2" /> : <Layers className="w-4 h-4 mr-2" />}
                            {isMergeMode ? 'Cancel Merge' : 'Merge Cards'}
                        </button>
                    </div>
                </div>

                {/* Upgrade Modal */}
                {upgradeModalCard && (
                    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => { if(upgradeStatus !== 'processing' && upgradeStatus !== 'confirming') { setUpgradeModalCard(null); setUpgradeStatus('idle'); } }}>
                        <div ref={upgradeContainerRef} className="bg-white dark:bg-zinc-900 rounded-2xl p-6 max-w-sm w-full shadow-2xl border border-white/20 dark:border-white/10 relative overflow-hidden" onClick={e => e.stopPropagation()}>
                            
                            {/* Blinking Background Gradient for Animation */}
                            <div ref={upgradeBgRef} className="absolute inset-0 bg-gradient-to-tr from-orange-600/40 via-orange-500/40 to-orange-600/40 opacity-0 pointer-events-none mix-blend-screen transition-opacity" />

                            <div className="flex justify-between items-center mb-4 relative z-10">
                                <h3 className="text-lg font-bold text-gray-900 dark:text-white">Upgrade Card</h3>
                                <button onClick={() => { setUpgradeModalCard(null); setUpgradeStatus('idle'); }} disabled={upgradeStatus === 'confirming' || upgradeStatus === 'processing'} className="text-gray-400 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed">
                                    <X className="w-5 h-5" />
                                </button>
                            </div>

                            <div className="flex items-center gap-4 mb-4 relative z-10" style={{ perspective: '1000px' }}>
                                <img ref={upgradeCardRef} src={upgradeModalCard.image} alt={upgradeModalCard.name} className="w-20 h-20 rounded-lg object-contain" style={{ transformStyle: 'preserve-3d' }} />
                                <div>
                                    <p className="font-bold text-gray-900 dark:text-white">{upgradeModalCard.name}</p>
                                    <p className="text-sm text-gray-500">{upgradeModalCard.rarity}</p>
                                    <p className="text-sm font-mono text-yc-aleo">Level {upgradeModalCard.level || upgradeModalCard.multiplier} → {(upgradeModalCard.level || upgradeModalCard.multiplier) + 1}</p>
                                </div>
                            </div>

                            {upgradeConfig && upgradeStatus === 'idle' && (
                                <>
                                    <div className="bg-gray-100 dark:bg-zinc-800 rounded-xl p-3 mb-3 space-y-2">
                                        <div className="flex justify-between text-sm">
                                            <span className="text-gray-500">Cost</span>
                                            <span className="font-bold text-green-500">FREE</span>
                                        </div>
                                        <div className="flex justify-between text-sm">
                                            <span className="text-gray-500">Success Rate</span>
                                            <span className="font-bold text-green-500">{upgradeConfig.chances[upgradeModalCard.level || upgradeModalCard.multiplier] || 0}%</span>
                                        </div>
                                        <div className="flex justify-between text-sm">
                                            <span className="text-gray-500">On Failure</span>
                                            <span className="font-bold text-red-500">Card is BURNED</span>
                                        </div>
                                    </div>
                                    <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3 mb-4">
                                        <p className="text-red-400 text-xs text-center font-semibold">
                                            WARNING: If upgrade fails, your card will be permanently destroyed!
                                        </p>
                                    </div>
                                    <button
                                        onClick={handleUpgrade}
                                        disabled={upgradeLoading}
                                        className="w-full py-3 bg-gradient-to-r from-yc-aleo to-orange-600 text-white font-bold rounded-xl hover:opacity-90 transition-all active:scale-95 disabled:opacity-50"
                                    >
                                        {upgradeLoading ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : 'Upgrade (Risk it!)'}
                                    </button>
                                </>
                            )}

                            {upgradeStatus === 'confirming' && (
                                <div className="text-center py-4 relative z-10">
                                    <Loader2 className="w-8 h-8 animate-spin mx-auto mb-3 text-yc-aleo" />
                                    <p className="text-white font-semibold mb-1">{upgradeStatusMsg || 'Confirm in your wallet...'}</p>
                                    <p className="text-gray-500 text-xs">Processing on Aleo blockchain</p>
                                </div>
                            )}

                            {upgradeStatus === 'processing' && (
                                <div className="text-center py-4 relative z-10">
                                    <p className="text-orange-400 font-black animate-pulse text-xl tracking-widest mt-2">
                                        {upgradeStatusMsg || 'UPGRADING...'}
                                    </p>
                                </div>
                            )}

                            {upgradeStatus === 'success' && (
                                <div className="text-center py-4 relative z-10">
                                    <div className="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-3">
                                        <ArrowUp className="w-8 h-8 text-green-500" />
                                    </div>
                                    <h4 className="text-xl font-bold text-green-500 mb-1">Upgrade Success!</h4>
                                    <p className="text-gray-400 mb-4">Card is now Level {upgradeResultLevel}</p>
                                    <button
                                        onClick={() => { setUpgradeModalCard(null); setUpgradeStatus('idle'); }}
                                        className="px-6 py-2 bg-white/10 text-white rounded-xl hover:bg-white/20 transition-all font-bold"
                                    >
                                        Awesome!
                                    </button>
                                </div>
                            )}

                            {upgradeStatus === 'failed' && (
                                <div className="text-center py-4 relative z-10">
                                    <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-3 animate-[shake_0.5s_ease-in-out]">
                                        <X className="w-8 h-8 text-red-500" />
                                    </div>
                                    <h4 className="text-xl font-bold text-red-400 mb-1">Upgrade Failed!</h4>
                                    <p className="text-gray-400 mb-4">Your card has been permanently destroyed.</p>
                                    <button
                                        onClick={() => {
                                            setUpgradeModalCard(null);
                                            setUpgradeStatus('idle');
                                        }}
                                        className="px-6 py-2 bg-white/10 text-white rounded-xl hover:bg-white/20 transition-all font-bold"
                                    >
                                        Close
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* Merge/Upgrade Instructions */}
                {isMergeMode && (
                    <div className="mb-6 p-4 bg-white/60 dark:bg-zinc-900/60 backdrop-blur-2xl border border-white/40 dark:border-white/[0.08] rounded-2xl flex items-center animate-[fadeIn_0.3s] shadow-[0_8px_32px_rgba(0,0,0,0.06),inset_0_1px_0_rgba(255,255,255,0.4)] dark:shadow-[0_8px_32px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.05)]">
                        <div>
                            <p className="text-xs text-gray-500 dark:text-gray-400">Select <span className="text-gray-900 dark:text-white font-semibold">3 cards of same rarity</span> to forge 1 higher rarity.</p>
                        </div>
                    </div>
                )}
                {isUpgradeMode && (
                    <div className="mb-6 p-4 bg-white/60 dark:bg-zinc-900/60 backdrop-blur-2xl border border-white/40 dark:border-white/[0.08] rounded-2xl flex items-center animate-[fadeIn_0.3s] shadow-[0_8px_32px_rgba(0,0,0,0.06),inset_0_1px_0_rgba(255,255,255,0.4)] dark:shadow-[0_8px_32px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.05)]">
                        <div>
                            <p className="text-xs text-gray-500 dark:text-gray-400">Select <span className="text-gray-900 dark:text-white font-semibold">1 card</span> to risk an upgrade.</p>
                        </div>
                    </div>
                )}

                {/* Loading State */}
                {isLoading && myCards.length === 0 && (
                    <div className="text-center py-20">
                        <RefreshCw className="w-8 h-8 text-yc-aleo animate-spin mx-auto mb-4" />
                        <p className="text-gray-500">Loading your cards...</p>
                    </div>
                )}

                {/* Empty State */}
                {!isLoading && myCards.length === 0 && (
                    <div className="text-center py-20">
                        <ShoppingCart className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                        <h3 className="text-xl font-bold text-gray-400 mb-2">No Cards Yet</h3>
                        <p className="text-gray-500 mb-6">{isConnected ? 'Buy a pack to get started!' : 'Connect your wallet and buy a pack to get started!'}</p>
                        <button
                            onClick={isConnected ? () => onBuyPack() : connect}
                            className="bg-yc-aleo text-white hover:bg-yc-aleo/80 px-8 py-3 rounded-2xl font-bold transition-all hover:shadow-[0_0_20px_rgba(249, 115, 22,0.3)] hover:scale-[1.02]"
                        >
                            {isConnected ? 'Buy First Pack' : 'Connect Wallet'}
                        </button>
                    </div>
                )}

                {/* Grid */}
                {myCards.length > 0 && (
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-1.5 md:gap-4 pb-24">
                        {myCards.map((card) => {
                            const _shieldSyncing = !!(card as any)._syncing;
                            const _marketSync = getMarketSyncing(marketKey.card(String((card as any)._rawCardId || card.tokenId)));
                            const isSyncing = _shieldSyncing || !!_marketSync;
                            const syncLabel = _marketSync?.label || 'Syncing with Shield...';
                            const isSelectedForMerge = selectedCardIds.includes(card.tokenId);
                            const isSelectedForUpgrade = selectedUpgradeCardId === card.tokenId;
                            const isSelected = isMergeMode ? isSelectedForMerge : (isUpgradeMode ? isSelectedForUpgrade : false);

                            const isDimmedMerge = isMergeMode && !isSelectedForMerge && (selectedCardIds.length >= 3 || !getAvailableForMerge(card));
                            const isDimmedUpgrade = isUpgradeMode && !isSelectedForUpgrade && (card.isLocked || (card.level || card.multiplier || 1) >= 5 || (selectedUpgradeCardId !== null));
                            const isDimmed = isMergeMode ? isDimmedMerge : (isUpgradeMode ? isDimmedUpgrade : false);

                            return (
                                <div
                                    key={card.tokenId}
                                    onClick={() => !isSyncing && handleCardClick(card)}
                                    className={`
                                  bg-white/60 dark:bg-zinc-900/60 backdrop-blur-2xl border rounded-xl overflow-hidden transition-all duration-300 relative shadow-[0_4px_16px_rgba(0,0,0,0.06),inset_0_1px_0_rgba(255,255,255,0.4)] dark:shadow-[0_4px_16px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.05)]
                                  ${isSyncing ? 'opacity-60 grayscale cursor-not-allowed pointer-events-none' : 'cursor-pointer'}
                                  ${isSelected
                                            ? 'border-yc-aleo ring-2 ring-yc-aleo/50 shadow-[0_0_20px_rgba(249, 115, 22,0.2)] scale-[1.02] z-10'
                                            : 'border-white/40 dark:border-white/[0.08] hover:border-yc-aleo/30 dark:hover:border-white/[0.15] hover:-translate-y-1 hover:shadow-xl'}
                                  ${isDimmed && !isSyncing ? 'opacity-40 grayscale' : ''}
                                  ${card.isLocked ? 'ring-1 ring-red-500/50' : ''}
                              `}
                                >
                                    {/* Syncing Overlay */}
                                    {isSyncing && (
                                        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/40 backdrop-blur-[2px] pointer-events-none">
                                            <div className="bg-black/70 text-white text-[10px] sm:text-xs font-medium px-2 py-1.5 rounded-md flex items-center gap-1.5 text-center max-w-[90%]">
                                                <div className="w-3 h-3 border-2 border-white/80 border-t-transparent rounded-full animate-spin"/>
                                                <span>{syncLabel}</span>
                                            </div>
                                        </div>
                                    )}
                                    {/* Selection Checkbox Overlay */}
                                    {((isMergeMode && !card.isLocked && card.rarity !== Rarity.LEGENDARY) || (isUpgradeMode && !card.isLocked && (card.level || card.multiplier || 1) < 5)) && (
                                        <div className={`absolute top-3 right-3 z-20 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all ${isSelected ? 'bg-yc-aleo border-yc-aleo' : 'bg-black/50 border-white/50'}`}>
                                            {isSelected && <Check className="w-4 h-4 text-white" />}
                                        </div>
                                    )}

                                    {/* Level Badge */}
                                    <LevelBadge level={card.level || card.multiplier} />

                                    {/* Locked Badge */}
                                    {card.isLocked && (
                                        <div className="absolute top-10 right-3 z-20 bg-red-500 text-white text-[10px] font-bold px-2 py-1 rounded">
                                            LOCKED
                                        </div>
                                    )}

                                    <div className="relative" style={{ aspectRatio: '591/1004' }}>
                                        <img src={card.image} alt={card.name} className="w-full h-full object-contain" />
                                    </div>

                                    {/* Upgrade button - visible when not in mode and card is upgradeable */}
                                    {!isMergeMode && !isUpgradeMode && !card.isLocked && (card.level || card.multiplier || 1) < 5 && (
                                        <button
                                            onClick={(e) => { e.stopPropagation(); openUpgradeModal(card); }}
                                            className="absolute bottom-1.5 right-1.5 md:bottom-2 md:right-2 z-20 bg-gradient-to-r from-yc-aleo to-orange-600 text-white text-[9px] md:text-[10px] font-bold px-2 py-1 md:px-2.5 md:py-1 rounded-lg shadow-lg hover:opacity-90 transition-all active:scale-95 flex items-center gap-0.5"
                                        >
                                            <ArrowUp className="w-3 h-3" />
                                            UP
                                        </button>
                                    )}
                                </div>
                            );
                        })}

                        {/* Add New Asset Placeholder */}
                        {!isMergeMode && !isUpgradeMode && (
                            <button
                                onClick={() => onBuyPack()}
                                className="border-2 border-dashed border-white/40 dark:border-white/[0.08] rounded-xl flex flex-col items-center justify-center p-4 md:p-6 text-gray-400 hover:text-yc-aleo hover:border-yc-aleo/40 dark:hover:border-white/[0.15] transition-colors min-h-[120px] md:min-h-[280px] bg-white/30 dark:bg-zinc-900/30 backdrop-blur-xl"
                            >
                                <Plus className="w-8 h-8 mb-2" />
                                <span className="font-bold text-sm">Add Asset</span>
                            </button>
                        )}
                    </div>
                )}

                {/* Floating Action Bar for Upgrade */}
                {isUpgradeMode && (
                    <div className="fixed bottom-28 md:bottom-8 left-1/2 transform -translate-x-1/2 z-40 animate-[slideUp_0.3s_cubic-bezier(0.2,0.8,0.2,1)]">
                        <div className="bg-white/70 dark:bg-zinc-900/70 backdrop-blur-2xl border border-white/40 dark:border-white/[0.1] p-2 pl-5 pr-2 rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.1),inset_0_1px_0_rgba(255,255,255,0.4)] dark:shadow-[0_8px_32px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.05)] flex items-center gap-4">
                            <span className="text-gray-900 dark:text-white font-mono font-bold text-base">{selectedUpgradeCardId !== null ? '1' : '0'}/1</span>
                            <button
                                disabled={selectedUpgradeCardId === null}
                                onClick={() => {
                                    if (selectedUpgradeCardId !== null) {
                                        const card = myCards.find(c => c.tokenId === selectedUpgradeCardId);
                                        if (card) {
                                            setSelectedUpgradeCardId(null);
                                            openUpgradeModal(card);
                                        }
                                    }
                                }}
                                className={`
                                px-6 py-2.5 rounded-xl font-bold uppercase tracking-wider text-sm transition-all
                                ${selectedUpgradeCardId !== null
                                        ? 'bg-gradient-to-r from-orange-500 to-orange-500 text-white shadow-[0_0_20px_rgba(249, 115, 22,0.5)] animate-pulse'
                                        : 'bg-gray-800 text-gray-500 cursor-not-allowed'}
                            `}
                            >
                                Upgrade
                            </button>
                        </div>
                    </div>
                )}

                {/* Floating Action Bar for Merge */}
                {isMergeMode && (
                    <div className="fixed bottom-28 md:bottom-8 left-1/2 transform -translate-x-1/2 z-40 animate-[slideUp_0.3s_cubic-bezier(0.2,0.8,0.2,1)]">
                        <div className="bg-white/70 dark:bg-zinc-900/70 backdrop-blur-2xl border border-white/40 dark:border-white/[0.1] p-2 pl-5 pr-2 rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.1),inset_0_1px_0_rgba(255,255,255,0.4)] dark:shadow-[0_8px_32px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.05)] flex items-center gap-4">
                            <span className="text-gray-900 dark:text-white font-mono font-bold text-base">{selectedCardIds.length}/3</span>
                            <button
                                disabled={selectedCardIds.length !== 3}
                                onClick={handleForge}
                                className={`
                                px-6 py-2.5 rounded-xl font-bold uppercase tracking-wider text-sm transition-all
                                ${selectedCardIds.length === 3
                                        ? 'bg-yc-aleo hover:bg-orange-600 text-white shadow-[0_0_20px_rgba(249, 115, 22,0.5)] animate-pulse'
                                        : 'bg-gray-800 text-gray-500 cursor-not-allowed'}
                            `}
                            >
                                Forge
                            </button>
                        </div>
                    </div>
                )}
            </>)}

            {/* --- DETAILED CARD VIEW MODAL --- */}
            <CardDetailModal
                data={viewingCard}
                cardData={viewingCardData}
                onClose={() => {
                    setViewingCard(null);
                    setViewingCardData(null);
                }}
            />

            {/* Forge Processing / Success Overlay */}
            {(mergeStatus !== 'idle' || mergeError) && (
                <div ref={fusionContainerRef} className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 backdrop-blur-xl overflow-hidden">

                    <div ref={flashRef} className="absolute inset-0 bg-white pointer-events-none opacity-0 z-[60]" />

                    {/* Confirming state - waiting for wallet */}
                    {mergeStatus === 'confirming' && (
                        <div className="text-center">
                            <div className="w-20 h-20 mx-auto mb-6 border-4 border-yc-aleo/30 border-t-yc-aleo rounded-full animate-spin" />
                            <h2 className="text-2xl font-bold text-white mb-2">Confirm in Wallet</h2>
                            <p className="text-gray-400">Please confirm the merge transaction...</p>
                        </div>
                    )}

                    {/* Error display */}
                    {mergeError && mergeStatus === 'idle' && (
                        <div className="text-center p-8 max-w-md">
                            <div className="w-16 h-16 mx-auto mb-4 bg-red-500/20 rounded-full flex items-center justify-center">
                                <X className="w-8 h-8 text-red-500" />
                            </div>
                            <h2 className="text-2xl font-bold text-white mb-2">Merge Failed</h2>
                            <p className="text-red-400 mb-6">{mergeError}</p>
                            <div className="flex gap-3 justify-center">
                                <button
                                    onClick={() => setMergeError(null)}
                                    className="px-6 py-3 bg-white text-black font-bold rounded-xl hover:bg-gray-200 transition-colors"
                                >
                                    Got It
                                </button>
                                {(mergeError.includes('rarity') || mergeError.includes('Rarity') || mergeError.includes('0x7c0aec15')) && (
                                    <button
                                        onClick={async () => {
                                            setMergeError(null);
                                            await loadCards(true);
                                        }}
                                        className="px-6 py-3 bg-yc-aleo text-white font-bold rounded-xl hover:bg-orange-600 transition-colors flex items-center gap-2"
                                    >
                                        <RefreshCw className="w-4 h-4" />
                                        Refresh Cards
                                    </button>
                                )}
                            </div>
                        </div>
                    )}

                    {mergeStatus === 'processing' && (
                        <div className="relative w-full h-full flex items-center justify-center">
                            <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')] opacity-20"></div>

                            <div
                                ref={coreRef}
                                className="absolute w-32 h-32 rounded-full bg-yc-aleo blur-md flex items-center justify-center z-10 shadow-[0_0_60px_rgba(249, 115, 22,0.6)]"
                            >
                                <div className="w-full h-full bg-white rounded-full opacity-50 blur-sm animate-pulse" />
                            </div>

                            <div className="relative w-[600px] h-[600px] flex items-center justify-center">
                                {selectedCardsData.map((card, idx) => {
                                    const angle = (idx / 3) * Math.PI * 2;
                                    const radius = 250;
                                    const x = Math.cos(angle) * radius;
                                    const y = Math.sin(angle) * radius;

                                    return (
                                        <div
                                            key={card.tokenId}
                                            ref={el => { if (el) fusionCardsRef.current[idx] = el }}
                                            className="absolute w-32 h-48 rounded-xl overflow-hidden z-20"
                                            style={{ transform: `translate(${x}px, ${y}px)` }}
                                        >
                                            <img src={card.image} className="w-full h-full object-contain" />
                                        </div>
                                    );
                                })}
                            </div>

                            <div className="absolute bottom-20 text-center animate-pulse z-30">
                                <h2 className="text-3xl font-black text-white uppercase tracking-[0.2em] mb-2">Fusing Assets</h2>
                                <p className="text-yc-aleo font-mono text-xs">Processing on blockchain...</p>
                            </div>
                        </div>
                    )}

                    {mergeStatus === 'success' && (
                        <div className="flex flex-col items-center animate-[scaleIn_0.4s_cubic-bezier(0.34,1.56,0.64,1)] relative z-50">
                            <h2 className="text-4xl font-black text-white uppercase tracking-tighter mb-2">Fusion Complete</h2>
                            <p className="text-gray-400 mb-8">A new powerful asset has been forged.</p>

                            {newlyForgedCard && (
                                <div className="w-64 rounded-xl overflow-hidden shadow-[0_0_50px_rgba(249, 115, 22,0.4)] mb-8 transform hover:scale-105 transition-transform duration-500">
                                    <img src={newlyForgedCard.image} className="w-full object-contain" />
                                </div>
                            )}

                            <button
                                onClick={closeSuccessModal}
                                className="bg-white text-black hover:bg-gray-200 px-10 py-3 rounded-lg font-bold uppercase tracking-wide transition-all shadow-lg"
                            >
                                Collect Asset
                            </button>
                        </div>
                    )}
                </div>
            )}

            {/* Sell Modal */}
            {sellModalOpen && cardToSell && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm animate-[fadeIn_0.2s_ease-out]">
                    <div className="bg-white dark:bg-white/[0.02] border border-gray-200 dark:border-white/[0.06] rounded-2xl p-6 w-full max-w-md mx-4 shadow-2xl animate-[scaleIn_0.3s_cubic-bezier(0.34,1.56,0.64,1)]">
                        {/* Header */}
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-xl font-bold text-gray-900 dark:text-white">Sell Card</h3>
                            <button
                                onClick={() => {
                                    setSellModalOpen(false);
                                    setCardToSell(null);
                                }}
                                className="text-gray-400 hover:text-white transition-colors"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        {/* Card Preview */}
                        <div className="flex items-center gap-4 mb-4 p-3 bg-gray-100 dark:bg-black/50 rounded-xl">
                            <img
                                src={cardToSell.image}
                                alt={cardToSell.name}
                                className="w-16 h-16 rounded-lg object-cover"
                            />
                            <div>
                                <h4 className="text-gray-900 dark:text-white font-bold">{cardToSell.name}</h4>
                                <p className="text-gray-500 dark:text-gray-400 text-sm">
                                    {cardToSell.rarity} · Lvl {cardToSell.level || cardToSell.multiplier}
                                </p>
                            </div>
                        </div>

                        {/* Sale Type Tabs */}
                        <div className="flex gap-2 mb-4">
                            <button
                                onClick={() => setSellMode('fixed')}
                                className={`flex-1 py-2 px-4 rounded-lg font-bold flex items-center justify-center gap-2 transition-all ${sellMode === 'fixed'
                                    ? 'bg-yc-aleo text-white'
                                    : 'bg-gray-100 dark:bg-[#1A1A1A] text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-[#222]'
                                    }`}
                            >
                                <Tag className="w-4 h-4" />
                                Fixed Price
                            </button>
                            <button
                                onClick={() => setSellMode('auction')}
                                className={`flex-1 py-2 px-4 rounded-lg font-bold flex items-center justify-center gap-2 transition-all ${sellMode === 'auction'
                                    ? 'bg-orange-500 text-white'
                                    : 'bg-gray-100 dark:bg-[#1A1A1A] text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-[#222]'
                                    }`}
                            >
                                <Gavel className="w-4 h-4" />
                                Auction
                            </button>
                        </div>

                        {/* Fixed Price Form */}
                        {sellMode === 'fixed' && (
                            <div className="mb-4">
                                <label className="block text-sm font-bold text-gray-400 uppercase mb-2">
                                    Sale Price ({currencySymbol()})
                                </label>
                                <div className="relative">
                                    <input
                                        type="number"
                                        step="0.01"
                                        min="0.01"
                                        placeholder="0.00"
                                        value={sellPrice}
                                        onChange={(e) => setSellPrice(e.target.value)}
                                        className="w-full bg-gray-50 dark:bg-black border border-gray-300 dark:border-white/[0.06] rounded-xl px-4 py-3 text-gray-900 dark:text-white text-lg font-mono focus:outline-none focus:border-yc-aleo transition-colors"
                                    />
                                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 font-bold">
                                        {currencySymbol()}
                                    </span>
                                </div>
                                <p className="text-xs text-gray-500 mt-2">
                                    2% royalty will be deducted on sale
                                </p>
                            </div>
                        )}

                        {/* Auction Form */}
                        {sellMode === 'auction' && (
                            <div className="space-y-4 mb-4">
                                <div>
                                    <label className="block text-sm font-bold text-gray-400 uppercase mb-2">
                                        Starting Price ({currencySymbol()})
                                    </label>
                                    <div className="relative">
                                        <input
                                            type="number"
                                            step="0.01"
                                            min="0.01"
                                            placeholder="0.00"
                                            value={auctionStartPrice}
                                            onChange={(e) => setAuctionStartPrice(e.target.value)}
                                            className="w-full bg-gray-50 dark:bg-black border border-gray-300 dark:border-white/[0.06] rounded-xl px-4 py-3 text-gray-900 dark:text-white text-lg font-mono focus:outline-none focus:border-orange-500 transition-colors"
                                        />
                                        <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 font-bold">
                                            {currencySymbol()}
                                        </span>
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-sm font-bold text-gray-400 uppercase mb-2">
                                        Reserve Price (Optional)
                                    </label>
                                    <div className="relative">
                                        <input
                                            type="number"
                                            step="0.01"
                                            min="0"
                                            placeholder="Same as start price"
                                            value={auctionReservePrice}
                                            onChange={(e) => setAuctionReservePrice(e.target.value)}
                                            className="w-full bg-gray-50 dark:bg-black border border-gray-300 dark:border-white/[0.06] rounded-xl px-4 py-3 text-gray-900 dark:text-white text-lg font-mono focus:outline-none focus:border-orange-500 transition-colors"
                                        />
                                        <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 font-bold">
                                            {currencySymbol()}
                                        </span>
                                    </div>
                                    <p className="text-xs text-gray-500 mt-1">
                                        Minimum price to complete sale
                                    </p>
                                </div>
                                <div>
                                    <label className="block text-sm font-bold text-gray-400 uppercase mb-2">
                                        <Clock className="w-3 h-3 inline mr-1" />
                                        Duration
                                    </label>
                                    <select
                                        value={auctionDuration}
                                        onChange={(e) => setAuctionDuration(e.target.value)}
                                        className="w-full bg-gray-50 dark:bg-black border border-gray-300 dark:border-white/[0.06] rounded-xl px-4 py-3 text-gray-900 dark:text-white focus:outline-none focus:border-orange-500 transition-colors"
                                    >
                                        <option value="1">1 Hour</option>
                                        <option value="6">6 Hours</option>
                                        <option value="12">12 Hours</option>
                                        <option value="24">24 Hours</option>
                                        <option value="48">48 Hours</option>
                                        <option value="72">72 Hours</option>
                                        <option value="168">1 Week</option>
                                    </select>
                                </div>
                                <p className="text-xs text-gray-500">
                                    2% royalty will be deducted on final sale
                                </p>
                            </div>
                        )}

                        {/* Actions */}
                        <div className="flex gap-3">
                            <button
                                onClick={() => {
                                    setSellModalOpen(false);
                                    setCardToSell(null);
                                }}
                                className="flex-1 py-3 rounded-xl font-bold text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-[#1A1A1A] hover:bg-gray-200 dark:hover:bg-[#222] transition-colors"
                            >
                                Cancel
                            </button>
                            {sellMode === 'fixed' ? (
                                <button
                                    onClick={handleSellCard}
                                    disabled={isSelling || !sellPrice || parseFloat(sellPrice) <= 0}
                                    className={`flex-1 py-3 rounded-xl font-bold transition-all flex items-center justify-center gap-2 ${isSelling || !sellPrice || parseFloat(sellPrice) <= 0
                                        ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
                                        : 'bg-yc-aleo text-white hover:bg-orange-600'
                                        }`}
                                >
                                    {isSelling ? (
                                        <>
                                            <Loader2 className="w-4 h-4 animate-spin" />
                                            Listing...
                                        </>
                                    ) : (
                                        <>
                                            <Tag className="w-4 h-4" />
                                            List for Sale
                                        </>
                                    )}
                                </button>
                            ) : (
                                <button
                                    onClick={handleCreateAuction}
                                    disabled={isSelling || !auctionStartPrice || parseFloat(auctionStartPrice) <= 0}
                                    className={`flex-1 py-3 rounded-xl font-bold transition-all flex items-center justify-center gap-2 ${isSelling || !auctionStartPrice || parseFloat(auctionStartPrice) <= 0
                                        ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
                                        : 'bg-orange-500 text-white hover:bg-orange-600'
                                        }`}
                                >
                                    {isSelling ? (
                                        <>
                                            <Loader2 className="w-4 h-4 animate-spin" />
                                            Creating...
                                        </>
                                    ) : (
                                        <>
                                            <Gavel className="w-4 h-4" />
                                            Create Auction
                                        </>
                                    )}
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* NFT Stats Modal */}
            {statsModalOpen && statsCard && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm animate-[fadeIn_0.2s_ease-out]">
                    <div className="bg-white dark:bg-white/[0.02] border border-gray-200 dark:border-white/[0.06] rounded-2xl p-6 w-full max-w-lg mx-4 shadow-2xl animate-[scaleIn_0.3s_cubic-bezier(0.34,1.56,0.64,1)] max-h-[85vh] flex flex-col">
                        {/* Header */}
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-xl font-bold text-gray-900 dark:text-white">Card Details</h3>
                            <button
                                onClick={() => {
                                    setStatsModalOpen(false);
                                    setStatsCard(null);
                                }}
                                className="text-gray-400 hover:text-white transition-colors"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        {/* Card Preview */}
                        <div className="flex items-center gap-4 mb-4 p-3 bg-gray-100 dark:bg-black/50 rounded-xl">
                            <img
                                src={statsCard.image}
                                alt={statsCard.name}
                                className="w-16 h-16 rounded-lg object-cover"
                            />
                            <div>
                                <h4 className="text-gray-900 dark:text-white font-bold">{statsCard.name}</h4>
                                <p className="text-gray-500 dark:text-gray-400 text-sm">
                                    {statsCard.rarity} · Lvl {statsCard.level || statsCard.multiplier} · #{statsCard.tokenId}
                                </p>
                            </div>
                        </div>

                        {/* Tabs */}
                        <div className="flex gap-2 mb-4">
                            <button
                                onClick={() => setStatsTab('bids')}
                                className={`flex-1 py-2 px-4 rounded-lg font-bold flex items-center justify-center gap-2 transition-all ${statsTab === 'bids'
                                    ? 'bg-yc-aleo text-white'
                                    : 'bg-gray-100 dark:bg-[#1A1A1A] text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-[#222]'
                                    }`}
                            >
                                <Gavel className="w-4 h-4" />
                                Bids ({cardBids.length})
                            </button>
                            <button
                                onClick={() => setStatsTab('sales')}
                                className={`flex-1 py-2 px-4 rounded-lg font-bold flex items-center justify-center gap-2 transition-all ${statsTab === 'sales'
                                    ? 'bg-blue-500 text-white'
                                    : 'bg-gray-100 dark:bg-[#1A1A1A] text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-[#222]'
                                    }`}
                            >
                                <History className="w-4 h-4" />
                                Sales
                            </button>
                            <button
                                onClick={() => setStatsTab('stats')}
                                className={`flex-1 py-2 px-4 rounded-lg font-bold flex items-center justify-center gap-2 transition-all ${statsTab === 'stats'
                                    ? 'bg-green-500 text-white'
                                    : 'bg-gray-100 dark:bg-[#1A1A1A] text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-[#222]'
                                    }`}
                            >
                                <Activity className="w-4 h-4" />
                                Stats
                            </button>
                        </div>

                        {/* Content */}
                        <div className="flex-1 overflow-y-auto">
                            {loadingStats ? (
                                <div className="flex items-center justify-center py-12">
                                    <Loader2 className="w-8 h-8 text-yc-aleo animate-spin" />
                                </div>
                            ) : (
                                <>
                                    {/* Bids Tab */}
                                    {statsTab === 'bids' && (
                                        <div className="space-y-3">
                                            {cardBids.length === 0 ? (
                                                <div className="text-center py-8 text-gray-500">
                                                    <Gavel className="w-8 h-8 mx-auto mb-2 opacity-50" />
                                                    <p>No active bids on this card</p>
                                                </div>
                                            ) : (
                                                cardBids.map((bid, idx) => (
                                                    <div key={idx} className="bg-gray-50 dark:bg-[#1A1A1A] rounded-xl p-4 border border-gray-200 dark:border-white/[0.06]">
                                                        <div className="flex justify-between items-center">
                                                            <div>
                                                                <p className="text-gray-900 dark:text-white font-bold">{formatXTZ(bid.amount)} {currencySymbol()}</p>
                                                                <p className="text-gray-500 text-xs font-mono">
                                                                    {bid.bidder.slice(0, 6)}...{bid.bidder.slice(-4)}
                                                                </p>
                                                            </div>
                                                            <div className="text-right">
                                                                <p className="text-gray-400 text-sm flex items-center gap-1">
                                                                    <Clock className="w-3 h-3" />
                                                                    Expires
                                                                </p>
                                                                <p className="text-gray-300 text-xs">
                                                                    {new Date(Number(bid.expiration) * 1000).toLocaleDateString()}
                                                                </p>
                                                            </div>
                                                        </div>
                                                    </div>
                                                ))
                                            )}
                                        </div>
                                    )}

                                    {/* Sales Tab */}
                                    {statsTab === 'sales' && (
                                        <div className="space-y-3">
                                            {cardSales.length === 0 ? (
                                                <div className="text-center py-8 text-gray-500">
                                                    <History className="w-8 h-8 mx-auto mb-2 opacity-50" />
                                                    <p>No sales history yet</p>
                                                </div>
                                            ) : (
                                                cardSales.map((sale, idx) => (
                                                    <div key={idx} className="bg-gray-50 dark:bg-[#1A1A1A] rounded-xl p-4 border border-gray-200 dark:border-white/[0.06]">
                                                        <div className="flex justify-between items-center">
                                                            <div>
                                                                <p className="text-gray-900 dark:text-white font-bold">{formatXTZ(sale.price)} {currencySymbol()}</p>
                                                                <p className="text-gray-500 text-xs">
                                                                    {sale.saleType === 0 ? 'Listing' : sale.saleType === 1 ? 'Bid Accepted' : 'Auction'}
                                                                </p>
                                                            </div>
                                                            <div className="text-right">
                                                                <p className="text-gray-400 text-xs font-mono">
                                                                    From: {sale.seller.slice(0, 6)}...{sale.seller.slice(-4)}
                                                                </p>
                                                                <p className="text-gray-400 text-xs font-mono">
                                                                    To: {sale.buyer.slice(0, 6)}...{sale.buyer.slice(-4)}
                                                                </p>
                                                            </div>
                                                        </div>
                                                        <p className="text-gray-500 text-xs mt-2">
                                                            {new Date(Number(sale.timestamp) * 1000).toLocaleString()}
                                                        </p>
                                                    </div>
                                                ))
                                            )}
                                        </div>
                                    )}

                                    {/* Stats Tab */}
                                    {statsTab === 'stats' && (
                                        <div className="space-y-3">
                                            {cardStats ? (
                                                <>
                                                    <div className="grid grid-cols-2 gap-3">
                                                        <div className="bg-gray-50 dark:bg-[#1A1A1A] rounded-xl p-4 border border-gray-200 dark:border-white/[0.06]">
                                                            <p className="text-gray-500 text-xs uppercase mb-1">Total Sales</p>
                                                            <p className="text-gray-900 dark:text-white text-xl font-bold">{cardStats.salesCount?.toString() || '0'}</p>
                                                        </div>
                                                        <div className="bg-gray-50 dark:bg-[#1A1A1A] rounded-xl p-4 border border-gray-200 dark:border-white/[0.06]">
                                                            <p className="text-gray-500 text-xs uppercase mb-1">Total Volume</p>
                                                            <p className="text-gray-900 dark:text-white text-xl font-bold">
                                                                {cardStats.totalVolume ? formatXTZ(cardStats.totalVolume) : '0'} {currencySymbol()}
                                                            </p>
                                                        </div>
                                                        <div className="bg-gray-50 dark:bg-[#1A1A1A] rounded-xl p-4 border border-gray-200 dark:border-white/[0.06]">
                                                            <p className="text-gray-500 text-xs uppercase mb-1">Highest Sale</p>
                                                            <p className="text-green-600 dark:text-green-400 text-xl font-bold">
                                                                {cardStats.highestSale ? formatXTZ(cardStats.highestSale) : '0'} {currencySymbol()}
                                                            </p>
                                                        </div>
                                                        <div className="bg-gray-50 dark:bg-[#1A1A1A] rounded-xl p-4 border border-gray-200 dark:border-white/[0.06]">
                                                            <p className="text-gray-500 text-xs uppercase mb-1">Lowest Sale</p>
                                                            <p className="text-blue-600 dark:text-blue-400 text-xl font-bold">
                                                                {cardStats.lowestSale && cardStats.lowestSale > 0n ? formatXTZ(cardStats.lowestSale) : '-'} {currencySymbol()}
                                                            </p>
                                                        </div>
                                                    </div>
                                                    <div className="bg-gray-50 dark:bg-[#1A1A1A] rounded-xl p-4 border border-gray-200 dark:border-white/[0.06]">
                                                        <p className="text-gray-500 text-xs uppercase mb-1">Last Sale Price</p>
                                                        <p className="text-yc-aleo text-2xl font-bold">
                                                            {cardStats.lastSalePrice && cardStats.lastSalePrice > 0n ? formatXTZ(cardStats.lastSalePrice) : '-'} {currencySymbol()}
                                                        </p>
                                                    </div>
                                                </>
                                            ) : (
                                                <div className="text-center py-8 text-gray-500">
                                                    <Activity className="w-8 h-8 mx-auto mb-2 opacity-50" />
                                                    <p>No stats available</p>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Pack Sell Modal */}
            {packSellModalOpen && packToSell !== null && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm animate-[fadeIn_0.2s_ease-out]">
                    <div className="bg-white dark:bg-white/[0.02] border border-gray-200 dark:border-white/[0.06] rounded-2xl p-6 w-full max-w-md mx-4 shadow-2xl animate-[scaleIn_0.3s_cubic-bezier(0.34,1.56,0.64,1)]">
                        {/* Header */}
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-xl font-bold text-gray-900 dark:text-white">Sell Pack</h3>
                            <button
                                onClick={() => {
                                    setPackSellModalOpen(false);
                                    setPackToSell(null);
                                }}
                                className="text-gray-400 hover:text-white transition-colors"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        {/* Pack Preview */}
                        <div className="flex items-center gap-4 mb-4 p-3 bg-gray-100 dark:bg-black/50 rounded-xl">
                            <div className="w-16 h-16 rounded-lg overflow-hidden shrink-0 bg-gray-100 dark:bg-black/30">
                                <img src="/aleo-pack.png" alt="Pack" className="w-full h-full object-contain" />
                            </div>
                            <div>
                                <h4 className="text-gray-900 dark:text-white font-bold">UnicornX Pack</h4>
                                <p className="text-gray-500 dark:text-gray-400 text-sm">
                                    Pack #{packToSell} · 5 Random Cards
                                </p>
                            </div>
                        </div>

                        {/* Sale Type Tabs */}
                        <div className="flex gap-2 mb-4">
                            <button
                                onClick={() => setPackSellMode('fixed')}
                                className={`flex-1 py-2 px-4 rounded-lg font-bold flex items-center justify-center gap-2 transition-all ${packSellMode === 'fixed'
                                    ? 'bg-yc-aleo text-white'
                                    : 'bg-gray-100 dark:bg-[#1A1A1A] text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-[#222]'
                                    }`}
                            >
                                <Tag className="w-4 h-4" />
                                Fixed Price
                            </button>
                            <button
                                onClick={() => setPackSellMode('auction')}
                                className={`flex-1 py-2 px-4 rounded-lg font-bold flex items-center justify-center gap-2 transition-all ${packSellMode === 'auction'
                                    ? 'bg-orange-500 text-white'
                                    : 'bg-gray-100 dark:bg-[#1A1A1A] text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-[#222]'
                                    }`}
                            >
                                <Gavel className="w-4 h-4" />
                                Auction
                            </button>
                        </div>

                        {/* Fixed Price Form */}
                        {packSellMode === 'fixed' && (
                            <div className="mb-4">
                                <label className="block text-sm font-bold text-gray-400 uppercase mb-2">
                                    Sale Price ({currencySymbol()})
                                </label>
                                <div className="relative">
                                    <input
                                        type="number"
                                        step="0.01"
                                        min="0.01"
                                        placeholder="0.00"
                                        value={packSellPrice}
                                        onChange={(e) => setPackSellPrice(e.target.value)}
                                        className="w-full bg-gray-50 dark:bg-black border border-gray-300 dark:border-white/[0.06] rounded-xl px-4 py-3 text-gray-900 dark:text-white text-lg font-mono focus:outline-none focus:border-yc-aleo transition-colors"
                                    />
                                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 font-bold">
                                        {currencySymbol()}
                                    </span>
                                </div>
                                <p className="text-xs text-gray-500 mt-2">
                                    2% royalty will be deducted on sale
                                </p>
                            </div>
                        )}

                        {/* Auction Form */}
                        {packSellMode === 'auction' && (
                            <div className="space-y-4 mb-4">
                                <div>
                                    <label className="block text-sm font-bold text-gray-400 uppercase mb-2">
                                        Starting Price ({currencySymbol()})
                                    </label>
                                    <div className="relative">
                                        <input
                                            type="number"
                                            step="0.01"
                                            min="0.01"
                                            placeholder="0.00"
                                            value={packAuctionStartPrice}
                                            onChange={(e) => setPackAuctionStartPrice(e.target.value)}
                                            className="w-full bg-gray-50 dark:bg-black border border-gray-300 dark:border-white/[0.06] rounded-xl px-4 py-3 text-gray-900 dark:text-white text-lg font-mono focus:outline-none focus:border-orange-500 transition-colors"
                                        />
                                        <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 font-bold">
                                            {currencySymbol()}
                                        </span>
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-sm font-bold text-gray-400 uppercase mb-2">
                                        Reserve Price (Optional)
                                    </label>
                                    <div className="relative">
                                        <input
                                            type="number"
                                            step="0.01"
                                            min="0"
                                            placeholder="Same as start price"
                                            value={packAuctionReservePrice}
                                            onChange={(e) => setPackAuctionReservePrice(e.target.value)}
                                            className="w-full bg-gray-50 dark:bg-black border border-gray-300 dark:border-white/[0.06] rounded-xl px-4 py-3 text-gray-900 dark:text-white text-lg font-mono focus:outline-none focus:border-orange-500 transition-colors"
                                        />
                                        <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 font-bold">
                                            {currencySymbol()}
                                        </span>
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-sm font-bold text-gray-400 uppercase mb-2">
                                        <Clock className="w-3 h-3 inline mr-1" />
                                        Duration
                                    </label>
                                    <select
                                        value={packAuctionDuration}
                                        onChange={(e) => setPackAuctionDuration(e.target.value)}
                                        className="w-full bg-gray-50 dark:bg-black border border-gray-300 dark:border-white/[0.06] rounded-xl px-4 py-3 text-gray-900 dark:text-white focus:outline-none focus:border-orange-500 transition-colors"
                                    >
                                        <option value="1">1 Hour</option>
                                        <option value="6">6 Hours</option>
                                        <option value="12">12 Hours</option>
                                        <option value="24">24 Hours</option>
                                        <option value="48">48 Hours</option>
                                        <option value="72">72 Hours</option>
                                        <option value="168">1 Week</option>
                                    </select>
                                </div>
                                <p className="text-xs text-gray-500">
                                    2% royalty will be deducted on final sale
                                </p>
                            </div>
                        )}

                        {/* Actions */}
                        <div className="flex gap-3">
                            <button
                                onClick={() => {
                                    setPackSellModalOpen(false);
                                    setPackToSell(null);
                                }}
                                className="flex-1 py-3 rounded-xl font-bold text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-[#1A1A1A] hover:bg-gray-200 dark:hover:bg-[#222] transition-colors"
                            >
                                Cancel
                            </button>
                            {packSellMode === 'fixed' ? (
                                <button
                                    onClick={handleSellPack}
                                    disabled={isSellingPack || !packSellPrice || parseFloat(packSellPrice) <= 0}
                                    className={`flex-1 py-3 rounded-xl font-bold transition-all flex items-center justify-center gap-2 ${isSellingPack || !packSellPrice || parseFloat(packSellPrice) <= 0
                                        ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
                                        : 'bg-yc-aleo text-white hover:bg-orange-600'
                                        }`}
                                >
                                    {isSellingPack ? (
                                        <>
                                            <Loader2 className="w-4 h-4 animate-spin" />
                                            Listing...
                                        </>
                                    ) : (
                                        <>
                                            <Tag className="w-4 h-4" />
                                            List Pack
                                        </>
                                    )}
                                </button>
                            ) : (
                                <button
                                    onClick={handleCreatePackAuction}
                                    disabled={isSellingPack || !packAuctionStartPrice || parseFloat(packAuctionStartPrice) <= 0}
                                    className={`flex-1 py-3 rounded-xl font-bold transition-all flex items-center justify-center gap-2 ${isSellingPack || !packAuctionStartPrice || parseFloat(packAuctionStartPrice) <= 0
                                        ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
                                        : 'bg-orange-500 text-white hover:bg-orange-600'
                                        }`}
                                >
                                    {isSellingPack ? (
                                        <>
                                            <Loader2 className="w-4 h-4 animate-spin" />
                                            Creating...
                                        </>
                                    ) : (
                                        <>
                                            <Gavel className="w-4 h-4" />
                                            Create Auction
                                        </>
                                    )}
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Onboarding Guide */}
            {showGuide && isConnected && (
                <OnboardingGuide
                    steps={PORTFOLIO_GUIDE}
                    currentStep={guideStep}
                    onNext={() => guideNext(PORTFOLIO_GUIDE.length)}
                    onDismiss={guideDismiss}
                />
            )}
        </div>
    );
};

export default Portfolio;