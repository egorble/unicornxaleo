import React, { useState } from 'react';
import { UserPlus, Copy, Check } from 'lucide-react';
import { useWalletContext } from '../context/WalletContext';
import { useReferral } from '../hooks/useReferral';
import { currencySymbol } from '../lib/networks';
import ModelViewer3D from './ModelViewer3D';

import { useActiveTournament, useSharedTopStartups } from '../hooks/useSharedData';

interface RightPanelProps {
  onOpenPack: () => void;
}

const RightPanel: React.FC<RightPanelProps> = ({ onOpenPack }) => {
  const { isConnected } = useWalletContext();
  const { getReferralLink, referralStats } = useReferral();
  const [copied, setCopied] = useState(false);
  const packPrice = '0.1';

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
    <aside className="w-64 h-screen fixed right-0 top-0 bg-white/60 dark:bg-zinc-900/40 backdrop-blur-2xl border-l border-white/40 dark:border-white/[0.06] p-3 hidden xl:flex flex-col space-y-3 z-40 overflow-y-auto transition-colors duration-300">

      {/* Buy Pack CTA */}
      <div className="rounded-2xl relative overflow-hidden shrink-0 bg-white/50 dark:bg-white/[0.04] backdrop-blur-xl border border-white/40 dark:border-white/[0.08] shadow-[0_8px_32px_rgba(0,0,0,0.06),inset_0_1px_0_rgba(255,255,255,0.4)] dark:shadow-[0_8px_32px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.05)]">
        {/* 3D model area */}
        <div className="relative h-40 bg-transparent">
          <ModelViewer3D mode="gentle" cameraZ={2.8} modelScale={0.8} />
        </div>
        {/* Bottom bar */}
        <div className="p-3 border-t border-white/30 dark:border-white/[0.06]">
          <div className="flex items-center justify-between mb-2.5">
            <span className="text-gray-500 text-[10px] font-medium">5 cards per pack</span>
            <span className="text-yc-text-primary dark:text-white font-mono font-black text-lg">{packPrice} <span className="text-gray-500 text-sm font-bold">{currencySymbol()}</span></span>
          </div>
          <button
            onClick={onOpenPack}
            className="w-full bg-yc-aleo text-white py-2.5 rounded-xl font-bold text-sm uppercase tracking-wider transition-all flex items-center justify-center active:scale-95 hover:bg-yc-aleo/80 hover:shadow-[0_0_20px_rgba(249, 115, 22,0.3)] hover:scale-[1.02]"
          >
            Buy Pack
          </button>
        </div>
      </div>

      {/* Top Startups by Points */}
      <div className="bg-white/50 dark:bg-white/[0.04] backdrop-blur-xl border border-white/40 dark:border-white/[0.08] rounded-2xl p-3 shadow-[0_8px_32px_rgba(0,0,0,0.06),inset_0_1px_0_rgba(255,255,255,0.4)] dark:shadow-[0_8px_32px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.05)]">
        <div className="flex items-center justify-between mb-2">
             <h3 className="text-gray-900 dark:text-white font-bold text-[11px] uppercase tracking-wide">Top Startups</h3>
             <span className="text-[8px] text-gray-400 dark:text-gray-500 font-medium">base pts</span>
        </div>

        <div className="space-y-1">
            {topStartups && topStartups.length > 0 ? (
              topStartups.map((startup, i) => (
                <div key={startup.name} className="flex items-center justify-between group hover:bg-gray-100 dark:hover:bg-white/[0.04] px-1 py-1 rounded-lg transition-colors">
                    <div className="flex items-center min-w-0">
                        <span className={`text-[10px] font-black shrink-0 mr-2 w-4 text-center ${
                          i === 0 ? 'text-gray-900 dark:text-white' : 'text-gray-500'
                        }`}>
                            {i + 1}
                        </span>
                        <p className="text-[11px] font-semibold text-gray-900 dark:text-white group-hover:text-gray-600 dark:group-hover:text-gray-300 transition-colors truncate">
                          {startup.name}
                        </p>
                    </div>
                    <span className="text-[10px] font-bold text-green-500 font-mono shrink-0 ml-1">
                      +{Math.round(startup.points)}
                    </span>
                </div>
              ))
            ) : (
              <p className="text-[10px] text-gray-400 dark:text-gray-500 text-center py-2">No scores yet</p>
            )}
        </div>
      </div>

      {/* Referral */}
      <div className="bg-white/50 dark:bg-white/[0.04] backdrop-blur-xl border border-white/40 dark:border-white/[0.08] rounded-2xl p-3 shadow-[0_8px_32px_rgba(0,0,0,0.06),inset_0_1px_0_rgba(255,255,255,0.4)] dark:shadow-[0_8px_32px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.05)]">
        <div className="flex items-center justify-between mb-1.5">
            <h3 className="text-gray-900 dark:text-white font-bold text-xs">Referral Program</h3>
            <UserPlus className="w-3.5 h-3.5 text-gray-400" />
        </div>
        <p className="text-gray-600 dark:text-gray-400 text-[10px] mb-2">
            Earn <span className="text-gray-900 dark:text-white font-bold">10%</span> from every pack your friends buy.
        </p>

        {isConnected && (
            <div className="flex gap-2 mb-2">
                <div className="flex-1 bg-white/40 dark:bg-white/[0.04] rounded-lg p-1.5 border border-white/30 dark:border-white/[0.06] text-center">
                    <p className="text-[9px] text-gray-500 uppercase font-bold">Refs</p>
                    <p className="text-gray-900 dark:text-white font-bold font-mono text-xs">{referralStats.count}</p>
                </div>
                <div className="flex-1 bg-white/40 dark:bg-white/[0.04] rounded-lg p-1.5 border border-white/30 dark:border-white/[0.06] text-center">
                    <p className="text-[9px] text-gray-500 uppercase font-bold">Earned</p>
                    <p className="text-gray-900 dark:text-white font-bold font-mono text-xs">{referralStats.totalEarned}</p>
                </div>
            </div>
        )}

        <div className="relative">
            <input
                type="text"
                value={isConnected ? referralLink : 'Connect wallet first'}
                readOnly
                className="w-full bg-white/40 dark:bg-white/[0.04] border border-white/30 dark:border-white/[0.06] text-gray-600 dark:text-gray-400 text-[9px] px-2 py-1.5 pr-12 rounded-lg font-mono focus:outline-none truncate"
            />
            <button
                onClick={handleCopy}
                disabled={!isConnected}
                className={`absolute right-0.5 top-1/2 -translate-y-1/2 text-[9px] font-bold px-1.5 py-0.5 rounded-lg transition-all flex items-center gap-0.5 ${
                    copied
                        ? 'bg-green-500 text-white'
                        : isConnected
                            ? 'bg-yc-aleo text-white hover:bg-yc-aleo/80'
                            : 'bg-gray-400 text-white cursor-not-allowed'
                }`}
            >
                {copied ? <Check className="w-2.5 h-2.5" /> : <Copy className="w-2.5 h-2.5" />}
                {copied ? 'OK' : 'Copy'}
            </button>
        </div>
      </div>

    </aside>
  );
};

export default RightPanel;
