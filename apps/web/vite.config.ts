import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)));

export default defineConfig({
  root,
  plugins: [react()],
  resolve: {
    alias: {
      '@arl/shared': join(root, '../../packages/shared/src/index.ts'),
      '@arl/evaluation': join(root, '../../packages/evaluation/src/index.ts'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
