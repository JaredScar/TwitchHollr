import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, sanitizeSettings } from '@shared/defaults';
import type { Settings } from '@shared/types';
import { buildHotwordsFile, parseTokens, tokenizeWord } from '../../src/main/stt/hotwords';

describe('hotwords', () => {
  const tokens = ['<blk> 0', '▁HO 1', '▁HOLL 2', 'ER 3', 'LL 4', '▁POLL 5', '▁P 6', 'O 7', 'L 8', '▁ 9'].join('\n');
  const pieces = parseTokens(tokens);

  it('greedily splits words into known BPE pieces', () => {
    expect(tokenizeWord('holler', pieces)).toEqual(['▁HOLL', 'ER']);
    expect(tokenizeWord('poll', pieces)).toEqual(['▁POLL']);
    expect(tokenizeWord('xyz', pieces)).toBeNull();
  });

  it('writes one line per encodable phrase', () => {
    expect(buildHotwordsFile(['holler', 'poll', 'xyz', 'holler'], tokens)).toBe('▁HOLL ER\n▁POLL\n');
  });
});

describe('sanitizeSettings', () => {
  it('clamps values and fills defaults', () => {
    const s = sanitizeSettings({ cooldownSec: -5, defaultPollDurationSec: 5000, wakeWord: '  JIM ' } as Partial<Settings>);
    expect(s.cooldownSec).toBe(0);
    expect(s.defaultPollDurationSec).toBe(1800);
    expect(s.wakeWord).toBe('jim');
    expect(s.hotkeys).toEqual(DEFAULT_SETTINGS.hotkeys);
  });

  it('merges a patch over the previous settings', () => {
    const prev = sanitizeSettings({ dryRun: true });
    const next = sanitizeSettings({ cooldownSec: 30 }, prev);
    expect(next.dryRun).toBe(true);
    expect(next.cooldownSec).toBe(30);
  });

  it('drops presets without a trigger', () => {
    const s = sanitizeSettings({
      presets: [
        { id: '1', trigger: '', kind: 'poll', title: '', choices: [], durationSec: 60 },
        { id: '2', trigger: ' Boss ', kind: 'prediction', title: 'Beat the boss?', choices: ['Yes', 'No'], durationSec: 9999 },
      ],
    });
    expect(s.presets).toEqual([
      { id: '2', trigger: 'boss', kind: 'prediction', title: 'Beat the boss?', choices: ['Yes', 'No'], durationSec: 1800 },
    ]);
  });
});
