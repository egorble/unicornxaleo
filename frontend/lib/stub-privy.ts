// Privy stub — never mounted, kept only for import compat.
import React from 'react';

export function PrivyProvider({ children }: any) {
    return children;
}

export function usePrivy() {
    return {
        ready: true,
        authenticated: false,
        user: null,
        login: () => {},
        logout: async () => {},
    };
}

export function useWallets() {
    return { wallets: [], ready: true };
}
