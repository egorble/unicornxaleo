import React, { useState, useRef, useEffect } from 'react';
import { User, Upload, Loader2, X, LogOut, Copy, Check } from 'lucide-react';
import { generatePixelAvatar } from '../lib/pixelAvatar';

interface ProfileEditModalProps {
    isOpen: boolean;
    onClose: () => void;
    address: string;
    currentUsername: string;
    currentAvatar: string | null;
    onSave: (username: string, avatarDataUrl?: string) => Promise<boolean>;
    onDisconnect?: () => void;
}

const ProfileEditModal: React.FC<ProfileEditModalProps> = ({
    isOpen,
    onClose,
    address,
    currentUsername,
    currentAvatar,
    onSave,
    onDisconnect,
}) => {
    const [username, setUsername] = useState(currentUsername);
    const [customAvatar, setCustomAvatar] = useState<string | null>(null);
    const [usePixel, setUsePixel] = useState(false);
    const [pixelAvatar, setPixelAvatar] = useState<string>('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [addressCopied, setAddressCopied] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleCopyAddress = () => {
        navigator.clipboard.writeText(address);
        setAddressCopied(true);
        setTimeout(() => setAddressCopied(false), 2000);
    };

    useEffect(() => {
        if (address) {
            setPixelAvatar(generatePixelAvatar(address, 256));
        }
    }, [address]);

    useEffect(() => {
        if (isOpen) {
            setUsername(currentUsername);
            setCustomAvatar(null);
            setUsePixel(false);
            setError('');
        }
    }, [isOpen, currentUsername]);

    if (!isOpen) return null;

    const displayAvatar = usePixel
        ? pixelAvatar
        : customAvatar || currentAvatar || pixelAvatar;

    const isPixelArt = usePixel || (!customAvatar && !currentAvatar);

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        if (file.size > 500 * 1024) {
            setError('Image must be under 500KB');
            return;
        }

        if (!file.type.startsWith('image/')) {
            setError('Please upload an image file');
            return;
        }

        const reader = new FileReader();
        reader.onload = (event) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = 256;
                canvas.height = 256;
                const ctx = canvas.getContext('2d')!;
                const minDim = Math.min(img.width, img.height);
                const sx = (img.width - minDim) / 2;
                const sy = (img.height - minDim) / 2;
                ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, 256, 256);
                setCustomAvatar(canvas.toDataURL('image/png', 0.8));
                setUsePixel(false);
                setError('');
            };
            img.src = event.target?.result as string;
        };
        reader.readAsDataURL(file);
    };

    const handleSubmit = async () => {
        const trimmed = username.trim();

        if (trimmed.length < 3) {
            setError('Username must be at least 3 characters');
            return;
        }
        if (trimmed.length > 20) {
            setError('Username must be at most 20 characters');
            return;
        }
        if (!/^[a-zA-Z0-9_\-. ]+$/.test(trimmed)) {
            setError('Username can only contain letters, numbers, spaces, - _ .');
            return;
        }

        setLoading(true);
        setError('');

        const avatarToSave = usePixel ? undefined : (customAvatar || undefined);
        const result = await onSave(trimmed, avatarToSave);

        if (result) {
            onClose();
        } else {
            setError('Failed to save. Please try again.');
        }
        setLoading(false);
    };

    return (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[100] flex items-center justify-center p-4" onClick={onClose}>
            <div
                className="bg-white dark:bg-[#121212] border border-gray-200 dark:border-[#2A2A2A] rounded-2xl w-full max-w-md overflow-hidden shadow-2xl animate-[fadeIn_0.3s_ease-out]"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-[#2A2A2A]">
                    <h2 className="text-lg font-black text-gray-900 dark:text-white">Edit Profile</h2>
                    <button
                        onClick={onClose}
                        className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-[#1A1A1A] text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                    >
                        <X size={18} />
                    </button>
                </div>

                <div className="p-6 space-y-5">
                    {/* Avatar Section */}
                    <div className="flex flex-col items-center">
                        <div className="w-24 h-24 rounded-xl overflow-hidden border-2 border-gray-200 dark:border-[#2A2A2A] shadow-lg">
                            {displayAvatar ? (
                                <img
                                    src={displayAvatar}
                                    alt="Avatar"
                                    className="w-full h-full object-cover"
                                    style={{ imageRendering: isPixelArt ? 'pixelated' : 'auto' }}
                                />
                            ) : (
                                <div className="w-full h-full bg-gray-100 dark:bg-[#1A1A1A] flex items-center justify-center">
                                    <User className="w-10 h-10 text-gray-400" />
                                </div>
                            )}
                        </div>

                        <div className="flex items-center gap-2 mt-3">
                            <button
                                onClick={() => fileInputRef.current?.click()}
                                className="text-xs font-bold text-yc-aleo hover:text-orange-600 transition-colors flex items-center gap-1"
                            >
                                <Upload className="w-3 h-3" />
                                Upload Photo
                            </button>
                            <span className="text-gray-300 dark:text-gray-600">|</span>
                            <button
                                onClick={() => {
                                    setCustomAvatar(null);
                                    setUsePixel(true);
                                    if (fileInputRef.current) fileInputRef.current.value = '';
                                }}
                                className="text-xs font-bold text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                            >
                                Use Pixel Art
                            </button>
                        </div>
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept="image/*"
                            onChange={handleFileUpload}
                            className="hidden"
                        />
                    </div>

                    {/* Wallet Address */}
                    <div className="flex items-center justify-between bg-gray-50 dark:bg-[#050505] rounded-xl px-4 py-2.5 border border-gray-200 dark:border-[#2A2A2A]">
                        <div className="min-w-0">
                            <span className="text-[10px] text-gray-400 uppercase font-bold tracking-wider">Wallet Address</span>
                            <p className="text-xs text-gray-600 dark:text-gray-400 font-mono truncate">{address}</p>
                        </div>
                        <button
                            onClick={handleCopyAddress}
                            className="ml-3 shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-[#2A2A2A] transition-all text-[11px] font-semibold"
                            style={{ color: addressCopied ? '#22c55e' : undefined, borderColor: addressCopied ? '#22c55e' : undefined }}
                        >
                            {addressCopied ? <Check size={12} /> : <Copy size={12} />}
                            <span>{addressCopied ? 'Copied!' : 'Copy'}</span>
                        </button>
                    </div>

                    {/* Username Input */}
                    <div>
                        <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
                            Username
                        </label>
                        <input
                            type="text"
                            value={username}
                            onChange={(e) => {
                                setUsername(e.target.value);
                                setError('');
                            }}
                            onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
                            placeholder="Enter your username..."
                            maxLength={20}
                            className="w-full bg-gray-50 dark:bg-[#050505] border border-gray-200 dark:border-[#2A2A2A] rounded-lg px-4 py-3 text-gray-900 dark:text-white font-medium text-sm focus:outline-none focus:ring-2 focus:ring-yc-aleo/30 focus:border-yc-aleo transition-all placeholder-gray-400"
                            autoFocus
                        />
                        <div className="flex justify-between mt-1.5">
                            <span className={`text-[10px] ${error ? 'text-red-500 font-bold' : 'text-gray-400'}`}>
                                {error || '3-20 characters, letters, numbers, spaces'}
                            </span>
                            <span className="text-[10px] text-gray-400 font-mono">
                                {username.length}/20
                            </span>
                        </div>
                    </div>

                    {/* Buttons */}
                    <div className="flex gap-3">
                        <button
                            onClick={onClose}
                            className="flex-1 py-3 rounded-xl font-bold text-sm border border-gray-200 dark:border-[#2A2A2A] text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-white/5 transition-all"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleSubmit}
                            disabled={loading || username.trim().length < 3}
                            className={`flex-1 py-3 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 ${loading || username.trim().length < 3
                                    ? 'bg-gray-200 dark:bg-[#1A1A1A] text-gray-400 cursor-not-allowed'
                                    : 'bg-yc-aleo hover:bg-orange-600 text-white shadow-lg shadow-lime-500/20 active:scale-95'
                                }`}
                        >
                            {loading ? (
                                <>
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                    Saving...
                                </>
                            ) : (
                                'Save Changes'
                            )}
                        </button>
                    </div>

                    {/* Disconnect Wallet */}
                    {onDisconnect && (
                        <button
                            onClick={() => { onDisconnect(); onClose(); }}
                            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-red-500 hover:bg-red-500/10 font-bold text-xs transition-all"
                        >
                            <LogOut size={14} />
                            Disconnect Wallet
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default ProfileEditModal;
