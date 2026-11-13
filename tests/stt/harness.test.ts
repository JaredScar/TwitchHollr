import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { readWave } from 'sherpa-onnx-node';
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '@shared/defaults';
import { normalize, parseCommand, stripWakeWord } from '../../src/main/commands/grammar';
import { SherpaEngine } from '../../src/main/stt/engines/sherpa';
import { COMMAND_HOTWORDS } from '../../src/main/stt/hotwords';
import { ModelManager } from '../../src/main/stt/models';

// Runs recorded clips through the real streaming engine + grammar and reports wake-word hit rate and
// false-trigger rate. Downloads the default model into ./models on first run.

const MODEL_ID = 'zipformer-en-2023-06-26';
const AUDIO_DIR = resolve(import.meta.dirname, '../fixtures/audio');
const MODELS_ROOT = process.env.HOLLR_MODELS_DIR ?? resolve(import.meta.dirname, '../../models');

type Expected = { kind: string; choices?: string[]; durationSec?: number } | null;
const expected: Record<string, Expected> = existsSync(join(AUDIO_DIR, 'expected.json'))
  ? JSON.parse(readFileSync(join(AUDIO_DIR, 'expected.json'), 'utf8'))
  : {};
const clips = existsSync(AUDIO_DIR) ? readdirSync(AUDIO_DIR).filter((f) => f.endsWith('.wav') && f in expected) : [];

const WAKE = [DEFAULT_SETTINGS.wakeWord, ...DEFAULT_SETTINGS.wakeAliases];
const ctx = { presets: DEFAULT_SETTINGS.presets, defaultPollDurationSec: 90, defaultPredictionWindowSec: 120 };

async function transcribe(engine: SherpaEngine, file: string): Promise<{ finals: string[]; ms: number }> {
  const wave = readWave(file);
  if (wave.sampleRate !== 16000) throw new Error(`${file}: expected 16 kHz, got ${wave.sampleRate}`);
  const finals: string[] = [];
  engine.onFinal((t) => finals.push(t));
  engine.reset();
  const pcm = new Int16Array(wave.samples.length + 16000 * 1.5);
  wave.samples.forEach((s, i) => (pcm[i] = Math.max(-32768, Math.min(32767, Math.round(s * 32767)))));
  const started = performance.now();
  for (let i = 0; i < pcm.length; i += 1600) engine.accept(pcm.subarray(i, i + 1600));
  return { finals, ms: performance.now() - started };
}

describe.skipIf(clips.length === 0)('STT harness (sherpa)', () => {
  const engine = new SherpaEngine();
  const results: { clip: string; heard: string; ok: boolean; triggered: boolean; isCommand: boolean }[] = [];

  beforeAll(async () => {
    const mm = new ModelManager(MODELS_ROOT);
    if (!mm.isInstalled(MODEL_ID)) {
      console.log(`Downloading ${MODEL_ID} to ${MODELS_ROOT}…`);
      await mm.download(MODEL_ID, () => undefined);
    }
    await engine.init({
      modelDir: mm.dirFor(MODEL_ID),
      sampleRate: 16000,
      numThreads: 2,
      hotwords: process.env.HOLLR_NO_HOTWORDS ? [] : [...WAKE, ...COMMAND_HOTWORDS],
    });
    console.log(`Hotwords active: ${engine.hotwordsActive}`);
  }, 600_000);

  it.each(clips)('%s', async (clip) => {
    const want = expected[clip] ?? null;
    const { finals, ms } = await transcribe(engine, join(AUDIO_DIR, clip));
    const heard = finals.join(' | ');
    const commands = finals
      .map((f) => stripWakeWord(normalize(f), WAKE))
      .filter((r): r is string => r !== null)
      .map((r) => parseCommand(r, ctx))
      .filter((r) => r.ok)
      .map((r) => (r.ok ? r.command : null));
    const got = commands[0] ?? null;
    let ok: boolean;
    if (want === null) ok = got === null;
    else {
      ok = got?.kind === want.kind;
      if (ok && got?.kind === 'poll.create' && want.choices) ok = JSON.stringify(got.spec.choices) === JSON.stringify(want.choices);
      if (ok && got?.kind === 'poll.create' && want.durationSec) ok = got.spec.durationSec === want.durationSec;
    }
    results.push({ clip, heard, ok, triggered: got !== null, isCommand: want !== null });
    console.log(`${ok ? 'PASS' : 'FAIL'} ${clip} (${ms.toFixed(0)}ms) heard: "${heard}" → ${got ? JSON.stringify(got) : 'no command'}`);
    expect(ok, `heard "${heard}"`).toBe(true);
  });

  it('reports rates', () => {
    const cmds = results.filter((r) => r.isCommand);
    const chatter = results.filter((r) => !r.isCommand);
    const hit = cmds.filter((r) => r.ok).length;
    const fp = chatter.filter((r) => r.triggered).length;
    console.log(`Wake/command hit rate: ${hit}/${cmds.length} · false triggers: ${fp}/${chatter.length}`);
    expect(fp).toBe(0);
  });
});
