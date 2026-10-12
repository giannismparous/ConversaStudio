import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Served under fλow at /dialogos/ (same-origin embed via Netlify proxy).
const base = process.env.VITE_BASE || '/dialogos/';

export default defineConfig({
  base,
  plugins: [react()],
  resolve: {
    alias: {
      '@dialogos-forge/chat-widget': path.resolve(
        __dirname,
        '../../packages/chat-widget/src/index.jsx'
      ),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/theme': {
        target: process.env.VITE_FLOW_ORIGIN || 'https://simasiaai-flow.netlify.app',
        changeOrigin: true,
      },
    },
  },
  optimizeDeps: {
    include: ['framer-motion'],
  },
});
