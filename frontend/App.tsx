import React, { useState, useMemo, useEffect, useCallback } from 'react';
import Sidebar from './components/Sidebar';
import RightPanel from './components/RightPanel';
import HeroBanner from './components/HeroBanner';
import LiveFeed from './components/LiveFeed';
import PackOpeningModal from './components/PackOpeningModal';
import Marketplace from './components/Marketplace';
import Portfolio from './components/Portfolio';
import Leagues from './components/Leagues';
import Analytics from './components/Analytics';
import Feed from './components/Feed';
import AdminPanel from './components/AdminPanel';
import CardDetailModal, { CardDetailData } from './components/CardDetailModal';
import ProfileSetupModal from './components/ProfileSetupModal';
import ProfileEditModal from './components/ProfileEditModal';
import BottomNav from './components/BottomNav';
import TournamentCTA from './components/TournamentCTA';
import DashboardLeaderboard from './components/DashboardLeaderboard';
import MobileWidgets from './components/MobileWidgets';
import SplashScreen from './components/SplashScreen';
import ErrorBoundary from './components/ErrorBoundary';
import ModelViewer3D from './components/ModelViewer3D';
import { NavSection, UserProfile, Rarity, CardData } from './types';
import { Filter, Wallet, Loader2, Sun, Moon, LogOut, User, Copy, Check } from 'lucide-react';
import { useTheme } from './context/ThemeContext';
import { ThemeProvider } from './context/ThemeContext';
import { WalletProvider, useWalletContext } from './context/WalletContext';
import { NetworkProvider, useNetwork } from './context/NetworkContext';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AleoWalletProvider } from '@provablehq/aleo-wallet-adaptor-react';
import { WalletModalProvider } from '@provablehq/aleo-wallet-adaptor-react-ui';
import { ShieldWalletAdapter } from '@provablehq/aleo-wallet-adaptor-shield';
import { DecryptPermission } from '@provablehq/aleo-wallet-adaptor-core';
import { Network } from '@provablehq/aleo-types';
import '@provablehq/aleo-wallet-adaptor-react-ui/dist/styles.css';
import { ensureWasm } from './lib/aleoCrypto';

// Initialize Aleo WASM at module load (async, non-blocking)
ensureWasm().catch(e => console.warn('[WASM init] failed:', e));

import { formatXTZ, CHAIN_NAME, ethers } from './lib/contracts';
import { currencySymbol } from './lib/networks';
import { isAdmin } from './hooks/useAdmin';
import { useUser } from './hooks/useUser';
import { generatePixelAvatar } from './lib/pixelAvatar';
import { useMarketplaceV2, Listing } from './hooks/useMarketplaceV2';
import { useNFT } from './hooks/useNFT';
import { usePacks } from './hooks/usePacks';
import { checkContractChange } from './lib/cache';

// Aleo wallet adapters — Shield only (matches NullPay)
const ALEO_WALLETS = [
    new ShieldWalletAdapter({ appName: 'UnicornX' }),
];


// Inner component that uses wallet context
const AppContent: React.FC = () => {
    const [activeSection, setActiveSection] = useState<NavSection>(NavSection.HOME);
    const [isPackModalOpen, setIsPackModalOpen] = useState(false);
    const [openPackId, setOpenPackId] = useState<number | null>(null);
    const [openPackIds, setOpenPackIds] = useState<number[] | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [dashboardSelectedStartup, setDashboardSelectedStartup] = useState<CardDetailData | null>(null);
    const [dashboardSelectedCard, setDashboardSelectedCard] = useState<CardData | null>(null);

    // Dashboard filters and sort
    const [activeFilter, setActiveFilter] = useState<string>('all');
    const [sortBy, setSortBy] = useState<'price' | 'rarity' | 'recent'>('recent');

    // Marketplace & NFT listings for dashboard
    const [dashboardListings, setDashboardListings] = useState<Array<{ listing: Listing; card: CardData }>>([]);
    const [isLoadingDashboard, setIsLoadingDashboard] = useState(true);

    // Network hook (multi-chain)
    const { activeNetwork, networkId, allNetworks, switchNetwork } = useNetwork();

    // Wallet hook
    const {
        isConnected,
        address,
        balance,
        balanceLoading,
        isCorrectChain,
        connect,
        disconnect,
        switchChain,
        refreshBalance,
        formatAddress,
        isConnecting,
        hasSavedWallet
    } = useWalletContext();

    const handleNetworkSwitch = (id: string) => {
        if (id === networkId) return;
        switchNetwork(id);
        if (isConnected) { switchChain().catch(() => { }); refreshBalance(); }
    };

    // User profile hook
    const { profile, needsRegistration, isNewUser, registerUser, updateProfile } = useUser();

    // Profile edit modal state
    const [isProfileEditOpen, setIsProfileEditOpen] = useState(false);

    // Pack refresh signal — incremented after buying packs so Portfolio refreshes immediately
    const [packRefreshSignal, setPackRefreshSignal] = useState(0);

    // Mobile menu state
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
    const [addressCopied, setAddressCopied] = useState(false);
    const { theme, toggleTheme } = useTheme();

    // Marketplace hook
    const { getActiveListings, buyCard } = useMarketplaceV2();
    const [buyingId, setBuyingId] = useState<number | null>(null);

    // NFT hook
    const { getCardInfo, getCards, updateServerCache, clearCache } = useNFT();

    // Packs hook (for pre-fetching)
    const { getUserPacks } = usePacks();

    // Dynamic user from wallet + profile
    const user: UserProfile = {
        name: isConnected
            ? (profile?.username || (address ? formatAddress(address) : ''))
            : 'Not Connected',
        handle: isConnected ? `@${address?.slice(2, 8)}` : '@connect',
        balanceXTZ: isConnected ? Number(ethers.formatEther(balance)) : 0,
        avatar: isConnected
            ? (profile?.avatar || generatePixelAvatar(address || ''))
            : generatePixelAvatar(''),
        address: address || undefined,
    };

    // On app load (or network switch), check if contracts changed on the server.
    // If so, all caches (in-memory + localStorage) are wiped so stale data is never served.
    useEffect(() => {
        checkContractChange(activeNetwork.apiBase).then(changed => {
            if (changed) {
                clearCache(); // wipe NFT-specific caches
            }
        });
    }, [activeNetwork.apiBase, clearCache]);

    // Pre-fetch user's NFT cards + packs as soon as wallet connects or network changes
    // Data gets cached in blockchainCache → Portfolio loads instantly
    useEffect(() => {
        if (isConnected && address) {
            getCards(address).catch(() => { });
            getUserPacks(address).catch(() => { });
        }
    }, [isConnected, address, getCards, getUserPacks, networkId]);

    // Load dashboard listings with NFT metadata (refetch on network switch)
    useEffect(() => {
        const loadDashboardData = async () => {
            setIsLoadingDashboard(true);
            try {
                const listings = await getActiveListings();

                // Fetch metadata for each listing (handle packs differently)
                const listingsWithCards = await Promise.all(
                    listings.map(async (listing) => {
                        if (listing.isPack) {
                            // Pack listings use fixed metadata — don't query UnicornX_NFT metadata
                            const packCard: CardData = {
                                tokenId: Number(listing.tokenId),
                                startupId: 0,
                                name: `Pack #${Number(listing.tokenId)}`,
                                rarity: Rarity.COMMON,
                                multiplier: 1,
                                isLocked: false,
                                image: '',
                                edition: 1,
                                fundraising: null,
                                description: null,
                                isPack: true,
                            };
                            return { listing, card: packCard };
                        }
                        const card = await getCardInfo(Number(listing.tokenId));
                        return card ? { listing, card } : null;
                    })
                );

                // Filter out null values (failed metadata fetches)
                const validListings = listingsWithCards.filter((item): item is { listing: Listing; card: CardData } => item !== null);
                setDashboardListings(validListings);
            } catch (err) {
            } finally {
                setIsLoadingDashboard(false);
            }
        };

        loadDashboardData();
    }, [getActiveListings, getCardInfo, networkId]);

    // Filter and sort dashboard listings
    const filteredAndSortedListings = useMemo(() => {
        let filtered = dashboardListings;

        // Apply search filter
        if (searchQuery) {
            filtered = filtered.filter(({ card }) =>
                card.name.toLowerCase().includes(searchQuery.toLowerCase())
            );
        }

        // Apply category filter (packs are always shown — they don't have rarity)
        if (activeFilter !== 'all') {
            filtered = filtered.filter(({ card }) => {
                if (card.isPack) return true;
                switch (activeFilter) {
                    case 'legendary':
                        return card.rarity === Rarity.LEGENDARY;
                    case 'epic':
                        return card.rarity === Rarity.EPIC || card.rarity === Rarity.EPIC_RARE;
                    case 'rare':
                        return card.rarity === Rarity.RARE;
                    case 'common':
                        return card.rarity === Rarity.COMMON;
                    default:
                        return true;
                }
            });
        }

        // Apply sorting
        const sorted = [...filtered].sort((a, b) => {
            switch (sortBy) {
                case 'price':
                    return Number(b.listing.price - a.listing.price);
                case 'rarity': {
                    const rarityOrder = {
                        [Rarity.LEGENDARY]: 5,
                        [Rarity.EPIC_RARE]: 4,
                        [Rarity.EPIC]: 3,
                        [Rarity.RARE]: 2,
                        [Rarity.COMMON]: 1,
                    };
                    return rarityOrder[b.card.rarity] - rarityOrder[a.card.rarity];
                }
                case 'recent':
                default:
                    return Number(b.listing.listedAt - a.listing.listedAt);
            }
        });

        return sorted;
    }, [dashboardListings, searchQuery, activeFilter, sortBy]);

    const handleSectionChange = (section: NavSection) => {
        setActiveSection(section);
    };

    const handleWalletClick = async () => {
        if (!isConnected) {
            await connect();
        } else if (!isCorrectChain) {
            await switchChain();
        }
    };

    const renderContent = () => {
        switch (activeSection) {
            case NavSection.MARKETPLACE:
                return <Marketplace />;
            case NavSection.PORTFOLIO:
                return <Portfolio onBuyPack={(packId?: number) => { setOpenPackId(packId ?? null); setOpenPackIds(null); setIsPackModalOpen(true); }} onOpenPacks={(packIds: number[]) => { setOpenPackIds(packIds); setOpenPackId(null); setIsPackModalOpen(true); }} packRefreshSignal={packRefreshSignal} />;
            case NavSection.LEAGUES:
                return <Leagues />;
            case NavSection.FEED:
                return <Feed />;
            case NavSection.ADMIN:
                return <AdminPanel />;
            case NavSection.HOME:
            default:
                return (
                    <div>
                        {/* 1. Hero Banner */}
                        <div className="mb-6 md:mb-10">
                            <HeroBanner />
                        </div>

                        {/* 2. Live Feed Marquee */}
                        <LiveFeed />

                        {/* 3. Tournament CTA */}
                        <TournamentCTA onNavigate={handleSectionChange} />

                        {/* 3.5 Top Startups + Referral (visible below xl where RightPanel is hidden) */}
                        <MobileWidgets onOpenPack={() => setIsPackModalOpen(true)} />

                        {/* 4. Leaderboard */}
                        <DashboardLeaderboard onNavigate={handleSectionChange} />

                        {/* 5. NFT Marketplace */}
                        <div className="mt-8">
                            <h3 className="font-bold text-lg text-gray-900 dark:text-white mb-4">
                                NFT Marketplace
                            </h3>

                            <div className="flex flex-col md:flex-row items-start md:items-center justify-between mb-6 gap-4 md:gap-6">
                                <div className="w-full md:w-auto">
                                    <div className="flex items-center flex-wrap gap-2">
                                        {['all', 'legendary', 'epic', 'rare', 'common'].map((filter) => (
                                            <button
                                                key={filter}
                                                onClick={() => setActiveFilter(filter)}
                                                className={`px-5 py-1.5 rounded-full text-xs font-bold transition-all duration-300 transform active:scale-95 ${activeFilter === filter
                                                    ? 'bg-yc-aleo/10 dark:bg-yc-aleo/[0.15] text-yc-aleo border border-yc-aleo/30 dark:border-yc-aleo/30'
                                                    : 'bg-gray-100 dark:bg-white/[0.03] text-gray-500 dark:text-gray-500 border border-transparent hover:bg-gray-200 dark:hover:bg-white/[0.06] hover:text-gray-900 dark:hover:text-white'
                                                    }`}
                                            >
                                                {filter.charAt(0).toUpperCase() + filter.slice(1)}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                <div className="flex items-center space-x-3 self-end md:self-auto">
                                    <span className="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wider">Sort:</span>
                                    <div className="relative group">
                                        <button className="flex items-center text-sm font-semibold text-yc-text-primary dark:text-white hover:text-gray-600 dark:hover:text-gray-300 transition-colors">
                                            {sortBy === 'price' ? 'Price' : sortBy === 'rarity' ? 'Rarity' : 'Recent'}
                                            <Filter className="w-3 h-3 ml-1 text-gray-400" />
                                        </button>
                                        <div className="absolute right-0 top-full mt-2 bg-white dark:bg-[#111113] backdrop-blur-xl border border-gray-200 dark:border-white/[0.08] rounded-2xl shadow-lg py-2 min-w-[120px] opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50">
                                            <button
                                                onClick={() => setSortBy('recent')}
                                                className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-white/[0.06] text-gray-900 dark:text-white rounded-lg"
                                            >
                                                Recent
                                            </button>
                                            <button
                                                onClick={() => setSortBy('price')}
                                                className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-white/[0.06] text-gray-900 dark:text-white rounded-lg"
                                            >
                                                Price
                                            </button>
                                            <button
                                                onClick={() => setSortBy('rarity')}
                                                className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-white/[0.06] text-gray-900 dark:text-white rounded-lg"
                                            >
                                                Rarity
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {isLoadingDashboard ? (
                                <div className="flex items-center justify-center py-20">
                                    <Loader2 className="w-8 h-8 animate-spin text-yc-aleo" />
                                    <span className="ml-3 text-lg font-bold text-gray-400">Loading marketplace...</span>
                                </div>
                            ) : (
                                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-1.5 md:gap-4">
                                    {filteredAndSortedListings.length > 0 ? (
                                        filteredAndSortedListings.map(({ listing, card }) => (
                                            <div
                                                key={`${listing.listingId}-${card.tokenId}`}
                                                className="bg-white/60 dark:bg-zinc-900/60 backdrop-blur-xl border border-white/40 dark:border-white/[0.08] rounded-2xl overflow-hidden hover:bg-white/70 dark:hover:bg-zinc-900/70 transition-all duration-300 group cursor-pointer shadow-[0_4px_16px_rgba(0,0,0,0.04),inset_0_1px_0_rgba(255,255,255,0.4)] dark:shadow-[0_4px_16px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.05)]"
                                                onClick={() => {
                                                    if (!card.isPack) {
                                                        setDashboardSelectedCard(card);
                                                        setDashboardSelectedStartup({
                                                            id: card.tokenId.toString(),
                                                            image: card.image,
                                                            name: card.name,
                                                            value: Number(ethers.formatEther(listing.price)),
                                                            rarity: card.rarity,
                                                            multiplier: `${card.multiplier}x`,
                                                            batch: `Edition ${card.edition}`,
                                                            stage: card.rarity
                                                        });
                                                    }
                                                }}
                                            >
                                                <div className="overflow-hidden" style={{ aspectRatio: '591/1004' }}>
                                                    {card.isPack ? (
                                                        <div className="relative w-full h-full bg-gradient-to-b from-yc-aleo/5 to-gray-50 dark:from-yc-aleo/[0.06] dark:to-[#0a0a0a]">
                                                            <ModelViewer3D mode="static" cameraZ={3} modelScale={0.8} />
                                                            <div className="absolute bottom-2 left-0 right-0 flex flex-col items-center pointer-events-none">
                                                                <span className="text-gray-700 dark:text-white/50 text-[10px] font-mono bg-white/60 dark:bg-black/40 px-2 py-0.5 rounded">#{card.tokenId}</span>
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <img src={card.image} alt={card.name} className="w-full h-full object-contain transition-transform duration-500 group-hover:scale-105" />
                                                    )}
                                                </div>
                                                <div className="p-1.5 md:p-3">
                                                    <p className="text-gray-900 dark:text-white font-bold text-[11px] md:text-sm leading-tight truncate">{card.name}</p>
                                                    <p className="text-yc-aleo font-bold text-[11px] md:text-base mt-0.5">{formatXTZ(listing.price)} {currencySymbol()}</p>
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            if (!isConnected) { alert('Please connect your wallet first'); return; }
                                                            if (listing.seller.toLowerCase() === address?.toLowerCase()) { alert("You can't buy your own listing"); return; }
                                                            setBuyingId(Number(listing.listingId));
                                                            buyCard(listing.listingId, listing.price)
                                                                .then(() => { alert('Purchase successful!'); window.location.reload(); })
                                                                .catch((err: any) => alert(`Error: ${err.message}`))
                                                                .finally(() => setBuyingId(null));
                                                        }}
                                                        disabled={buyingId === Number(listing.listingId)}
                                                        className="w-full mt-1.5 md:mt-2 px-2 py-1 md:px-4 md:py-2 rounded-xl font-bold text-[10px] md:text-sm bg-yc-aleo text-white border border-yc-aleo hover:bg-yc-aleo/80 transition-all active:scale-95 disabled:opacity-50"
                                                    >
                                                        {buyingId === Number(listing.listingId) ? 'Buying...' : 'Buy Now'}
                                                    </button>
                                                </div>
                                            </div>
                                        ))
                                    ) : (
                                        <div className="col-span-2 sm:col-span-3 lg:col-span-4 xl:col-span-5 text-center py-20">
                                            <p className="text-xl font-bold text-gray-400">
                                                {searchQuery ? `No NFTs found matching "${searchQuery}"` : 'No NFTs listed on marketplace'}
                                            </p>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                );
        }
    };

    return (
        <div className="bg-white dark:bg-[#050507] text-yc-text-primary dark:text-white font-sans selection:bg-white/20 selection:text-white">

            {/* Sidebar Navigation (desktop only) */}
            <Sidebar
                activeSection={activeSection}
                setActiveSection={handleSectionChange}
                user={user}
                onSettingsClick={() => isConnected && setIsProfileEditOpen(true)}
            />

            {/* Main Content Area */}
            <main className="w-full md:pl-72 xl:pr-64 min-h-screen pb-36 md:pb-6 overflow-x-hidden">
                <div className="w-full mx-auto p-4 md:p-6 max-w-full overflow-hidden">

                    {/* Top Bar (Mobile Only now) */}
                    <div className="flex md:hidden items-center justify-between mb-4 py-2">

                        <div className="relative flex-1 max-w-md flex items-center h-full">
                            {/* Spacer */}
                        </div>

                        <div className="flex items-center space-x-2 md:space-x-6 ml-2 md:ml-6">
                            {/* Mobile: Copy address button */}
                            {isConnected && address && (
                                <button
                                    onClick={() => {
                                        navigator.clipboard.writeText(address);
                                        setAddressCopied(true);
                                        setTimeout(() => setAddressCopied(false), 2000);
                                    }}
                                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-bold font-mono transition-all active:scale-95 ${addressCopied
                                        ? 'bg-green-500/10 text-green-500'
                                        : 'bg-white/60 dark:bg-zinc-900/60 backdrop-blur-2xl text-gray-500 dark:text-gray-400 shadow-[0_4px_16px_rgba(0,0,0,0.06),inset_0_1px_0_rgba(255,255,255,0.4)] dark:shadow-[0_4px_16px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.05)]'
                                        }`}
                                >
                                    {addressCopied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                                    {addressCopied ? 'Copied' : formatAddress(address)}
                                </button>
                            )}

                            {/* Mobile: Profile avatar button */}
                            <div className="relative md:hidden">
                                <button
                                    onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                                    className="w-9 h-9 rounded-full overflow-hidden border-2 border-gray-200 dark:border-gray-700 active:scale-95 transition-transform"
                                >
                                    {isConnected ? (
                                        <img
                                            src={user.avatar}
                                            alt="Profile"
                                            className="w-full h-full object-cover"
                                            style={{ imageRendering: user.avatar?.startsWith('data:') ? 'pixelated' : 'auto' }}
                                        />
                                    ) : (
                                        <div className="w-full h-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center">
                                            <User className="w-4 h-4 text-gray-400" />
                                        </div>
                                    )}
                                </button>

                                {/* Mobile dropdown */}
                                {isMobileMenuOpen && (
                                    <>
                                        <div className="fixed inset-0 z-40" onClick={() => setIsMobileMenuOpen(false)} />
                                        <div className="absolute right-0 top-12 z-50 w-64 bg-white/70 dark:bg-zinc-900/70 backdrop-blur-2xl rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.15),inset_0_1px_0_rgba(255,255,255,0.4)] dark:shadow-[0_8px_32px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.05)] p-4 space-y-3 border border-white/40 dark:border-white/[0.08]">

                                            {/* User info */}
                                            {isConnected && (
                                                <div
                                                    className="flex items-center gap-3 p-2 rounded-xl bg-white/40 dark:bg-white/[0.04] cursor-pointer active:scale-[0.98] transition-transform"
                                                    onClick={() => { setIsMobileMenuOpen(false); setIsProfileEditOpen(true); }}
                                                >
                                                    <div className="w-10 h-10 rounded-lg overflow-hidden shrink-0 border border-gray-200 dark:border-gray-700">
                                                        <img
                                                            src={user.avatar}
                                                            alt="Avatar"
                                                            className="w-full h-full object-cover"
                                                            style={{ imageRendering: user.avatar?.startsWith('data:') ? 'pixelated' : 'auto' }}
                                                        />
                                                    </div>
                                                    <div className="min-w-0">
                                                        <p className="text-sm font-bold text-gray-900 dark:text-white truncate">{user.name}</p>
                                                        <p className="text-[10px] text-gray-400 font-mono">{address ? formatAddress(address) : ''}</p>
                                                    </div>
                                                </div>
                                            )}

                                            {/* Balance */}
                                            {isConnected && (
                                                <div className="flex items-center justify-between p-2 rounded-xl bg-white/40 dark:bg-white/[0.04]">
                                                    <span className="text-xs font-bold text-gray-400">Balance</span>
                                                    {balanceLoading ? (
                                                        <div className="h-4 w-24 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
                                                    ) : (
                                                        <span className="text-sm font-black font-mono text-gray-900 dark:text-white">
                                                            <span className="text-yc-aleo mr-1">◈</span>
                                                            {Number(ethers.formatEther(balance)).toFixed(2)} {activeNetwork.nativeCurrency.symbol}
                                                        </span>
                                                    )}
                                                </div>
                                            )}

                                            {/* Connect / Switch */}
                                            {!isConnected ? (
                                                <div className="space-y-2">
                                                    <button
                                                        onClick={() => { setIsMobileMenuOpen(false); connect(); }}
                                                        disabled={isConnecting}
                                                        className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-yc-aleo text-white font-bold text-sm active:scale-95 transition-transform hover:bg-yc-aleo/80 disabled:opacity-60 disabled:cursor-wait"
                                                    >
                                                        {isConnecting ? (
                                                            <>
                                                                <Loader2 className="w-4 h-4 animate-spin" />
                                                                Reconnecting...
                                                            </>
                                                        ) : (
                                                            <>
                                                                <Wallet className="w-4 h-4" />
                                                                {hasSavedWallet ? 'Reconnect Wallet' : 'Connect Aleo Wallet'}
                                                            </>
                                                        )}
                                                    </button>
                                                </div>
                                            ) : !isCorrectChain ? (
                                                <button
                                                    onClick={() => { setIsMobileMenuOpen(false); switchChain(); }}
                                                    className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-yc-aleo text-white font-bold text-sm active:scale-95 transition-transform hover:bg-yc-aleo/80"
                                                >
                                                    <Wallet className="w-4 h-4" />
                                                    Switch Network
                                                </button>
                                            ) : null}

                                            {/* Network toggle */}
                                            <div className="flex items-center justify-between p-2">
                                                <span className="text-xs font-bold text-gray-400 uppercase">Network</span>
                                                <div className="flex bg-gray-200 dark:bg-white/[0.04] rounded-full p-0.5 gap-0.5 border border-transparent dark:border-white/[0.06]">
                                                    {allNetworks.map((net) => (
                                                        <button
                                                            key={net.id}
                                                            onClick={() => { setIsMobileMenuOpen(false); handleNetworkSwitch(net.id); }}
                                                            className={`flex items-center gap-1 px-2 py-1.5 rounded-full text-xs font-bold transition-all ${networkId === net.id
                                                                ? 'bg-gray-100 dark:bg-white/[0.1] text-black dark:text-white shadow-sm'
                                                                : 'text-gray-400 dark:text-gray-500'
                                                                }`}
                                                        >
                                                            <span>{net.shortName}</span>
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>

                                            {/* Theme toggle */}
                                            <div className="flex items-center justify-between p-2">
                                                <span className="text-xs font-bold text-gray-400 uppercase">Theme</span>
                                                <div className="flex bg-gray-200 dark:bg-white/[0.04] rounded-full p-0.5 border border-transparent dark:border-white/[0.06]">
                                                    <button
                                                        onClick={() => theme === 'dark' && toggleTheme()}
                                                        className={`p-1.5 rounded-full transition-all ${theme === 'light' ? 'bg-white shadow text-gray-700' : 'text-gray-500'}`}
                                                    >
                                                        <Sun size={14} />
                                                    </button>
                                                    <button
                                                        onClick={() => theme === 'light' && toggleTheme()}
                                                        className={`p-1.5 rounded-full transition-all ${theme === 'dark' ? 'bg-white/10 text-white' : 'text-gray-400'}`}
                                                    >
                                                        <Moon size={14} />
                                                    </button>
                                                </div>
                                            </div>

                                            {/* Disconnect */}
                                            {isConnected && (
                                                <button
                                                    onClick={() => { setIsMobileMenuOpen(false); disconnect(); }}
                                                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-red-500/10 text-red-500 font-bold text-sm active:scale-95 transition-transform"
                                                >
                                                    <LogOut size={14} />
                                                    Disconnect
                                                </button>
                                            )}
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Dynamic Content */}
                    {renderContent()}

                </div>
            </main>

            {/* Right Widget Panel */}
            <RightPanel onOpenPack={() => setIsPackModalOpen(true)} />

            {/* Pack Opening Modal */}
            <PackOpeningModal
                isOpen={isPackModalOpen}
                initialPackId={openPackId}
                initialPackIds={openPackIds}
                onClose={() => { setIsPackModalOpen(false); setOpenPackId(null); setOpenPackIds(null); }}
                onPacksBought={() => setPackRefreshSignal(p => p + 1)}
                onCardsAcquired={(cards) => {
                    if (address) {
                        updateServerCache(address, cards);
                    }
                }}
            />

            {/* Card Details Modal */}
            <CardDetailModal
                data={dashboardSelectedStartup}
                cardData={dashboardSelectedCard}
                onClose={() => {
                    setDashboardSelectedStartup(null);
                    setDashboardSelectedCard(null);
                }}
            />

            {/* Profile Setup Modal - shown on first wallet connection */}
            <ProfileSetupModal
                isOpen={isConnected && needsRegistration}
                address={address || ''}
                onComplete={registerUser}
            />

            {/* Profile Edit Modal - shown when clicking gear icon */}
            <ProfileEditModal
                isOpen={isProfileEditOpen}
                onClose={() => setIsProfileEditOpen(false)}
                address={address || ''}
                currentUsername={profile?.username || ''}
                currentAvatar={profile?.avatar || null}
                onSave={updateProfile}
                onDisconnect={disconnect}
            />

            {/* Bottom Navigation (mobile only) — hidden when fullscreen modals are open */}
            {!isPackModalOpen && <BottomNav activeSection={activeSection} onNavigate={handleSectionChange} />}

        </div>
    );
};

// No key={networkId} — data is shared across networks, components stay alive
// Network-specific UI (pack visual, price, currency) re-renders via useNetwork context

// Singleton QueryClient for wagmi/react-query
const queryClient = new QueryClient();

// Main App with providers + splash screen
const App: React.FC = () => {
    const [showSplash, setShowSplash] = useState(true);

    const handleSplashReady = useCallback(() => {
        setShowSplash(false);
    }, []);

    return (
        <QueryClientProvider client={queryClient}>
            <AleoWalletProvider
                wallets={ALEO_WALLETS}
                network={Network.TESTNET}
                decryptPermission={DecryptPermission.AutoDecrypt}
                programs={['unicornx_v2.aleo', 'credits.aleo']}
                autoConnect
                onError={(error) => console.error('[UnicornX] Wallet error:', error.message)}
            >
                <WalletModalProvider>
                    <ThemeProvider>
                        <ErrorBoundary>
                            <NetworkProvider>
                                <WalletProvider>
                                    {showSplash && <SplashScreen onReady={handleSplashReady} />}
                                    <AppContent />
                                </WalletProvider>
                            </NetworkProvider>
                        </ErrorBoundary>
                    </ThemeProvider>
                </WalletModalProvider>
            </AleoWalletProvider>
        </QueryClientProvider>
    );
};

export default App;