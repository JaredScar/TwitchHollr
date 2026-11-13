export interface EngineInitOptions {
  modelDir: string;
  sampleRate: 16000;
  numThreads: number;
  /** Words to bias recognition toward (wake word, aliases, command verbs). */
  hotwords: string[];
  /** Whisper only: try the CUDA execution provider first. */
  useGpu?: boolean;
}

export interface ISttEngine {
  init(opts: EngineInitOptions): Promise<void>;
  accept(pcm: Int16Array): void;
  onPartial(cb: (text: string) => void): void;
  /** Fired at an endpoint (≈0.8 s of trailing silence). */
  onFinal(cb: (text: string) => void): void;
  reset(): void;
  dispose(): void;
  /** Execution provider actually in use, e.g. "cpu" or "cuda". */
  readonly provider: string;
}

export function int16ToFloat32(pcm: Int16Array): Float32Array {
  const out = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) out[i] = pcm[i]! / 32768;
  return out;
}
