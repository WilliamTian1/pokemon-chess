/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const serverPort = Number(process.env.SERVER_PORT ?? 8787);

export default defineConfig({
  // GitHub Pages serves the site from /<repo>/; the Pages workflow sets VITE_BASE.
  base: process.env.VITE_BASE ?? '/',
  plugins: [react()],
  server: {
    proxy: {
      // Online play in dev: `npm run server` in another terminal.
      '/ws': { target: `ws://localhost:${serverPort}`, ws: true },
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 120_000,
  },
});
