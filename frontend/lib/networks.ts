// Network registry — Aleo Testnet (single chain)

export interface NetworkConfig {
    id: string;
    name: string;
    shortName: string;
    chainId: number;        // kept for interface compat (not used on Aleo)
    rpcUrl: string;         // Aleo explorer API
    explorerUrl: string;
    nativeCurrency: { name: string; symbol: string; decimals: number };
    contracts: {
        // Aleo program IDs (not addresses) — kept under same names for compat
        UnicornX_NFT: string;
        PackNFT: string;
        PackOpener: string;
        TournamentManager: string;
        MarketplaceV2: string;
        TokenLeagues: string;
    };
    apiBase: string;
    metadataBase: string;
    packPrice: bigint;      // 0.1 ALEO in microcredits
    icon: string;
    deployed: boolean;
    // Aleo-specific
    programId: string;
    adminAddress: string;
}

export const ALEO_PROGRAM_ID = import.meta.env.VITE_PROGRAM_ID || 'unicornx_v3.aleo';
export const ALEO_ADMIN = 'aleo1d96ex9hc8j5hj3wwu7elyxsm4dzphw6u7t9vx5hnpg5mjh6anvxqeqcq64';
export const ALEO_ENDPOINT = import.meta.env.VITE_ENDPOINT || 'https://api.explorer.provable.com/v1';
export const ALEO_NETWORK = import.meta.env.VITE_NETWORK || 'testnet';

export const NETWORKS: Record<string, NetworkConfig> = {
    aleo: {
        id: 'aleo',
        name: 'Aleo Testnet',
        shortName: 'ALEO',
        chainId: 1,
        rpcUrl: ALEO_ENDPOINT,
        explorerUrl: 'https://explorer.aleo.org',
        nativeCurrency: { name: 'Aleo Credits', symbol: 'ALEO', decimals: 6 },
        contracts: {
            // All point to the single Aleo program — UI uses these as "routes"
            UnicornX_NFT: ALEO_PROGRAM_ID,
            PackNFT: ALEO_PROGRAM_ID,
            PackOpener: ALEO_PROGRAM_ID,
            TournamentManager: ALEO_PROGRAM_ID,
            MarketplaceV2: ALEO_PROGRAM_ID,
            TokenLeagues: ALEO_PROGRAM_ID,
        },
        apiBase: '/api',
        metadataBase: '/metadata',
        packPrice: BigInt('100000'),  // 0.1 ALEO = 100_000 microcredits
        icon: '',
        deployed: true,
        programId: ALEO_PROGRAM_ID,
        adminAddress: ALEO_ADMIN,
    },
};

let _activeId: string = 'aleo';

export function getActiveNetwork(): NetworkConfig {
    return NETWORKS[_activeId] || NETWORKS.aleo;
}

export function setActiveNetwork(id: string) {
    if (!NETWORKS[id]) return;
    _activeId = id;
    if (typeof localStorage !== 'undefined') {
        localStorage.setItem('unicornx:network', id);
    }
}

export function getActiveNetworkId(): string {
    return _activeId;
}

export function getAllNetworks(): NetworkConfig[] {
    return Object.values(NETWORKS);
}

/** Short currency symbol for the active network */
export function currencySymbol(): string {
    return getActiveNetwork().nativeCurrency.symbol;
}
