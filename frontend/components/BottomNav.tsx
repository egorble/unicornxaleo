import React, { useState, useRef, useEffect } from 'react';
import { NavSection } from '../types';
import { Flame, Store, Wallet, Swords, Newspaper, ShieldCheck } from 'lucide-react';
import { isAdmin } from '../hooks/useAdmin';
import { useWalletContext } from '../context/WalletContext';

interface BottomNavProps {
  activeSection: NavSection;
  onNavigate: (section: NavSection) => void;
}

const BottomNav: React.FC<BottomNavProps> = ({ activeSection, onNavigate }) => {
  const { address } = useWalletContext();
  const userIsAdmin = isAdmin(address);
  const [showLeagueMenu, setShowLeagueMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const isLeagueActive = activeSection === NavSection.LEAGUES;

  // Close menu on outside click
  useEffect(() => {
    if (!showLeagueMenu) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowLeagueMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showLeagueMenu]);

  const tabs = [
    { id: NavSection.HOME, icon: Flame, label: 'Home' },
    { id: NavSection.MARKETPLACE, icon: Store, label: 'Market' },
    { id: NavSection.PORTFOLIO, icon: Wallet, label: 'Portfolio' },
    { id: NavSection.LEAGUES, icon: Swords, label: 'Leagues' },
    { id: NavSection.FEED, icon: Newspaper, label: 'Feed' },
    ...(userIsAdmin ? [{ id: NavSection.ADMIN, icon: ShieldCheck, label: 'Admin' }] : []),
  ];

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 md:hidden flex justify-center" style={{ paddingBottom: 'env(safe-area-inset-bottom, 8px)' }}>
      <nav className="mx-4 mb-3 px-3 py-2 rounded-[28px] bg-white/60 dark:bg-zinc-900/60 backdrop-blur-2xl border border-white/40 dark:border-white/[0.08] shadow-[0_8px_32px_rgba(0,0,0,0.08),inset_0_1px_0_rgba(255,255,255,0.4)] dark:shadow-[0_8px_32px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.05)] relative">
        <div className="flex items-center gap-1">
          {tabs.map((tab) => {
            const isActive = activeSection === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => onNavigate(tab.id as NavSection)}
                className={`flex flex-col items-center justify-center px-3 py-1.5 rounded-2xl transition-all duration-300 ${isActive
                  ? 'bg-yc-aleo/10 dark:bg-yc-aleo/[0.15] text-yc-aleo shadow-sm'
                  : 'text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 active:scale-95'
                  }`}
              >
                <tab.icon className="w-5 h-5" strokeWidth={isActive ? 2.2 : 1.8} />
                <span className={`text-[9px] mt-0.5 leading-tight ${isActive ? 'font-bold' : 'font-medium'}`}>
                  {tab.label}
                </span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
};

export default BottomNav;
