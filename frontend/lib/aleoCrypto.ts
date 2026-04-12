// Aleo cryptography helpers — all client-side via @provablehq/sdk WASM.
// No backend needed for commitment computation or mapping queries.

import { BHP256, Plaintext, initializeWasm } from '@provablehq/sdk';
import { ALEO_ENDPOINT, ALEO_NETWORK, ALEO_PROGRAM_ID } from './networks';

// Initialize WASM once at app start
let wasmReady: Promise<void> | null = null;
export const ensureWasm = () => (wasmReady ??= initializeWasm().then(() => undefined));

const MAPPING_BASE = `${ALEO_ENDPOINT}/${ALEO_NETWORK}`;

// ═══════════════════════════════════════════════════════════════════
// Mapping queries (direct HTTP to Aleo explorer)
// ═══════════════════════════════════════════════════════════════════

export async function readMapping(mapping: string, key: string, program = ALEO_PROGRAM_ID): Promise<string | null> {
    const url = `${MAPPING_BASE}/program/${program}/mapping/${mapping}/${encodeURIComponent(key)}`;
    try {
        const res = await fetch(url);
        if (!res.ok) return null;
        const text = await res.text();
        const parsed = JSON.parse(text);
        return parsed === null ? null : String(parsed);
    } catch (e) {
        console.warn('[readMapping]', mapping, key, e);
        return null;
    }
}

// ═══════════════════════════════════════════════════════════════════
// Commitment computation (BHP256::hash_to_field(CardProof))
// ═══════════════════════════════════════════════════════════════════

export interface CardProofData {
    card_id: string;      // "123" or "123field"
    card_owner: string;   // "aleo1..."
    startup_id: number;
    rarity: number;
    level: number;
    salt: string;         // "456" or "456field"
}

function withField(v: string): string {
    const s = String(v);
    return s.endsWith('field') ? s : `${s}field`;
}

/**
 * Compute BHP256::hash_to_field(CardProof) exactly as Leo contract does.
 * Returns commitment as "<digits>field" string.
 */
export async function computeCardCommitment(p: CardProofData): Promise<string | null> {
    try {
        await ensureWasm();
        const literal =
            `{ card_id: ${withField(p.card_id)}, ` +
            `card_owner: ${p.card_owner}, ` +
            `startup_id: ${p.startup_id}u8, ` +
            `rarity: ${p.rarity}u8, ` +
            `level: ${p.level}u8, ` +
            `salt: ${withField(p.salt)} }`;
        const pt = Plaintext.fromString(literal);
        // BHP256.hash() expects a boolean bit array, not a Field array
        const bits = pt.toBitsLe();
        const hasher = new BHP256();
        const commitment = hasher.hash(bits).toString();
        try { (hasher as any).free?.(); } catch { }
        try { (pt as any).free?.(); } catch { }
        return commitment;
    } catch (e) {
        console.error('[computeCardCommitment] failed:', e, p);
        return null;
    }
}

/**
 * Compute BHP256::hash_to_field(PlayerTournament { tournament_id, player }).
 * Used to check / build keys for `player_entered` and `player_scores` mappings.
 */
export async function computeEntryKey(tournamentId: number | string, player: string): Promise<string | null> {
    try {
        await ensureWasm();
        const tid = String(tournamentId).replace('field', '');
        const literal = `{ tournament_id: ${tid}field, player: ${player} }`;
        const pt = Plaintext.fromString(literal);
        const bits = pt.toBitsLe();
        const hasher = new BHP256();
        const key = hasher.hash(bits).toString();
        try { (hasher as any).free?.(); } catch { }
        try { (pt as any).free?.(); } catch { }
        return key;
    } catch (e) {
        console.error('[computeEntryKey] failed:', e, tournamentId, player);
        return null;
    }
}

/**
 * Compute BHP256::hash_to_field(address as field) — used as key for user-indexed mappings.
 */
export async function hashAddressField(address: string): Promise<string | null> {
    try {
        await ensureWasm();
        // BHP256::hash_to_field(addr as field) — hash the field value's bit representation
        // We wrap the field value in a Plaintext literal to get its bits.
        const { Address } = await import('@provablehq/sdk');
        const addrObj = Address.from_string(address);
        const asField = addrObj.toField();
        const fieldStr = asField.toString();  // "<digits>field"
        // Convert field to bits by parsing it as Plaintext
        const pt = Plaintext.fromString(fieldStr);
        const bits = pt.toBitsLe();
        const hasher = new BHP256();
        const commitment = hasher.hash(bits).toString();
        try { (hasher as any).free?.(); } catch { }
        try { (pt as any).free?.(); } catch { }
        try { (asField as any).free?.(); } catch { }
        try { (addrObj as any).free?.(); } catch { }
        return commitment;
    } catch (e) {
        console.error('[hashAddressField] failed:', e, address);
        return null;
    }
}

// ═══════════════════════════════════════════════════════════════════
// Alive check for a single card (parallelizable by caller)
// ═══════════════════════════════════════════════════════════════════

export async function isCardAliveOnChain(proof: CardProofData): Promise<boolean> {
    const commitment = await computeCardCommitment(proof);
    if (!commitment) return true; // On computation error, assume alive (don't hide cards)
    const value = await readMapping('cards', commitment);
    return value !== null && value !== undefined && value !== 'null';
}

/**
 * Fetch on-chain CardData for a single card. Returns null if not in mapping (dead/burned).
 */
export async function getCardStateOnChain(proof: CardProofData): Promise<{ alive: boolean; locked: boolean }> {
    const commitment = await computeCardCommitment(proof);
    if (!commitment) return { alive: true, locked: false };
    const value = await readMapping('cards', commitment);
    if (!value || value === 'null') return { alive: false, locked: false };
    const locked = /locked:\s*true/.test(value);
    return { alive: true, locked };
}

/**
 * Check many cards in parallel. Returns alive/dead raw_ids AND locked raw_ids.
 * Locked = cards stored in mapping with locked:true (registered in an active tournament).
 */
export async function batchCheckAlive(cards: CardProofData[]): Promise<{ alive: string[]; dead: string[]; locked: string[] }> {
    const results = await Promise.all(cards.map(async (c) => {
        const state = await getCardStateOnChain(c);
        const rawId = String(c.card_id).replace('field', '');
        return { rawId, ...state };
    }));
    return {
        alive: results.filter(r => r.alive).map(r => r.rawId),
        dead: results.filter(r => !r.alive).map(r => r.rawId),
        locked: results.filter(r => r.alive && r.locked).map(r => r.rawId),
    };
}

// No-op functions kept for backward compat
export function clearAliveCache(): void { /* no cache — always on-chain */ }

/**
 * Check many cards in parallel by querying on-chain mapping directly.
 * No cache — always fresh.
 */
export async function batchCheckAliveCached(cards: CardProofData[]): Promise<{ alive: string[]; dead: string[]; locked: string[] }> {
    return batchCheckAlive(cards);
}
