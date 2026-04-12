import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  server: {
    port: 5171,
    strictPort: true,
    host: '0.0.0.0',
    proxy: {
      '/api': {
        target: 'http://localhost:5170',
        changeOrigin: true,
      },
    },
  },
  plugins: [react()],
  define: {
    global: 'globalThis',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
      // Redirect `ethers` imports to our Aleo-compat shim (no ethers dependency)
      'ethers': path.resolve(__dirname, 'lib/ethers-shim.ts'),
      // Stub out Privy / wagmi / viem packages
      '@privy-io/react-auth': path.resolve(__dirname, 'lib/stub-privy.ts'),
      'wagmi': path.resolve(__dirname, 'lib/stub-wagmi.ts'),
      'viem': path.resolve(__dirname, 'lib/stub-viem.ts'),
      '@walletconnect/ethereum-provider': path.resolve(__dirname, 'lib/stub-empty.ts'),
      '@walletconnect/modal': path.resolve(__dirname, 'lib/stub-empty.ts'),
      'rise-wallet': path.resolve(__dirname, 'lib/stub-empty.ts'),
      'rise-wallet/wagmi': path.resolve(__dirname, 'lib/stub-empty.ts'),
    },
    dedupe: ['react', 'react-dom'],
  },
  optimizeDeps: {
    exclude: ['@provablehq/wasm'],
    include: ['@provablehq/sdk', 'core-js/proposals/json-parse-with-source'],
    esbuildOptions: {
      target: 'esnext',
      supported: { 'top-level-await': true },
    },
  },
  build: {
    target: 'esnext',
  },
  worker: {
    format: 'es',
  },
});
