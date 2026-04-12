// Buffer polyfill — required by WalletConnect / Privy embedded wallets in browsers
import { Buffer } from 'buffer';
if (typeof window !== 'undefined' && !window.Buffer) {
    window.Buffer = Buffer;
}

// Preload fires all API calls immediately — before React mounts
import './lib/preload';
import './index.css';

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

// Unregister old service worker and clear its caches
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((registrations) => {
    registrations.forEach((r) => r.unregister());
  });
  caches.keys().then((keys) => {
    keys.forEach((key) => caches.delete(key));
  });
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);