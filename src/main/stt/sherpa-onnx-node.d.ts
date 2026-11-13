declare module 'sherpa-onnx-node' {
  export interface Waveform {
    samples: Float32Array;
    sampleRate: number;
  }

  export interface OnlineRecognizerResult {
    text: string;
    tokens: string[];
    timestamps: number[];
  }

  export class OnlineStream {
    acceptWaveform(obj: Waveform): void;
    inputFinished(): void;
  }

  export class OnlineRecognizer {
    constructor(config: Record<string, unknown>);
    createStream(): OnlineStream;
    isReady(stream: OnlineStream): boolean;
    decode(stream: OnlineStream): void;
    isEndpoint(stream: OnlineStream): boolean;
    reset(stream: OnlineStream): void;
    getResult(stream: OnlineStream): OnlineRecognizerResult;
  }

  export class OfflineStream {
    acceptWaveform(obj: Waveform): void;
  }

  export class OfflineRecognizer {
    constructor(config: Record<string, unknown>);
    createStream(): OfflineStream;
    decode(stream: OfflineStream): void;
    getResult(stream: OfflineStream): { text: string };
  }

  export interface SpeechSegment {
    start: number;
    samples: Float32Array;
  }

  export class Vad {
    constructor(config: Record<string, unknown>, bufferSizeInSeconds: number);
    acceptWaveform(samples: Float32Array): void;
    isEmpty(): boolean;
    isDetected(): boolean;
    front(enableExternalBuffer?: boolean): SpeechSegment;
    pop(): void;
    reset(): void;
    flush(): void;
  }

  export function readWave(filename: string): Waveform;
}
