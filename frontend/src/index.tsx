import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OutreachProvider } from './context/OutreachContext';
import './index.css';
import App from './App';

// ─── Console Noise Filters ────────────────────────────────────────────────────
// Single consolidated filter covering all four noise categories:
//  1. Cross-window bridge spam  (page_all.js / MessageEvent / init command)
//  2. log4js DEFAULT root logger warnings (printToConsole / Using DEFAULT root logger)
//  3. Angular error-corruption stubs (Understand this error / warning)
//  4. Browser-extension noise  (grammarly / chrome-extension / react-devtools)
const NOISE_FILTERS = [
  // Category 1 — cross-window bridge
  'MessageEvent',
  'init command',
  // Category 2 — log4js root logger
  'printToConsole',
  'Using DEFAULT root logger',
  // Category 3 — Angular stubs
  'Understand this error',
  'Understand this warning',
  // Category 4 — browser extensions
  'grammarly',
  'chrome-extension://',
  'react-devtools',
  '__grammarly',
  'inject',
  'crx',
];

const shouldFilterStr = (str: string) => NOISE_FILTERS.some(p => str.includes(p));
const shouldFilterArgs = (args: any[]) => {
  if (typeof args[0] === 'string') return shouldFilterStr(args[0]);
  const str = args.map(a => (a ?? '').toString()).join(' ');
  return shouldFilterStr(str);
};

const _origConsoleLog  = console.log;
const _origConsoleWarn = console.warn;
const _origConsoleErr  = console.error;
console.log  = (...args: any[]) => { if (!shouldFilterArgs(args)) _origConsoleLog.apply(console, args); };
console.warn = (...args: any[]) => { if (!shouldFilterArgs(args)) _origConsoleWarn.apply(console, args); };
console.error = (...args: any[]) => {
  const str = args.map(a => (a ?? '').toString()).join(' ');
  if (str.includes('grammarly') || str.includes('chrome-extension')) return;
  _origConsoleErr.apply(console, args);
};

// ─── MessageEvent Deduplication ──────────────────────────────────────────────
// Filters repeated cross-window MessageEvent spam; only surfaces first occurrence
// per unique fingerprint as console.debug in DEV mode.
const filterMessageEvents = () => {
  const ORIGIN = window.location.origin;
  let lastSeen = '';
  window.addEventListener('message', (event: MessageEvent) => {
    if (event.origin !== ORIGIN) return;
    if (typeof event.data === 'object' && event.data !== null && 'command' in event.data) return;
    const fingerprint = JSON.stringify(event.data);
    if (fingerprint === lastSeen) return;
    lastSeen = fingerprint;
    if (import.meta.env.DEV) console.debug('[MessageEvent]', event.data);
  }, true);
};
filterMessageEvents();

import reportWebVitals from './reportWebVitals';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error: any) => {
        if (error?.response?.status === 401) return false;
        return failureCount < 3;
      },
    },
    mutations: {
      onError: (error: any) => {
        if (error?.response?.status === 401) {
          localStorage.removeItem('token');
          localStorage.removeItem('refreshToken');
          window.location.href = '/login';
        }
      },
    },
  },
});

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
);
  root.render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <OutreachProvider>
          <App />
        </OutreachProvider>
      </QueryClientProvider>
    </React.StrictMode>
  );

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
