import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { buildInfo } from './scripts/buildInfo.ts';

export default defineConfig({
  define: { __PORTAL_BUILD__: JSON.stringify(buildInfo(fileURLToPath(new URL('.', import.meta.url)))) },
  root: 'client',
  plugins: [react()],
  build: { outDir: '../dist/client', emptyOutDir: true },
  server: { port: 5174, proxy: { '/api': 'http://localhost:8081' } },
  test: { root: '.', include: ['shared/**/*.test.ts', 'server/**/*.test.ts', 'client/src/**/*.test.ts'] },
});
