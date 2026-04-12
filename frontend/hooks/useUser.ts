import { useState, useCallback, useEffect } from 'react';
import { useWalletContext } from '../context/WalletContext';
import { generatePixelAvatar } from '../lib/pixelAvatar';

import { apiUrl } from '../lib/api';
import { getActiveNetworkId } from '../lib/networks';

function profileCacheKey(): string {
    return `unicornx_profile_${getActiveNetworkId()}`;
}

export interface UserProfileData {
    address: string;
    username: string;
    avatar: string | null;
}

function getCachedProfile(addr: string): UserProfileData | null {
    try {
        const raw = localStorage.getItem(profileCacheKey());
        if (!raw) return null;
        const cached = JSON.parse(raw);
        if (cached.address === addr.toLowerCase()) return cached;
    } catch { /* ignore */ }
    return null;
}

function cacheProfile(profile: UserProfileData) {
    try {
        localStorage.setItem(profileCacheKey(), JSON.stringify(profile));
    } catch { /* ignore */ }
}

function clearProfileCache() {
    try { localStorage.removeItem(profileCacheKey()); } catch { /* ignore */ }
}

export function useUser() {
    const { address, isConnected } = useWalletContext();
    const [profile, setProfile] = useState<UserProfileData | null>(null);
    const [needsRegistration, setNeedsRegistration] = useState(false);
    const [loading, setLoading] = useState(false);
    const [isNewUser, setIsNewUser] = useState(false);

    // Check if user exists in backend
    const checkUser = useCallback(async (addr: string) => {
        const lowerAddr = addr.toLowerCase();

        // Try localStorage cache first — instant, no flicker
        const cached = getCachedProfile(lowerAddr);
        if (cached) {
            setProfile(cached);
            setNeedsRegistration(false);
            setIsNewUser(false);
        }

        try {
            setLoading(true);
            const res = await fetch(apiUrl(`/users/${lowerAddr}`));

            // Only treat 200 OK as authoritative — anything else is an error, not "user not found"
            if (!res.ok) {
                // Server error / rate limit — don't show registration modal
                if (!cached) {
                    setNeedsRegistration(false);
                }
                return;
            }

            const data = await res.json();

            if (data.success && data.data) {
                const p: UserProfileData = {
                    address: data.data.address,
                    username: data.data.username,
                    avatar: data.data.avatar || generatePixelAvatar(lowerAddr),
                };
                setProfile(p);
                cacheProfile(p);
                setNeedsRegistration(false);
                setIsNewUser(false);
            } else {
                // Backend explicitly confirmed user doesn't exist (200 + success:false)
                setProfile(null);
                clearProfileCache();
                setNeedsRegistration(true);
                setIsNewUser(true);
            }
        } catch {
            // Network error — don't show registration modal, keep cached profile if any
            if (!cached) {
                setNeedsRegistration(false);
            }
        } finally {
            setLoading(false);
        }
    }, []);

    // Register new user
    const registerUser = useCallback(async (username: string, avatarDataUrl?: string) => {
        if (!address) return false;

        try {
            setLoading(true);

            // Check for stored referrer to send with registration
            let referrer = localStorage.getItem(`unicornx_referrer_${getActiveNetworkId()}`);
            if (!referrer) {
                const params = new URLSearchParams(window.location.search);
                const ref = params.get('ref');
                if (ref && ref.startsWith('0x') && ref.length === 42) {
                    referrer = ref.toLowerCase();
                }
            }

            const res = await fetch(apiUrl(`/users/register`), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    address: address.toLowerCase(),
                    username,
                    avatar: avatarDataUrl || null,
                    referrer: referrer || null,
                }),
            });
            const data = await res.json();

            if (data.success) {
                const p: UserProfileData = {
                    address: data.data.address,
                    username: data.data.username,
                    avatar: data.data.avatar || generatePixelAvatar(address),
                };
                setProfile(p);
                cacheProfile(p);
                setNeedsRegistration(false);
                setIsNewUser(data.isNew);
                return data.isNew;
            }
            return false;
        } catch {
            return false;
        } finally {
            setLoading(false);
        }
    }, [address]);

    // Update existing profile
    const updateProfile = useCallback(async (username: string, avatarDataUrl?: string) => {
        if (!address) return false;

        try {
            setLoading(true);

            const res = await fetch(apiUrl(`/users/${address.toLowerCase()}`), {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    address: address.toLowerCase(),
                    username,
                    avatar: avatarDataUrl || null,
                }),
            });
            const data = await res.json();

            if (data.success) {
                const p: UserProfileData = {
                    address: data.data.address,
                    username: data.data.username,
                    avatar: data.data.avatar || generatePixelAvatar(address),
                };
                setProfile(p);
                cacheProfile(p);
                return true;
            }
            return false;
        } catch {
            return false;
        } finally {
            setLoading(false);
        }
    }, [address]);

    // Get generated pixel avatar for address
    const getPixelAvatar = useCallback((addr?: string) => {
        return generatePixelAvatar(addr || address || '');
    }, [address]);

    // Check user on wallet connect
    useEffect(() => {
        if (isConnected && address) {
            checkUser(address);
        } else {
            setProfile(null);
            clearProfileCache();
            setNeedsRegistration(false);
            setIsNewUser(false);
        }
    }, [isConnected, address, checkUser]);

    return {
        profile,
        needsRegistration,
        isNewUser,
        loading,
        registerUser,
        updateProfile,
        getPixelAvatar,
    };
}
