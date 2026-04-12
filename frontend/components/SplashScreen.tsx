import React, { useState, useEffect } from 'react';
import { preloadPromise } from '../lib/preload';

interface SplashScreenProps {
    onReady: () => void;
}

const SplashScreen: React.FC<SplashScreenProps> = ({ onReady }) => {
    const [progress, setProgress] = useState(0);
    const [fadeOut, setFadeOut] = useState(false);

    useEffect(() => {
        // Remove the pre-React HTML splash overlay
        const preSplash = document.getElementById('pre-splash');
        if (preSplash) preSplash.remove();

        const t1 = setTimeout(() => setProgress(30), 100);
        const t2 = setTimeout(() => setProgress(55), 300);
        const t3 = setTimeout(() => setProgress(70), 600);

        preloadPromise.then(() => {
            setProgress(100);
            setTimeout(() => setFadeOut(true), 200);
            setTimeout(() => onReady(), 700);
        }).catch(() => {
            setProgress(100);
            setTimeout(() => setFadeOut(true), 200);
            setTimeout(() => onReady(), 700);
        });

        return () => {
            clearTimeout(t1);
            clearTimeout(t2);
            clearTimeout(t3);
        };
    }, [onReady]);

    return (
        <div
            className={`fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-[#050505] transition-opacity duration-500 ${
                fadeOut ? 'opacity-0 pointer-events-none' : 'opacity-100'
            }`}
        >
            {/* Subtle grid background */}
            <div
                className="absolute inset-0 opacity-[0.03]"
                style={{
                    backgroundImage:
                        'linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)',
                    backgroundSize: '60px 60px',
                }}
            />

            {/* Glow effect */}
            <div className="absolute w-64 h-64 bg-yc-aleo/10 rounded-full blur-[100px]" />

            {/* Logo */}
            <div className="relative mb-8">
                <img
                    src="/unicornx.png"
                    alt="UnicornX"
                    className="w-20 h-20 md:w-24 md:h-24 animate-pulse"
                    style={{ filter: 'drop-shadow(0 0 30px rgba(242, 101, 34, 0.3))' }}
                />
            </div>

            {/* Brand text */}
            <h1 className="text-2xl md:text-3xl font-black text-white tracking-tight mb-1">
                UNICORN<span className="text-yc-aleo">X</span>
            </h1>
            <p className="text-gray-500 text-xs font-medium tracking-widest uppercase mb-10">
                Fantasy YC Trading
            </p>

            {/* Progress bar */}
            <div className="w-48 md:w-64 h-1 bg-white/10 rounded-full overflow-hidden">
                <div
                    className="h-full bg-gradient-to-r from-yc-aleo to-orange-400 rounded-full transition-all duration-500 ease-out"
                    style={{ width: `${progress}%` }}
                />
            </div>

            <p className="mt-4 text-gray-600 text-[11px] font-mono">
                {progress < 100 ? 'Loading...' : 'Ready'}
            </p>
        </div>
    );
};

export default SplashScreen;
