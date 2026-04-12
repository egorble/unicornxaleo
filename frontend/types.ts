// Types for UnicornX application

// ============ Rarity (matches contract enum) ============
export enum Rarity {
  COMMON = 'Common',      // 0
  RARE = 'Rare',          // 1
  EPIC = 'Epic',          // 2
  EPIC_RARE = 'EpicRare', // 3
  LEGENDARY = 'Legendary' // 4
}

// Rarity sort order (higher = rarer)
export const RARITY_ORDER: Record<string, number> = {
  [Rarity.COMMON]: 0,
  [Rarity.RARE]: 1,
  [Rarity.EPIC]: 2,
  [Rarity.EPIC_RARE]: 3,
  [Rarity.LEGENDARY]: 4,
};

export function sortByRarity(cards: CardData[]): CardData[] {
  return [...cards].sort((a, b) => (RARITY_ORDER[b.rarity] ?? 0) - (RARITY_ORDER[a.rarity] ?? 0));
}

// ============ Startup Display Data ============
export interface Startup {
  id: string;
  name: string;
  batch: string;
  description: string;
  value: number;
  change: number;
  logo: string;
  coverImage: string;
  stage: string;
  score: number;
  trend: number[]; // For sparkline
}

// ============ NFT Card Data (from contract) ============
export interface FundraisingData {
  round: string; // e.g. "Series B", "Seed"
  amount: string; // e.g. "$330M"
  valuation: string | null; // e.g. "$6.6B" or null
}

export interface CardData {
  tokenId: number;
  startupId: number;
  name: string;
  rarity: Rarity;
  level?: number; // Card level 1-5 (= score multiplier), defaults to multiplier
  multiplier: number; // = level (kept for backward compat)
  isLocked: boolean;
  image: string;
  edition: number;
  fundraising?: FundraisingData | null; // Optional fundraising data from metadata
  description?: string; // Optional description from metadata
  isPack?: boolean; // True for PackNFT listings (not UnicornX_NFT cards)
}

// Legacy CardData for mock (deprecated)
export interface LegacyCardData {
  id: string;
  startupName: string;
  rarity: Rarity;
  value: string;
  multiplier: string;
  image: string;
}

// ============ Navigation ============
export enum NavSection {
  HOME = 'Home',
  MARKETPLACE = 'Marketplace',
  PORTFOLIO = 'My Portfolio',
  LEAGUES = 'Leagues',
  FEED = 'Feed',
  ADMIN = 'Admin'
}

// ============ User Profile ============
export interface UserProfile {
  name: string;
  handle: string;
  balanceXTZ: number;
  avatar: string;
  address?: string;
}

// ============ Tournament ============
export interface Tournament {
  id: number;
  name: string;
  registrationStart: number;
  startTime: number;
  endTime: number;
  prizePool: bigint;
  entryCount: number;
  status: 'Created' | 'Active' | 'Finalized' | 'Cancelled';
}

// ============ Lineup ============
export interface Lineup {
  cardIds: number[];
  owner: string;
  timestamp: number;
  cancelled: boolean;
  claimed: boolean;
}

// ============ Pack ============
export interface Pack {
  id: number;
  buyer: string;
  purchaseTime: number;
  opened: boolean;
  cardIds: number[];
}

// Helper to convert legacy to new CardData
export function legacyToCardData(legacy: LegacyCardData, index: number): CardData {
  const level = parseFloat(legacy.multiplier) || 1;
  return {
    tokenId: index,
    startupId: index,
    name: legacy.startupName,
    rarity: legacy.rarity,
    level,
    multiplier: level,
    isLocked: false,
    image: legacy.image,
    edition: 1,
  };
}