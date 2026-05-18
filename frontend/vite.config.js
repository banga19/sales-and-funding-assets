import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
// Vite loads .env*, .env.local, .env.[mode] before building the config object.
// process.env.VITE_* is therefore already available at config evaluation time.
var VITE_API_BASE_URL = process.env.VITE_API_BASE_URL || '/api';
var VITE_API_TIMEOUT = process.env.VITE_API_TIMEOUT || '10000';
var API_TARGET = process.env.VITE_API_TARGET || 'http://localhost:3002';
var BACKEND_TARGET = process.env.VITE_BACKEND_TARGET || 'http://localhost:3000';
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
            // ── /api/* → Agent (port 3002)
            //    Agent owns /api/health, /api/status, /api/agent/*, /api/contacts/*
            '/api': {
                target: API_TARGET,
                changeOrigin: true,
            },
            // ── /api/products → Backend (port 3000) — wins over /api catch-all above
            //    because it is a more specific prefix match
            '/api/products': {
                target: BACKEND_TARGET,
                changeOrigin: true,
            },
        },
    },
});
