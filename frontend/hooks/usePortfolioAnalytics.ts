import { useState, useEffect, useCallback } from 'react';
import { CardData } from '../types';
import { useMarketplaceV2, Listing } from './useMarketplaceV2';
import { useNFT } from './useNFT';
import { useTournament } from './useTournament';
import { formatXTZ } from '../lib/contracts';

import { apiUrl } from '../lib/api';

// Per-card analytics data
export interface CardAnalytics {
    tokenId: number;
    name: string;
    floorPrice: bigint | null; // null = no listings for this startup
    totalPoints: number;
    todayPoints: number;
    multiplier: number;
}

// Overall portfolio summary
export interface PortfolioSummary {
    portfolioValue: bigint; // sum of floor prices for all cards (wei)
    totalCards: number;
    totalMultiplier: number;
    rank: number | null;
    totalScore: number;
    todayPoints: number;
    bestPerformer: string | null; // startup name with highest totalPoints
}

interface StartupScores {
    [startupName: string]: {
        totalPoints: number;
        todayPoints: number;
        daysScored: number;
    };
}

export function usePortfolioAnalytics(cards: CardData[], address: string | undefined) {
    const [cardAnalytics, setCardAnalytics] = useState<CardAnalytics[]>([]);
    const [summary, setSummary] = useState<PortfolioSummary>({
        portfolioValue: 0n,
        totalCards: 0,
        totalMultiplier: 0,
        rank: null,
        totalScore: 0,
        todayPoints: 0,
        bestPerformer: null,
    });
    const [loading, setLoading] = useState(false);

    const { getActiveListings } = useMarketplaceV2();
    const { getCardInfo } = useNFT();
    const { getActiveTournamentId } = useTournament();

    const computeAnalytics = useCallback(async () => {
        if (!cards.length || !address) {
            setCardAnalytics([]);
            setSummary({
                portfolioValue: 0n,
                totalCards: 0,
                totalMultiplier: 0,
                rank: null,
                totalScore: 0,
                todayPoints: 0,
                bestPerformer: null,
            });
            return;
        }

        setLoading(true);

        try {
            // 1. Get active tournament ID
            let tournamentId: number | null = null;
            try {
                tournamentId = await getActiveTournamentId();
                if (tournamentId === 0) tournamentId = null;
            } catch { }

            // 2. Compute floor prices from active marketplace listings
            const floorPrices = new Map<string, bigint>(); // startup name -> min price
            try {
                const listings = await getActiveListings();
                // Get unique startup names the user owns
                const ownedStartups = new Set(cards.map(c => c.name));

                // Resolve each listing's tokenId to a startup name
                const resolvePromises = listings.map(async (listing: Listing) => {
                    const cardInfo = await getCardInfo(Number(listing.tokenId));
                    if (cardInfo && ownedStartups.has(cardInfo.name)) {
                        const current = floorPrices.get(cardInfo.name);
                        if (!current || listing.price < current) {
                            floorPrices.set(cardInfo.name, listing.price);
                        }
                    }
                });
                await Promise.all(resolvePromises);
            } catch (e) {
            }

            // 3. Fetch tournament scoring data
            let startupScores: StartupScores = {};
            let playerRank: number | null = null;
            let playerTotalScore = 0;

            if (tournamentId) {
                // Fetch card scores
                try {
                    const scoresRes = await fetch(apiUrl(`/player/${address.toLowerCase()}/card-scores/${tournamentId}`));
                    const scoresData = await scoresRes.json();
                    if (scoresData.success) {
                        startupScores = scoresData.data;
                    }
                } catch { }

                // Fetch player rank
                try {
                    const rankRes = await fetch(apiUrl(`/player/${address.toLowerCase()}/rank/${tournamentId}`));
                    const rankData = await rankRes.json();
                    if (rankData.success && rankData.data) {
                        playerRank = rankData.data.rank;
                        playerTotalScore = rankData.data.score || 0;
                    }
                } catch { }
            }

            // 4. Build per-card analytics
            // card-scores API already returns multiplied points
            // (breakdown stores baseScore × multiplier), so do NOT multiply again
            const analytics: CardAnalytics[] = cards.map(card => {
                const floor = floorPrices.get(card.name) ?? null;
                const scores = startupScores[card.name];
                return {
                    tokenId: card.tokenId,
                    name: card.name,
                    floorPrice: floor,
                    totalPoints: scores ? scores.totalPoints : 0,
                    todayPoints: scores ? scores.todayPoints : 0,
                    multiplier: card.multiplier,
                };
            });

            // 5. Build summary
            let portfolioValue = 0n;
            let todayPts = 0;
            let bestName: string | null = null;
            let bestPts = 0;

            for (const a of analytics) {
                if (a.floorPrice) portfolioValue += a.floorPrice;
                todayPts += a.todayPoints;
                if (a.totalPoints > bestPts) {
                    bestPts = a.totalPoints;
                    bestName = a.name;
                }
            }

            setCardAnalytics(analytics);
            setSummary({
                portfolioValue,
                totalCards: cards.length,
                totalMultiplier: cards.reduce((sum, c) => sum + c.multiplier, 0),
                rank: playerRank,
                totalScore: playerTotalScore,
                todayPoints: todayPts,
                bestPerformer: bestName,
            });
        } catch (e) {
        } finally {
            setLoading(false);
        }
    }, [cards, address, getActiveListings, getCardInfo, getActiveTournamentId]);

    // Recompute when cards or address changes
    useEffect(() => {
        computeAnalytics();
    }, [computeAnalytics]);

    // Helper: get analytics for a specific card
    const getCardAnalytics = useCallback((tokenId: number): CardAnalytics | undefined => {
        return cardAnalytics.find(a => a.tokenId === tokenId);
    }, [cardAnalytics]);

    return {
        cardAnalytics,
        summary,
        loading,
        refresh: computeAnalytics,
        getCardAnalytics,
        formatXTZ,
    };
}
