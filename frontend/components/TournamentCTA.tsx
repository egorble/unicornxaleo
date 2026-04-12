import React, { useState, useEffect } from 'react';
import { Trophy, Users, Clock, ArrowRight, Zap } from 'lucide-react';
import { NavSection } from '../types';
import { currencySymbol } from '../lib/networks';
import { useActiveTournament } from '../hooks/useSharedData';

interface TournamentCTAProps {
    onNavigate: (section: NavSection) => void;
}

const TournamentCTA: React.FC<TournamentCTAProps> = ({ onNavigate }) => {
    const { data: tournament } = useActiveTournament();
    const [timeLeft, setTimeLeft] = useState('');

    // Update countdown
    useEffect(() => {
        if (!tournament) return;

        const updateTime = () => {
            const now = Math.floor(Date.now() / 1000);
            const end = tournament.endTime;
            const remaining = end - now;

            if (remaining <= 0) {
                setTimeLeft('Ended');
                return;
            }

            const days = Math.floor(remaining / 86400);
            const hours = Math.floor((remaining % 86400) / 3600);
            const minutes = Math.floor((remaining % 3600) / 60);

            if (days > 0) {
                setTimeLeft(`${days}d ${hours}h`);
            } else if (hours > 0) {
                setTimeLeft(`${hours}h ${minutes}m`);
            } else {
                setTimeLeft(`${minutes}m`);
            }
        };

        updateTime();
        const interval = setInterval(updateTime, 60000);
        return () => clearInterval(interval);
    }, [tournament]);

    if (!tournament) return null;

    return (
        <div className="my-8">
            <div className="relative overflow-hidden rounded-[24px] bg-gradient-to-br from-orange-50 via-white to-orange-50 dark:from-yc-aleo/[0.06] dark:via-white/[0.02] dark:to-orange-500/[0.04] backdrop-blur-xl border border-orange-200/60 dark:border-yc-aleo/[0.15] p-4 md:p-8 group hover:border-yc-aleo/40 dark:hover:border-yc-aleo/30 transition-all duration-500 shadow-sm">
                {/* Background decoration */}
                <div className="absolute -top-20 -right-20 w-60 h-60 bg-yc-aleo/8 dark:bg-yc-aleo/[0.06] rounded-full blur-3xl pointer-events-none" />
                <div className="absolute -bottom-10 -left-10 w-40 h-40 bg-orange-400/8 dark:bg-orange-500/[0.04] rounded-full blur-2xl pointer-events-none" />
                <div className="absolute -top-10 -right-10 opacity-[0.06] dark:opacity-[0.03] pointer-events-none text-yc-aleo">
                    <Trophy size={200} />
                </div>

                <div className="relative z-10 flex flex-col gap-4 md:gap-6">
                    {/* Top: Tournament info */}
                    <div>
                        <div className="flex items-center gap-2 mb-2 md:mb-3">
                            <span className="px-2.5 py-1 bg-orange-100 dark:bg-white/[0.06] text-yc-aleo dark:text-gray-300 text-[10px] font-bold uppercase rounded-lg border border-orange-200/60 dark:border-white/[0.08]">
                                Tournament #{tournament.id}
                            </span>
                            <span className={`px-2.5 py-1 text-[10px] font-bold uppercase rounded-lg flex items-center ${
                                tournament.status === 'active' ? 'bg-green-500/10 text-green-500' :
                                tournament.status === 'finalized' ? 'bg-yellow-500/10 text-yellow-500' :
                                tournament.status === 'ended' ? 'bg-gray-500/10 text-gray-400' :
                                'bg-green-500/10 text-green-500'
                            }`}>
                                <Zap size={10} className="mr-1" /> {
                                    tournament.status === 'active' ? 'Live Now' :
                                    tournament.status === 'finalized' ? 'Finalized' :
                                    tournament.status === 'ended' ? 'Ended' :
                                    'Open'
                                }
                            </span>
                        </div>

                        <h3 className="text-xl md:text-3xl font-black text-gray-900 dark:text-white uppercase tracking-tight mb-1 md:mb-2">
                            {tournament.status === 'finalized' ? 'Tournament Results' : 'Win the Prize Pool'}
                        </h3>
                        <p className="text-gray-500 dark:text-gray-400 text-xs md:text-sm max-w-lg hidden md:block">
                            {tournament.status === 'finalized'
                                ? 'The tournament has ended. Check the leaderboard and claim your prize!'
                                : 'Join the tournament, lock your 5 best NFT cards, and compete against other players. Top scorers win from the prize pool!'
                            }
                        </p>
                    </div>

                    {/* Stats Row */}
                    <div className="grid grid-cols-3 gap-2 md:flex md:items-center md:gap-4">
                        <div className="text-center bg-white/70 dark:bg-white/[0.03] rounded-2xl px-2 md:px-4 py-2 md:py-3 border border-orange-200/50 dark:border-white/[0.06]">
                            <div className="flex items-center justify-center gap-1 mb-0.5 md:mb-1">
                                <Trophy className="w-3 h-3 text-gray-400" />
                                <span className="text-[9px] md:text-[10px] text-gray-500 uppercase font-bold">Prize Pool</span>
                            </div>
                            <p className="text-sm md:text-xl font-black text-gray-900 dark:text-white font-mono leading-tight">
                                {tournament.prizePool}
                            </p>
                            <p className="text-[10px] md:text-xs text-gray-500 font-bold">{currencySymbol()}</p>
                        </div>
                        <div className="text-center bg-white/70 dark:bg-white/[0.03] rounded-2xl px-2 md:px-4 py-2 md:py-3 border border-orange-200/50 dark:border-white/[0.06]">
                            <div className="flex items-center justify-center gap-1 mb-0.5 md:mb-1">
                                <Users className="w-3 h-3 text-gray-400" />
                                <span className="text-[9px] md:text-[10px] text-gray-500 uppercase font-bold">Players</span>
                            </div>
                            <p className="text-sm md:text-xl font-black text-gray-900 dark:text-white font-mono">
                                {tournament.entryCount}
                            </p>
                        </div>
                        <div className="text-center bg-white/70 dark:bg-white/[0.03] rounded-2xl px-2 md:px-4 py-2 md:py-3 border border-orange-200/50 dark:border-white/[0.06]">
                            <div className="flex items-center justify-center gap-1 mb-0.5 md:mb-1">
                                <Clock className="w-3 h-3 text-gray-400" />
                                <span className="text-[9px] md:text-[10px] text-gray-500 uppercase font-bold">Time Left</span>
                            </div>
                            <p className="text-sm md:text-xl font-black text-gray-900 dark:text-white font-mono">
                                {timeLeft}
                            </p>
                        </div>
                    </div>

                    {/* CTA Button */}
                    <button
                        onClick={() => onNavigate(NavSection.LEAGUES)}
                        className="bg-yc-aleo text-white w-full md:w-auto md:self-start px-8 py-3 rounded-2xl font-bold text-sm transition-all flex items-center justify-center active:scale-95 group hover:bg-yc-aleo/80 hover:shadow-[0_0_20px_rgba(249, 115, 22,0.3)] hover:scale-[1.02]"
                    >
                        {tournament.status === 'finalized' ? 'View Results' : 'Join Tournament'}
                        <ArrowRight className="w-4 h-4 ml-2 group-hover:translate-x-1 transition-transform" />
                    </button>
                </div>
            </div>
        </div>
    );
};

export default TournamentCTA;
