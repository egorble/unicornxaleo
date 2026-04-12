// Shim re-exporting the ethers-compatible helpers from lib/contracts.
// Allows `import { ethers } from 'ethers'` to work via Vite alias (see vite.config.ts).
export { ethers } from './contracts';
export const Eip1193Provider = null as any;
export type Signer = any;
export type Provider = any;
export type Contract = any;
export type BrowserProvider = any;
export type JsonRpcProvider = any;
export { ethers as default } from './contracts';

// For `import { BrowserProvider, ethers, Eip1193Provider } from 'ethers'` style
import { ethers as _e } from './contracts';
export const BrowserProvider = _e.BrowserProvider;
export const Contract = _e.Contract;
export const JsonRpcProvider = _e.JsonRpcProvider;
