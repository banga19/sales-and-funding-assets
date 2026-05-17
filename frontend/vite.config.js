import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
// Vite loads .env*, .env.local, .env.[mode] before building the config object.
// process.env.VITE_* is therefore already available at config evaluation time.
var VITE_API_BASE_URL = process.env.VITE_API_BASE_URL || '/api';
var VITE_API_TIMEOUT = process.env.VITE_API_TIMEOUT || '10000';
var API_TARGET = process.env.VITE_API_TARGET || 'http://localhost:3002';
export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
        },
    },
    define: {
        'import.meta.env.VITE_API_BASE_URL': JSON.stringify(VITE_API_BASE_URL),
        'import.meta.env.VITE_API_TIMEOUT': JSON.stringify(VITE_API_TIMEOUT),
    },
    server: {
        port: 3001,
        strictPort: true,
        proxy: {
            // All /api/* calls ──────────────────────────────────────────────────────────
            // DEVELOPMENT (default): /api/* → Agent (port 3002)
            //   The Agent owns /api/health, /api/status, /api/agent/*, /api/contacts/*
            //   and every endpoint the frontend needs with live data.
            //
            // PRODUCTION override:     set VITE_API_TARGET to the backend URL in
            //   frontend/.env.production (e.g. https://api.sokogate.com)
            // ─────────────────────────────────────────────────────────────────────────
            // Contacts/CMS routes  → Agent (port 3002)  [primary target]
            '/api': {
                target: API_TARGET,
                changeOrigin: true,
            },
            // Webhooks (WhatsApp / Email provider callbacks) → no change needed
            '/webhooks': {
                target: 'http://localhost:3002',
                changeOrigin: true,
            },
        },
    },
});
