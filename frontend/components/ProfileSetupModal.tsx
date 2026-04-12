import React, { useState, useRef, useEffect } from 'react';
import { User, Upload, Loader2 } from 'lucide-react';
import { generatePixelAvatar } from '../lib/pixelAvatar';

interface ProfileSetupModalProps {
    isOpen: boolean;
    address: string;
    onComplete: (username: string, avatarDataUrl?: string) => Promise<boolean | undefined>;
}

const ProfileSetupModal: React.FC<ProfileSetupModalProps> = ({ isOpen, address, onComplete }) => {
    const [username, setUsername] = useState('');
    const [customAvatar, setCustomAvatar] = useState<string | null>(null);
    const [pixelAvatar, setPixelAvatar] = useState<string>('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (address) {
            setPixelAvatar(generatePixelAvatar(address, 256));
        }
    }, [address]);

    if (!isOpen) return null;

    const currentAvatar = customAvatar || pixelAvatar;

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
                // Resize to 256x256
                const canvas = document.createElement('canvas');
                canvas.width = 256;
                canvas.height = 256;
                const ctx = canvas.getContext('2d')!;

                // Center crop
                const minDim = Math.min(img.width, img.height);
                const sx = (img.width - minDim) / 2;
                const sy = (img.height - minDim) / 2;
                ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, 256, 256);

                setCustomAvatar(canvas.toDataURL('image/png', 0.8));
                setError('');
            };
            img.src = event.target?.result as string;
        };
        reader.readAsDataURL(file);
    };

    const handleRemoveAvatar = () => {
        setCustomAvatar(null);
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
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

        const result = await onComplete(trimmed, customAvatar || undefined);
        if (result === false) {
            setError('Failed to register. Please try again.');
        }
        setLoading(false);
    };

    return (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
            <div className="bg-white dark:bg-[#121212] border border-gray-200 dark:border-[#2A2A2A] rounded-2xl w-full max-w-md overflow-hidden shadow-2xl animate-[fadeIn_0.3s_ease-out]">
                {/* Header */}
                <div className="bg-gradient-to-r from-yc-aleo to-orange-600 p-6 text-center">
                    <h2 className="text-white text-xl font-black">Welcome to UnicornX</h2>
                    <p className="text-white/80 text-sm mt-1">Set up your profile to get started</p>
                </div>

                <div className="p-6 space-y-5">
                    {/* Avatar Section */}
                    <div className="flex flex-col items-center">
                        <div className="relative group">
                            <div className="w-24 h-24 rounded-xl overflow-hidden border-2 border-gray-200 dark:border-[#2A2A2A] shadow-lg">
                                {currentAvatar ? (
                                    <img
                                        src={currentAvatar}
                                        alt="Avatar"
                                        className="w-full h-full object-cover"
                                        style={{ imageRendering: customAvatar ? 'auto' : 'pixelated' }}
                                    />
                                ) : (
                                    <div className="w-full h-full bg-gray-100 dark:bg-[#1A1A1A] flex items-center justify-center">
                                        <User className="w-10 h-10 text-gray-400" />
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="flex items-center gap-2 mt-3">
                            <button
                                onClick={() => fileInputRef.current?.click()}
                                className="text-xs font-bold text-yc-aleo hover:text-orange-600 transition-colors flex items-center gap-1"
                            >
                                <Upload className="w-3 h-3" />
                                Upload Photo
                            </button>
                            {customAvatar && (
                                <>
                                    <span className="text-gray-300 dark:text-gray-600">|</span>
                                    <button
                                        onClick={handleRemoveAvatar}
                                        className="text-xs font-bold text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                                    >
                                        Use Pixel Art
                                    </button>
                                </>
                            )}
                        </div>
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept="image/*"
                            onChange={handleFileUpload}
                            className="hidden"
                        />
                        <p className="text-[10px] text-gray-400 mt-1">
                            {customAvatar ? 'Custom avatar selected' : 'Unique pixel art generated from your wallet'}
                        </p>
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

                    {/* Wallet Address */}
                    <div className="bg-gray-50 dark:bg-[#050505] rounded-lg px-4 py-2.5 border border-gray-200 dark:border-[#2A2A2A]">
                        <span className="text-[10px] text-gray-400 uppercase font-bold">Wallet</span>
                        <p className="text-xs text-gray-600 dark:text-gray-400 font-mono truncate">{address}</p>
                    </div>

                    {/* Submit Button */}
                    <button
                        onClick={handleSubmit}
                        disabled={loading || username.trim().length < 3}
                        className={`w-full py-3.5 rounded-xl font-bold text-sm uppercase tracking-wider transition-all flex items-center justify-center gap-2 ${loading || username.trim().length < 3
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
                            'Start Playing'
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ProfileSetupModal;
