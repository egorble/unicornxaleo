import React, { useState, useEffect, useRef, useLayoutEffect } from 'react';
import { CardData, sortByRarity } from '../types';
import { Layers, Package, Minus, Plus, ChevronDown, BoxSelect, ChevronRight } from 'lucide-react';
import { usePacks } from '../hooks/usePacks';
import { useWalletContext } from '../context/WalletContext';
import { formatXTZ, getPackNFTContract } from '../lib/contracts';
import { currencySymbol, getActiveNetwork } from '../lib/networks';
import ModelViewer3D from './ModelViewer3D';
import gsap from 'gsap';

/** Parse raw blockchain/wallet errors into short, user-friendly messages */
function friendlyError(msg: string, rawError?: string): { friendly: string; raw: string } {
    const l = msg.toLowerCase();
    let friendly: string;
    if (l.includes('insufficient funds') || l.includes('have 0 want'))
        friendly = 'Not enough ALEO in your wallet. Top up and try again.';
    else if (l.includes('user rejected') || l.includes('user denied') || l.includes('rejected the request'))
        friendly = 'Transaction cancelled.';
    else if (l.includes('gas limit too high') || l.includes('exceeds block gas'))
        friendly = 'Transaction too large. Try buying fewer packs.';
    else if (l.includes('nonce'))
        friendly = 'Transaction conflict. Please wait a moment and try again.';
    else if (l.includes('timeout') || l.includes('timed out'))
        friendly = 'Network timeout. Check your connection and try again.';
    else if (l.includes('network') || l.includes('disconnected'))
        friendly = 'Network error. Check your connection.';
    else if (l.includes('unpredictable gas'))
        friendly = 'Transaction would fail. Check your balance or try again later.';
    else {
        const first = msg.split('\n')[0].slice(0, 120);
        friendly = first.length < msg.length ? first + '...' : first;
    }
    return { friendly, raw: rawError || msg };
}

/** Expandable error block */
function ErrorBlock({ error }: { error: { friendly: string; raw: string } }) {
    const [expanded, setExpanded] = useState(false);
    const showToggle = error.raw !== error.friendly && error.raw.length > 0;
    return (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-2.5 max-w-xs text-center mb-3 shrink-0">
            <p className="text-red-400 text-xs font-medium">{error.friendly}</p>
            {showToggle && (
                <>
                    <button
                        onClick={() => setExpanded(!expanded)}
                        className="flex items-center justify-center gap-1 mx-auto mt-1.5 text-red-400/60 hover:text-red-400 text-[10px] transition-colors"
                    >
                        <ChevronRight className={`w-3 h-3 transition-transform ${expanded ? 'rotate-90' : ''}`} />
                        {expanded ? 'Hide details' : 'Show details'}
                    </button>
                    {expanded && (
                        <p className="mt-2 text-red-400/70 text-[10px] font-mono break-all text-left max-h-32 overflow-y-auto leading-relaxed">
                            {error.raw}
                        </p>
                    )}
                </>
            )}
        </div>
    );
}

interface PackOpeningModalProps {
    isOpen: boolean;
    onClose: () => void;
    onCardsAcquired?: (cards: CardData[]) => void;
    /** Called after pack(s) are successfully purchased — before opening */
    onPacksBought?: (packIds: number[]) => void;
    /** If provided, skip to 'bought' stage with this pack ready to open */
    initialPackId?: number | null;
    /** If provided, skip to 'bought' stage with these packs ready for batch open */
    initialPackIds?: number[] | null;
}

// Stages: select → buying → bought → opening → exploding → dealing → finished
type Stage = 'select' | 'buying' | 'bought' | 'opening' | 'exploding' | 'dealing' | 'finished';

const PackOpeningModal: React.FC<PackOpeningModalProps> = ({ isOpen, onClose, onCardsAcquired, onPacksBought, initialPackId, initialPackIds }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const flashRef = useRef<HTMLDivElement>(null);
    const cardsContainerRef = useRef<HTMLDivElement>(null);
    const cardRefs = useRef<(HTMLDivElement | null)[]>([]);
    const ctx = useRef<gsap.Context | null>(null);

    const [stage, setStage] = useState<Stage>('select');
    const [packCount, setPackCount] = useState(1);
    const [cardsDealtCount, setCardsDealtCount] = useState(0);
    const [mintedCards, setMintedCards] = useState<CardData[]>([]);
    const packPrice = getActiveNetwork().packPrice;
    const [txError, setTxError] = useState<{ friendly: string; raw: string } | null>(null);
    const [pendingCards, setPendingCards] = useState<CardData[] | null>(null);

    // Two-step state
    const [ownedPacks, setOwnedPacks] = useState<number[]>([]);
    const [boughtPackIds, setBoughtPackIds] = useState<number[]>([]);
    const [selectedPackId, setSelectedPackId] = useState<number | null>(null);
    /** Packs selected for batch opening */
    const [batchSelection, setBatchSelection] = useState<number[]>([]);
    /** Total packs in current batch open */
    const [batchTotal, setBatchTotal] = useState(0);

    const isMultiPack = packCount > 1 || batchTotal > 1;

    // Hooks
    const { isConnected, getSigner, connect, isCorrectChain, switchChain, refreshBalance, address } = useWalletContext();
    const { buyPack, openPack, batchOpenPacks, getUserPacks, isLoading, statusMessage: packStatus } = usePacks();

    // Fetch user's owned packs when modal opens
    useEffect(() => {
        if (isOpen && address) {
            getUserPacks(address).then(packs => {
                setOwnedPacks(packs);
            });
        }
    }, [isOpen, address, getUserPacks]);

    // If initialPackId is provided, skip directly to opening (useLayoutEffect prevents flicker)
    const autoOpenRef = useRef(false);

    useLayoutEffect(() => {
        if (isOpen && initialPackId != null) {
            setSelectedPackId(initialPackId);
            setBoughtPackIds([initialPackId]);
            setStage('opening');
        } else if (isOpen && initialPackIds && initialPackIds.length > 0) {
            setBoughtPackIds([]);
            setStage('opening');
        }
    }, [isOpen, initialPackId, initialPackIds]);

    // Auto-trigger pack open when coming from portfolio
    useEffect(() => {
        if (!isOpen || autoOpenRef.current) return;
        if (initialPackId != null && stage === 'opening') {
            autoOpenRef.current = true;
            handleOpenPack(initialPackId);
        } else if (initialPackIds && initialPackIds.length > 0 && stage === 'opening') {
            autoOpenRef.current = true;
            handleBatchOpen(initialPackIds);
        }
    }, [isOpen, initialPackId, initialPackIds, stage]);

    // Initialize GSAP Context
    useLayoutEffect(() => {
        if (isOpen && stage !== 'select' && stage !== 'bought') {
            ctx.current = gsap.context(() => { }, containerRef);
        }
        return () => {
            ctx.current?.revert();
        };
    }, [isOpen, stage]);

    // Reset on close
    useEffect(() => {
        if (!isOpen) {
            ctx.current?.revert();
            setStage('select');
            setPackCount(1);
            setCardsDealtCount(0);
            setMintedCards([]);
            setPendingCards(null);
            setBoughtPackIds([]);
            setSelectedPackId(null);
            setBatchSelection([]);
            setBatchTotal(0);
            cardRefs.current = [];
            setTxError(null);
            autoOpenRef.current = false;
        }
    }, [isOpen]);

    // Handle "Dealing" Logic (single pack only)
    useLayoutEffect(() => {
        if (stage === 'dealing' && !isMultiPack && ctx.current) {
            ctx.current.add(() => {
                setTimeout(() => prepareStack(), 100);
            });
        }
    }, [stage]);

    // Clean up GSAP when entering finished stage
    useLayoutEffect(() => {
        if (stage === 'finished') {
            cardRefs.current.forEach(card => {
                if (card) {
                    gsap.killTweensOf(card);
                    gsap.set(card, { clearProps: 'all' });
                    const inner = card.querySelector('.card-inner');
                    if (inner) {
                        gsap.killTweensOf(inner);
                        gsap.set(inner, { clearProps: 'all' });
                    }
                }
            });
            cardRefs.current = [];
        }
    }, [stage]);

    // When pendingCards is set during opening, transition
    useLayoutEffect(() => {
        if (pendingCards && stage === 'opening') {
            setMintedCards(sortByRarity(pendingCards));
            setPendingCards(null);
            setStage('exploding');
        }
    }, [pendingCards, stage]);

    // Exploding stage animation — burst effect
    useLayoutEffect(() => {
        if (stage !== 'exploding' || !ctx.current) return;

        ctx.current.add(() => {
            const tl = gsap.timeline({
                onComplete: () => setStage(isMultiPack ? 'finished' : 'dealing'),
            });
            if (flashRef.current) {
                tl.to(flashRef.current, { opacity: 1, duration: 0.2, ease: 'power4.in' })
                    .to(flashRef.current, { opacity: 0, duration: 0.7, ease: 'power2.out' });
            } else {
                setStage(isMultiPack ? 'finished' : 'dealing');
            }
        });
    }, [stage]);

    // Step 1: Buy pack(s)
    const handleBuyPacks = async () => {
        if (stage !== 'select') return;

        if (!isConnected) { await connect(); return; }
        if (!isCorrectChain) { await switchChain(); return; }

        setStage('buying');
        setTxError(null);

        try {
            const signer = await getSigner();
            if (!signer) { setTxError({ friendly: 'Failed to get signer', raw: '' }); setStage('select'); return; }

            const result = await buyPack(signer, packCount);

            if (result.success && result.packTokenIds) {
                setBoughtPackIds(result.packTokenIds);
                setSelectedPackId(result.packTokenIds[0]);
                refreshBalance();
                onPacksBought?.(result.packTokenIds);
                setStage('bought');
            } else {
                setTxError(friendlyError(result.error || 'Failed to buy pack', result.rawError));
                setStage('select');
            }
        } catch (e: any) {
            setTxError(friendlyError(e.message || 'Something went wrong', e.stack || e.message));
            setStage('select');
        }
    };

    // Step 2: Open a pack
    const handleOpenPack = async (packTokenId: number) => {
        if (!isConnected) { await connect(); return; }
        if (!isCorrectChain) { await switchChain(); return; }

        setStage('opening');
        setTxError(null);

        // If auto-opening from portfolio, errors stay on 'opening' (with retry UI)
        const errorStage: Stage = initialPackId != null ? 'opening' : 'bought';

        try {
            const signer = await getSigner();
            if (!signer) { setTxError({ friendly: 'Failed to get signer', raw: '' }); setStage(errorStage); return; }

            const result = await openPack(signer, packTokenId);

            if (result.success && result.cards) {
                setPendingCards(result.cards);
                onCardsAcquired?.(result.cards);
                refreshBalance();
            } else {
                // Re-add pack on failure
                setBoughtPackIds(prev => prev.includes(packTokenId) ? prev : [...prev, packTokenId]);
                setOwnedPacks(prev => prev.includes(packTokenId) ? prev : [...prev, packTokenId]);
                setTxError(friendlyError(result.error || 'Failed to open pack', result.rawError));
                setStage(errorStage);
            }
        } catch (e: any) {
            // Re-add pack on failure
            setBoughtPackIds(prev => prev.includes(packTokenId) ? prev : [...prev, packTokenId]);
            setOwnedPacks(prev => prev.includes(packTokenId) ? prev : [...prev, packTokenId]);
            setTxError(friendlyError(e.message || 'Something went wrong', e.stack || e.message));
            setStage(errorStage);
        }
    };

    // Open an existing pack from inventory
    const handleOpenExistingPack = async (packTokenId: number) => {
        setSelectedPackId(packTokenId);
        await handleOpenPack(packTokenId);
    };

    // Batch open: single pack uses openPack, multiple uses batchOpenPacks
    const handleBatchOpen = async (packIds: number[]) => {
        if (packIds.length === 0) return;
        if (!isConnected) { await connect(); return; }
        if (!isCorrectChain) { await switchChain(); return; }

        const fromPortfolio = !!(initialPackIds && initialPackIds.length > 0);
        const errorStage: Stage = fromPortfolio ? 'opening' : 'bought';

        setMintedCards([]);
        setStage('opening');
        setTxError(null);

        try {
            const signer = await getSigner();
            if (!signer) { setTxError({ friendly: 'Failed to get signer', raw: '' }); setStage(errorStage); return; }

            // Verify packs still exist on-chain (cache may be stale)
            const packNft = getPackNFTContract();
            const signerAddress = await signer.getAddress();
            const validIds: number[] = [];
            await Promise.all(packIds.map(async (id) => {
                try {
                    const owner = await packNft.ownerOf(id);
                    if (owner.toLowerCase() === signerAddress.toLowerCase()) {
                        validIds.push(id);
                    }
                } catch { /* pack burned / doesn't exist */ }
            }));

            if (validIds.length === 0) {
                setTxError({ friendly: 'These packs have already been opened. Refresh your portfolio.', raw: '' });
                setStage(errorStage);
                return;
            }

            setBatchTotal(validIds.length);

            // Remove packs from lists immediately (re-add on failure)
            setBoughtPackIds(prev => prev.filter(id => !validIds.includes(id)));
            setOwnedPacks(prev => prev.filter(id => !validIds.includes(id)));

            let result: { success: boolean; cards?: CardData[]; error?: string; rawError?: string };

            if (validIds.length === 1) {
                result = await openPack(signer, validIds[0]);
            } else {
                result = await batchOpenPacks(signer, validIds);
            }

            if (result.success && result.cards && result.cards.length > 0) {
                onCardsAcquired?.(result.cards);
                refreshBalance();
                setBatchSelection([]);
                setMintedCards(sortByRarity(result.cards));
                setStage('exploding');
            } else {
                setBoughtPackIds(prev => [...prev, ...validIds.filter(id => !prev.includes(id))]);
                setOwnedPacks(prev => [...prev, ...validIds.filter(id => !prev.includes(id))]);
                const err = friendlyError(result.error || 'Failed to open packs', result.rawError);
                if (validIds.length > 2) err.friendly += ' Try opening fewer packs at a time.';
                setTxError(err);
                setBatchSelection([]);
                setStage(errorStage);
            }
        } catch (e: any) {
            setBoughtPackIds(prev => [...prev, ...packIds.filter(id => !prev.includes(id))]);
            setOwnedPacks(prev => [...prev, ...packIds.filter(id => !prev.includes(id))]);
            const err = friendlyError(e.message || 'Something went wrong', e.stack || e.message);
            if (packIds.length > 2) err.friendly += ' Try opening fewer packs at a time.';
            setTxError(err);
            setBatchSelection([]);
            setStage(errorStage);
        }
    };

    const prepareStack = () => {
        const cards = cardRefs.current;
        if (!cards || cards.length === 0) return;
        const stackX = window.innerWidth / 2;
        const isMobile = window.innerWidth < 640;
        const stackY = window.innerHeight - (isMobile ? 100 : 150);

        cards.forEach((card, i) => {
            if (!card) return;
            const rect = card.getBoundingClientRect();
            const cardCenterX = rect.width ? rect.left + rect.width / 2 : stackX;
            const cardCenterY = rect.height ? rect.top + rect.height / 2 : stackY;
            gsap.set(card, {
                x: stackX - cardCenterX, y: stackY - cardCenterY, z: 0,
                zIndex: 50 - i, rotation: (Math.random() - 0.5) * 10, scale: 0.8, autoAlpha: 1
            });
            const inner = card.querySelector('.card-inner');
            if (inner) gsap.set(inner, { rotationY: 180 });
        });
    };

    const dealNextCard = () => {
        if (cardsDealtCount >= mintedCards.length) return;
        const card = cardRefs.current[cardsDealtCount];
        if (card && ctx.current) {
            ctx.current.add(() => {
                gsap.to(card, {
                    x: 0, y: 0, rotation: 0, scale: 1, zIndex: 100,
                    duration: 0.5, ease: "back.out(1.2)",
                    onComplete: () => gsap.set(card, { zIndex: 1 })
                });
                const inner = card.querySelector('.card-inner');
                if (inner) gsap.to(inner, { rotationY: 0, duration: 0.4, delay: 0.1, ease: "power2.out" });
            });
        }
        const nextCount = cardsDealtCount + 1;
        setCardsDealtCount(nextCount);
        if (nextCount === mintedCards.length) setTimeout(() => setStage('finished'), 800);
    };

    const totalPrice = packPrice * BigInt(packCount);

    return (
        <div ref={containerRef} className={`fixed inset-0 z-50 flex items-center justify-center bg-black/95 backdrop-blur-md overflow-hidden ${isOpen ? '' : 'invisible pointer-events-none'}`}>
            {/* Flash Overlay */}
            <div ref={flashRef} className="absolute inset-0 bg-white pointer-events-none opacity-0 z-[60]" />

            {/* --- STAGE: PACK SELECTION --- */}
            {stage === 'select' && (
                <div className="flex flex-col items-center w-full h-full px-4 py-4 sm:py-0 sm:justify-center">
                    {/* 3D pack — takes upper space */}
                    <div className="relative w-full flex-1 min-h-0 max-h-[55%] shrink mb-2">
                        <ModelViewer3D mode="interactive" cameraZ={4.5} modelScale={1} paused={!isOpen} />
                        {packCount > 1 && (
                            <div className="absolute top-2 right-2 w-9 h-9 bg-yc-aleo rounded-full flex items-center justify-center text-white font-black text-base shadow-lg shadow-lime-500/30 z-10">
                                {packCount}x
                            </div>
                        )}
                    </div>

                    {/* Owned packs indicator */}
                    {ownedPacks.length > 0 && (
                        <div className="mb-3 shrink-0">
                            <button
                                onClick={() => {
                                    setBoughtPackIds(ownedPacks);
                                    setSelectedPackId(ownedPacks[0]);
                                    setStage('bought');
                                }}
                                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition-colors text-sm"
                            >
                                <BoxSelect className="w-4 h-4 text-yc-aleo" />
                                <span className="text-white font-medium">You have {ownedPacks.length} unopened pack{ownedPacks.length > 1 ? 's' : ''}</span>
                                <span className="text-yc-aleo font-bold">Open →</span>
                            </button>
                        </div>
                    )}

                    {/* Pack count selector */}
                    <div className="flex items-center gap-3 sm:gap-4 mb-3 shrink-0">
                        <button
                            onClick={() => setPackCount(Math.max(1, packCount - 1))}
                            className="w-9 h-9 sm:w-10 sm:h-10 rounded-lg bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors active:scale-90"
                        >
                            <Minus className="w-4 h-4 sm:w-5 sm:h-5" />
                        </button>
                        <div className="text-center min-w-[80px] sm:min-w-[100px]">
                            <p className="text-2xl sm:text-3xl font-black text-white">{packCount}</p>
                            <p className="text-gray-500 text-[10px] sm:text-xs uppercase tracking-wider">{packCount === 1 ? 'Pack' : 'Packs'}</p>
                        </div>
                        <button
                            onClick={() => setPackCount(Math.min(5, packCount + 1))}
                            className="w-9 h-9 sm:w-10 sm:h-10 rounded-lg bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors active:scale-90"
                        >
                            <Plus className="w-4 h-4 sm:w-5 sm:h-5" />
                        </button>
                    </div>

                    {/* Price */}
                    <div className="text-center mb-3 shrink-0">
                        <p className="text-yc-aleo font-mono font-bold text-xl sm:text-2xl">{formatXTZ(totalPrice)} {currencySymbol()}</p>
                        {packCount > 1 && (
                            <p className="text-gray-500 text-xs mt-1">{formatXTZ(packPrice)} per pack</p>
                        )}
                    </div>

                    {/* Error */}
                    {txError && <ErrorBlock error={txError} />}

                    {/* Buy button */}
                    <button
                        onClick={handleBuyPacks}
                        className="bg-yc-aleo hover:bg-orange-600 text-white px-8 sm:px-10 py-3 sm:py-3.5 rounded-xl font-black text-sm sm:text-base uppercase tracking-wider transition-all shadow-lg shadow-lime-500/20 active:scale-95 mb-3 shrink-0"
                    >
                        <Package className="w-4 h-4 sm:w-5 sm:h-5 inline-block mr-2 -mt-0.5" />
                        {packCount === 1 ? 'Buy Pack' : `Buy ${packCount} Packs`}
                    </button>

                    <button onClick={onClose} className="text-gray-500 hover:text-white text-sm font-medium transition-colors shrink-0">
                        Cancel
                    </button>
                </div>
            )}

            {/* --- STAGE: BUYING (waiting for buy tx) --- */}
            {stage === 'buying' && (
                <div key="stage-buying" className="flex flex-col items-center justify-center w-full h-full relative">
                    <div className="w-24 h-24 mb-8 border-4 border-yc-aleo/30 border-t-yc-aleo rounded-full animate-spin" />
                    <h2 className="text-2xl font-bold text-white mb-2">
                        {packStatus || 'Confirm in Wallet'}
                    </h2>
                    <p className="text-gray-400 text-sm mb-4">
                        {packCount === 1
                            ? 'Buying 1 pack NFT'
                            : `Buying ${packCount} pack NFTs`
                        }
                    </p>
                    <div className="text-yc-aleo font-mono font-bold text-lg mb-6">{formatXTZ(totalPrice)} {currencySymbol()}</div>
                    <button onClick={() => { setStage('select'); }} className="text-gray-500 hover:text-white text-sm font-medium transition-colors">Cancel</button>
                </div>
            )}

            {/* --- STAGE: BOUGHT (pack NFTs minted, choose to open) --- */}
            {stage === 'bought' && (
                <div key="stage-bought" className="flex flex-col items-center w-full h-full px-4 py-4 sm:py-0 sm:justify-center">
                    {boughtPackIds.length === 1 ? (
                        /* Single pack — 3D model + Open */
                        <>
                            <div className="relative w-full flex-1 min-h-0 max-h-[50%] shrink mb-4">
                                <ModelViewer3D mode="interactive" cameraZ={4.5} modelScale={1} paused={!isOpen} />
                            </div>
                            <div className="text-center mb-4 shrink-0">
                                <h2 className="text-2xl sm:text-3xl font-black text-white mb-2">Pack Acquired!</h2>
                                <p className="text-gray-400 text-sm">Open to reveal 5 cards.</p>
                            </div>
                        </>
                    ) : (
                        /* Multiple packs — select which to open */
                        <>
                            <div className="text-center mb-4 mt-8 shrink-0">
                                <h2 className="text-2xl sm:text-3xl font-black text-white mb-2">
                                    {boughtPackIds.length} Packs
                                </h2>
                                <p className="text-gray-400 text-sm">
                                    {batchSelection.length === 0
                                        ? 'Select packs to open'
                                        : `${batchSelection.length} selected`}
                                </p>
                            </div>
                            <div className="flex flex-wrap justify-center gap-3 sm:gap-4 mb-4 max-w-lg shrink-0">
                                {boughtPackIds.map((packId, i) => {
                                    const isSelected = batchSelection.includes(packId);
                                    return (
                                        <button
                                            key={packId}
                                            onClick={() => setBatchSelection(prev =>
                                                isSelected ? prev.filter(id => id !== packId) : [...prev, packId]
                                            )}
                                            className={`relative w-20 h-28 sm:w-24 sm:h-32 rounded-2xl flex flex-col items-center justify-center gap-1.5 active:scale-95 transition-all ${
                                                isSelected
                                                    ? 'bg-yc-aleo/20 border-2 border-yc-aleo shadow-[0_0_16px_rgba(249, 115, 22,0.3)]'
                                                    : 'bg-zinc-800/80 border border-white/10 hover:border-white/30'
                                            }`}
                                            style={{ animation: `fadeInUp 0.3s ease-out ${i * 60}ms both` }}
                                        >
                                            {isSelected && (
                                                <div className="absolute top-1.5 right-1.5 w-5 h-5 bg-yc-aleo rounded-full flex items-center justify-center">
                                                    <span className="text-white text-[10px] font-black">{batchSelection.indexOf(packId) + 1}</span>
                                                </div>
                                            )}
                                            <Package className={`w-8 h-8 sm:w-10 sm:h-10 ${isSelected ? 'text-yc-aleo' : 'text-gray-500'}`} />
                                            <span className="text-[9px] text-gray-400 font-mono">#{packId}</span>
                                        </button>
                                    );
                                })}
                            </div>
                            {/* Select all / deselect all */}
                            <button
                                onClick={() => setBatchSelection(prev =>
                                    prev.length === boughtPackIds.length ? [] : [...boughtPackIds]
                                )}
                                className="text-gray-400 hover:text-white text-xs font-bold mb-4 transition-colors shrink-0"
                            >
                                {batchSelection.length === boughtPackIds.length ? 'Deselect All' : 'Select All'}
                            </button>
                        </>
                    )}

                    {/* Error */}
                    {txError && <ErrorBlock error={txError} />}

                    {/* Single pack: Open button */}
                    {boughtPackIds.length === 1 && (
                        <button
                            onClick={() => {
                                const packId = boughtPackIds[0];
                                setSelectedPackId(packId);
                                setBoughtPackIds([]);
                                setOwnedPacks(prev => prev.filter(id => id !== packId));
                                handleOpenPack(packId);
                            }}
                            className="bg-yc-aleo hover:bg-orange-600 text-white px-8 sm:px-10 py-3 sm:py-3.5 rounded-xl font-black text-sm sm:text-base uppercase tracking-wider transition-all shadow-lg shadow-lime-500/20 active:scale-95 mb-3 shrink-0"
                        >
                            <Package className="w-4 h-4 sm:w-5 sm:h-5 inline-block mr-2 -mt-0.5" />
                            Open Pack
                        </button>
                    )}

                    {/* Multi-pack: Open selected */}
                    {boughtPackIds.length > 1 && (
                        <button
                            onClick={() => handleBatchOpen(batchSelection)}
                            disabled={batchSelection.length === 0 || isLoading}
                            className="bg-yc-aleo hover:bg-orange-600 text-white px-8 sm:px-10 py-3 sm:py-3.5 rounded-xl font-black text-sm sm:text-base uppercase tracking-wider transition-all shadow-lg shadow-lime-500/20 active:scale-95 mb-3 shrink-0 disabled:opacity-40"
                        >
                            <Package className="w-4 h-4 sm:w-5 sm:h-5 inline-block mr-2 -mt-0.5" />
                            Open {batchSelection.length} Pack{batchSelection.length !== 1 ? 's' : ''}
                        </button>
                    )}

                    <button onClick={onClose} className="text-gray-500 hover:text-white text-sm font-medium transition-colors shrink-0">
                        Open Later
                    </button>
                </div>
            )}

            {/* --- STAGE: OPENING (waiting for open tx) --- */}
            {stage === 'opening' && (
                <div key="stage-opening" className="flex flex-col items-center w-full h-full px-4 py-4 sm:py-0 sm:justify-center">
                    <div className="relative w-full flex-1 min-h-0 max-h-[50%] shrink mb-6">
                        <ModelViewer3D mode="gentle" cameraZ={4.5} modelScale={1} paused={!isOpen} />
                    </div>

                    {!txError ? (
                        <div className="flex flex-col items-center shrink-0">
                            <div className="w-10 h-10 mb-4 border-[3px] border-yc-aleo/30 border-t-yc-aleo rounded-full animate-spin" />
                            <h2 className="text-xl sm:text-2xl font-bold text-white mb-2">
                                {packStatus || (batchTotal > 1 ? `Opening ${batchTotal} Packs...` : 'Opening Pack...')}
                            </h2>
                            <p className="text-gray-500 text-sm mb-4">
                                {packStatus
                                    ? 'Processing on Aleo blockchain...'
                                    : `Confirm in wallet to reveal ${batchTotal > 1 ? `${batchTotal * 5} cards` : '5 cards'}`
                                }
                            </p>
                            <button
                                onClick={() => (initialPackId != null || (initialPackIds && initialPackIds.length > 0)) ? onClose() : setStage('bought')}
                                className="text-gray-500 hover:text-white text-sm font-medium transition-colors"
                            >
                                Cancel
                            </button>
                        </div>
                    ) : (
                        <div className="flex flex-col items-center shrink-0">
                            <ErrorBlock error={txError!} />
                            <div className="flex gap-3">
                                <button
                                    onClick={() => {
                                        setTxError(null);
                                        autoOpenRef.current = false;
                                        if (initialPackIds && initialPackIds.length > 0) {
                                            handleBatchOpen(initialPackIds);
                                        } else {
                                            handleOpenPack(selectedPackId || initialPackId!);
                                        }
                                    }}
                                    className="px-6 py-2.5 bg-yc-aleo hover:bg-orange-600 text-white rounded-xl font-bold text-sm transition-all"
                                >
                                    Retry
                                </button>
                                <button onClick={onClose} className="px-6 py-2.5 text-gray-500 hover:text-white text-sm font-medium transition-colors">
                                    Cancel
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* --- STAGE: BURST EFFECT (flash overlay handles visual, this is just a placeholder) --- */}
            {stage === 'exploding' && (
                <div key="stage-exploding" className="flex items-center justify-center w-full h-full" />
            )}

            {/* --- STAGE: DEALING (single pack - tap to reveal) --- */}
            {stage === 'dealing' && !isMultiPack && (
                <div key="stage-dealing" className="w-full h-full flex flex-col items-center relative z-40 pt-10 sm:pt-20">
                    <div ref={cardsContainerRef} className="flex flex-wrap justify-center gap-3 sm:gap-4 md:gap-8 perspective-1000 w-full max-w-6xl px-4 mt-4 sm:mt-10">
                        {mintedCards.map((card, index) => (
                            <div
                                key={card.tokenId}
                                ref={(el) => { cardRefs.current[index] = el }}
                                className="relative w-36 h-52 sm:w-48 sm:h-72 md:w-56 md:h-80 group cursor-pointer opacity-0"
                            >
                                <div className="card-inner w-full h-full relative transform-style-3d">
                                    <div className="absolute inset-0 backface-hidden rounded-xl overflow-hidden shadow-2xl">
                                        <img src={card.image} className="w-full h-full object-contain" loading="eager" />
                                    </div>
                                    <div className="absolute inset-0 backface-hidden rotate-y-180 rounded-xl bg-[#0a0a0a] border border-gray-800 overflow-hidden shadow-2xl flex items-center justify-center">
                                        <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')] opacity-20" />
                                        <div className="w-full h-full border-4 border-[#1a1a1a] m-1 rounded-lg flex items-center justify-center">
                                            <div className="text-center">
                                                <div className="w-12 h-12 bg-yc-aleo rounded flex items-center justify-center mx-auto mb-2 shadow-[0_0_15px_#F97316]">
                                                    <span className="text-white font-black text-xl">Y</span>
                                                </div>
                                                <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">UNICORNX</p>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>

                    <div
                        className="fixed bottom-0 left-0 w-full h-[25vh] sm:h-[40vh] z-50 flex items-end justify-center pb-8 sm:pb-12 cursor-pointer touch-manipulation group"
                        onClick={dealNextCard}
                    >
                        <div className="flex flex-col items-center animate-pulse group-active:scale-95 transition-transform">
                            <p className="text-white/50 text-sm font-bold uppercase tracking-widest mb-2">Tap to Reveal</p>
                            <Layers className="text-yc-aleo opacity-80 w-8 h-8" />
                        </div>
                    </div>
                </div>
            )}

            {/* --- STAGE: FINISHED --- */}
            {stage === 'finished' && (
                <div key="stage-finished" className="w-full h-full flex flex-col relative z-40">
                    {/* Header */}
                    <div className="flex-shrink-0 pt-4 sm:pt-8 pb-2 sm:pb-4 text-center">
                        <h2 className="text-2xl sm:text-3xl md:text-4xl font-black text-white uppercase tracking-tighter animate-[fadeInUp_0.5s_ease-out]">
                            {isMultiPack ? `${batchTotal || packCount} Packs Opened!` : 'Pack Opened!'}
                        </h2>
                        <p className="text-gray-400 text-xs sm:text-sm mt-1">{mintedCards.length} cards acquired</p>
                        {isMultiPack && mintedCards.length > 10 && (
                            <div className="flex items-center justify-center gap-1 mt-2 text-gray-500 text-xs animate-bounce">
                                <ChevronDown className="w-4 h-4" />
                                Scroll to see all cards
                            </div>
                        )}
                    </div>

                    {/* Scrollable card grid */}
                    <div className="flex-1 overflow-y-auto overflow-x-hidden px-3 sm:px-4 pb-28 scrollbar-thin scrollbar-thumb-gray-700 scrollbar-track-transparent">
                        <div className={`grid gap-2 sm:gap-3 md:gap-4 max-w-6xl mx-auto ${isMultiPack
                            ? 'grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6'
                            : 'grid-cols-2 sm:grid-cols-3 md:grid-cols-5'
                            }`}>
                            {mintedCards.map((card, index) => (
                                <div
                                    key={card.tokenId}
                                    className="relative bg-[#121212] border border-[#2A2A2A] rounded-xl overflow-hidden transition-transform hover:scale-[1.03]"
                                    style={{
                                        animation: `fadeInUp 0.3s ease-out ${isMultiPack ? index * 30 : 0}ms both`,
                                    }}
                                >
                                    <img
                                        src={card.image}
                                        className="block w-full"
                                        loading={index < 20 ? 'eager' : 'lazy'}
                                        alt={card.name}
                                    />
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Fixed bottom buttons */}
                    <div className="fixed bottom-0 left-0 right-0 flex justify-center gap-3 pb-4 sm:pb-6 pt-3 sm:pt-4 bg-gradient-to-t from-black via-black/80 to-transparent z-50" style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
                        {/* If there are more packs to open, show "Open Next" */}
                        {boughtPackIds.length > 0 && (
                            <button
                                onClick={() => {
                                    setMintedCards([]);
                                    setCardsDealtCount(0);
                                    setPendingCards(null);
                                    cardRefs.current = [];
                                    setStage('bought');
                                }}
                                className="px-6 sm:px-8 py-3 bg-white/10 hover:bg-white/20 text-white rounded-xl font-black text-sm sm:text-base uppercase tracking-wider transition-all active:scale-95"
                            >
                                Open Next ({boughtPackIds.length} left)
                            </button>
                        )}
                        <button
                            onClick={onClose}
                            className="px-8 sm:px-10 py-3 bg-yc-aleo hover:bg-orange-600 text-white rounded-xl font-black text-sm sm:text-base uppercase tracking-wider transition-all shadow-lg shadow-lime-500/30 active:scale-95"
                        >
                            Collect All
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default PackOpeningModal;
