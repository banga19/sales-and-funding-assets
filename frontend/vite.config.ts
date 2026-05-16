import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig(({ mode }) => {
  // Load .env*, .env.local, .env.[mode] — merge on top of OS env vars
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    define: {
      // Expose selected env vars to the client bundle as import.meta.env
      'import.meta.env.VITE_API_BASE_URL': JSON.stringify(
        env.VITE_API_BASE_URL || '/api'
      ),
      'import.meta.env.VITE_API_TIMEOUT': JSON.stringify(
        env.VITE_API_TIMEOUT ?? '10000'
      ),
    },
    server: {
      port: 3001,
      strictPort: true,
      proxy: {
        '/api': {
          target: env.VITE_API_TARGET || 'http://localhost:3000',
          changeOrigin: true,
        },
      },
    },
  };
});
