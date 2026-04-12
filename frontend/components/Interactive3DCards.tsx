import React, { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

const mockCards = [
    { id: 6, name: 'Browser Use', rarity: 'Epic', image: '/images/6.png', color: 'from-blue-500 to-cyan-400' },
    { id: 1, name: 'Openclaw', rarity: 'Legendary', image: '/images/1.png', color: 'from-yc-aleo to-pink-500' },
    { id: 4, name: 'OpenAI', rarity: 'Legendary', image: '/images/4.png', color: 'from-amber-400 to-yellow-500' },
    { id: 5, name: 'Anthropic', rarity: 'Legendary', image: '/images/5.png', color: 'from-orange-500 to-orange-500' },
    { id: 7, name: 'Dedalus Labs', rarity: 'Epic', image: '/images/7.png', color: 'from-green-500 to-emerald-400' },
];

const Interactive3DCards: React.FC = () => {
    const [currentIndex, setCurrentIndex] = useState(2); // Center on OpenAI initially

    const nextCard = () => {
        setCurrentIndex((prev) => (prev + 1) % mockCards.length);
    };

    const prevCard = () => {
        setCurrentIndex((prev) => (prev === 0 ? mockCards.length - 1 : prev - 1));
    };

    const getCardStyle = (index: number) => {
        const diff = (index - currentIndex + mockCards.length) % mockCards.length;

        // Normalize index: -2, -1, 0, 1, 2
        let relativeIndex = diff;
        if (diff > Math.floor(mockCards.length / 2)) {
            relativeIndex = diff - mockCards.length;
        }

        const absIndex = Math.abs(relativeIndex);

        // Z-index calculation (center is highest)
        const zIndex = 50 - absIndex * 10;

        let translateX: string | number = '0%';
        let translateZ = 0;
        let rotateY = 0;
        let rotateX = 8; // Slight tilt back
        let rotateZ = 0;
        let scale = 1;
        let opacity = 1;

        if (absIndex === 0) {
            // Center
            translateX = '0%';
            translateZ = 60;
            rotateY = 0;
            rotateX = 0;
            rotateZ = 0;
            scale = 1.15;
            opacity = 1;
        } else if (relativeIndex === 1) {
            // Right 1
            translateX = 'calc(55% + 5vw)';
            translateZ = -40;
            rotateY = -30;
            rotateX = 5;
            rotateZ = 2;
            scale = 0.85;
            opacity = 0.85;
        } else if (relativeIndex === -1) {
            // Left 1
            translateX = 'calc(-55% - 5vw)';
            translateZ = -40;
            rotateY = 30;
            rotateX = 5;
            rotateZ = -2;
            scale = 0.85;
            opacity = 0.85;
        } else if (relativeIndex === 2) {
            // Right 2
            translateX = 'calc(95% + 10vw)';
            translateZ = -100;
            rotateY = -40;
            rotateX = 10;
            rotateZ = 4;
            scale = 0.65;
            opacity = 0.5;
        } else if (relativeIndex === -2) {
            // Left 2
            translateX = 'calc(-95% - 10vw)';
            translateZ = -100;
            rotateY = 40;
            rotateX = 10;
            rotateZ = -4;
            scale = 0.65;
            opacity = 0.5;
        }

        return {
            zIndex,
            transform: `translateX(${translateX}) translateZ(${translateZ}px) rotateY(${rotateY}deg) rotateX(${rotateX}deg) rotateZ(${rotateZ}deg) scale(${scale})`,
            opacity,
            transition: 'all 0.7s cubic-bezier(0.2, 0.8, 0.2, 1)',
            transformStyle: 'preserve-3d' as const,
        };
    };

    return (
        <div className="relative w-full h-[300px] md:h-[350px] flex items-center justify-center py-2 my-0" style={{ perspective: '1000px' }}>
            {/* Background glow behind cards */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[20rem] h-[20rem] bg-orange-500/10 dark:bg-yc-aleo/20 rounded-full blur-[80px] pointer-events-none"></div>

            <button
                onClick={prevCard}
                className="absolute left-2 md:left-8 z-[60] p-2 md:p-2.5 rounded-full bg-transparent hover:bg-white/10 dark:hover:bg-white/5 border border-transparent hover:border-white/20 text-orange-400/70 hover:text-orange-300 dark:text-gray-400 dark:hover:text-white transition-all active:scale-95 group"
            >
                <ChevronLeft className="w-8 h-8 md:w-10 md:h-10 group-hover:-translate-x-1 transition-transform" />
            </button>

            <div className="relative w-full max-w-[200px] sm:max-w-[220px] md:max-w-[220px] h-72 md:h-80 flex justify-center items-center" style={{ transformStyle: 'preserve-3d' }}>
                {mockCards.map((card, index) => {
                    const style = getCardStyle(index);
                    const isCenter = style.opacity === 1 && style.zIndex === 50;

                    return (
                        <div
                            key={card.id}
                            className="absolute w-[150px] md:w-[170px] h-[254px] md:h-[288px] rounded-[1.25rem] cursor-pointer"
                            style={style}
                            onClick={() => {
                                if (!isCenter) {
                                    setCurrentIndex(index);
                                }
                            }}
                        >
                            {/* Card Container - Intense Glassmorphism imitating the reference */}
                            <div className={`w-full h-full relative rounded-[1.25rem] overflow-hidden
                border-2 ${isCenter ? 'border-orange-400/60 dark:border-yc-aleo/60' : 'border-white/30 dark:border-white/20 shadow-xl'}`}
                                style={{
                                    boxShadow: isCenter ? '0 0 30px rgba(249, 115, 22, 0.4)' : '0 8px 25px rgba(0,0,0,0.3)',
                                }}
                            >
                                <img
                                    src={card.image}
                                    alt={card.name}
                                    className="w-full h-full object-fill rounded-[1.25rem]"
                                    draggable={false}
                                />
                            </div>
                        </div>
                    );
                })}
            </div>

            <button
                onClick={nextCard}
                className="absolute right-2 md:right-8 z-[60] p-2 md:p-2.5 rounded-full bg-transparent hover:bg-white/10 dark:hover:bg-white/5 border border-transparent hover:border-white/20 text-orange-400/70 hover:text-orange-300 dark:text-gray-400 dark:hover:text-white transition-all active:scale-95 group"
            >
                <ChevronRight className="w-8 h-8 md:w-10 md:h-10 group-hover:translate-x-1 transition-transform" />
            </button>

            {/* Navigation Dots */}
            <div className="absolute bottom-1 left-1/2 -translate-x-1/2 flex space-x-2.5 z-[60]">
                {mockCards.map((card, index) => (
                    <div
                        key={card.id}
                        onClick={() => setCurrentIndex(index)}
                        className={`h-1.5 rounded-full cursor-pointer transition-all duration-300 ${index === currentIndex ? 'bg-cyan-400 dark:bg-yc-aleo w-4 shadow-[0_0_8px_rgba(34,211,238,0.6)]' : 'bg-white/20 hover:bg-white/40 w-1.5'}`}
                    />
                ))}
            </div>
        </div>
    );
};

export default Interactive3DCards;
