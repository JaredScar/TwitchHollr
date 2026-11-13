import { OfflineRecognizer, Vad } from 'sherpa-onnx-node';
import { fileFor, getModel } from '../models';
import { type EngineInitOptions, type ISttEngine, int16ToFloat32 } from '../engine';

const WINDOW = 512;

/**
 * Silero VAD cuts audio into utterances; Whisper (run through sherpa-onnx's ONNX runtime) transcribes each.
 * With useGpu, the CUDA execution provider is tried first and falls back to CPU if unavailable.
 */
export class WhisperEngine implements ISttEngine {
  private vad: Vad | null = null;
  private recognizer: OfflineRecognizer | null = null;
  private buffer = new Float32Array(0);
  private partialCb: (t: string) => void = () => {};
  private finalCb: (t: string) => void = () => {};
  private speaking = false;
  private _provider = 'cpu';

  constructor(private readonly modelId: string) {}

  get provider(): string {
    return this._provider;
  }

  async init(opts: EngineInitOptions): Promise<void> {
    const def = getModel(this.modelId);
    if (!def) throw new Error(`Unknown Whisper model ${this.modelId}`);
    const dir = opts.modelDir;
    this.vad = new Vad(
      {
        sileroVad: {
          model: fileFor(dir, def, 'vad'),
          threshold: 0.5,
          minSilenceDuration: 0.6,
          minSpeechDuration: 0.25,
          maxSpeechDuration: 12,
          windowSize: WINDOW,
        },
        sampleRate: opts.sampleRate,
        numThreads: 1,
        provider: 'cpu',
        debug: 0,
      },
      30,
    );
    const make = (provider: string) =>
      new OfflineRecognizer({
        featConfig: { sampleRate: opts.sampleRate, featureDim: 80 },
        modelConfig: {
          whisper: {
            encoder: fileFor(dir, def, 'encoder'),
            decoder: fileFor(dir, def, 'decoder'),
            language: 'en',
            task: 'transcribe',
            tailPaddings: -1,
          },
          tokens: fileFor(dir, def, 'tokens'),
          numThreads: opts.numThreads,
          provider,
          debug: 0,
        },
      });
    if (opts.useGpu) {
      try {
        this.recognizer = make('cuda');
        this._provider = 'cuda';
        return;
      } catch {
        // CUDA provider unavailable in this build or on this machine.
      }
    }
    this.recognizer = make('cpu');
    this._provider = 'cpu';
  }

  accept(pcm: Int16Array): void {
    const vad = this.vad;
    if (!vad) return;
    const merged = new Float32Array(this.buffer.length + pcm.length);
    merged.set(this.buffer);
    merged.set(int16ToFloat32(pcm), this.buffer.length);
    let offset = 0;
    while (merged.length - offset >= WINDOW) {
      vad.acceptWaveform(merged.subarray(offset, offset + WINDOW));
      offset += WINDOW;
    }
    this.buffer = merged.slice(offset);

    const detected = vad.isDetected();
    if (detected && !this.speaking) this.partialCb('…');
    this.speaking = detected;

    while (!vad.isEmpty()) {
      const seg = vad.front(false);
      vad.pop();
      this.transcribe(seg.samples);
    }
  }

  private transcribe(samples: Float32Array): void {
    const r = this.recognizer;
    if (!r) return;
    const stream = r.createStream();
    stream.acceptWaveform({ samples, sampleRate: 16000 });
    r.decode(stream);
    const text = r.getResult(stream).text.trim();
    if (text && !/^\[.*\]$|^\(.*\)$/.test(text)) {
      this.partialCb(text);
      this.finalCb(text);
    }
  }

  onPartial(cb: (text: string) => void): void {
    this.partialCb = cb;
  }

  onFinal(cb: (text: string) => void): void {
    this.finalCb = cb;
  }

  reset(): void {
    this.vad?.reset();
    this.buffer = new Float32Array(0);
    this.speaking = false;
  }

  dispose(): void {
    this.vad = null;
    this.recognizer = null;
  }
}
