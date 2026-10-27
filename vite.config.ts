import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'client',
  plugins: [react()],
  build: { outDir: '../dist/client', emptyOutDir: true },
  server: { port: 5174, proxy: { '/api': 'http://localhost:8081' } },
  test: { root: '.', include: ['shared/**/*.test.ts', 'server/**/*.test.ts', 'client/src/**/*.test.ts'] },
});
