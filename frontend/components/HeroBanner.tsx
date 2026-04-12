import React from 'react';
import Interactive3DCards from './Interactive3DCards';

const HeroBanner: React.FC = () => {
  return (
    <div className="relative w-full rounded-[24px] border border-orange-300/60 dark:border-yc-aleo/[0.15] group mb-4 md:mb-8 bg-gradient-to-br from-orange-50 to-orange-50 dark:bg-white/[0.02] overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 rounded-[24px] overflow-hidden">
        {/* Solid overlay — no transparent edges, no white bleed */}
        <div className="absolute inset-0 bg-orange-50 dark:bg-[#050507]"></div>

        {/* Decorative Grid Lines */}
        <div className="absolute inset-0 opacity-[0.05] dark:opacity-[0.03]" style={{
          backgroundImage: 'linear-gradient(currentColor 1px, transparent 1px), linear-gradient(90deg, currentColor 1px, transparent 1px)',
          backgroundSize: '40px 40px',
        }}></div>
      </div>

      {/* Left Aligned Header */}
      <div className="absolute top-6 left-6 md:top-8 md:left-8 z-20 pointer-events-none">
        <div className="flex flex-col items-start text-left">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/60 dark:bg-white/[0.04] border border-gray-200/50 dark:border-white/[0.08] backdrop-blur-md">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span>
            <span className="text-[10px] font-bold tracking-widest uppercase text-gray-800 dark:text-gray-300">Season 1: Live</span>
          </div>
        </div>
      </div>

      {/* 3D Interactive Cards */}
      <div className="relative z-10 w-full h-full flex flex-col items-center justify-center pt-10 pb-2">
        <Interactive3DCards />
      </div>
    </div>
  );
};

export default HeroBanner;
