import React from 'react';
import { NavSection, UserProfile } from '../types';
import { Flame, Store, Wallet, Swords, Newspaper, Settings, Sun, Moon, ShieldCheck, Copy, Check } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import { isAdmin } from '../hooks/useAdmin';
import { useWalletContext } from '../context/WalletContext';
import { ethers } from 'ethers';


interface SidebarProps {
  activeSection: NavSection;
  setActiveSection: (section: NavSection) => void;
  user: UserProfile;
  isOpen?: boolean;
  onClose?: () => void;
  onSettingsClick?: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({ activeSection, setActiveSection, user, isOpen = false, onClose, onSettingsClick }) => {
  const { theme, toggleTheme } = useTheme();
  const { connect, isConnecting, isConnected, balance, balanceLoading, address } = useWalletContext();
  const [addressCopied, setAddressCopied] = React.useState(false);

  const handleCopyAddress = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!address) return;
    navigator.clipboard.writeText(address);
    setAddressCopied(true);
    setTimeout(() => setAddressCopied(false), 2000);
  };

  const userIsAdmin = isAdmin(user.address || null);

  const navItems = [
    { id: NavSection.HOME, icon: Flame, label: 'Dashboard' },
    { id: NavSection.MARKETPLACE, icon: Store, label: 'Marketplace' },
    { id: NavSection.PORTFOLIO, icon: Wallet, label: 'My Portfolio' },
    { id: NavSection.LEAGUES, icon: Swords, label: 'Leagues' },
    { id: NavSection.FEED, icon: Newspaper, label: 'Feed' },
    ...(userIsAdmin ? [{ id: NavSection.ADMIN, icon: ShieldCheck, label: 'Admin' }] : []),
  ];

  return (
    <aside
      className="w-72 h-screen fixed top-0 left-0 bg-white/60 dark:bg-zinc-900/40 backdrop-blur-2xl border-r border-white/40 dark:border-white/[0.06] hidden md:flex flex-col z-50"
    >
      {/* Logo Area */}
      <div className="px-8 py-10 flex items-center justify-between">
        <div className="flex items-center gap-3 text-yc-text-primary dark:text-white">
          <img src={theme === 'dark' ? '/unicornx.png' : '/unicornx_black.png'} alt="UnicornX" className="h-9 w-auto" />
          <h1 className="text-2xl font-black tracking-tighter">
            UnicornX
          </h1>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-6 space-y-1.5 overflow-y-auto">
        {navItems.map((item) => {
          const isActive = activeSection === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActiveSection(item.id)}
              className={`w-full flex items-center px-5 py-3.5 rounded-2xl transition-all duration-300 group font-semibold text-[15px]
                ${isActive
                  ? 'bg-yc-aleo/10 dark:bg-yc-aleo/[0.12] text-yc-aleo border-l-[3px] border-yc-aleo'
                  : 'text-gray-500 dark:text-gray-500 hover:bg-gray-100 dark:hover:bg-white/[0.04] hover:text-yc-text-primary dark:hover:text-gray-300 border-l-[3px] border-transparent'}
              `}
            >
              <item.icon
                className={`w-5 h-5 mr-4 transition-colors duration-300
                  ${isActive ? 'text-yc-aleo' : 'text-gray-400 dark:text-gray-500 group-hover:text-gray-600 dark:group-hover:text-gray-400'}`}
                strokeWidth={isActive ? 2.2 : 1.8}
              />
              <span className="tracking-tight">{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="p-6 border-t border-white/30 dark:border-white/[0.06] space-y-4 bg-transparent">

        {isConnected ? (
          /* Connected: show profile card + theme toggle */
          <>
            <div
              className="flex items-center p-3 rounded-2xl bg-white/40 dark:bg-white/[0.04] backdrop-blur-xl border border-white/40 dark:border-white/[0.06] cursor-pointer hover:bg-white/60 dark:hover:bg-white/[0.08] transition-all group"
              onClick={onSettingsClick}
            >
              <div className="w-10 h-10 rounded-lg bg-gray-200 dark:bg-white/10 overflow-hidden shrink-0">
                <img
                  src={user.avatar}
                  alt="User"
                  className="w-full h-full object-cover"
                  style={{ imageRendering: user.avatar?.startsWith('data:') ? 'pixelated' : 'auto' }}
                />
              </div>
              <div className="ml-3 flex-1 min-w-0">
                <p className="text-sm font-semibold text-yc-text-primary dark:text-white truncate">{user.name}</p>
                <div className="flex items-center gap-1 mt-0.5">
                  <p className="text-xs text-gray-400 dark:text-gray-500 font-mono font-medium">
                    {balanceLoading ? '...' : `${Number(ethers.formatEther(balance)).toFixed(2)} ALEO`}
                  </p>
                  <button
                    onClick={handleCopyAddress}
                    className="shrink-0 p-0.5 text-gray-300 dark:text-gray-600 hover:text-yc-aleo dark:hover:text-yc-aleo transition-colors"
                    title="Copy wallet address"
                  >
                    {addressCopied ? <Check size={11} className="text-green-500" /> : <Copy size={11} />}
                  </button>
                </div>
              </div>
              <Settings className="w-5 h-5 text-gray-300 dark:text-gray-600 group-hover:text-gray-500 dark:group-hover:text-gray-400 transition-colors shrink-0" />
            </div>

            {/* Theme Toggle */}
            <div className="flex justify-center">
              <div className="flex bg-white/40 dark:bg-white/[0.04] backdrop-blur-xl rounded-full p-1 border border-white/40 dark:border-white/[0.06]">
                <button
                  onClick={() => theme === 'dark' && toggleTheme()}
                  className={`p-2 rounded-full transition-all ${theme === 'light' ? 'bg-white shadow text-gray-700' : 'text-gray-500'}`}
                >
                  <Sun size={16} />
                </button>
                <button
                  onClick={() => theme === 'light' && toggleTheme()}
                  className={`p-2 rounded-full transition-all ${theme === 'dark' ? 'bg-white/10 text-white' : 'text-gray-400'}`}
                >
                  <Moon size={16} />
                </button>
              </div>
            </div>
          </>
        ) : (
          /* Not connected: Aleo wallet (Shield/Leo/Fox) */
          <>
            <p className="text-center text-[10px] text-gray-400 dark:text-gray-600 font-medium tracking-wide">
              Powered by{' '}
              <span className="text-gray-500 dark:text-gray-500 font-semibold">Aleo</span>
            </p>

            {/* Connect Aleo Wallet (opens Shield/Leo/Fox modal) */}
            <button
              onClick={connect}
              disabled={isConnecting}
              className="w-full flex items-center justify-center gap-2 px-4 py-3.5 rounded-2xl bg-yc-aleo text-white font-bold text-sm transition-all hover:bg-yc-aleo/80 hover:shadow-[0_0_20px_rgba(249, 115, 22,0.3)] hover:scale-[1.02] active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <Wallet size={18} />
              {isConnecting ? 'Loading...' : 'Connect Aleo Wallet'}
            </button>

            {/* Theme Toggle */}
            <div className="flex justify-center">
              <div className="flex bg-white/40 dark:bg-white/[0.04] backdrop-blur-xl rounded-full p-1 border border-white/40 dark:border-white/[0.06]">
                <button
                  onClick={() => theme === 'dark' && toggleTheme()}
                  className={`p-2 rounded-full transition-all ${theme === 'light' ? 'bg-white shadow text-gray-700' : 'text-gray-500'}`}
                >
                  <Sun size={16} />
                </button>
                <button
                  onClick={() => theme === 'light' && toggleTheme()}
                  className={`p-2 rounded-full transition-all ${theme === 'dark' ? 'bg-white/10 text-white' : 'text-gray-400'}`}
                >
                  <Moon size={16} />
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </aside>
  );
};

export default Sidebar;
