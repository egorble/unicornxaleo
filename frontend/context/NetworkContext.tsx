// Network context — currently single chain (Aleo Testnet)

import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import {
    NetworkConfig,
    getActiveNetwork,
    setActiveNetwork as setModuleNetwork,
    getActiveNetworkId,
    getAllNetworks,
} from '../lib/networks';
import { resetNFTModuleState } from '../hooks/useNFT';
import { resetPreloadState } from '../lib/preload';

interface NetworkContextType {
    activeNetwork: NetworkConfig;
    networkId: string;
    allNetworks: NetworkConfig[];
    switchNetwork: (id: string) => void;
}

const NetworkContext = createContext<NetworkContextType | null>(null);

export function NetworkProvider({ children }: { children: ReactNode }) {
    const [networkId, setNetworkId] = useState<string>(getActiveNetworkId());

    const switchNetwork = useCallback((id: string) => {
        // 1. Reset NFT dedup state (per-chain)
        resetNFTModuleState();
        // 2. Update module-level network (apiUrl() picks up new base)
        setModuleNetwork(id);
        // 3. Pre-fetch tournament + leaderboard for new network
        resetPreloadState();
        // 4. Trigger React re-render → components pick up new networkId
        //    usePollingData cacheKeys include networkId → new subscriptions auto-created
        //    Old network's cached data stays for instant switch-back
        setNetworkId(id);
    }, []);

    const value: NetworkContextType = {
        activeNetwork: getActiveNetwork(),
        networkId,
        allNetworks: getAllNetworks(),
        switchNetwork,
    };

    return (
        <NetworkContext.Provider value={value}>
            {children}
        </NetworkContext.Provider>
    );
}

export function useNetwork() {
    const context = useContext(NetworkContext);
    if (!context) {
        throw new Error('useNetwork must be used within NetworkProvider');
    }
    return context;
}
