import React, { useState, useEffect, useCallback } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { Trophy, TrendingUp, Wallet, Target, RefreshCw } from 'lucide-react';
import { useWalletContext } from '../context/WalletContext';
import { useNFT } from '../hooks/useNFT';
import { usePortfolioAnalytics, CardAnalytics } from '../hooks/usePortfolioAnalytics';
import { CardData, RARITY_ORDER, sortByRarity } from '../types';
import { formatXTZ } from '../lib/contracts';
import { currencySymbol } from '../lib/networks';

import { apiUrl } from '../lib/api';

// Rarity color mapping
const RARITY_COLORS: Record<string, string> = {
    'Common': 'text-gray-400',
    'Rare': 'text-blue-400',
    'Epic': 'text-orange-400',
    'EpicRare': 'text-pink-400',
    'Legendary': 'text-yellow-400',
};

const RARITY_BG: Record<string, string> = {
    'Common': 'bg-gray-500/10 border-gray-500/20',
    'Rare': 'bg-blue-500/10 border-blue-500/20',
    'Epic': 'bg-orange-500/10 border-orange-500/20',
    'EpicRare': 'bg-pink-500/10 border-pink-500/20',
    'Legendary': 'bg-yellow-500/10 border-yellow-500/20',
};

interface DailyPoint {
    date: string;
    points: number;
}

const Analytics: React.FC = () => {
    const { isConnected, address } = useWalletContext();
    const { getCards } = useNFT();
    const [cards, setCards] = useState<CardData[]>([]);
    const [cardsLoading, setCardsLoading] = useState(false);
    const [dailyHistory, setDailyHistory] = useState<DailyPoint[]>([]);
    const [tournamentId, setTournamentId] = useState<number | null>(null);

    const { cardAnalytics, summary, loading, refresh } = usePortfolioAnalytics(cards, address ?? undefined);

    // Load user's cards
    useEffect(() => {
        if (!isConnected || !address) {
            setCards([]);
            return;
        }

        let cancelled = false;
        setCardsLoading(true);

        getCards(address).then(result => {
            if (!cancelled) {
                setCards(sortByRarity(result));
                setCardsLoading(false);
            }
        }).catch(() => {
            if (!cancelled) setCardsLoading(false);
        });

        return () => { cancelled = true; };
    }, [isConnected, address, getCards]);

    // Fetch active tournament + daily score history
    useEffect(() => {
        if (!address) {
            setDailyHistory([]);
            setTournamentId(null);
            return;
        }

        let cancelled = false;

        (async () => {
            try {
                const tourRes = await fetch(apiUrl('/tournaments/active'));
                const tourData = await tourRes.json();
                if (!tourData.success || !tourData.data?.id) {
                    setTournamentId(null);
                    setDailyHistory([]);
                    return;
                }

                const tId = tourData.data.id;
                if (!cancelled) setTournamentId(tId);

                const histRes = await fetch(apiUrl(`/player/${address.toLowerCase()}/history/${tId}`));
                const histData = await histRes.json();
                if (!cancelled && histData.success) {
                    setDailyHistory(histData.data.map((d: any) => ({
                        date: d.date,
                        points: d.points,
                    })));
                }
            } catch {
                if (!cancelled) setDailyHistory([]);
            }
        })();

        return () => { cancelled = true; };
    }, [address]);

    const isLoading = cardsLoading || loading;

    // Format floor price for display
    const formatFloor = (price: bigint | null): string => {
        if (price === null) return '--';
        const val = parseFloat(formatXTZ(price));
        if (val < 0.01) return `<0.01 ${currencySymbol()}`;
        return `${val.toFixed(2)} ${currencySymbol()}`;
    };

    // Format portfolio value
    const formatPortfolioValue = (): string => {
        if (summary.portfolioValue === 0n && cards.length > 0) return 'No listings';
        if (summary.portfolioValue === 0n) return `0 ${currencySymbol()}`;
        const val = parseFloat(formatXTZ(summary.portfolioValue));
        return `${val.toFixed(2)} ${currencySymbol()}`;
    };

    // Sort card analytics: best performers first (by totalPoints desc)
    const sortedAnalytics = [...cardAnalytics].sort((a, b) => b.totalPoints - a.totalPoints);
    const bestPerformer = sortedAnalytics[0] || null;
    const worstPerformer = sortedAnalytics.length > 1 ? sortedAnalytics[sortedAnalytics.length - 1] : null;

    return (
        <div className="overflow-x-hidden">
            <div className="flex items-center justify-between mb-8">
                <h2 className="text-3xl font-black text-yc-text-primary dark:text-white uppercase tracking-tight">Analytics</h2>
                <button
                    onClick={refresh}
                    disabled={isLoading}
                    className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-500 hover:text-yc-aleo transition-colors disabled:opacity-50"
                >
                    <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
                    Refresh
                </button>
            </div>

            {/* Summary Stats */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
                <div className="bg-white dark:bg-[#121212] border border-yc-light-border dark:border-[#2A2A2A] rounded-xl p-4">
                    <div className="flex items-center gap-2 mb-2">
                        <Wallet className="w-4 h-4 text-yc-aleo" />
                        <span className="text-gray-500 text-xs uppercase font-bold">Portfolio Value</span>
                    </div>
                    <p className="text-xl font-bold text-yc-text-primary dark:text-white">
                        {isLoading ? '...' : formatPortfolioValue()}
                    </p>
                    <p className="text-xs text-gray-500 mt-1">{summary.totalCards} cards</p>
                </div>

                <div className="bg-white dark:bg-[#121212] border border-yc-light-border dark:border-[#2A2A2A] rounded-xl p-4">
                    <div className="flex items-center gap-2 mb-2">
                        <Trophy className="w-4 h-4 text-yc-aleo" />
                        <span className="text-gray-500 text-xs uppercase font-bold">Tournament Rank</span>
                    </div>
                    <p className="text-xl font-bold text-yc-text-primary dark:text-white">
                        {isLoading ? '...' : summary.rank ? `#${summary.rank}` : '--'}
                    </p>
                    <p className="text-xs text-gray-500 mt-1">
                        {summary.totalScore > 0 ? `${summary.totalScore.toFixed(1)} pts total` : 'Not in tournament'}
                    </p>
                </div>

                <div className="bg-white dark:bg-[#121212] border border-yc-light-border dark:border-[#2A2A2A] rounded-xl p-4">
                    <div className="flex items-center gap-2 mb-2">
                        <TrendingUp className="w-4 h-4 text-yc-green" />
                        <span className="text-gray-500 text-xs uppercase font-bold">Today's Points</span>
                    </div>
                    <p className="text-xl font-bold text-yc-green">
                        {isLoading ? '...' : summary.todayPoints > 0 ? `+${summary.todayPoints.toFixed(1)}` : '0'}
                    </p>
                    <p className="text-xs text-gray-500 mt-1">{summary.totalMultiplier}x total multiplier</p>
                </div>

                <div className="bg-white dark:bg-[#121212] border border-yc-light-border dark:border-[#2A2A2A] rounded-xl p-4">
                    <div className="flex items-center gap-2 mb-2">
                        <Target className="w-4 h-4 text-orange-400" />
                        <span className="text-gray-500 text-xs uppercase font-bold">Best Performer</span>
                    </div>
                    <p className="text-xl font-bold text-yc-text-primary dark:text-white truncate">
                        {isLoading ? '...' : summary.bestPerformer || '--'}
                    </p>
                    <p className="text-xs text-gray-500 mt-1">
                        {bestPerformer && bestPerformer.totalPoints > 0 ? `${bestPerformer.totalPoints.toFixed(1)} pts` : 'No data'}
                    </p>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
                {/* Score History Chart */}
                <div className="bg-white dark:bg-[#121212] border border-yc-light-border dark:border-[#2A2A2A] rounded-xl p-6">
                    <h3 className="font-bold text-yc-text-primary dark:text-white mb-6">Daily Score History</h3>
                    {dailyHistory.length > 0 ? (
                        <div className="h-64 w-full">
                            <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={dailyHistory}>
                                    <defs>
                                        <linearGradient id="colorPoints" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#F97316" stopOpacity={0.3} />
                                            <stop offset="95%" stopColor="#F97316" stopOpacity={0} />
                                        </linearGradient>
                                    </defs>
                                    <XAxis
                                        dataKey="date"
                                        axisLine={false}
                                        tickLine={false}
                                        tick={{ fill: '#888', fontSize: 11 }}
                                        tickFormatter={(val) => {
                                            const d = new Date(val);
                                            return `${d.getMonth() + 1}/${d.getDate()}`;
                                        }}
                                    />
                                    <YAxis axisLine={false} tickLine={false} tick={{ fill: '#888', fontSize: 11 }} />
                                    <Tooltip
                                        contentStyle={{
                                            backgroundColor: '#1A1A1A',
                                            border: '1px solid #333',
                                            borderRadius: '8px',
                                        }}
                                        itemStyle={{ color: '#fff' }}
                                        labelFormatter={(val) => `Date: ${val}`}
                                        formatter={(value: number) => [`${value.toFixed(1)} pts`, 'Score']}
                                    />
                                    <Area type="monotone" dataKey="points" stroke="#F97316" fillOpacity={1} fill="url(#colorPoints)" />
                                </AreaChart>
                            </ResponsiveContainer>
                        </div>
                    ) : (
                        <div className="h-64 flex items-center justify-center text-gray-500">
                            {isLoading ? 'Loading...' : tournamentId ? 'No score history yet' : 'No active tournament'}
                        </div>
                    )}
                </div>

                {/* Top & Bottom Performers */}
                <div className="grid grid-cols-1 gap-4">
                    <div className="bg-white dark:bg-[#121212] border border-yc-light-border dark:border-[#2A2A2A] rounded-xl p-6 flex items-center justify-between">
                        <div>
                            <p className="text-gray-500 text-xs uppercase font-bold">Best Performer</p>
                            <h4 className="text-xl font-bold text-yc-text-primary dark:text-white mt-1">
                                {bestPerformer ? bestPerformer.name : '--'}
                            </h4>
                        </div>
                        <span className="text-yc-green font-mono font-bold text-xl">
                            {bestPerformer && bestPerformer.totalPoints > 0
                                ? `+${bestPerformer.totalPoints.toFixed(1)} pts`
                                : '--'}
                        </span>
                    </div>
                    <div className="bg-white dark:bg-[#121212] border border-yc-light-border dark:border-[#2A2A2A] rounded-xl p-6 flex items-center justify-between">
                        <div>
                            <p className="text-gray-500 text-xs uppercase font-bold">Lowest Performer</p>
                            <h4 className="text-xl font-bold text-yc-text-primary dark:text-white mt-1">
                                {worstPerformer ? worstPerformer.name : '--'}
                            </h4>
                        </div>
                        <span className="text-yc-red font-mono font-bold text-xl">
                            {worstPerformer && worstPerformer.totalPoints > 0
                                ? `${worstPerformer.totalPoints.toFixed(1)} pts`
                                : '--'}
                        </span>
                    </div>
                    <div className="bg-white dark:bg-[#121212] border border-yc-light-border dark:border-[#2A2A2A] rounded-xl p-6 flex items-center justify-between">
                        <div>
                            <p className="text-gray-500 text-xs uppercase font-bold">Est. Portfolio Value</p>
                            <h4 className="text-xl font-bold text-yc-text-primary dark:text-white mt-1">
                                {formatPortfolioValue()}
                            </h4>
                        </div>
                        <span className="text-gray-400 font-mono text-sm">Floor prices</span>
                    </div>
                </div>
            </div>

            {/* Per-Card Breakdown Table */}
            <div className="bg-white dark:bg-[#121212] border border-yc-light-border dark:border-[#2A2A2A] rounded-xl p-6">
                <h3 className="font-bold text-yc-text-primary dark:text-white mb-4">Card Breakdown</h3>

                {cards.length === 0 ? (
                    <p className="text-gray-500 text-center py-8">
                        {isLoading ? 'Loading cards...' : !isConnected ? 'Connect your wallet to see your card breakdown' : 'No cards in your portfolio'}
                    </p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-gray-200 dark:border-[#2A2A2A]">
                                    <th className="text-left py-3 px-2 text-gray-500 font-bold text-xs uppercase">Card</th>
                                    <th className="text-left py-3 px-2 text-gray-500 font-bold text-xs uppercase">Rarity</th>
                                    <th className="text-right py-3 px-2 text-gray-500 font-bold text-xs uppercase">Multiplier</th>
                                    <th className="text-right py-3 px-2 text-gray-500 font-bold text-xs uppercase">Floor Price</th>
                                    <th className="text-right py-3 px-2 text-gray-500 font-bold text-xs uppercase">Today</th>
                                    <th className="text-right py-3 px-2 text-gray-500 font-bold text-xs uppercase">Total Pts</th>
                                </tr>
                            </thead>
                            <tbody>
                                {sortedAnalytics.map((a) => {
                                    const card = cards.find(c => c.tokenId === a.tokenId);
                                    if (!card) return null;
                                    return (
                                        <tr key={a.tokenId} className="border-b border-gray-100 dark:border-[#1A1A1A] hover:bg-gray-50 dark:hover:bg-[#1A1A1A] transition-colors">
                                            <td className="py-3 px-2">
                                                <div className="flex items-center gap-3">
                                                    {card.image && (
                                                        <img
                                                            src={card.image}
                                                            alt={card.name}
                                                            className="w-8 h-8 rounded object-cover"
                                                        />
                                                    )}
                                                    <div>
                                                        <span className="font-medium text-yc-text-primary dark:text-white">{card.name}</span>
                                                        <span className="text-gray-400 text-xs ml-2">#{card.tokenId}</span>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="py-3 px-2">
                                                <span className={`text-xs font-bold px-2 py-0.5 rounded border ${RARITY_BG[card.rarity] || ''} ${RARITY_COLORS[card.rarity] || 'text-gray-400'}`}>
                                                    {card.rarity}
                                                </span>
                                            </td>
                                            <td className="py-3 px-2 text-right font-mono text-yc-text-primary dark:text-white">
                                                {card.multiplier}x
                                            </td>
                                            <td className="py-3 px-2 text-right font-mono text-yc-text-primary dark:text-white">
                                                {formatFloor(a.floorPrice)}
                                            </td>
                                            <td className="py-3 px-2 text-right font-mono">
                                                <span className={a.todayPoints > 0 ? 'text-yc-green' : 'text-gray-500'}>
                                                    {a.todayPoints > 0 ? `+${a.todayPoints.toFixed(1)}` : '0'}
                                                </span>
                                            </td>
                                            <td className="py-3 px-2 text-right font-mono font-bold text-yc-text-primary dark:text-white">
                                                {a.totalPoints > 0 ? a.totalPoints.toFixed(1) : '0'}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
};

export default Analytics;
