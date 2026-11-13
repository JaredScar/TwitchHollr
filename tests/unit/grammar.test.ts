import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '@shared/defaults';
import type { Command } from '@shared/types';
import {
  matchOutcome,
  normalize,
  parseCommand,
  parseDuration,
  stripWakeWord,
  titleCase,
  truncate,
} from '../../src/main/commands/grammar';

const ctx = {
  presets: DEFAULT_SETTINGS.presets,
  defaultPollDurationSec: 90,
  defaultPredictionWindowSec: 120,
};
const WAKE = [DEFAULT_SETTINGS.wakeWord, ...DEFAULT_SETTINGS.wakeAliases];

/** Full pipeline as voice input sees it: normalize → wake word → grammar. */
function voice(utterance: string): Command | null {
  const rest = stripWakeWord(normalize(utterance), WAKE);
  if (rest === null) return null;
  const r = parseCommand(rest, ctx);
  return r.ok ? r.command : null;
}

const poll = (title: string, choices: string[], durationSec = 90): Extract<Command, { kind: 'poll.create' }> => ({
  kind: 'poll.create',
  spec: { title, choices, durationSec },
});

describe('poll phrasings', () => {
  const cases: [string, Command][] = [
    ['Hollr, poll win or loss', poll('Win or Loss?', ['Win', 'Loss'])],
    ['holler poll win or loss', poll('Win or Loss?', ['Win', 'Loss'])],
    ['Holler, poll yes or no.', poll('Yes or No?', ['Yes', 'No'])],
    ['hey holler poll yes or no', poll('Yes or No?', ['Yes', 'No'])],
    ['ok holler, poll yes or no', poll('Yes or No?', ['Yes', 'No'])],
    ['um hey holler poll yes or no', poll('Yes or No?', ['Yes', 'No'])],
    ['HOLLER POLL RED OR BLUE OR GREEN', poll('Red or Blue or Green?', ['Red', 'Blue', 'Green'])],
    ['holler pole win or loss', poll('Win or Loss?', ['Win', 'Loss'])],
    ['holler paul win or loss', poll('Win or Loss?', ['Win', 'Loss'])],
    ['holler pull win or loss', poll('Win or Loss?', ['Win', 'Loss'])],
    ['holler polls win or loss', poll('Win or Loss?', ['Win', 'Loss'])],
    ['holler start a poll win or loss', poll('Win or Loss?', ['Win', 'Loss'])],
    ['holler make a poll win or loss', poll('Win or Loss?', ['Win', 'Loss'])],
    ['holler run a quick poll win or loss', poll('Win or Loss?', ['Win', 'Loss'])],
    ['holler can you poll win or loss please', poll('Win or Loss?', ['Win', 'Loss'])],
    ['holler poll on pizza or tacos', poll('Pizza or Tacos?', ['Pizza', 'Tacos'])],
    ['holler poll cats vs dogs', poll('Cats or Dogs?', ['Cats', 'Dogs'])],
    ['holler poll cats versus dogs', poll('Cats or Dogs?', ['Cats', 'Dogs'])],
    ['holler poll either left or right', poll('Left or Right?', ['Left', 'Right'])],
    ['holler poll win or loss for 2 minutes', poll('Win or Loss?', ['Win', 'Loss'], 120)],
    ['holler poll win or loss for two minutes', poll('Win or Loss?', ['Win', 'Loss'], 120)],
    ['holler poll win or loss for ninety seconds', poll('Win or Loss?', ['Win', 'Loss'], 90)],
    ['holler poll win or loss for 30 seconds', poll('Win or Loss?', ['Win', 'Loss'], 30)],
    ['holler poll win or loss for a minute', poll('Win or Loss?', ['Win', 'Loss'], 60)],
    ['holler poll win or loss for a minute and a half', poll('Win or Loss?', ['Win', 'Loss'], 90)],
    ['holler poll win or loss for one and a half minutes', poll('Win or Loss?', ['Win', 'Loss'], 90)],
    ['holler poll win or loss for half a minute', poll('Win or Loss?', ['Win', 'Loss'], 30)],
    ['holler poll win or loss for 2 minutes and 30 seconds', poll('Win or Loss?', ['Win', 'Loss'], 150)],
    ['holler poll win or loss for twenty five seconds', poll('Win or Loss?', ['Win', 'Loss'], 25)],
    ['holler poll win or loss four two minutes', poll('Win or Loss?', ['Win', 'Loss'], 120)],
    ['holler poll win or loss for 5 seconds', poll('Win or Loss?', ['Win', 'Loss'], 15)],
    ['holler poll win or loss for 60 minutes', poll('Win or Loss?', ['Win', 'Loss'], 1800)],
    ['holler poll win or loss for 1.5 minutes', poll('Win or Loss?', ['Win', 'Loss'], 90)],
    [
      'holler poll who wins the round options red team or blue team',
      poll('Who wins the round?', ['Red Team', 'Blue Team']),
    ],
    ['holler poll best map option dust or mirage or inferno', poll('Best map?', ['Dust', 'Mirage', 'Inferno'])],
    ['holler poll next game choices elden ring or hades', poll('Next game?', ['Elden Ring', 'Hades'])],
    [
      'holler poll next game choices elden ring or hades for 3 minutes',
      poll('Next game?', ['Elden Ring', 'Hades'], 180),
    ],
    ['holler poll go for it or play it safe', poll('Go for It or Play It Safe?', ['Go for It', 'Play It Safe'])],
    ['holler poll yes or no or yes', poll('Yes or No?', ['Yes', 'No'])],
    [
      'holler poll win or loss or draw or tie or forfeit or other',
      poll('Win or Loss or Draw or Tie or Forfeit?', ['Win', 'Loss', 'Draw', 'Tie', 'Forfeit']),
    ],
    ['holler poll match', { ...poll('Win or Loss?', ['Win', 'Loss']), presetTrigger: 'match' }],
    ['holler poll match for 2 minutes', { ...poll('Win or Loss?', ['Win', 'Loss'], 120), presetTrigger: 'match' }],
    ['holler match', { ...poll('Win or Loss?', ['Win', 'Loss']), presetTrigger: 'match' }],
    ['holler poll rock & roll or jazz', poll('Rock and Roll or Jazz?', ['Rock and Roll', 'Jazz'])],
  ];

  it.each(cases)('%s', (utterance, expected) => {
    expect(voice(utterance)).toEqual(expected);
  });
});

describe('control commands', () => {
  const cases: [string, Command['kind']][] = [
    ['holler end poll', 'poll.end'],
    ['holler end the poll', 'poll.end'],
    ['holler stop the poll', 'poll.end'],
    ['holler close poll now', 'poll.end'],
    ['holler finish the pole', 'poll.end'],
    ['HAY HOLLER AND THE POLE', 'poll.end'],
    ['N HOLLER LOCK THE PREDICTION', 'prediction.lock'],
    ['HOLLOW POLE RED OR BLUE', 'poll.create'],
    ['holler cancel poll', 'poll.cancel'],
    ['holler cancel the poll', 'poll.cancel'],
    ['holler delete that poll', 'poll.cancel'],
    ['holler repeat poll', 'poll.repeat'],
    ['holler repeat the last poll', 'poll.repeat'],
    ['holler poll again', 'poll.repeat'],
    ['holler same poll again', 'poll.repeat'],
    ['holler run back the poll', 'poll.repeat'],
    ['holler cancel', 'pending.cancel'],
    ['holler never mind', 'pending.cancel'],
    ['holler nevermind', 'pending.cancel'],
    ['holler stop', 'pending.cancel'],
    ['holler lock', 'prediction.lock'],
    ['holler lock prediction', 'prediction.lock'],
    ['holler lock the prediction', 'prediction.lock'],
    ['holler lock it in', 'prediction.lock'],
    ['holler lock bets', 'prediction.lock'],
    ['holler cancel prediction', 'prediction.cancel'],
    ['holler refund the prediction', 'prediction.cancel'],
  ];
  it.each(cases)('%s → %s', (utterance, kind) => {
    expect(voice(utterance)?.kind).toBe(kind);
  });
});

describe('predictions', () => {
  it('creates a prediction with default window', () => {
    expect(voice('holler predict win or loss')).toEqual({
      kind: 'prediction.create',
      spec: { title: 'Win or Loss?', outcomes: ['Win', 'Loss'], windowSec: 120 },
    });
  });

  it('supports a custom title and duration', () => {
    expect(voice('holler start a prediction will we win options yes or no for 1 minute')).toEqual({
      kind: 'prediction.create',
      spec: { title: 'Will we win?', outcomes: ['Yes', 'No'], windowSec: 60 },
    });
  });

  it('clamps the prediction window to at least 30s', () => {
    const c = voice('holler predict win or loss for 10 seconds');
    expect(c?.kind === 'prediction.create' && c.spec.windowSec).toBe(30);
  });

  it('caps prediction titles at 45 chars', () => {
    const c = voice(
      'holler predict will the streamer finally beat the final boss this time options yes or no',
    );
    expect(c?.kind === 'prediction.create' && c.spec.title.length).toBeLessThanOrEqual(45);
  });

  it.each([
    ['holler blue wins', 'blue'],
    ['holler red team wins', 'red team'],
    ['holler the winner is pink', 'pink'],
    ['holler winner yes', 'yes'],
    ['holler resolve with option two', 'option two'],
    ['holler pay out to win', 'win'],
  ])('%s resolves to "%s"', (utterance, outcome) => {
    expect(voice(utterance)).toEqual({ kind: 'prediction.resolve', outcome });
  });
});

describe('wake word rules', () => {
  it.each([
    'poll win or loss',
    'i told holler to poll win or loss',
    'so then the holler poll thing',
    'holly poll win or loss',
    'hello poll win or loss',
    '',
  ])('ignores "%s"', (utterance) => {
    expect(stripWakeWord(normalize(utterance), WAKE)).toBeNull();
  });

  it('allows at most two fillers before the wake word', () => {
    expect(stripWakeWord('hey ok holler end poll', WAKE)).toBe('end poll');
    expect(stripWakeWord('um so hey holler end poll', WAKE)).toBeNull();
  });

  it('matches multi-word aliases', () => {
    expect(stripWakeWord('holler at end poll', WAKE)).toBe('end poll');
  });

  it('honours a custom wake word', () => {
    expect(stripWakeWord(normalize('Jim, poll win or loss'), ['jim', 'gym'])).toBe('poll win or loss');
    expect(stripWakeWord(normalize('gym poll win or loss'), ['jim', 'gym'])).toBe('poll win or loss');
  });
});

describe('errors', () => {
  it.each([
    ['poll', /What should the poll be/],
    ['poll win', /at least 2 choices/],
    ['poll pizza for 2 minutes', /at least 2 choices/],
    ['predict yes', /2 outcomes/],
    ['make me a sandwich', /Didn't recognize/],
    ['', /no command/],
  ])('"%s" fails with a helpful message', (text, re) => {
    const r = parseCommand(text, ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(re);
  });
});

describe('limits & shaping', () => {
  it('truncates long choices to 25 characters', () => {
    const c = voice('holler poll the extremely long first option name here or b');
    expect(c?.kind).toBe('poll.create');
    if (c?.kind === 'poll.create') {
      for (const ch of c.spec.choices) expect(ch.length).toBeLessThanOrEqual(25);
      expect(c.spec.title.length).toBeLessThanOrEqual(60);
    }
  });

  it('keeps poll titles within 60 characters and ending in ?', () => {
    const c = voice(
      'holler poll supercalifragilistic expialidocious or antidisestablishmentarianism or floccinaucinihilipilification',
    );
    if (c?.kind !== 'poll.create') throw new Error('expected poll');
    expect(c.spec.title.length).toBeLessThanOrEqual(60);
    expect(c.spec.title.endsWith('?')).toBe(true);
  });

  it('title-cases choices, keeping small words lowercase', () => {
    expect(titleCase('go for it')).toBe('Go for It');
    expect(titleCase('the last of us')).toBe('The Last of Us');
  });

  it('truncates on a word boundary when possible', () => {
    expect(truncate('hello wonderful world', 15)).toBe('hello wonderful');
    expect(truncate('abcdefghij', 5)).toBe('abcde');
  });

  it('normalizes punctuation and keeps decimals', () => {
    expect(normalize("  Holler,   POLL: win/loss? It's 1.5 mins. ")).toBe('holler poll win loss its 1.5 mins');
  });
});

describe('parseDuration', () => {
  it.each([
    [['2', 'minutes'], 120],
    [['two', 'minutes'], 120],
    [['ninety', 'seconds'], 90],
    [['one', 'hundred', 'and', 'twenty', 'seconds'], 120],
    [['a', 'minute'], 60],
    [['half', 'a', 'minute'], 30],
    [['3', 'mins'], 180],
    [['1', 'minute', '30'], 90],
  ] as [string[], number][])('%j → %i', (tokens, seconds) => {
    expect(parseDuration(tokens)).toBe(seconds);
  });

  it.each([[['two']], [['minutes']], [['two', 'apples']], [[]]] as [string[]][])('%j is not a duration', (t) => {
    expect(parseDuration(t)).toBeNull();
  });
});

describe('matchOutcome', () => {
  const outcomes = [
    { id: 'a', title: 'Red Team', color: 'BLUE' },
    { id: 'b', title: 'Blue Team', color: 'PINK' },
  ];
  it.each([
    ['red team', 'a'],
    ['red', 'a'],
    ['the blue team', 'b'],
    ['pink', 'b'],
    ['first', 'a'],
    ['option two', 'b'],
    ['2', 'b'],
    ['purple', null],
  ])('"%s" → %s', (spoken, id) => {
    expect(matchOutcome(spoken, outcomes)).toBe(id);
  });
});
