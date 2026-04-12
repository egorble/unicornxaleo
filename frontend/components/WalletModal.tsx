import React from 'react';
import { X, ExternalLink, Smartphone, QrCode } from 'lucide-react';

export interface DetectedWallet {
    info: {
        uuid: string;
        name: string;
        icon: string;
        rdns: string;
    };
    provider: any;
}

interface WalletModalProps {
    isOpen: boolean;
    onClose: () => void;
    wallets: DetectedWallet[];
    onSelectInjected: (provider: any, rdns: string) => void;
    onSelectWalletConnect: () => void;
    isConnecting: boolean;
    hasWalletConnect: boolean;
}

const isMobile = () => /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

const WalletModal: React.FC<WalletModalProps> = ({
    isOpen, onClose, wallets, onSelectInjected, onSelectWalletConnect, isConnecting, hasWalletConnect
}) => {
    if (!isOpen) return null;

    const mobile = isMobile();
    const hasInjected = typeof window !== 'undefined' && !!(window as any).ethereum;

    return (
        <div
            className="fixed inset-0 z-[100] flex items-end md:items-center justify-center bg-black/80 backdrop-blur-sm animate-[fadeIn_0.15s_ease-out]"
            onClick={onClose}
        >
            <div
                className="bg-white dark:bg-[#121212] rounded-t-2xl md:rounded-2xl p-6 w-full max-w-sm md:mx-4 shadow-2xl animate-[slideUp_0.2s_ease-out]"
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between mb-5">
                    <h2 className="text-lg font-bold text-gray-900 dark:text-white">Connect Wallet</h2>
                    <button
                        onClick={onClose}
                        className="p-1 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/10 transition-colors"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Connecting spinner */}
                {isConnecting && (
                    <div className="text-center py-8">
                        <div className="w-10 h-10 mx-auto border-3 border-yc-aleo/30 border-t-yc-aleo rounded-full animate-spin mb-3" />
                        <p className="text-gray-500 text-sm">Confirm in your wallet...</p>
                    </div>
                )}

                {!isConnecting && (
                    <div className="space-y-2">
                        {/* Detected wallets (EIP-6963) */}
                        {wallets.map(wallet => (
                            <button
                                key={wallet.info.uuid}
                                onClick={() => onSelectInjected(wallet.provider, wallet.info.rdns)}
                                className="w-full flex items-center gap-3 p-3 rounded-xl border border-gray-200 dark:border-[#2A2A2A] hover:border-yc-aleo hover:bg-yc-aleo/5 transition-all active:scale-[0.98]"
                            >
                                <img
                                    src={wallet.info.icon}
                                    alt={wallet.info.name}
                                    className="w-9 h-9 rounded-xl"
                                />
                                <span className="text-gray-900 dark:text-white font-bold text-sm flex-1 text-left">
                                    {wallet.info.name}
                                </span>
                                <span className="text-[10px] text-gray-400 font-medium uppercase tracking-wide">Detected</span>
                            </button>
                        ))}

                        {/* Fallback: window.ethereum without EIP-6963 */}
                        {wallets.length === 0 && hasInjected && (
                            <button
                                onClick={() => onSelectInjected((window as any).ethereum, 'injected')}
                                className="w-full flex items-center gap-3 p-3 rounded-xl border border-gray-200 dark:border-[#2A2A2A] hover:border-yc-aleo hover:bg-yc-aleo/5 transition-all active:scale-[0.98]"
                            >
                                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-orange-400 to-orange-600 flex items-center justify-center text-white text-lg font-bold">
                                    W
                                </div>
                                <span className="text-gray-900 dark:text-white font-bold text-sm flex-1 text-left">
                                    Browser Wallet
                                </span>
                                <span className="text-[10px] text-gray-400 font-medium uppercase tracking-wide">Detected</span>
                            </button>
                        )}

                        {/* WalletConnect — works on mobile & desktop */}
                        {hasWalletConnect && (
                            <>
                                {(wallets.length > 0 || hasInjected) && (
                                    <div className="relative my-3">
                                        <div className="absolute inset-0 flex items-center">
                                            <div className="w-full border-t border-gray-200 dark:border-[#2A2A2A]" />
                                        </div>
                                        <div className="relative flex justify-center">
                                            <span className="bg-white dark:bg-[#121212] px-3 text-xs text-gray-400 font-medium">or</span>
                                        </div>
                                    </div>
                                )}
                                <button
                                    onClick={onSelectWalletConnect}
                                    className="w-full flex items-center gap-3 p-3 rounded-xl border border-gray-200 dark:border-[#2A2A2A] hover:border-[#3B99FC] hover:bg-[#3B99FC]/5 transition-all active:scale-[0.98]"
                                >
                                    <div className="w-9 h-9 rounded-xl bg-[#3B99FC] flex items-center justify-center">
                                        <QrCode className="w-5 h-5 text-white" />
                                    </div>
                                    <div className="flex-1 text-left">
                                        <span className="text-gray-900 dark:text-white font-bold text-sm block">WalletConnect</span>
                                        <span className="text-[11px] text-gray-400">{mobile ? 'Connect mobile wallet' : 'Scan with phone'}</span>
                                    </div>
                                </button>
                            </>
                        )}

                        {/* No wallet and no WalletConnect */}
                        {!hasWalletConnect && wallets.length === 0 && !hasInjected && (
                            <div className="text-center py-6">
                                <div className="w-14 h-14 mx-auto mb-3 rounded-2xl bg-gray-100 dark:bg-white/5 flex items-center justify-center">
                                    <Smartphone className="w-7 h-7 text-gray-400" />
                                </div>
                                <p className="text-gray-500 text-sm mb-4">No wallet detected</p>
                                <a
                                    href="https://metamask.io/download/"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-2 text-yc-aleo font-bold text-sm hover:underline"
                                >
                                    Install MetaMask <ExternalLink className="w-3.5 h-3.5" />
                                </a>
                            </div>
                        )}
                    </div>
                )}

                {/* Safe area bottom padding on mobile */}
                <div className="h-2 md:hidden" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }} />
            </div>
        </div>
    );
};

export default WalletModal;
