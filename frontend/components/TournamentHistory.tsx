import React, { useState } from 'react';
import { Trophy, ChevronDown, Gift, CheckCircle, Users, Clock, Loader2, Unlock } from 'lucide-react';
import { useWalletContext } from '../context/WalletContext';
import { useTournamentHistory, PastTournamentEntry } from '../hooks/useTournamentHistory';
import { useNFT } from '../hooks/useNFT';
import { formatXTZ } from '../lib/contracts';
import { currencySymbol } from '../lib/networks';

interface TournamentHistoryProps {
    activeTournamentId: number;
}

const STATUS_COLOR: Record<string, string> = {
    'Finalized': 'bg-yellow-500',
    'Created': 'bg-gray-500',
    'Active': 'bg-green-500',
    'Cancelled': 'bg-red-500',
};

function formatDateRange(startTime: number, endTime: number): string {
    const s = new Date(startTime * 1000);
    const e = new Date(endTime * 1000);
    const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
    const startStr = s.toLocaleDateString('en-US', opts);
    const endStr = e.toLocaleDateString('en-US', { ...opts, year: 'numeric' });
    return `${startStr} — ${endStr}`;
}

const TournamentHistory: React.FC<TournamentHistoryProps> = ({ activeTournamentId }) => {
    const [expandedId, setExpandedId] = useState<number | null>(null);
    const [claimingId, setClaimingId] = useState<number | null>(null);
    const [unlockingId, setUnlockingId] = useState<number | null>(null);
    const [unlockMsg, setUnlockMsg] = useState<Record<number, string>>({});

    const { isConnected, address, getSigner } = useWalletContext();
    const { entries, loading, claimPrize, unlockCards } = useTournamentHistory(activeTournamentId);
    const { getCards } = useNFT();

    // Past = tournaments the user entered AND aren't the currently-active one
    // (the active one is rendered in the main Leagues view above).
    const visible = entries.filter(e => e.entered && e.tournamentId !== activeTournamentId);

    // Debug: log state so we can see what's happening
    console.log(`[TournamentHistory] active=${activeTournamentId} entries=${entries.length} visible=${visible.length} loading=${loading}`, entries.map(e => ({id: e.tournamentId, status: e.status, entered: e.entered, canUnlock: e.canUnlock})));

    if (!isConnected || !address) return null;
    if (!loading && visible.length === 0) return null;

    const handleClaim = async (tournamentId: number) => {
        setClaimingId(tournamentId);
        const signer = await getSigner();
        if (!signer) {
            setClaimingId(null);
            return;
        }
        await claimPrize(signer, tournamentId);
        setClaimingId(null);
    };

    const handleUnlock = async (tournamentId: number, hasSavedLineup: boolean) => {
        setUnlockingId(tournamentId);
        setUnlockMsg(m => ({ ...m, [tournamentId]: '' }));
        try {
            const signer = await getSigner();
            if (!signer) return;

            // If no saved lineup, try to pick 5 currently-locked cards as a fallback
            let fallback: [any, any, any, any, any] | undefined;
            if (!hasSavedLineup && address) {
                const cards = await getCards(address);
                const locked = cards.filter((c: any) => c.isLocked);
                if (locked.length < 5) {
                    setUnlockMsg(m => ({ ...m, [tournamentId]: `Need 5 locked cards, found ${locked.length}` }));
                    return;
                }
                fallback = locked.slice(0, 5) as any;
            }

            const result = await unlockCards(signer, tournamentId, fallback);
            if (!result.success) {
                setUnlockMsg(m => ({ ...m, [tournamentId]: result.error || 'Unlock failed' }));
            } else {
                setUnlockMsg(m => ({ ...m, [tournamentId]: '✅ Cards unlocked' }));
            }
        } finally {
            setUnlockingId(null);
        }
    };

    return (
        <div className="mt-8">
            <h3 className="font-bold text-lg sm:text-xl text-yc-text-primary dark:text-white flex items-center mb-4">
                <Trophy className="w-5 h-5 mr-2 text-gray-400" />
                Past Tournaments
                {loading && <Loader2 className="w-4 h-4 ml-2 animate-spin text-gray-400" />}
            </h3>

            <div className="space-y-3">
                {visible.map((e) => {
                    const isExpanded = expandedId === e.tournamentId;
                    const isClaiming = claimingId === e.tournamentId;
                    const isUnlocking = unlockingId === e.tournamentId;

                    return (
                        <div key={e.tournamentId} className="glass-panel rounded-xl overflow-hidden">
                            {/* Header — always visible */}
                            <div
                                onClick={() => setExpandedId(isExpanded ? null : e.tournamentId)}
                                className="flex items-center px-3 sm:px-5 py-3 sm:py-4 cursor-pointer hover:bg-white/5 transition-colors"
                            >
                                <div className="flex-1 min-w-0">
                                    <div className="flex flex-wrap items-center gap-1.5 mb-1">
                                        <span className="px-2 py-0.5 bg-yc-aleo text-white text-[10px] font-bold uppercase rounded">
                                            #{e.tournamentId}
                                        </span>
                                        <span className={`px-2 py-0.5 text-white text-[10px] font-bold uppercase rounded ${STATUS_COLOR[e.status] || 'bg-gray-500'}`}>
                                            {e.status}
                                        </span>
                                        <span className="px-2 py-0.5 bg-yc-green/20 text-yc-green text-[10px] font-bold uppercase rounded flex items-center">
                                            <CheckCircle size={10} className="mr-1" /> Entered
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
                                        <span className="flex items-center">
                                            <Clock size={11} className="mr-1" />
                                            {formatDateRange(e.startTime, e.endTime)}
                                        </span>
                                    </div>
                                </div>

                                <div className="text-right shrink-0 ml-3 flex items-center gap-3">
                                    <div>
                                        <p className="text-sm font-bold font-mono text-yc-aleo">
                                            {formatXTZ(e.prizePool)} {currencySymbol()}
                                        </p>
                                        <p className="text-[10px] text-gray-400 flex items-center justify-end">
                                            <Users size={10} className="mr-1" /> {e.entryCount}
                                        </p>
                                    </div>
                                    <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                                </div>
                            </div>

                            {/* Expanded detail */}
                            {isExpanded && (
                                <div className="px-3 sm:px-5 py-3 sm:py-4 border-t border-gray-200 dark:border-[#2A2A2A] bg-white/5">
                                    <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 sm:gap-6">
                                        <div className="flex items-center gap-4 sm:gap-6">
                                            <div>
                                                <p className="text-[10px] text-gray-500 uppercase font-bold">Your Score</p>
                                                <p className="text-lg font-black font-mono text-yc-text-primary dark:text-white">
                                                    {Number(e.userScore).toLocaleString()}
                                                </p>
                                            </div>
                                            <div className="w-px h-8 bg-gray-300 dark:bg-gray-700"></div>
                                            <div>
                                                <p className="text-[10px] text-gray-500 uppercase font-bold">Your Prize</p>
                                                <p className="text-lg font-black font-mono text-yc-aleo">
                                                    {e.userPrize > 0n
                                                        ? `${formatXTZ(e.userPrize)} ${currencySymbol()}`
                                                        : '—'
                                                    }
                                                </p>
                                            </div>
                                        </div>

                                        <div className="sm:ml-auto flex flex-col sm:flex-row gap-2 items-end">
                                            {e.claimed ? (
                                                <span className="text-yc-green font-bold text-sm flex items-center">
                                                    <CheckCircle className="w-4 h-4 mr-1.5" /> Prize claimed
                                                </span>
                                            ) : e.userPrize > 0n ? (
                                                <button
                                                    onClick={(ev) => {
                                                        ev.stopPropagation();
                                                        handleClaim(e.tournamentId);
                                                    }}
                                                    disabled={isClaiming}
                                                    className="bg-yellow-500 hover:bg-yellow-600 text-black px-4 py-2 rounded-lg font-black text-xs uppercase tracking-wide transition-all flex items-center shadow-lg"
                                                >
                                                    {isClaiming ? (
                                                        <span className="animate-pulse">Claiming...</span>
                                                    ) : (
                                                        <>
                                                            <Gift className="w-4 h-4 mr-1.5" />
                                                            Claim {formatXTZ(e.userPrize)} {currencySymbol()}
                                                        </>
                                                    )}
                                                </button>
                                            ) : null}

                                            {e.canUnlock && (
                                                <div className="flex flex-col items-end gap-1">
                                                    <button
                                                        onClick={(ev) => {
                                                            ev.stopPropagation();
                                                            handleUnlock(e.tournamentId, e.hasSavedLineup);
                                                        }}
                                                        disabled={isUnlocking}
                                                        className="bg-yc-aleo hover:opacity-90 text-white px-4 py-2 rounded-lg font-black text-xs uppercase tracking-wide transition-all flex items-center shadow-lg disabled:opacity-60"
                                                    >
                                                        {isUnlocking ? (
                                                            <span className="animate-pulse">Unlocking...</span>
                                                        ) : (
                                                            <>
                                                                <Unlock className="w-4 h-4 mr-1.5" />
                                                                Unlock Cards
                                                            </>
                                                        )}
                                                    </button>
                                                    {!e.hasSavedLineup && (
                                                        <span className="text-[10px] text-gray-400">Will use your 5 currently-locked cards</span>
                                                    )}
                                                    {unlockMsg[e.tournamentId] && (
                                                        <span className="text-[11px] text-gray-300">{unlockMsg[e.tournamentId]}</span>
                                                    )}
                                                </div>
                                            )}

                                            {!e.canUnlock && !e.claimed && e.userPrize === 0n && (
                                                <span className="text-gray-500 text-sm font-bold">No prize earned</span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default TournamentHistory;
