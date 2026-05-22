import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
// Vite loads .env*, .env.local, .env.[mode] before building the config object.
// process.env.VITE_* is therefore already available at config evaluation time.
var VITE_API_BASE_URL = process.env.VITE_API_BASE_URL || '/api';
var VITE_API_TIMEOUT = process.env.VITE_API_TIMEOUT || '30000';
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
            // ── /api/* → Agent (port 3002; /api prefix forwarded as-is)
            //    Covers: /api/health, /api/status, /api/agent/*, /api/contacts/*,
            //    /api/products, /api/products/stats, /api/products/:id, /api/products/scrape, etc.
            '/api': {
                target: API_TARGET,
                changeOrigin: true,
                // Agent health checks + AI calls can take up to 8–12 s; keep the Vite proxy
                // gate wider so it does not reject a slow-but-healthy response mid-flight.
                proxyTimeout: 20000,
            },
        },
    },
});
