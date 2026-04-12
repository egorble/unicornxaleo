import React, { useState } from 'react';
import { TrendingUp, UserPlus, Copy, Check, Package } from 'lucide-react';
import { useWalletContext } from '../context/WalletContext';
import { useReferral } from '../hooks/useReferral';
import { currencySymbol } from '../lib/networks';
import ModelViewer3D from './ModelViewer3D';
import { useActiveTournament, useSharedTopStartups } from '../hooks/useSharedData';

interface MobileWidgetsProps {
    onOpenPack?: () => void;
}

const MobileWidgets: React.FC<MobileWidgetsProps> = ({ onOpenPack }) => {
    const { isConnected } = useWalletContext();
    const packPrice = '0.1';
    const { getReferralLink, referralStats } = useReferral();
    const [copied, setCopied] = useState(false);

    const { data: tournament } = useActiveTournament();
    const { data: topStartups } = useSharedTopStartups(tournament?.id ?? null);

    const referralLink = getReferralLink();

    const handleCopy = () => {
        if (!referralLink) return;
        navigator.clipboard.writeText(referralLink);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className="my-6 xl:hidden">
            {/* Buy Pack CTA */}
            {onOpenPack && (
                <div className="mb-3 rounded-xl overflow-hidden shadow-lg bg-white dark:bg-[#0a0a0a] border border-yc-aleo/20 dark:border-yc-aleo/[0.15]">
                    <div className="relative h-36 bg-gradient-to-b from-yc-aleo/5 to-gray-50 dark:from-yc-aleo/[0.06] dark:to-[#0a0a0a]">
                        <ModelViewer3D mode="gentle" cameraZ={2.8} modelScale={0.8} />
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                            <div className="w-20 h-20 bg-yc-aleo/10 rounded-full blur-2xl" />
                        </div>
                    </div>
                    <div className="p-3 border-t border-gray-200 dark:border-white/[0.06] flex items-center justify-between">
                        <div>
                            <span className="text-gray-500 text-[10px] font-medium">5 cards per pack</span>
                            <p className="text-yc-text-primary dark:text-white font-mono font-black text-lg">{packPrice} <span className="text-gray-500 text-sm font-bold">{currencySymbol()}</span></p>
                        </div>
                        <button
                            onClick={onOpenPack}
                            className="bg-yc-aleo hover:bg-orange-600 text-white px-5 py-2.5 rounded-lg font-black text-sm uppercase tracking-wider active:scale-95 transition-all shadow-md shadow-lime-500/20"
                        >
                            Buy Pack
                        </button>
                    </div>
                </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">

                {/* Top Startups Card */}
                <div className="bg-gray-50 dark:bg-white/[0.02] border border-gray-200 dark:border-white/[0.06] rounded-xl p-4 shadow-sm dark:shadow-none">
                    <div className="flex items-center justify-between mb-3">
                        <h3 className="text-gray-900 dark:text-white font-bold text-xs uppercase tracking-wide flex items-center">
                            <TrendingUp className="w-4 h-4 text-yc-aleo mr-2" />
                            Top Startups
                        </h3>
                        <span className="text-[9px] text-gray-400 font-medium">base pts</span>
                    </div>

                    <div className="space-y-1">
                        {topStartups && topStartups.length > 0 ? (
                            topStartups.map((startup, i) => (
                                <div key={startup.name} className="flex items-center justify-between hover:bg-gray-100 dark:hover:bg-white/5 px-2 py-1.5 rounded transition-colors">
                                    <div className="flex items-center min-w-0">
                                        <span className={`text-[11px] font-black shrink-0 mr-2 w-5 text-center ${i === 0 ? 'text-yc-aleo' : 'text-gray-400'}`}>
                                            {i + 1}
                                        </span>
                                        <p className="text-xs font-semibold text-gray-900 dark:text-white truncate">
                                            {startup.name}
                                        </p>
                                    </div>
                                    <span className="text-[11px] font-bold text-green-500 font-mono shrink-0 ml-2">
                                        +{Math.round(startup.points)}
                                    </span>
                                </div>
                            ))
                        ) : (
                            <p className="text-xs text-gray-400 text-center py-3">No scores yet</p>
                        )}
                    </div>
                </div>

                {/* Referral Card */}
                <div className="bg-gradient-to-br from-orange-50 to-orange-100 dark:from-gray-900 dark:to-black border border-orange-200 dark:border-gray-800 rounded-xl p-4">
                    <div className="flex items-center justify-between mb-2">
                        <h3 className="text-gray-900 dark:text-white font-bold text-xs flex items-center">
                            <UserPlus className="w-4 h-4 text-yc-aleo mr-2" />
                            Referral Program
                        </h3>
                    </div>
                    <p className="text-gray-600 dark:text-gray-400 text-[11px] mb-3">
                        Earn <span className="text-yc-aleo font-bold">10%</span> from every pack your friends buy.
                    </p>

                    {isConnected && (
                        <div className="flex gap-2 mb-3">
                            <div className="flex-1 bg-white/80 dark:bg-black/50 rounded-lg p-2 border border-orange-200/50 dark:border-gray-700 text-center">
                                <p className="text-[9px] text-gray-500 uppercase font-bold">Refs</p>
                                <p className="text-gray-900 dark:text-white font-bold font-mono text-sm">{referralStats.count}</p>
                            </div>
                            <div className="flex-1 bg-white/80 dark:bg-black/50 rounded-lg p-2 border border-orange-200/50 dark:border-gray-700 text-center">
                                <p className="text-[9px] text-gray-500 uppercase font-bold">Earned</p>
                                <p className="text-yc-aleo font-bold font-mono text-sm">{referralStats.totalEarned}</p>
                            </div>
                        </div>
                    )}

                    <div className="relative">
                        <input
                            type="text"
                            value={isConnected ? referralLink : 'Connect wallet first'}
                            readOnly
                            className="w-full bg-white/80 dark:bg-black/50 border border-orange-200/50 dark:border-gray-700 text-gray-600 dark:text-gray-400 text-[10px] px-3 py-2 pr-14 rounded-lg font-mono focus:outline-none truncate"
                        />
                        <button
                            onClick={handleCopy}
                            disabled={!isConnected}
                            className={`absolute right-1 top-1/2 -translate-y-1/2 text-white text-[10px] font-bold px-2 py-1 rounded-md transition-all flex items-center gap-1 ${
                                copied
                                    ? 'bg-green-500'
                                    : isConnected
                                        ? 'bg-yc-aleo hover:bg-orange-600'
                                        : 'bg-gray-400 cursor-not-allowed'
                            }`}
                        >
                            {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                            {copied ? 'OK' : 'Copy'}
                        </button>
                    </div>
                </div>

            </div>
        </div>
    );
};

export default MobileWidgets;
