// Shared in-memory state for optimistic Marketplace UI.
// When a list/cancel/buy tx is submitted to Shield, we immediately mark the
// target (card/pack/listing) as "syncing" so the UI shows an overlay until
// the on-chain state reflects the change. TTL is a safety net.

export type MarketSyncKind =
    | 'card-list'     // user is listing a card they own
    | 'card-cancel'   // user is cancelling their card listing
    | 'card-buy'      // user is buying a card listing
    | 'pack-list'     // user is listing a pack
    | 'pack-cancel'   // user is cancelling their pack listing
    | 'pack-buy';     // user is buying a pack listing

export interface MarketSyncEntry {
    kind: MarketSyncKind;
    label: string;
    addedAt: number;
}

const TTL_MS = 3 * 60 * 1000; // 3 minutes — Aleo tx confirmation ceiling

const _state = new Map<string, MarketSyncEntry>();
const _listeners = new Set<() => void>();

function prune() {
    const now = Date.now();
    let changed = false;
    for (const [key, entry] of _state.entries()) {
        if (now - entry.addedAt > TTL_MS) {
            _state.delete(key);
            changed = true;
        }
    }
    if (changed) _listeners.forEach(l => l());
}

export function markMarketSyncing(key: string, kind: MarketSyncKind, label: string) {
    prune();
    _state.set(key, { kind, label, addedAt: Date.now() });
    _listeners.forEach(l => l());
}

export function clearMarketSyncing(key: string) {
    if (_state.delete(key)) _listeners.forEach(l => l());
}

export function getMarketSyncing(key: string): MarketSyncEntry | null {
    prune();
    return _state.get(key) ?? null;
}

export function subscribeMarketSyncing(cb: () => void): () => void {
    _listeners.add(cb);
    return () => { _listeners.delete(cb); };
}

// Key helpers — unified format so overlays match across views.
export const marketKey = {
    card: (tokenId: bigint | number | string) => `card:${String(tokenId)}`,
    pack: (packId: bigint | number | string) => `pack:${String(packId)}`,
    listing: (listingId: bigint | number | string) => `listing:${String(listingId)}`,
};
