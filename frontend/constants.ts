import { Startup, Rarity } from './types';

// Real YC Startups from the UnicornX game
// Data matches backend server.js STARTUPS
export const MOCK_STARTUPS: Startup[] = [
  // === LEGENDARY (5) ===
  {
    id: '1',
    name: 'Openclaw',
    batch: 'W25',
    description: 'Open-source AI infrastructure.',
    value: 500.00,
    change: 10.0,
    logo: 'https://picsum.photos/40/40?random=1',
    coverImage: 'https://images.unsplash.com/photo-1677442136019-21780ecad995?w=400&h=500&fit=crop',
    stage: 'Seed',
    score: 90,
    trend: [400, 420, 440, 460, 480, 500]
  },
  {
    id: '2',
    name: 'Lovable',
    batch: 'W24',
    description: 'AI software engineer that builds production apps.',
    value: 6600.00,
    change: 18.5,
    logo: 'https://picsum.photos/40/40?random=2',
    coverImage: 'https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=400&h=500&fit=crop',
    stage: 'Series B',
    score: 96,
    trend: [4000, 4500, 5000, 5500, 6000, 6600]
  },
  {
    id: '3',
    name: 'Cursor',
    batch: 'S23',
    description: 'AI-first code editor built for pair programming.',
    value: 29300.00,
    change: 25.2,
    logo: 'https://picsum.photos/40/40?random=3',
    coverImage: 'https://images.unsplash.com/photo-1461749280684-dccba630e2f6?w=400&h=500&fit=crop',
    stage: 'Series D',
    score: 98,
    trend: [20000, 22000, 24000, 26000, 28000, 29300]
  },
  {
    id: '4',
    name: 'OpenAI',
    batch: 'S15',
    description: 'Leading AI research lab - creators of GPT.',
    value: 157000.00,
    change: 45.0,
    logo: 'https://picsum.photos/40/40?random=4',
    coverImage: 'https://images.unsplash.com/photo-1620712943543-bcc4688e7485?w=400&h=500&fit=crop',
    stage: 'Series F',
    score: 100,
    trend: [100000, 120000, 130000, 140000, 150000, 157000]
  },
  {
    id: '5',
    name: 'Anthropic',
    batch: 'S21',
    description: 'AI safety company - creators of Claude.',
    value: 183000.00,
    change: 30.0,
    logo: 'https://picsum.photos/40/40?random=5',
    coverImage: 'https://images.unsplash.com/photo-1677442136019-21780ecad995?w=400&h=500&fit=crop',
    stage: 'Series F',
    score: 99,
    trend: [120000, 135000, 150000, 165000, 175000, 183000]
  },
  // === EPIC (3) ===
  {
    id: '6',
    name: 'Browser Use',
    batch: 'W24',
    description: 'AI browser automation for web agents.',
    value: 50.00,
    change: 5.2,
    logo: 'https://picsum.photos/40/40?random=6',
    coverImage: 'https://images.unsplash.com/photo-1558494949-ef010cbdcc31?w=400&h=500&fit=crop',
    stage: 'Seed',
    score: 85,
    trend: [40, 42, 45, 47, 48, 50]
  },
  {
    id: '7',
    name: 'Dedalus Labs',
    batch: 'S25',
    description: 'AI agent infrastructure - Vercel for Agents.',
    value: 80.00,
    change: 3.8,
    logo: 'https://picsum.photos/40/40?random=7',
    coverImage: 'https://images.unsplash.com/photo-1639322537228-f710d846310a?w=400&h=500&fit=crop',
    stage: 'Seed',
    score: 82,
    trend: [60, 65, 70, 72, 75, 80]
  },
  {
    id: '8',
    name: 'Autumn',
    batch: 'S25',
    description: 'Billing and pricing infrastructure for AI startups.',
    value: 120.00,
    change: 4.5,
    logo: 'https://picsum.photos/40/40?random=8',
    coverImage: 'https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?w=400&h=500&fit=crop',
    stage: 'Seed',
    score: 80,
    trend: [100, 105, 108, 110, 115, 120]
  },
  // === RARE (5) ===
  {
    id: '9',
    name: 'Axiom',
    batch: 'W22',
    description: 'ZK coprocessor for Ethereum smart contracts.',
    value: 200.00,
    change: 8.0,
    logo: 'https://picsum.photos/40/40?random=9',
    coverImage: 'https://images.unsplash.com/photo-1516245834210-c4c142787335?w=400&h=500&fit=crop',
    stage: 'Seed',
    score: 88,
    trend: [150, 160, 170, 180, 190, 200]
  },
  {
    id: '10',
    name: 'Multifactor',
    batch: 'W24',
    description: 'Authentication platform for enterprises.',
    value: 30.00,
    change: 2.1,
    logo: 'https://picsum.photos/40/40?random=10',
    coverImage: 'https://images.unsplash.com/photo-1563986768494-4dee2763ff3f?w=400&h=500&fit=crop',
    stage: 'Seed',
    score: 72,
    trend: [25, 26, 27, 28, 29, 30]
  },
  {
    id: '11',
    name: 'Dome',
    batch: 'F25',
    description: 'Unified API for prediction markets.',
    value: 25.00,
    change: 1.5,
    logo: 'https://picsum.photos/40/40?random=11',
    coverImage: 'https://images.unsplash.com/photo-1558002038-1055907df827?w=400&h=500&fit=crop',
    stage: 'Pre-seed',
    score: 68,
    trend: [20, 21, 22, 23, 24, 25]
  },
  {
    id: '12',
    name: 'GrazeMate',
    batch: 'W23',
    description: 'AgTech for livestock management.',
    value: 15.00,
    change: 0.8,
    logo: 'https://picsum.photos/40/40?random=12',
    coverImage: 'https://images.unsplash.com/photo-1500595046743-cd271d694d30?w=400&h=500&fit=crop',
    stage: 'Seed',
    score: 65,
    trend: [12, 13, 13, 14, 14, 15]
  },
  {
    id: '13',
    name: 'Tornyol Systems',
    batch: 'W25',
    description: 'Industrial automation systems.',
    value: 20.00,
    change: 1.2,
    logo: 'https://picsum.photos/40/40?random=13',
    coverImage: 'https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?w=400&h=500&fit=crop',
    stage: 'Seed',
    score: 70,
    trend: [15, 16, 17, 18, 19, 20]
  },
  // === COMMON (6) ===
  {
    id: '14',
    name: 'Pocket',
    batch: 'W26',
    description: 'AI note-taker for meetings.',
    value: 10.00,
    change: 0.5,
    logo: 'https://picsum.photos/40/40?random=14',
    coverImage: 'https://images.unsplash.com/photo-1517842645767-c639042777db?w=400&h=500&fit=crop',
    stage: 'Seed',
    score: 55,
    trend: [8, 8, 9, 9, 10, 10]
  },
  {
    id: '15',
    name: 'Caretta',
    batch: 'W26',
    description: 'Realtime AI for sales teams.',
    value: 12.00,
    change: 0.6,
    logo: 'https://picsum.photos/40/40?random=15',
    coverImage: 'https://images.unsplash.com/photo-1552664730-d307ca884978?w=400&h=500&fit=crop',
    stage: 'Seed',
    score: 58,
    trend: [9, 10, 10, 11, 11, 12]
  },
  {
    id: '16',
    name: 'AxionOrbital Space',
    batch: 'W25',
    description: 'Space technology and orbital systems.',
    value: 8.00,
    change: 0.3,
    logo: 'https://picsum.photos/40/40?random=16',
    coverImage: 'https://images.unsplash.com/photo-1446776811953-b23d57bd21aa?w=400&h=500&fit=crop',
    stage: 'Seed',
    score: 50,
    trend: [6, 6, 7, 7, 8, 8]
  },
  {
    id: '17',
    name: 'Freeport Markets',
    batch: 'F25',
    description: 'Decentralized prediction markets.',
    value: 9.00,
    change: 0.4,
    logo: 'https://picsum.photos/40/40?random=17',
    coverImage: 'https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=400&h=500&fit=crop',
    stage: 'Pre-seed',
    score: 52,
    trend: [7, 7, 8, 8, 9, 9]
  },
  {
    id: '18',
    name: 'Ruvo',
    batch: 'W25',
    description: 'Global dollar app for Brazil.',
    value: 11.00,
    change: 0.5,
    logo: 'https://picsum.photos/40/40?random=18',
    coverImage: 'https://images.unsplash.com/photo-1580519542036-c47de6196ba5?w=400&h=500&fit=crop',
    stage: 'Seed',
    score: 56,
    trend: [8, 9, 9, 10, 10, 11]
  },
  {
    id: '19',
    name: 'Lightberry',
    batch: 'W25',
    description: 'Social brain for robots.',
    value: 7.00,
    change: 0.2,
    logo: 'https://picsum.photos/40/40?random=19',
    coverImage: 'https://images.unsplash.com/photo-1485827404703-89b55fcc595e?w=400&h=500&fit=crop',
    stage: 'Seed',
    score: 48,
    trend: [5, 5, 6, 6, 7, 7]
  }
];

// Rarity colors for display
export const RARITY_COLORS: Record<Rarity, { bg: string; text: string; border: string }> = {
  [Rarity.COMMON]: { bg: 'bg-gray-800', text: 'text-gray-300', border: 'border-gray-600' },
  [Rarity.RARE]: { bg: 'bg-green-600', text: 'text-white', border: 'border-green-500' },
  [Rarity.EPIC]: { bg: 'bg-orange-600', text: 'text-white', border: 'border-orange-500' },
  [Rarity.EPIC_RARE]: { bg: 'bg-orange-600', text: 'text-white', border: 'border-orange-500' },
  [Rarity.LEGENDARY]: { bg: 'bg-orange-500', text: 'text-white', border: 'border-orange-400' },
};

// Rarity multipliers
export const RARITY_MULTIPLIERS: Record<Rarity, number> = {
  [Rarity.COMMON]: 1,
  [Rarity.RARE]: 3,
  [Rarity.EPIC]: 5,
  [Rarity.EPIC_RARE]: 8,
  [Rarity.LEGENDARY]: 10,
};