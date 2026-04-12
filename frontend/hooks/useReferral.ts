// Referral hook — Aleo version. Reads referral_count from Aleo mapping.
// Same API as original EVM hook.

import { useState, useCallback, useEffect } from 'react';
import { useWalletContext } from '../context/WalletContext';
import { readAleoMapping, formatXTZ } from '../lib/contracts';

function referralStorageKey(): string {
    return 'unicornx_referrer_aleo';
}

export function useReferral() {
    const { address, isConnected } = useWalletContext();
    const [referralStats, setReferralStats] = useState<{ count: number; totalEarned: string }>({
        count: 0,
        totalEarned: '0',
    });
    const [myReferrer, setMyReferrer] = useState<string | null>(null);

    // Generate referral link (uses Aleo address)
    const getReferralLink = useCallback(() => {
        if (!address) return '';
        return `${window.location.origin}?ref=${address}`;
    }, [address]);

    // Check URL for referral code and store in localStorage
    const checkReferralFromURL = useCallback(() => {
        const params = new URLSearchParams(window.location.search);
        const ref = params.get('ref');
        if (ref && ref.startsWith('aleo1') && ref.length >= 60) {
            const stored = localStorage.getItem(referralStorageKey());
            if (!stored) {
                localStorage.setItem(referralStorageKey(), ref);
            }
            return ref;
        }
        return localStorage.getItem(referralStorageKey());
    }, []);

    // Fetch referral stats — on Aleo, referral_count is in a mapping keyed by hash(address)
    // Client can't compute the hash easily → return 0 for now.
    const fetchReferralStats = useCallback(async () => {
        if (!address) return;
        // Aleo referral tracking requires hash(address) as key. Skip for now.
        setReferralStats({ count: 0, totalEarned: '0' });
    }, [address]);

    // Auto-check referral URL and fetch stats
    useEffect(() => {
        if (isConnected && address) {
            checkReferralFromURL();
            fetchReferralStats();
        }
    }, [isConnected, address, checkReferralFromURL, fetchReferralStats]);

    return {
        getReferralLink,
        referralStats,
        myReferrer,
        fetchReferralStats,
    };
}
