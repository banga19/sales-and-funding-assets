var _a;
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
// Vite loads .env*, .env.local, .env.[mode] before building the config object.
// process.env.VITE_* is therefore already available at config evaluation time.
var VITE_API_BASE_URL = process.env.VITE_API_BASE_URL || '/api';
var VITE_API_TIMEOUT = (_a = process.env.VITE_API_TIMEOUT) !== null && _a !== void 0 ? _a : '10000';
var API_TARGET = process.env.VITE_API_TARGET || 'http://localhost:3000';
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
            // Health, status, contacts, agent trigger, metrics  → Backend (port 3000)
            '/api': {
                target: API_TARGET,
                changeOrigin: true,
            },
            // Webhooks (WhatsApp / Email provider callbacks)      → Agent (port 3002)
            '/webhooks': {
                target: 'http://localhost:3002',
                changeOrigin: true,
            },
        },
    },
});
