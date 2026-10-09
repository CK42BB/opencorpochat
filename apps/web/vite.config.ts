// SPDX-License-Identifier: AGPL-3.0-only
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const api = process.env.OCPC_DEV_API ?? 'http://localhost:8080';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api/v1/ws': { target: api.replace(/^http/, 'ws'), ws: true },
      '/api': { target: api, changeOrigin: false },
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 1200,
  },
  test: {
    environment: 'jsdom',
  },
});
