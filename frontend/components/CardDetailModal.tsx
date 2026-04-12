import React from 'react';
import { X, Share2, Calendar, Star, Hash, Layers, ExternalLink, TrendingUp, Building2 } from 'lucide-react';
import { CardData, Rarity } from '../types';
import { STARTUPS, getActiveContracts } from '../lib/contracts';
import { getActiveNetwork } from '../lib/networks';

export interface CardDetailData {
    id: string;
    image: string;
    name: string;
    value: string | number;
    rarity?: Rarity | string;
    multiplier?: string;
    batch?: string;
    stage?: string;
}

interface CardDetailModalProps {
    data: CardDetailData | null;
    cardData?: CardData | null;
    onClose: () => void;
}

const RARITY_COLORS: Record<string, string> = {
    Legendary: 'bg-amber-500/10 text-amber-500 border-amber-500/30',
    Epic: 'bg-orange-500/10 text-orange-500 border-orange-500/30',
    Rare: 'bg-blue-500/10 text-blue-500 border-blue-500/30',
    Common: 'bg-gray-500/10 text-gray-400 border-gray-500/30',
};

const CardDetailModal: React.FC<CardDetailModalProps> = ({ data, cardData, onClose }) => {
    if (!data && !cardData) return null;

    const displayData = cardData || data;
    if (!displayData) return null;

    const rarity = cardData?.rarity || data?.rarity || 'Common';
    const level = cardData?.level || cardData?.multiplier || Number(data?.multiplier || data?.value || 1);
    const edition = cardData?.edition;
    const tokenId = cardData?.tokenId;
    const startupId = cardData?.startupId;
    const isLocked = cardData?.isLocked;
    const description = cardData?.description || 'YC startup building innovative solutions.';
    const fundraising = cardData?.fundraising;

    const fundingHistory = fundraising ? [
        {
            round: fundraising.round,
            date: new Date().toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
            amount: fundraising.amount,
            valuation: fundraising.valuation || 'N/A',
            investor: 'Undisclosed'
        }
    ] : [];

    const rarityStyle = RARITY_COLORS[rarity] || RARITY_COLORS.Common;

    return (
        <div className="fixed inset-0 z-[60] flex items-end md:items-center justify-center bg-black/60 backdrop-blur-sm md:p-4" onClick={onClose}>
            <div
                className="bg-white dark:bg-zinc-900 backdrop-blur-2xl w-full md:max-w-5xl max-h-[85vh] md:max-h-[90vh] rounded-t-2xl md:rounded-xl border border-gray-200 dark:border-white/[0.08] shadow-[0_8px_32px_rgba(0,0,0,0.12)] dark:shadow-[0_8px_32px_rgba(0,0,0,0.4)] flex flex-col relative overflow-hidden"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Mobile drag handle */}
                <div className="md:hidden flex justify-center pt-3 pb-1">
                    <div className="w-10 h-1 bg-gray-300 dark:bg-gray-600 rounded-full" />
                </div>

                {/* Header Section */}
                <div className="flex items-start justify-between p-4 md:p-6 border-b border-gray-100 dark:border-white/[0.06]">
                    <div className="flex gap-3 md:gap-5 min-w-0">
                        <div className="w-20 h-20 md:w-28 md:h-28 rounded-xl overflow-hidden shrink-0">
                            <img
                                src={cardData?.image || data?.image}
                                alt={cardData?.name || data?.name}
                                className="w-full h-full object-contain"
                            />
                        </div>
                        <div className="min-w-0">
                            <div className="flex items-center gap-2 md:gap-3 mb-1 flex-wrap">
                                <h2 className="text-lg md:text-3xl font-bold text-gray-900 dark:text-white tracking-tight truncate">
                                    {cardData?.name || data?.name}
                                </h2>
                                <span className={`px-2 py-0.5 rounded-full border text-[10px] md:text-xs font-semibold ${rarityStyle}`}>
                                    {rarity}
                                </span>
                            </div>
                            <div className="flex items-center gap-3 md:gap-4 text-xs md:text-sm text-gray-500 dark:text-gray-400 flex-wrap">
                                {tokenId !== undefined && (
                                    <div className="flex items-center gap-1">
                                        <Hash className="w-3 h-3 md:w-4 md:h-4" />
                                        <span>Token #{tokenId}</span>
                                    </div>
                                )}
                                {edition !== undefined && (
                                    <div className="flex items-center gap-1">
                                        <Layers className="w-3 h-3 md:w-4 md:h-4" />
                                        <span>Edition #{edition}</span>
                                    </div>
                                )}
                                {data?.batch && (
                                    <div className="flex items-center gap-1">
                                        <Calendar className="w-3 h-3 md:w-4 md:h-4" />
                                        <span>Batch {data.batch}</span>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                    <div className="flex gap-1 shrink-0 ml-2">
                        <button className="p-1.5 md:p-2 text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors">
                            <Share2 className="w-4 h-4 md:w-5 md:h-5" />
                        </button>
                        <button
                            onClick={onClose}
                            className="p-1.5 md:p-2 text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
                        >
                            <X className="w-5 h-5 md:w-6 md:h-6" />
                        </button>
                    </div>
                </div>

                {/* Main Content Grid - scrollable */}
                <div className="flex flex-col lg:flex-row overflow-y-auto">

                    {/* Left Column: Card Stats */}
                    <div className="lg:w-2/3 p-4 md:p-6 lg:border-r border-gray-100 dark:border-white/[0.06]">

                        {/* Description */}
                        <div className="mb-4 md:mb-8">
                            <h3 className="text-sm font-semibold text-gray-900 dark:text-white uppercase tracking-wider mb-2 md:mb-3">About</h3>
                            <p className="text-gray-600 dark:text-gray-300 leading-relaxed text-xs md:text-sm">
                                {description}
                            </p>
                        </div>

                        {/* Card Metrics */}
                        <div className="grid grid-cols-3 gap-2 md:gap-4 mb-4 md:mb-8">
                            <div className="p-2.5 md:p-4 rounded-lg bg-gray-50 dark:bg-white/[0.04] border border-gray-100 dark:border-white/[0.06]">
                                <div className="flex items-center gap-1 md:gap-2 text-gray-500 dark:text-gray-400 mb-1 md:mb-2">
                                    <TrendingUp className="w-3 h-3 md:w-4 md:h-4" />
                                    <span className="text-[10px] md:text-xs font-semibold uppercase">Level</span>
                                </div>
                                <p className="text-base md:text-2xl font-bold text-gray-900 dark:text-white font-mono tracking-tight">
                                    Lvl {level} <span className="text-sm text-gray-500">({level}x)</span>
                                </p>
                                <p className="mt-1 md:mt-2 text-[10px] md:text-xs text-gray-500">Score multiplier</p>
                            </div>

                            <div className="p-2.5 md:p-4 rounded-lg bg-gray-50 dark:bg-white/[0.04] border border-gray-100 dark:border-white/[0.06]">
                                <div className="flex items-center gap-1 md:gap-2 text-gray-500 dark:text-gray-400 mb-1 md:mb-2">
                                    <Star className="w-3 h-3 md:w-4 md:h-4" />
                                    <span className="text-[10px] md:text-xs font-semibold uppercase">Rarity</span>
                                </div>
                                <p className="text-base md:text-2xl font-bold text-gray-900 dark:text-white font-mono tracking-tight">
                                    {rarity}
                                </p>
                                <p className="mt-1 md:mt-2 text-[10px] md:text-xs text-gray-500">
                                    {rarity === 'Legendary' ? 'Top tier' : rarity === 'Epic' ? 'High tier' : rarity === 'Rare' ? 'Mid tier' : 'Base tier'}
                                </p>
                            </div>

                            <div className="p-2.5 md:p-4 rounded-lg bg-gray-50 dark:bg-white/[0.04] border border-gray-100 dark:border-white/[0.06]">
                                <div className="flex items-center gap-1 md:gap-2 text-gray-500 dark:text-gray-400 mb-1 md:mb-2">
                                    <Layers className="w-3 h-3 md:w-4 md:h-4" />
                                    <span className="text-[10px] md:text-xs font-semibold uppercase">Edition</span>
                                </div>
                                <p className="text-base md:text-2xl font-bold text-gray-900 dark:text-white font-mono tracking-tight">
                                    #{edition || '?'}
                                </p>
                                <p className="mt-1 md:mt-2 text-[10px] md:text-xs text-gray-500">Mint number</p>
                            </div>
                        </div>

                        {/* Card Status */}
                        <div className="flex flex-wrap gap-2">
                            {isLocked && (
                                <span className="px-3 py-1.5 rounded-lg bg-red-500/10 text-red-500 border border-red-500/20 text-xs font-semibold">
                                    Locked in Tournament
                                </span>
                            )}
                            {startupId && (
                                <span className="px-3 py-1.5 rounded-lg bg-white/40 dark:bg-white/[0.04] text-gray-600 dark:text-gray-400 border border-white/30 dark:border-white/[0.06] text-xs font-semibold">
                                    Startup #{startupId}
                                </span>
                            )}
                        </div>
                    </div>

                    {/* Right Column: Funding & Links */}
                    <div className="lg:w-1/3 bg-gray-50 dark:bg-white/[0.02]">

                        {/* Funding Timeline */}
                        {fundingHistory.length > 0 && (
                            <div className="p-4 md:p-6 border-b border-gray-100 dark:border-white/[0.06]">
                                <h3 className="text-sm font-semibold text-gray-900 dark:text-white uppercase tracking-wider mb-6">Funding History</h3>
                                <div className="relative pl-2">
                                    <div className="absolute left-[7px] top-2 bottom-2 w-px bg-gray-200 dark:bg-white/[0.08]"></div>
                                    <div className="space-y-6">
                                        {fundingHistory.map((round, i) => (
                                            <div key={i} className="relative pl-8">
                                                <div className={`absolute left-0 top-1.5 w-3.5 h-3.5 rounded-full border-[3px] border-white dark:border-zinc-900 z-10
                                                    ${i === 0 ? 'bg-yc-aleo ring-1 ring-yc-aleo' : 'bg-gray-300 dark:bg-gray-700'}`}></div>

                                                <div className="flex justify-between items-start mb-1">
                                                    <span className="font-bold text-sm text-gray-900 dark:text-white">{round.round}</span>
                                                    <span className="font-mono text-xs font-semibold text-gray-900 dark:text-white">{round.amount}</span>
                                                </div>
                                                <div className="flex justify-between items-center text-xs text-gray-500">
                                                    <span>{round.date}</span>
                                                    <span>Val: {round.valuation}</span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Actions */}
                        <div className="p-4 md:p-6">
                            <div className="space-y-3">
                                {tokenId !== undefined && (
                                    <a
                                        href={`${getActiveNetwork().explorerUrl}/token/${getActiveContracts().UnicornX_NFT}/instance/${tokenId}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="w-full py-3.5 px-4 bg-yc-aleo text-white rounded-lg font-bold text-sm hover:bg-yc-aleo/80 transition-colors flex items-center justify-center"
                                    >
                                        <ExternalLink className="w-4 h-4 mr-2" /> View on Explorer
                                    </a>
                                )}
                            </div>
                        </div>

                    </div>
                </div>
            </div>
        </div>
    );
}

export default CardDetailModal;
