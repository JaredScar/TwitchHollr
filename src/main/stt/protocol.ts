import type { SttEngineId } from '@shared/types';

export type ToWorker =
  | {
      type: 'init';
      engine: SttEngineId;
      modelId: string;
      modelDir: string;
      numThreads: number;
      hotwords: string[];
      useGpu: boolean;
    }
  /** Accompanied by a MessagePort in ports[0]: the renderer's audio stream. */
  | { type: 'port' }
  | { type: 'gate'; open: boolean }
  | { type: 'dispose' };

export type FromWorker =
  | { type: 'ready'; provider: string; loadMs: number }
  | { type: 'error'; message: string }
  | { type: 'partial'; text: string }
  | { type: 'final'; text: string; decodeMs: number };
