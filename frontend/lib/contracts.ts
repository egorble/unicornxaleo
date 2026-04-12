// Aleo contract layer — mimics ethers.Contract API so UI hooks work unchanged.
// All "contracts" below are wrappers around Aleo program transitions & mapping reads.

import { getActiveNetwork, ALEO_PROGRAM_ID, ALEO_ADMIN, ALEO_ENDPOINT, ALEO_NETWORK } from './networks';

// ─── Chain shim (kept for UI compat; all UI expects "ETH", we expose ALEO) ─────
export const CHAIN_ID = 1;
export const CHAIN_NAME = 'Aleo Testnet';
export const RPC_URL = ALEO_ENDPOINT;
export const EXPLORER_URL = 'https://explorer.aleo.org';
export const METADATA_API = '';

export function getChainConfig() {
    const net = getActiveNetwork();
    return {
        chainId: net.chainId,
        chainName: net.name,
        rpcUrl: net.rpcUrl,
        explorerUrl: net.explorerUrl,
        nativeCurrency: net.nativeCurrency,
    };
}

export function getActiveContracts() {
    return getActiveNetwork().contracts;
}

// Legacy address constants — all point to the Aleo program for interface compat.
export const CONTRACTS = {
    UnicornX_NFT: ALEO_PROGRAM_ID,
    PackNFT: ALEO_PROGRAM_ID,
    PackOpener: ALEO_PROGRAM_ID,
    TournamentManager: ALEO_PROGRAM_ID,
    MarketplaceV2: ALEO_PROGRAM_ID,
    TokenLeagues: ALEO_PROGRAM_ID,
} as const;

// ─── Startup Data (19 YC startups, 1=Legendary..19=Common) ─────────────────────
export const STARTUPS: Record<number, { name: string; rarity: string; multiplier: number }> = {
    1: { name: 'Openclaw', rarity: 'Legendary', multiplier: 10 },
    2: { name: 'Lovable', rarity: 'Legendary', multiplier: 10 },
    3: { name: 'Cursor', rarity: 'Legendary', multiplier: 10 },
    4: { name: 'OpenAI', rarity: 'Legendary', multiplier: 10 },
    5: { name: 'Anthropic', rarity: 'Legendary', multiplier: 10 },
    6: { name: 'Browser Use', rarity: 'Epic', multiplier: 5 },
    7: { name: 'Dedalus Labs', rarity: 'Epic', multiplier: 5 },
    8: { name: 'Autumn', rarity: 'Epic', multiplier: 5 },
    9: { name: 'Axiom', rarity: 'Rare', multiplier: 3 },
    10: { name: 'Multifactor', rarity: 'Rare', multiplier: 3 },
    11: { name: 'Dome', rarity: 'Rare', multiplier: 3 },
    12: { name: 'GrazeMate', rarity: 'Rare', multiplier: 3 },
    13: { name: 'Tornyol Systems', rarity: 'Rare', multiplier: 3 },
    14: { name: 'Pocket', rarity: 'Common', multiplier: 1 },
    15: { name: 'Caretta', rarity: 'Common', multiplier: 1 },
    16: { name: 'AxionOrbital Space', rarity: 'Common', multiplier: 1 },
    17: { name: 'Freeport Markets', rarity: 'Common', multiplier: 1 },
    18: { name: 'Ruvo', rarity: 'Common', multiplier: 1 },
    19: { name: 'Lightberry', rarity: 'Common', multiplier: 1 },
};

// ─── Aleo REST helpers ─────────────────────────────────────────────────────────

// In-memory cache for mapping reads (TTL ~15s, dedupe in-flight)
const _mappingCache = new Map<string, { value: string | null; ts: number }>();
const _inflightMapping = new Map<string, Promise<string | null>>();
const MAPPING_TTL_MS = 15_000;

export async function readAleoMapping(mapping: string, key: string): Promise<string | null> {
    const cacheKey = `${mapping}:${key}`;
    const cached = _mappingCache.get(cacheKey);
    if (cached && (Date.now() - cached.ts) < MAPPING_TTL_MS) {
        return cached.value;
    }
    const inflight = _inflightMapping.get(cacheKey);
    if (inflight) return inflight;

    const promise = (async () => {
        try {
            const res = await fetch(`${ALEO_ENDPOINT}/${ALEO_NETWORK}/program/${ALEO_PROGRAM_ID}/mapping/${mapping}/${key}`);
            if (!res.ok) {
                _mappingCache.set(cacheKey, { value: null, ts: Date.now() });
                return null;
            }
            const text = await res.text();
            // Aleo API returns "null" literal for missing keys — normalize to JS null
            if (text === 'null' || text === '"null"' || text === '') {
                _mappingCache.set(cacheKey, { value: null, ts: Date.now() });
                return null;
            }
            const value = text.replace(/^"|"$/g, '');
            _mappingCache.set(cacheKey, { value, ts: Date.now() });
            return value;
        } catch {
            return null;
        } finally {
            _inflightMapping.delete(cacheKey);
        }
    })();
    _inflightMapping.set(cacheKey, promise);
    return promise;
}

export function invalidateMappingCache(mapping?: string) {
    if (mapping) {
        for (const k of Array.from(_mappingCache.keys())) {
            if (k.startsWith(mapping + ':')) _mappingCache.delete(k);
        }
    } else {
        _mappingCache.clear();
    }
}

export async function getAleoBlockHeight(): Promise<number> {
    try {
        const res = await fetch(`${ALEO_ENDPOINT}/${ALEO_NETWORK}/block/height/latest`);
        return parseInt(await res.text()) || 0;
    } catch { return 0; }
}

const _balanceCache = new Map<string, { value: bigint; ts: number }>();
const _inflightBalance = new Map<string, Promise<bigint>>();
const BALANCE_TTL_MS = 8_000;

export async function getAleoBalance(address: string): Promise<bigint> {
    const cached = _balanceCache.get(address);
    if (cached && (Date.now() - cached.ts) < BALANCE_TTL_MS) return cached.value;
    const inflight = _inflightBalance.get(address);
    if (inflight) return inflight;

    const promise = (async () => {
        try {
            const res = await fetch(`${ALEO_ENDPOINT}/${ALEO_NETWORK}/program/credits.aleo/mapping/account/${address}`);
            if (!res.ok) return 0n;
            const text = await res.text();
            const val = text.replace(/"/g, '').replace('u64', '');
            const bi = BigInt(val || '0');
            _balanceCache.set(address, { value: bi, ts: Date.now() });
            return bi;
        } catch {
            return 0n;
        } finally {
            _inflightBalance.delete(address);
        }
    })();
    _inflightBalance.set(address, promise);
    return promise;
}

// ─── Signer shim — Aleo wallet wrapper that looks like ethers.Signer ───────────

export interface AleoSignerLike {
    _isAleoSigner: true;
    address: string;
    getAddress: () => Promise<string>;
    // Execute an Aleo transition via the connected wallet
    execute: (functionName: string, inputs: string[], fee?: number) => Promise<string>;
    // Wallet-provided record fetchers (returns decrypted records when possible)
    requestRecords: (programId?: string) => Promise<any[]>;
    // Optional record decrypt helper (Shield wallet)
    decrypt?: (ciphertext: string) => Promise<string>;
}

// Module-level signer (set by WalletContext when wallet connects)
let _signer: AleoSignerLike | null = null;
export function setAleoSigner(signer: AleoSignerLike | null) { _signer = signer; }
export function getAleoSigner(): AleoSignerLike | null { return _signer; }

// ─── Contract wrappers (mimic ethers.Contract API) ─────────────────────────────
// Each "contract" exposes methods used by existing hooks. Read methods hit
// Aleo mappings; write methods call transitions via the signer.

interface AleoContract {
    [method: string]: any;
}

// Helper: write tx returns ethers-like { wait: () => Promise<{ hash, logs }> }
function wrapTxResult(txId: string) {
    return {
        hash: txId,
        wait: async () => ({ hash: txId, logs: [] }),
    };
}

function getSigner(signerOrProvider: any): AleoSignerLike | null {
    if (signerOrProvider && signerOrProvider._isAleoSigner) return signerOrProvider;
    return _signer;
}

// ─── NFT Contract (UnicornX_NFT) ─────────────────────────────────────────────

export function getNFTContract(signerOrProvider?: any): AleoContract {
    const signer = getSigner(signerOrProvider);

    return {
        // ─ Read methods ─
        async ownerOf(tokenId: bigint | number) {
            // On Aleo, ownership is private (in records). Public mapping only tracks existence.
            // Return current wallet address if card exists.
            const exists = await readAleoMapping('card_exists', `${tokenId}field`);
            return exists === 'true' ? (signer?.address || '0x0') : '0x0';
        },
        async balanceOf(address: string) {
            // Count user's card records via wallet
            if (!signer) return 0n;
            try {
                const records = await signer.requestRecords(ALEO_PROGRAM_ID);
                const cards = records.filter((r: any) =>
                    r.plaintext?.includes('card_id') &&
                    r.plaintext?.includes('startup_id') &&
                    !r.plaintext?.includes('card1_id') // not a LineupCommitment
                );
                return BigInt(cards.length);
            } catch { return 0n; }
        },
        async totalSupply() {
            const total = await readAleoMapping('total_cards_minted', '0u8');
            return BigInt((total || '0').replace(/u\d+/, ''));
        },
        async tokenToStartup(tokenId: bigint | number) {
            // Stored privately; return 0 (hooks should use card records instead)
            return 0n;
        },
        async tokenToEdition(tokenId: bigint | number) { return 0n; },
        async isLocked(tokenId: bigint | number) {
            // Cards are locked via UTXO consumption (record spent) — always false here
            return false;
        },
        async startupMintCount(startupId: bigint | number) {
            const count = await readAleoMapping('startup_editions', `${startupId}u8`);
            return BigInt((count || '0').replace(/u\d+/, ''));
        },
        async getCardInfo(tokenId: bigint | number) {
            // Private data — return default (hooks should use record-based loading)
            return {
                startupId: 0n, edition: 0n, rarity: 0,
                multiplier: 1n, isLocked: false, name: 'Private Card',
            };
        },
        async getOwnedTokens(address: string) {
            // Card IDs come from record plaintext — return empty for compat
            // (Hooks that use this should read records via wallet instead)
            return [];
        },
        async startups(id: bigint | number) {
            const s = STARTUPS[Number(id)];
            if (!s) return { name: 'Unknown', rarity: 0, multiplier: 1n };
            const rarityMap: Record<string, number> = { 'Common': 0, 'Rare': 1, 'Epic': 2, 'Legendary': 4 };
            return { name: s.name, rarity: rarityMap[s.rarity] || 0, multiplier: BigInt(s.multiplier) };
        },
        async getCardLevel(tokenId: bigint | number) { return 1; },
        async upgradeChance(level: number) {
            const chances: Record<number, number> = { 1: 8000, 2: 7000, 3: 6000, 4: 5000 };
            return chances[level] || 0;
        },

        // ─ Write methods ─
        async mergeCards(_tokenIds: [bigint, bigint, bigint]) {
            throw new Error('mergeCards must be called with Aleo card records — use hooks directly');
        },
        async upgradeCard(_tokenId: bigint | number) {
            throw new Error('upgradeCard must be called with Aleo card record — use hooks directly');
        },
        async approve() { return wrapTxResult('no-op'); },
        async setApprovalForAll() { return wrapTxResult('no-op'); },

        interface: {
            parseLog: (_log: any) => null,
        },
    };
}

// ─── PackNFT Contract ──────────────────────────────────────────────────────────

export function getPackNFTContract(signerOrProvider?: any): AleoContract {
    const signer = getSigner(signerOrProvider);

    return {
        async balanceOf(address: string) {
            if (!signer) return 0n;
            try {
                const records = await signer.requestRecords(ALEO_PROGRAM_ID);
                const packs = records.filter((r: any) =>
                    r.plaintext?.includes('pack_id') && !r.plaintext?.includes('card_id')
                );
                return BigInt(packs.length);
            } catch { return 0n; }
        },
        async ownerOf() { return signer?.address || '0x0'; },
        async totalSupply() {
            const t = await readAleoMapping('total_packs_sold', '0u8');
            return BigInt((t || '0').replace(/u\d+/, ''));
        },
        async maxSupply() { return 10000n; },
        async getOwnedTokens(address: string) {
            // Pack IDs are in private records — hooks should fetch records directly
            return [];
        },
        async tokenURI() { return ''; },
    };
}

// ─── PackOpener Contract ───────────────────────────────────────────────────────

export function getPackOpenerContract(signerOrProvider?: any): AleoContract {
    const signer = getSigner(signerOrProvider);

    return {
        async currentPackPrice() {
            const p = await readAleoMapping('pack_price', '0u8');
            if (!p || !p.trim()) return 100000n; // 0.1 ALEO default
            return safeBigInt(p.replace(/u\d+/, ''), 100000n);
        },
        async packsSold() {
            const t = await readAleoMapping('total_packs_sold', '0u8');
            return BigInt((t || '0').replace(/u\d+/, ''));
        },
        async activeTournamentId() {
            // Tournament ID is a field in Aleo; we hardcode default or read from backend
            return 2n;
        },
        async uniqueBuyerCount() { return 0n; },
        async referrers(_address: string) { return '0x0'; },
        async referralEarnings(_address: string) { return 0n; },
        async referralCount(_address: string) { return 0n; },

        // Writes
        async buyPack(_referrer: string, _opts: any) {
            throw new Error('buyPack: use usePacks hook with Aleo records');
        },
        async buyMultiplePacks() {
            throw new Error('buyMultiplePacks: use usePacks hook');
        },
        async openPack() {
            throw new Error('openPack: use usePacks hook');
        },
    };
}

// ─── Tournament Contract ───────────────────────────────────────────────────────

export function getTournamentContract(signerOrProvider?: any): AleoContract {
    const signer = getSigner(signerOrProvider);

    return {
        async getTournament(tournamentId: bigint | number) {
            const data = await readAleoMapping('tournaments', `${tournamentId}field`);
            if (!data) {
                return {
                    id: BigInt(tournamentId),
                    registrationStart: 0n, startTime: 0n, endTime: 0n,
                    prizePool: 0n, entryCount: 0n, status: 3,
                };
            }
            // Parse struct: { registration_height: Xu32, start_height: Xu32, ... }
            const getField = (k: string) => {
                const m = data.match(new RegExp(`${k}:\\s*(\\d+)u\\d+`));
                return m ? BigInt(m[1]) : 0n;
            };
            const blockHeight = await getAleoBlockHeight();
            const regHeight = getField('registration_height');
            const startHeight = getField('start_height');
            const endHeight = getField('end_height');
            const status = Number(getField('status'));

            // Convert block heights to unix timestamps (approximate: 1 block = 1 sec)
            const now = Math.floor(Date.now() / 1000);
            const registrationStart = BigInt(now - (blockHeight - Number(regHeight)));
            const startTime = BigInt(now - (blockHeight - Number(startHeight)));
            const endTime = BigInt(now - (blockHeight - Number(endHeight)));

            return {
                id: BigInt(tournamentId),
                registrationStart,
                startTime,
                endTime,
                prizePool: getField('prize_pool'),
                entryCount: getField('entry_count'),
                status,
            };
        },
        async canRegister(tournamentId: bigint | number) {
            const data = await (this as any).getTournament(tournamentId);
            const now = Math.floor(Date.now() / 1000);
            return data.status === 0 && now >= Number(data.registrationStart) && now < Number(data.startTime);
        },
        async hasEntered(tournamentId: bigint | number, address: string) {
            // Requires hash(PlayerTournament) — we can't compute on client easily.
            // Return false and let frontend check via records.
            return false;
        },
        async getUserLineup(tournamentId: bigint | number, _address: string) {
            return {
                cardIds: [0n, 0n, 0n, 0n, 0n],
                owner: signer?.address || '0x0',
                timestamp: 0n,
                cancelled: false,
                claimed: false,
            };
        },
        async getUserPrize() { return 0n; },
        async getTournamentPoints() { return new Array(19).fill(0n); },
        async getTournamentParticipants() { return []; },
        async getActiveEntryCount(tournamentId: bigint | number) {
            const t = await (this as any).getTournament(tournamentId);
            return t.entryCount;
        },
        async getUserScoreInfo() {
            return { userScore: 0n, userPrize: 0n, totalScore: 0n };
        },
        async nextTournamentId() { return 3n; },

        // Writes
        async enterTournament() {
            throw new Error('enterTournament: use useTournament hook with Aleo card records');
        },
        async cancelEntry() {
            throw new Error('cancelEntry: use useTournament hook');
        },
        async claimPrize() {
            throw new Error('claimPrize: use useTournament hook');
        },
    };
}

// ─── MarketplaceV2 Contract (stub — marketplace not yet on Aleo) ───────────────

export function getMarketplaceV2Contract(_signerOrProvider?: any): AleoContract {
    return {
        async getActiveListings() { return []; },
        async getListing() { return null; },
        async getListingsBySeller() { return []; },
        async getActiveListingCount() { return 0n; },
        async isTokenListed() { return false; },
        async isPackListed() { return false; },
        async getActiveBidsForToken() { return []; },
        async getBidsOnToken() { return []; },
        async getBidsOnPack() { return []; },
        async getUserBids() { return []; },
        async getActiveAuctions() { return []; },
        async getAuction() { return null; },
        async getActiveAuctionCount() { return 0n; },
        async getTokenSaleHistory() { return []; },
        async getUserSaleHistory() { return []; },
        async getTokenStats() {
            return { lastSalePrice: 0n, totalVolume: 0n, salesCount: 0n, highestSale: 0n, lowestSale: 0n };
        },
        async getGlobalStats() {
            return { _totalVolume: 0n, _totalSales: 0n, _activeListings: 0n, _activeAuctions: 0n };
        },
    };
}

// ─── TokenLeagues Contract (stub) ──────────────────────────────────────────────

export function getTokenLeaguesContract(_signerOrProvider?: any): AleoContract {
    return {
        async getCurrentCycle() { return null; },
        async getAllTokens() { return []; },
        async getUserEntry() { return null; },
        async currentCycleId() { return 0n; },
        async entryFee() { return 100000n; },
    };
}

// ─── Provider shims ────────────────────────────────────────────────────────────

export function getProvider() { return null; }

export function getReadProvider() { return null; }

// ─── Formatting helpers ───────────────────────────────────────────────────────

/** Format microcredits to ALEO string (safe against null/undefined) */
export function formatXTZ(microcredits: bigint | string | number | null | undefined): string {
    if (microcredits == null) return '0.0000';
    try {
        const n = typeof microcredits === 'bigint'
            ? Number(microcredits)
            : Number(microcredits);
        if (Number.isNaN(n)) return '0.0000';
        return (n / 1_000_000).toFixed(4);
    } catch {
        return '0.0000';
    }
}

/** Parse ALEO string to microcredits */
export function parseXTZ(aleo: string): bigint {
    if (!aleo) return 0n;
    const n = parseFloat(aleo);
    if (Number.isNaN(n)) return 0n;
    return BigInt(Math.floor(n * 1_000_000));
}

/** Safe BigInt conversion that returns 0n on null/undefined/invalid */
export function safeBigInt(val: any, fallback: bigint = 0n): bigint {
    if (val == null || val === '') return fallback;
    try { return BigInt(val); } catch { return fallback; }
}

// Legacy ABI exports (empty arrays for import compat)
export const NFT_ABI: any[] = [];
export const PACK_NFT_ABI: any[] = [];
export const PACK_OPENER_ABI: any[] = [];
export const TOURNAMENT_ABI: any[] = [];
export const MARKETPLACE_V2_ABI: any[] = [];
export const TOKEN_LEAGUES_ABI: any[] = [];

// ─── ethers compat shim ────────────────────────────────────────────────────
// Components that still import { ethers } from 'ethers' can import this instead.
// Provides just the formatters used in the UI (formatEther / parseEther).
// NOTE: On Aleo these operate on microcredits (6 decimals), NOT ETH (18).
export const ethers = {
    formatEther(val: bigint | string | number | null | undefined): string {
        if (val == null) return '0';
        try {
            const micro = typeof val === 'bigint' ? Number(val) : Number(val);
            if (Number.isNaN(micro)) return '0';
            return (micro / 1_000_000).toString();
        } catch { return '0'; }
    },
    parseEther(aleo: string | null | undefined): bigint {
        if (!aleo) return 0n;
        const n = parseFloat(aleo);
        if (Number.isNaN(n)) return 0n;
        return BigInt(Math.floor(n * 1_000_000));
    },
    ZeroAddress: 'aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq0q2qqu',
    BrowserProvider: class { constructor() {} async getSigner() { return null; } },
    JsonRpcProvider: class { constructor() {} },
    Contract: class { constructor() {} },
    formatUnits(val: bigint | string | number | null | undefined, decimals: number | string = 6): string {
        if (val == null) return '0';
        try {
            const div = 10 ** Number(decimals || 6);
            const n = typeof val === 'bigint' ? Number(val) : Number(val);
            if (Number.isNaN(n)) return '0';
            return (n / div).toString();
        } catch { return '0'; }
    },
    parseUnits(val: string | null | undefined, decimals: number | string = 6): bigint {
        if (!val) return 0n;
        const n = parseFloat(val);
        if (Number.isNaN(n)) return 0n;
        const mult = 10 ** Number(decimals || 6);
        return BigInt(Math.floor(n * mult));
    },
};

// Also re-export as a module-level constant for `import { ethers } from 'ethers'` style.
export type EthersLike = typeof ethers;
