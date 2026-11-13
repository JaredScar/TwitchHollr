import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ModelInfo, SttEngineId } from '@shared/types';

export interface ModelFile {
  /** Role used by the engine to find the file. */
  role: 'encoder' | 'decoder' | 'joiner' | 'tokens' | 'vad';
  name: string;
  url: string;
  sha256: string;
  size: number;
}

export interface ModelDef {
  id: string;
  label: string;
  engine: SttEngineId;
  files: ModelFile[];
}

const hf = (repo: string, rev: string, file: string) =>
  `https://huggingface.co/csukuangfj/${repo}/resolve/${rev}/${file}`;

const ZIPFORMER = { repo: 'sherpa-onnx-streaming-zipformer-en-2023-06-26', rev: '672fbf1b30579d6585301139bb363f42a0ad4a24' };
const WHISPER_BASE = { repo: 'sherpa-onnx-whisper-base.en', rev: '59eea950fc76df2453efb57e6c0fd334548e8ffe' };
const WHISPER_SMALL = { repo: 'sherpa-onnx-whisper-small.en', rev: 'd9533f69affd85061aee349af7fea5cb2996dbbe' };
const VAD = { repo: 'vad', rev: 'fba88cd2e921609e7675c3aaf51e0b9b295da4bc' };

const vadFile: ModelFile = {
  role: 'vad',
  name: 'silero_vad.onnx',
  url: hf(VAD.repo, VAD.rev, 'silero_vad.onnx'),
  sha256: 'a35ebf52fd3ce5f1469b2a36158dba761bc47b973ea3382b3186ca15b1f5af28',
  size: 1807522,
};

const whisperTokens = (m: { repo: string; rev: string }, prefix: string): ModelFile => ({
  role: 'tokens',
  name: `${prefix}-tokens.txt`,
  url: hf(m.repo, m.rev, `${prefix}-tokens.txt`),
  sha256: '306cd27f03c1a714eca7108e03d66b7dc042abe8c258b44c199a7ed9838dd930',
  size: 835554,
});

export const MODELS: ModelDef[] = [
  {
    id: 'zipformer-en-2023-06-26',
    label: 'Streaming Zipformer (English, default)',
    engine: 'sherpa',
    files: [
      {
        role: 'encoder',
        name: 'encoder-epoch-99-avg-1-chunk-16-left-128.int8.onnx',
        url: hf(ZIPFORMER.repo, ZIPFORMER.rev, 'encoder-epoch-99-avg-1-chunk-16-left-128.int8.onnx'),
        sha256: '563fde436d16cf7607cf408cd6b30909819d03162652ef389c2450ced3f45ac1',
        size: 71083163,
      },
      {
        role: 'decoder',
        name: 'decoder-epoch-99-avg-1-chunk-16-left-128.onnx',
        url: hf(ZIPFORMER.repo, ZIPFORMER.rev, 'decoder-epoch-99-avg-1-chunk-16-left-128.onnx'),
        sha256: '7bf787f90b194b307e5a4ad6a34fadb4e748304c35f78a8d66358a05b13ee6ef',
        size: 2092621,
      },
      {
        role: 'joiner',
        name: 'joiner-epoch-99-avg-1-chunk-16-left-128.int8.onnx',
        url: hf(ZIPFORMER.repo, ZIPFORMER.rev, 'joiner-epoch-99-avg-1-chunk-16-left-128.int8.onnx'),
        sha256: 'd944208d660d67c8d72cd2acaeac971fa5ceb8c80e76c1968148846fedd6e297',
        size: 259335,
      },
      {
        role: 'tokens',
        name: 'tokens.txt',
        url: hf(ZIPFORMER.repo, ZIPFORMER.rev, 'tokens.txt'),
        sha256: '49e3c2646595fd907228b3c6787069658f67b17377c60aeb8619c4551b2316fb',
        size: 5048,
      },
    ],
  },
  {
    id: 'whisper-base.en',
    label: 'Whisper base.en (optional, more accurate)',
    engine: 'whisper',
    files: [
      {
        role: 'encoder',
        name: 'base.en-encoder.int8.onnx',
        url: hf(WHISPER_BASE.repo, WHISPER_BASE.rev, 'base.en-encoder.int8.onnx'),
        sha256: 'ef6b936f4c9b1d90a3b68634b60c4ed8576b26172b33c2535ec0e933c9edb823',
        size: 29120534,
      },
      {
        role: 'decoder',
        name: 'base.en-decoder.int8.onnx',
        url: hf(WHISPER_BASE.repo, WHISPER_BASE.rev, 'base.en-decoder.int8.onnx'),
        sha256: 'f7162ad6db2dbef16cfaeaa7f945b9d7dd9c1b8d472f6aca82f2273d185e4d41',
        size: 130669978,
      },
      whisperTokens(WHISPER_BASE, 'base.en'),
      vadFile,
    ],
  },
  {
    id: 'whisper-small.en',
    label: 'Whisper small.en (optional, best accuracy, needs a fast PC/GPU)',
    engine: 'whisper',
    files: [
      {
        role: 'encoder',
        name: 'small.en-encoder.int8.onnx',
        url: hf(WHISPER_SMALL.repo, WHISPER_SMALL.rev, 'small.en-encoder.int8.onnx'),
        sha256: '8bdac288f369aa94ee2194059238c465ed82ea9d47ee8fa4a8c0a891873e462f',
        size: 112442483,
      },
      {
        role: 'decoder',
        name: 'small.en-decoder.int8.onnx',
        url: hf(WHISPER_SMALL.repo, WHISPER_SMALL.rev, 'small.en-decoder.int8.onnx'),
        sha256: '710ccf890e10f3faa15f51ec346081a2723c9f3adb6e4da81c6573a5a6f877fb',
        size: 262223042,
      },
      whisperTokens(WHISPER_SMALL, 'small.en'),
      vadFile,
    ],
  },
];

export const modelIdFor = (engine: SttEngineId, whisperModel: string) =>
  engine === 'sherpa' ? 'zipformer-en-2023-06-26' : `whisper-${whisperModel}`;

export const getModel = (id: string) => MODELS.find((m) => m.id === id);

export const fileFor = (dir: string, def: ModelDef, role: ModelFile['role']) => {
  const f = def.files.find((x) => x.role === role);
  return f ? join(dir, f.name) : '';
};

const MANIFEST = 'hollr-manifest.json';

export class ModelManager {
  constructor(
    private readonly root: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  dirFor(id: string): string {
    return join(this.root, id);
  }

  isInstalled(id: string): boolean {
    const def = getModel(id);
    if (!def) return false;
    const dir = this.dirFor(id);
    const manifest = join(dir, MANIFEST);
    if (!existsSync(manifest)) return false;
    try {
      const m = JSON.parse(readFileSync(manifest, 'utf8')) as Record<string, string>;
      return def.files.every((f) => m[f.name] === f.sha256 && existsSync(join(dir, f.name)));
    } catch {
      return false;
    }
  }

  list(): ModelInfo[] {
    return MODELS.map((m) => ({
      id: m.id,
      label: m.label,
      engine: m.engine,
      sizeBytes: m.files.reduce((n, f) => n + f.size, 0),
      installed: this.isInstalled(m.id),
    }));
  }

  /** Download every file to a .part file, verify its SHA-256, then move it into place. */
  async download(id: string, onProgress: (received: number, total: number) => void, signal?: AbortSignal) {
    const def = getModel(id);
    if (!def) throw new Error(`Unknown model ${id}`);
    const dir = this.dirFor(id);
    mkdirSync(dir, { recursive: true });
    const total = def.files.reduce((n, f) => n + f.size, 0);
    let done = 0;
    const manifest: Record<string, string> = {};

    for (const file of def.files) {
      const dest = join(dir, file.name);
      if (existsSync(dest) && statSync(dest).size === file.size && (await sha256File(dest)) === file.sha256) {
        done += file.size;
        manifest[file.name] = file.sha256;
        onProgress(done, total);
        continue;
      }
      const part = `${dest}.part`;
      const res = await this.fetchImpl(file.url, { signal });
      if (!res.ok || !res.body) throw new Error(`Download failed for ${file.name} (HTTP ${res.status}).`);
      const hash = createHash('sha256');
      const out = createWriteStream(part);
      let fileBytes = 0;
      try {
        const reader = res.body.getReader();
        for (;;) {
          const { value, done: eof } = await reader.read();
          if (eof) break;
          hash.update(value);
          fileBytes += value.byteLength;
          if (!out.write(value)) await new Promise<void>((r) => out.once('drain', () => r()));
          onProgress(done + fileBytes, total);
        }
      } finally {
        await new Promise<void>((r) => out.end(() => r()));
      }
      const digest = hash.digest('hex');
      if (digest !== file.sha256) {
        rmSync(part, { force: true });
        throw new Error(`Checksum mismatch for ${file.name}. The download may be corrupted; please retry.`);
      }
      renameSync(part, dest);
      done += file.size;
      manifest[file.name] = file.sha256;
      onProgress(done, total);
    }
    writeFileSync(join(dir, MANIFEST), JSON.stringify(manifest, null, 2));
  }
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    createReadStream(path)
      .on('data', (d) => hash.update(d))
      .on('end', () => resolve())
      .on('error', reject);
  });
  return hash.digest('hex');
}
