// Wallet context — Aleo wallet adapter (Leo, Fox, Puzzle).
// Preserves the same interface as the original EVM WalletContext so that UI
// components and hooks keep working without changes.

import React, { createContext, useContext, ReactNode, useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useWallet as useAleoWallet } from '@provablehq/aleo-wallet-adaptor-react';
import { useWalletModal } from '@provablehq/aleo-wallet-adaptor-react-ui';
import { getActiveNetwork } from '../lib/networks';
import { useNetwork } from './NetworkContext';
import { setAleoSigner, AleoSignerLike, getAleoBalance } from '../lib/contracts';

// ── Interface (same shape as original EVM context) ───────────────────────────

interface WalletContextType {
    isConnected: boolean;
    address: string | null;
    balance: bigint;
    balanceLoading: boolean;
    chainId: number | null;
    isCorrectChain: boolean;
    isConnecting: boolean;
    hasSavedWallet: boolean;     // walletName persisted in localStorage
    error: string | null;
    connect: () => void;
    connectRiseWallet: () => void;
    disconnect: () => void;
    switchChain: () => Promise<void>;
    getSigner: () => Promise<any | null>;    // Returns AleoSignerLike (typed as any for compat)
    signMessage: (message: string) => Promise<string | null>;
    refreshBalance: () => void;
    formatAddress: (address: string) => string;
    formatBalance: (microcredits: bigint, decimals?: number) => string;
    walletProvider: any | null;
    // Aleo-specific: parsed records exposed globally so all hooks share state
    cardRecords: any[];          // raw Card records (with plaintext)
    packRecords: any[];          // raw Pack records (with plaintext)
    refreshRecords: () => Promise<void>;
}

const WalletContext = createContext<WalletContextType | null>(null);

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatAddress(address: string): string {
    if (!address) return '';
    return `${address.slice(0, 8)}...${address.slice(-6)}`;
}

function formatBalance(microcredits: bigint, decimals = 4): string {
    const aleo = Number(microcredits) / 1_000_000;
    return aleo.toLocaleString(undefined, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
    });
}

// ── Provider ─────────────────────────────────────────────────────────────────

export function WalletProvider({ children }: { children: ReactNode }) {
    const { activeNetwork } = useNetwork();
    const aleoWallet = useAleoWallet();
    const walletModal = useWalletModal();

    const address = aleoWallet.publicKey || aleoWallet.address || null;
    const isConnected = !!aleoWallet.connected;
    const isConnecting = !!aleoWallet.connecting;
    const wallet = aleoWallet.wallet;
    // Check localStorage for previously connected wallet name
    const hasSavedWallet = typeof window !== 'undefined'
        ? !!localStorage.getItem('walletName')
        : false;

    const [balance, setBalance] = useState<bigint>(0n);
    const [balanceLoading, setBalanceLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [cardRecords, setCardRecords] = useState<any[]>([]);
    const [packRecords, setPackRecords] = useState<any[]>([]);

    // Chain always matches (Aleo testnet only)
    const chainId = activeNetwork.chainId;
    const isCorrectChain = true;

    // ── Balance polling (public balance from Aleo credits mapping) ───────────
    const updateBalance = useCallback(async (addr: string) => {
        try {
            const bal = await getAleoBalance(addr);
            setBalance(bal);
        } catch {
            // keep previous
        } finally {
            setBalanceLoading(false);
        }
    }, []);

    useEffect(() => {
        if (!address) {
            setBalance(0n);
            setBalanceLoading(false);
            return;
        }
        setBalanceLoading(true);
        updateBalance(address);
        const interval = setInterval(() => updateBalance(address), 10_000);
        return () => clearInterval(interval);
    }, [address, updateBalance]);

    const refreshBalance = useCallback(() => {
        if (address) updateBalance(address);
    }, [address, updateBalance]);

    // ── Connect / Disconnect ─────────────────────────────────────────────────
    const connect = useCallback(async () => {
        setError(null);
        try {
            // If we have a remembered wallet, try to reconnect to it directly
            const savedWallet = localStorage.getItem('walletName');
            const savedWalletClean = savedWallet ? savedWallet.replace(/^"|"$/g, '') : null;

            if (savedWalletClean && aleoWallet.wallets) {
                const match = aleoWallet.wallets.find((w: any) =>
                    (w.adapter?.name || '') === savedWalletClean
                );
                if (match) {
                    console.log('[WalletContext] Auto-reconnecting to', savedWalletClean);
                    (aleoWallet as any).selectWallet?.(match.adapter.name);
                    // autoConnect effect will pick it up
                    return;
                }
            }
            // No saved wallet — open modal for user to pick
            walletModal.setVisible(true);
        } catch (e: any) {
            setError(e?.message || 'Failed to open wallet modal');
        }
    }, [walletModal, aleoWallet]);

    // Alias for backward compat (original used connectRiseWallet)
    const connectRiseWallet = connect;

    const disconnect = useCallback(async () => {
        setError(null);
        try {
            await aleoWallet.disconnect?.();
        } catch { /* ignore */ }
    }, [aleoWallet]);

    // ── Chain switch (no-op on Aleo, single network) ─────────────────────────
    const switchChain = useCallback(async () => {
        // Aleo has only one network in this app
        return;
    }, []);

    // ── signMessage ──────────────────────────────────────────────────────────
    const signMessage = useCallback(async (message: string): Promise<string | null> => {
        try {
            const bytes = new TextEncoder().encode(message);
            const result = await (aleoWallet as any).signMessage?.(bytes);
            if (!result) return null;
            if (typeof result === 'string') return result;
            if (result.signature) return String(result.signature);
            return String(result);
        } catch {
            return null;
        }
    }, [aleoWallet]);

    // ── In-memory spent record tracking (Shield doesn't update cache instantly) ──
    const spentCommitmentsRef = useRef<Set<string>>(new Set());
    // Forward-ref to refreshRecords (set later, used inside signer.execute)
    const refreshRecordsRef = useRef<(() => Promise<void>) | null>(null);

    // ── Records cache: program → { records, ts } ──
    // Single in-memory cache shared across all hooks. TTL ~10s, invalidated on write.
    const recordsCacheRef = useRef<Map<string, { records: any[]; ts: number }>>(new Map());
    // Decrypt cache: ciphertext → plaintext (lifetime of session)
    const decryptCacheRef = useRef<Map<string, string>>(new Map());
    // In-flight requestRecords promises (dedupe simultaneous calls)
    const inflightRecordsRef = useRef<Map<string, Promise<any[]>>>(new Map());

    const RECORDS_TTL_MS = 3_000;

    const invalidateRecords = useCallback((programId?: string) => {
        if (programId) recordsCacheRef.current.delete(programId);
        else recordsCacheRef.current.clear();
    }, []);

    // ── AleoSigner wrapper (analog of ethers.Signer) ─────────────────────────
    const signer = useMemo<AleoSignerLike | null>(() => {
        if (!isConnected || !address) return null;

        const s: AleoSignerLike = {
            _isAleoSigner: true,
            address,
            getAddress: async () => address,
            execute: async (functionName: string, inputs: string[], fee = 500000) => {
                const exec = (aleoWallet as any).executeTransaction;
                const transactionStatus = (aleoWallet as any).transactionStatus;

                // Strip _version from record plaintext before passing to Shield wallet.
                // Shield's VM doesn't accept _version as a record entry.
                // Shield finds records by its own internal index, not by recomputing commitment.
                inputs = inputs.map((inp: string) => {
                    if (typeof inp !== 'string' || !inp.includes('_version')) return inp;
                    return inp
                        .replace(/,?\s*_version:\s*\d+u8\.public/g, '')
                        .replace(/,(\s*\})/g, '$1');
                });

                // Collect nonces from input records (mark as spent AFTER confirmed, not before)
                const inputNonces: string[] = [];
                for (const inp of inputs) {
                    if (typeof inp === 'string' && inp.includes('_nonce:')) {
                        const nonceMatch = inp.match(/_nonce:\s*(\d+)group/);
                        if (nonceMatch) inputNonces.push(nonceMatch[1]);
                    }
                }

                // Cross-program calls: "program.aleo/function" → split
                let program = activeNetwork.programId;
                let func = functionName;
                if (functionName.includes('/')) {
                    const idx = functionName.indexOf('/');
                    program = functionName.slice(0, idx);
                    func = functionName.slice(idx + 1);
                }

                console.log('[signer.execute] →', { program, function: func, inputCount: inputs.length });
                inputs.forEach((inp, i) => {
                    if (typeof inp === 'string') {
                        console.log(`[signer.execute] input[${i}] (len=${inp.length}, has_version=${inp.includes('_version')}):`, inp);
                    } else {
                        console.log(`[signer.execute] input[${i}]:`, inp);
                    }
                });

                if (!exec) throw new Error('Wallet has no executeTransaction');

                // Invalidate records cache for this program (and credits.aleo if cross-program)
                recordsCacheRef.current.delete(program);
                if (program !== activeNetwork.programId) recordsCacheRef.current.delete(activeNetwork.programId);

                // 1. Submit the transaction to wallet (Shield validates + signs)
                const result = await exec({ program, function: func, inputs, fee, privateFee: false });
                // Shield returns { transactionId: 'shield_xxx' } — extract local id
                const localId: string = typeof result === 'string'
                    ? result
                    : (result?.transactionId || result?.id || String(result));
                console.log('[signer.execute] ✓ submitted, localId:', localId);

                // 2. Poll transactionStatus until accepted/finalized
                if (transactionStatus) {
                    const maxAttempts = 60; // ~60 seconds (faster fail)
                    for (let i = 0; i < maxAttempts; i++) {
                        await new Promise(r => setTimeout(r, 1000));
                        try {
                            const status = await transactionStatus(localId);
                            const errStr = JSON.stringify(status || {}).toLowerCase();
                            const s = (status?.status || status || '').toString().toLowerCase();

                            if (s === 'accepted' || s === 'finalized' || s === 'completed' || s === 'confirmed') {
                                console.log(`[signer.execute] ✓ accepted after ${i + 1}s`);
                                // NOW mark input records as spent (transaction confirmed)
                                for (const nonce of inputNonces) {
                                    spentCommitmentsRef.current.add(nonce);
                                }
                                // Force immediate record refresh (3 retries with increasing delays)
                                recordsCacheRef.current.clear();
                                setTimeout(() => refreshRecordsRef.current?.(), 1000);
                                setTimeout(() => refreshRecordsRef.current?.(), 3000);
                                setTimeout(() => refreshRecordsRef.current?.(), 7000);
                                return localId;
                            }

                            // Stale-record auto-recovery — detect via error string regardless of status field
                            // NOTE: Do NOT mark input nonces as spent here! The transaction was
                            // REJECTED, so no records were consumed. The commitment might just
                            // not be indexed on-chain yet (e.g. freshly created credits record).
                            if (errStr.includes('commitment') && errStr.includes('does not exist')) {
                                console.warn('[signer.execute] ✗ stale commitment — clearing cache (records NOT marked spent)');
                                recordsCacheRef.current.clear();
                                decryptCacheRef.current.clear();
                                setTimeout(() => { refreshRecordsRef.current?.(); }, 100);
                                throw new Error('Stale wallet records. Cache cleared — try again.');
                            }

                            if (s === 'rejected' || s === 'failed') {
                                throw new Error(`Transaction rejected: ${JSON.stringify(status)}`);
                            }

                            // Any other error string in the response
                            if (errStr.includes('error') && errStr.includes('rejected')) {
                                throw new Error(`Transaction rejected: ${JSON.stringify(status)}`);
                            }
                        } catch (e: any) {
                            // Re-throw rejection / stale-record errors immediately
                            if (e?.message?.includes('rejected') || e?.message?.includes('Stale')) throw e;
                            // Other errors are transient (tx not yet visible) — keep polling
                        }
                    }
                    // Timed out — assume failure rather than hanging the UI
                    throw new Error('Transaction timed out after 60s. Check Shield wallet activity.');
                }
                // No transactionStatus available — optimistically mark as spent
                for (const nonce of inputNonces) {
                    spentCommitmentsRef.current.add(nonce);
                }
                return localId;
            },
            requestRecords: async (programId?: string) => {
                const pid = programId || activeNetwork.programId;

                // 1. Cache hit?
                const cached = recordsCacheRef.current.get(pid);
                if (cached && (Date.now() - cached.ts) < RECORDS_TTL_MS) {
                    // Filter spent on every read (cheap)
                    return cached.records.filter((r: any) => {
                        const pt = r.plaintext || '';
                        const nonceMatch = pt.match(/_nonce:\s*(\d+)group/);
                        return !(nonceMatch && spentCommitmentsRef.current.has(nonceMatch[1]));
                    });
                }

                // 2. Dedupe in-flight requests
                const inflight = inflightRecordsRef.current.get(pid);
                if (inflight) return inflight;

                const promise = (async () => {
                    try {
                        if (!(aleoWallet as any).requestRecords) return [];
                        const raw: any[] = await (aleoWallet as any).requestRecords(pid);
                        if (!Array.isArray(raw)) return [];

                        const filtered = raw.filter((r: any) => {
                            if (r.spent === true || r.status === 'spent') return false;
                            if (r.programName && pid && r.programName !== pid) return false;
                            // Filter out records from any prior unicornx_v* that's not the current one
                            if (r.programName && /^unicornx_v\d+\.aleo$/.test(r.programName) && r.programName !== pid) return false;
                            return true;
                        });

                        // 3. Parallel decrypt with persistent cache (NullPay pattern)
                        const decryptFn = (aleoWallet as any).decrypt;
                        await Promise.all(filtered.map(async (rec: any) => {
                            if (rec.plaintext) return;
                            // Try decrypt ciphertext first
                            if (rec.recordCiphertext) {
                                const cachedPt = decryptCacheRef.current.get(rec.recordCiphertext);
                                if (cachedPt) { rec.plaintext = cachedPt; return; }
                                if (decryptFn) {
                                    try {
                                        const dec = await decryptFn(rec.recordCiphertext);
                                        const pt = typeof dec === 'string' ? dec : (dec?.plaintext || dec?.data || JSON.stringify(dec));
                                        rec.plaintext = pt;
                                        decryptCacheRef.current.set(rec.recordCiphertext, pt);
                                    } catch (e) {
                                        console.warn('[requestRecords] Decrypt failed:', e);
                                    }
                                }
                                return;
                            }
                            // Fallback: reconstruct plaintext from nonce (NullPay pattern)
                            const nonce = rec.nonce || rec._nonce || rec.data?._nonce;
                            if (nonce && rec.owner) {
                                if (rec.recordName === 'credits' || rec.programName === 'credits.aleo') {
                                    const micro = rec.data?.microcredits || rec.microcredits || '0';
                                    rec.plaintext = `{ owner: ${rec.owner}.private, microcredits: ${micro}u64.private, _nonce: ${nonce}group.public }`;
                                }
                            }
                        }));

                        // Drop records whose tag is missing (already spent on-chain)
                        // Shield's `spent` field can lag — the `tag` field is more authoritative
                        // when paired with our local spent commitment tracking.
                        recordsCacheRef.current.set(pid, { records: filtered, ts: Date.now() });

                        // Quick stats
                        let cards = 0, packs = 0, lineups = 0, openReqs = 0, others = 0;
                        for (const r of filtered) {
                            const pt = r.plaintext || '';
                            if (pt.includes('card1_id')) lineups++;
                            else if (pt.includes('player:') && pt.includes('pack_id')) openReqs++;
                            else if (pt.includes('card_id') && pt.includes('startup_id')) cards++;
                            else if (pt.includes('pack_id')) packs++;
                            else others++;
                        }
                        console.log(`[requestRecords] ${pid}: ${raw.length} raw → ${filtered.length} (cards=${cards}, packs=${packs}, lineups=${lineups}, openReqs=${openReqs}, other=${others})`);

                        // Expose for browser-console debugging
                        if (typeof window !== 'undefined') {
                            (window as any).__aleoRecords = filtered;
                            (window as any).__aleoCards = filtered.filter((r: any) =>
                                (r.plaintext || '').includes('card_id') &&
                                (r.plaintext || '').includes('startup_id') &&
                                !(r.plaintext || '').includes('card1_id')
                            );
                        }

                        return filtered.filter((r: any) => {
                            const pt = r.plaintext || '';
                            const nonceMatch = pt.match(/_nonce:\s*(\d+)group/);
                            return !(nonceMatch && spentCommitmentsRef.current.has(nonceMatch[1]));
                        });
                    } catch (e) {
                        console.warn('[requestRecords] failed:', e);
                        return [];
                    } finally {
                        inflightRecordsRef.current.delete(pid);
                    }
                })();

                inflightRecordsRef.current.set(pid, promise);
                return promise;
            },
            decrypt: (aleoWallet as any).decrypt?.bind(aleoWallet),
        };
        return s;
    }, [isConnected, address, aleoWallet, activeNetwork.programId]);

    // Sync signer to module-level for contract wrappers
    useEffect(() => {
        setAleoSigner(signer);
    }, [signer]);

    // Refresh records (called on mount, after writes, and via context)
    const refreshRecords = useCallback(async () => {
        if (!signer) { setCardRecords([]); setPackRecords([]); return; }
        try {
            recordsCacheRef.current.clear();
            const records = await signer.requestRecords();

            // Group cards by raw card_id, keep only the LATEST (highest blockHeight)
            const cardsByRawId = new Map<string, any>();
            const packsByRawId = new Map<string, any>();

            for (const r of records) {
                const pt = r.plaintext || r.data || '';
                if (pt.includes('card1_id')) continue;
                if (pt.includes('player:') && pt.includes('pack_id')) continue;

                const blockHeight = r.blockHeight || 0;

                if (pt.includes('card_id') && pt.includes('startup_id')) {
                    const m = pt.match(/card_id:\s*(\d+)field/);
                    const rawId = m ? m[1] : `_${blockHeight}_${cardsByRawId.size}`;
                    const existing = cardsByRawId.get(rawId);
                    if (!existing || (existing.blockHeight || 0) < blockHeight) {
                        cardsByRawId.set(rawId, r);
                    }
                } else if (pt.includes('pack_id') && !pt.includes('player:')) {
                    const m = pt.match(/pack_id:\s*(\d+)field/);
                    const rawId = m ? m[1] : `_${blockHeight}_${packsByRawId.size}`;
                    const existing = packsByRawId.get(rawId);
                    if (!existing || (existing.blockHeight || 0) < blockHeight) {
                        packsByRawId.set(rawId, r);
                    }
                }
            }

            const cards = Array.from(cardsByRawId.values());
            const packs = Array.from(packsByRawId.values());
            setCardRecords(cards);
            setPackRecords(packs);
            console.log(`[WalletContext] Refreshed records: ${cards.length} unique cards, ${packs.length} packs (from ${records.length} raw)`);
        } catch (e) {
            console.warn('[WalletContext] refreshRecords failed:', e);
        }
    }, [signer]);

    // Keep ref in sync so signer.execute can call latest version
    useEffect(() => {
        refreshRecordsRef.current = refreshRecords;
    }, [refreshRecords]);

    // Auto-poll records every 15s when connected
    useEffect(() => {
        if (!isConnected || !signer) return;
        refreshRecords();
        const interval = setInterval(refreshRecords, 5_000);
        return () => clearInterval(interval);
    }, [isConnected, signer, refreshRecords]);

    // getSigner returns the Aleo signer (works like ethers.Signer in hooks)
    const getSigner = useCallback(async (): Promise<any | null> => {
        return signer;
    }, [signer]);

    // ── Context value ────────────────────────────────────────────────────────
    const value: WalletContextType = {
        isConnected,
        address,
        balance,
        balanceLoading,
        chainId,
        isCorrectChain,
        isConnecting,
        hasSavedWallet,
        error,
        connect,
        connectRiseWallet,
        disconnect,
        switchChain,
        getSigner,
        signMessage,
        refreshBalance,
        formatAddress,
        formatBalance,
        walletProvider: wallet,
        cardRecords,
        packRecords,
        refreshRecords,
    };

    return (
        <WalletContext.Provider value={value}>
            {children}
        </WalletContext.Provider>
    );
}

export function useWalletContext() {
    const context = useContext(WalletContext);
    if (!context) {
        throw new Error('useWalletContext must be used within WalletProvider');
    }
    return context;
}
