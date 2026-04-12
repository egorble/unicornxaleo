// Upgrade hook — v5 architecture. upgrade_card takes CardProof struct (no record input).
// Server rolls dice, user executes transaction with result.

import { useState, useCallback } from 'react';
import { blockchainCache, CacheKeys } from '../lib/cache';
import { addSyncingCards, rawCardIdToTokenId } from './usePacks';
import { STARTUPS } from '../lib/contracts';
import { Rarity } from '../types';
import { clearAliveCache } from '../lib/aleoCrypto';


const API_URL = (import.meta as any).env?.VITE_API_URL || '';
function apiUrl(path: string) {
    return API_URL ? `${API_URL}${path}` : path;
}

const DEFAULT_CHANCES: Record<number, number> = {
    1: 80, 2: 70, 3: 60, 4: 50,
};

export interface UpgradeConfig { chances: Record<number, number>; }
export interface UpgradeResult {
    success: boolean;
    burned?: boolean;
    newLevel?: number;
    txHash?: string;
    error?: string;
}

export function useUpgrade() {
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [statusMessage, setStatusMessage] = useState<string>('');

    const getUpgradeConfig = useCallback(async (): Promise<UpgradeConfig> => {
        return { chances: DEFAULT_CHANCES };
    }, []);

    const upgradeCard = useCallback(async (
        signer: any,
        tokenIdOrCard: number | any
    ): Promise<UpgradeResult> => {
        setIsLoading(true);
        setError(null);
        setStatusMessage('');

        try {
            if (!signer?._isAleoSigner) throw new Error('Aleo wallet required');

            // Extract card data from CardData object
            const card = typeof tokenIdOrCard === 'object' ? tokenIdOrCard : null;
            if (!card) throw new Error('Card data required');

            const cardId = card._rawCardId || '0';
            const currentLevel = card.level || 1;
            const salt = card._salt || '0';
            const cardOwner = card._cardOwner || signer.address;
            const startupId = card.startupId || 0;

            // Map rarity string to u8
            const rarityMap: Record<string, number> = { 'Common': 0, 'Rare': 1, 'Epic': 2, 'Legendary': 3 };
            const rarity = rarityMap[card.rarity] ?? 0;

            if (currentLevel >= 5) {
                return { success: false, error: 'Card is already at max level' };
            }

            // Step 1: Server rolls the dice
            setStatusMessage(`Rolling the dice... ${DEFAULT_CHANCES[currentLevel]}% chance!`);
            const diceRes = await fetch(apiUrl('/api/upgrades/roll'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ currentLevel }),
            });
            const diceData = await diceRes.json();
            const success = !!diceData.success;

            setStatusMessage(success
                ? 'Lucky! Submitting upgrade to blockchain...'
                : 'Unlucky... Submitting burn to blockchain...'
            );

            // Step 2: Build CardProof struct and execute upgrade_card
            const newSalt = `${Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)}field`;
            const proofStr = `{ card_id: ${cardId}field, card_owner: ${cardOwner}, startup_id: ${startupId}u8, rarity: ${rarity}u8, level: ${currentLevel}u8, salt: ${salt}field }`;

            console.log(`[upgradeCard] Executing upgrade_card (success=${success})...`);
            const txId = await signer.execute('upgrade_card', [
                proofStr,
                newSalt,
                success ? 'true' : 'false',
            ], 500000);

            // Invalidate alive cache — old commitment is now dead
            clearAliveCache();

            // Step 3: Show result
            if (success) {
                setStatusMessage(`Upgrade successful! Level ${currentLevel} → ${currentLevel + 1}`);

                // Optimistic UI: add upgraded card to syncing list (Shield may take time to index)
                const startup = STARTUPS[startupId];
                const rarityMap: Record<number, Rarity> = { 0: Rarity.COMMON, 1: Rarity.RARE, 2: Rarity.EPIC, 3: Rarity.LEGENDARY };
                const newSaltClean = newSalt.replace('field', '');
                addSyncingCards([{ card_id: cardId, startup_id: startupId, rarity, salt: newSaltClean }], () => ({
                    tokenId: rawCardIdToTokenId(String(cardId)),
                    startupId: startupId,
                    name: startup?.name || `Startup #${startupId}`,
                    rarity: rarityMap[rarity] || Rarity.COMMON,
                    level: currentLevel + 1,
                    multiplier: currentLevel + 1,
                    isLocked: false,
                    image: `/images/${startupId}.png`,
                    edition: 0,
                }));
            } else {
                setStatusMessage(`Upgrade failed! Card burned. (${DEFAULT_CHANCES[currentLevel]}% chance)`);
            }

            return {
                success,
                burned: !success,
                newLevel: success ? (currentLevel + 1) : undefined,
                txHash: txId,
            };
        } catch (err: any) {
            const msg = err?.message || 'Upgrade failed';
            setError(msg);
            setStatusMessage('');
            return { success: false, burned: false, error: msg };
        } finally {
            setIsLoading(false);
        }
    }, []);

    return { upgradeCard, getUpgradeConfig, isLoading, error, statusMessage };
}
