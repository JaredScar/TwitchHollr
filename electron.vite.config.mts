import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';

const shared = { '@shared': resolve(import.meta.dirname, 'src/shared') };

// The renderer is an Angular app built by the Angular CLI (see angular.json) and the STT worker has its own
// config (vite.worker.config.mts), so only main and preload live here.
export default defineConfig({
  main: {
    resolve: { alias: shared },
    build: {
      externalizeDeps: { exclude: ['electron-store'] },
      rollupOptions: {
        input: { index: resolve(import.meta.dirname, 'src/main/index.ts') },
      },
    },
  },
  preload: {
    resolve: { alias: shared },
    build: {
      rollupOptions: {
        input: { index: resolve(import.meta.dirname, 'src/preload/index.ts') },
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
});
