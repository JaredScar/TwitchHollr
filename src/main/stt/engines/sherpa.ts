import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { OnlineRecognizer, type OnlineStream } from 'sherpa-onnx-node';
import { fileFor, getModel } from '../models';
import { type EngineInitOptions, type ISttEngine, int16ToFloat32 } from '../engine';
import { buildHotwordsFile } from '../hotwords';

const MODEL_ID = 'zipformer-en-2023-06-26';

/** Streaming Zipformer transducer with endpoint detection and hotword biasing. */
export class SherpaEngine implements ISttEngine {
  private recognizer: OnlineRecognizer | null = null;
  private stream: OnlineStream | null = null;
  private partialCb: (t: string) => void = () => {};
  private finalCb: (t: string) => void = () => {};
  private lastPartial = '';
  readonly provider = 'cpu';
  hotwordsActive = false;

  async init(opts: EngineInitOptions): Promise<void> {
    const def = getModel(MODEL_ID)!;
    const dir = opts.modelDir;
    const tokens = fileFor(dir, def, 'tokens');
    const base = {
      featConfig: { sampleRate: opts.sampleRate, featureDim: 80 },
      modelConfig: {
        transducer: {
          encoder: fileFor(dir, def, 'encoder'),
          decoder: fileFor(dir, def, 'decoder'),
          joiner: fileFor(dir, def, 'joiner'),
        },
        tokens,
        numThreads: opts.numThreads,
        provider: 'cpu',
        debug: 0,
      },
      decodingMethod: 'modified_beam_search',
      maxActivePaths: 4,
      enableEndpoint: 1,
      rule1MinTrailingSilence: 2.4,
      rule2MinTrailingSilence: 0.8,
      rule3MinUtteranceLength: 20,
    };

    let hotwordsFile = '';
    if (opts.hotwords.length && existsSync(tokens)) {
      hotwordsFile = join(dir, 'hollr-hotwords.txt');
      writeFileSync(hotwordsFile, buildHotwordsFile(opts.hotwords, readFileSync(tokens, 'utf8')));
    }
    try {
      this.recognizer = new OnlineRecognizer(hotwordsFile ? { ...base, hotwordsFile, hotwordsScore: 2.0 } : base);
      this.hotwordsActive = Boolean(hotwordsFile);
    } catch (err) {
      if (!hotwordsFile) throw err;
      this.recognizer = new OnlineRecognizer(base);
    }
    this.stream = this.recognizer.createStream();
  }

  accept(pcm: Int16Array): void {
    const r = this.recognizer;
    const s = this.stream;
    if (!r || !s) return;
    s.acceptWaveform({ samples: int16ToFloat32(pcm), sampleRate: 16000 });
    while (r.isReady(s)) r.decode(s);
    const text = r.getResult(s).text.trim();
    if (text && text !== this.lastPartial) {
      this.lastPartial = text;
      this.partialCb(text);
    }
    if (r.isEndpoint(s)) {
      if (text) this.finalCb(text);
      r.reset(s);
      this.lastPartial = '';
    }
  }

  onPartial(cb: (text: string) => void): void {
    this.partialCb = cb;
  }

  onFinal(cb: (text: string) => void): void {
    this.finalCb = cb;
  }

  reset(): void {
    if (this.recognizer && this.stream) this.recognizer.reset(this.stream);
    this.lastPartial = '';
  }

  dispose(): void {
    this.stream = null;
    this.recognizer = null;
  }
}
