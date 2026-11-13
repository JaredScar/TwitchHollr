import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// The STT utilityProcess entry is bundled on its own so it can never share a chunk with (and therefore load)
// the main process bundle.
export default defineConfig({
  resolve: { alias: { '@shared': resolve(import.meta.dirname, 'src/shared') } },
  build: {
    ssr: resolve(import.meta.dirname, 'src/main/stt/worker.ts'),
    outDir: 'out/worker',
    emptyOutDir: true,
    target: 'node22',
    minify: false,
    rollupOptions: {
      external: ['electron', 'sherpa-onnx-node'],
      output: { format: 'cjs', entryFileNames: 'stt-worker.js', codeSplitting: false },
    },
  },
});
