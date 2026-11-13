import { LIMITS } from '@shared/defaults';
import type { Command, PollSpec, PredictionSpec, Preset } from '@shared/types';

export type ParseResult = { ok: true; command: Command } | { ok: false; error: string };

export interface GrammarContext {
  presets: Preset[];
  defaultPollDurationSec: number;
  defaultPredictionWindowSec: number;
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

/** Lowercase, strip punctuation (keeping decimal points), collapse whitespace. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’`]/g, '')
    .replace(/(\d),(\d)/g, '$1$2')
    .replace(/(?<!\d)\.|\.(?!\d)/g, ' ')
    .replace(/[^a-z0-9.\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const ONES: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
};
const TENS: Record<string, number> = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fourty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};

function readSmall(t: string[], i: number): [number, number] | null {
  const w = t[i];
  if (w === undefined) return null;
  if (/^\d+(\.\d+)?$/.test(w)) return [parseFloat(w), i + 1];
  if (w in ONES) return [ONES[w]!, i + 1];
  if (w in TENS) {
    const next = t[i + 1];
    const unit = next !== undefined ? ONES[next] : undefined;
    if (unit !== undefined && unit >= 1 && unit <= 9) return [TENS[w]! + unit, i + 2];
    return [TENS[w]!, i + 1];
  }
  return null;
}

/** Read a number written as digits or words ("two", "ninety five", "one hundred and twenty") at index i. */
export function readNumber(t: string[], i: number): [number, number] | null {
  const first = readSmall(t, i);
  if (!first) return null;
  let [value, j] = first;
  if (t[j] === 'hundred') {
    value *= 100;
    j++;
    if (t[j] === 'and' && readSmall(t, j + 1)) j++;
    const rest = readSmall(t, j);
    if (rest) [value, j] = [value + rest[0], rest[1]];
  }
  return [value, j];
}

const MINUTE_WORDS = new Set(['minute', 'minutes', 'min', 'mins', 'minit', 'minits']);
const SECOND_WORDS = new Set(['second', 'seconds', 'sec', 'secs']);
const isMin = (w: string | undefined) => w !== undefined && MINUTE_WORDS.has(w);
const isSec = (w: string | undefined) => w !== undefined && SECOND_WORDS.has(w);
const isAndAHalf = (t: string[], i: number) => t[i] === 'and' && t[i + 1] === 'a' && t[i + 2] === 'half';

/** Parse a whole token list as a duration, e.g. ["two","minutes"] → 120. Returns null if it isn't one. */
export function parseDuration(t: string[]): number | null {
  if (t.length === 0) return null;
  let i = 0;
  if (t[0] === 'half') {
    i = 1;
    if (t[i] === 'a' || t[i] === 'an') i++;
    return isMin(t[i]) && i + 1 === t.length ? 30 : null;
  }
  let total = 0;
  let sawUnit = false;
  while (i < t.length) {
    let n: number;
    if (t[i] === 'a' || t[i] === 'an') {
      n = 1;
      i++;
    } else {
      const r = readNumber(t, i);
      if (!r) return null;
      [n, i] = r;
    }
    if (isAndAHalf(t, i)) {
      n += 0.5;
      i += 3;
    }
    const unit = t[i];
    if (isMin(unit)) {
      total += n * 60;
      i++;
      if (isAndAHalf(t, i)) {
        total += 30;
        i += 3;
      }
    } else if (isSec(unit)) {
      total += n;
      i++;
    } else if (unit === undefined && sawUnit) {
      total += n;
    } else {
      return null;
    }
    sawUnit = true;
    if (t[i] === 'and') i++;
  }
  return sawUnit ? Math.round(total) : null;
}

/** Split a trailing "for <duration>" off the token list. */
export function splitDuration(tokens: string[]): { body: string[]; seconds: number | null } {
  for (let k = 0; k < tokens.length - 1; k++) {
    const w = tokens[k];
    if (w !== 'for' && w !== 'four' && w !== 'lasting') continue;
    const seconds = parseDuration(tokens.slice(k + 1));
    if (seconds !== null) return { body: tokens.slice(0, k), seconds };
  }
  return { body: tokens, seconds: null };
}

// ---------------------------------------------------------------------------
// Text shaping
// ---------------------------------------------------------------------------

const SMALL_WORDS = new Set(['a', 'an', 'the', 'of', 'or', 'and', 'to', 'in', 'on', 'at', 'vs', 'for', 'by']);

export function titleCase(s: string): string {
  return s
    .split(' ')
    .filter(Boolean)
    .map((w, i) => (i > 0 && SMALL_WORDS.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

export function sentenceCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Truncate to max chars, preferring a word boundary. */
export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return (space > max * 0.6 ? cut.slice(0, space) : cut).trim();
}

function asQuestion(s: string, max: number): string {
  const base = s.replace(/\?+$/, '').trim();
  return `${truncate(base, max - 1)}?`;
}

export const clampDuration = (s: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(s)));

// ---------------------------------------------------------------------------
// Wake word
// ---------------------------------------------------------------------------

// Includes STT artifacts seen in the harness ("hay" for "hey", a stray "n"/"a" before the wake word).
const FILLERS = new Set([
  'hey',
  'hay',
  'hi',
  'ok',
  'okay',
  'yo',
  'um',
  'uh',
  'umm',
  'uhh',
  'ah',
  'eh',
  'so',
  'alright',
  'oi',
  'and',
  'n',
  'a',
]);

/**
 * If the (normalized) utterance starts with the wake word, return the remainder; otherwise null.
 * Up to two filler words ("hey", "ok", …) may precede the wake word. Mid-sentence mentions never match.
 */
export function stripWakeWord(normalized: string, wakeWords: string[]): string | null {
  const tokens = normalized.split(' ').filter(Boolean);
  const phrases = [...new Set(wakeWords.map((w) => normalize(w)).filter(Boolean))]
    .map((w) => w.split(' '))
    .sort((a, b) => b.length - a.length);
  for (let start = 0; start <= 2 && start < tokens.length; start++) {
    for (const phrase of phrases) {
      if (phrase.every((p, k) => tokens[start + k] === p)) {
        return tokens.slice(start + phrase.length).join(' ');
      }
    }
    if (!FILLERS.has(tokens[start]!)) break;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Grammar
// ---------------------------------------------------------------------------

const POLL = '(?:poll|polls|pole|poles|pol|paul|pull|bowl|vote)';
const PRED = '(?:prediction|predictions|bet|bets)';
const DET = '(?: the| this| that| current| our| my)?';
const CREATE = '(?:(?:start|make|run|create|open|launch|do|new|begin|throw up|put up)(?: a| an| the| new| quick)* )?';

const RE = {
  pendingCancel: /^(?:cancel|cancel that|cancel it|never mind|nevermind|abort|stop|wait|no)$/,
  pollEnd: new RegExp(`^(?:end|ends|and|stop|close|finish|terminate|kill|lock)${DET} ${POLL}(?: now)?$`),
  pollCancel: new RegExp(`^(?:cancel|delete|archive|remove|scrap|trash|hide)${DET} ${POLL}$`),
  pollRepeat: new RegExp(
    `^(?:(?:repeat|rerun|redo|restart|run back|runback)(?: the| that| last| previous| same)*(?: ${POLL})?(?: again)?|${POLL} again|(?:same|another) ${POLL}(?: again)?|again)$`,
  ),
  predLock: new RegExp(`^lock(?: it| in| the| this| current| bets)*(?: ${PRED})?(?: now)?$`),
  predCancel: new RegExp(`^(?:cancel|refund|delete|abort|scrap)${DET} ${PRED}$`),
  predCreate: new RegExp(`^${CREATE}(?:predict|predicting|${PRED})(?: on| that| if| whether| for)?(?: (.+))?$`),
  pollCreate: new RegExp(`^${CREATE}${POLL}(?: on| about)?(?: (.+))?$`),
  resolveSuffix: /^(?:the )?(.+?) (?:wins|won|win|takes it)$/,
  resolvePrefix:
    /^(?:(?:the )?winner is|winner|winning outcome is|resolve(?: the)?(?: prediction)?(?: with| to| as| for)?|pay out(?: to)?|payout(?: to)?) (.+)$/,
};

const POLITE_PREFIX = /^(?:(?:please|can you|could you|would you|lets|let us|go ahead and|i want to|i want|give me|gimme|quick) )+/;
const POLITE_SUFFIX = /(?: please| thanks| thank you| now)+$/;

function cleanCommandText(text: string): string {
  return normalize(text).replace(POLITE_PREFIX, '').replace(POLITE_SUFFIX, '').trim();
}

const SEP = /\s+(?:or|vs|versus)\s+/;
const TITLE_SEP = /\s+(?:options|option|choices|choice|outcomes|outcome|answers)\s+/;

interface Options {
  title: string | null;
  items: string[];
  droppedDuplicates: boolean;
  truncatedCount: boolean;
}

function splitOptions(body: string, maxItems: number, maxLen: number): Options {
  let title: string | null = null;
  let list = body;
  const m = TITLE_SEP.exec(` ${body} `);
  if (m && m.index > 0) {
    const padded = ` ${body} `;
    title = padded.slice(0, m.index).trim();
    list = padded.slice(m.index + m[0].length).trim();
  }
  list = list.replace(/^(?:either|between|is it|its|whether) /, '');
  const raw = list
    .split(SEP)
    .map((c) => c.replace(/^(?:a|an|the) (?=\S+ \S)/, '').trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const items: string[] = [];
  let dup = false;
  for (const r of raw) {
    if (seen.has(r)) {
      dup = true;
      continue;
    }
    seen.add(r);
    items.push(truncate(titleCase(r), maxLen));
  }
  return {
    title,
    items: items.slice(0, maxItems),
    droppedDuplicates: dup,
    truncatedCount: items.length > maxItems,
  };
}

function findPreset(body: string, presets: Preset[]): Preset | undefined {
  const b = normalize(body);
  return presets.find((p) => normalize(p.trigger) === b);
}

function presetCommand(p: Preset, seconds: number | null): Command {
  if (p.kind === 'prediction') {
    return {
      kind: 'prediction.create',
      presetTrigger: p.trigger,
      spec: {
        title: asQuestion(p.title || p.choices.join(' or '), LIMITS.predictionTitle),
        outcomes: p.choices.slice(0, LIMITS.predictionMaxOutcomes).map((c) => truncate(c, LIMITS.predictionOutcome)),
        windowSec: clampDuration(seconds ?? p.durationSec, LIMITS.predictionMinWindow, LIMITS.predictionMaxWindow),
      },
    };
  }
  return {
    kind: 'poll.create',
    presetTrigger: p.trigger,
    spec: {
      title: asQuestion(p.title || p.choices.join(' or '), LIMITS.pollTitle),
      choices: p.choices.slice(0, LIMITS.pollMaxChoices).map((c) => truncate(c, LIMITS.pollChoice)),
      durationSec: clampDuration(seconds ?? p.durationSec, LIMITS.pollMinDuration, LIMITS.pollMaxDuration),
    },
  };
}

function buildPoll(body: string, seconds: number | null, ctx: GrammarContext): ParseResult {
  const o = splitOptions(body, LIMITS.pollMaxChoices, LIMITS.pollChoice);
  if (o.items.length < LIMITS.pollMinChoices) {
    return { ok: false, error: `A poll needs at least 2 choices, e.g. "poll win or loss" (heard "${body}").` };
  }
  const title = o.title ? sentenceCase(o.title) : o.items.join(' or ');
  const spec: PollSpec = {
    title: asQuestion(title, LIMITS.pollTitle),
    choices: o.items,
    durationSec: clampDuration(seconds ?? ctx.defaultPollDurationSec, LIMITS.pollMinDuration, LIMITS.pollMaxDuration),
  };
  return { ok: true, command: { kind: 'poll.create', spec } };
}

function buildPrediction(body: string, seconds: number | null, ctx: GrammarContext): ParseResult {
  const o = splitOptions(body, LIMITS.predictionMaxOutcomes, LIMITS.predictionOutcome);
  if (o.items.length < LIMITS.predictionMinOutcomes) {
    return { ok: false, error: `A prediction needs 2 outcomes, e.g. "predict win or loss" (heard "${body}").` };
  }
  const title = o.title ? sentenceCase(o.title) : o.items.join(' or ');
  const spec: PredictionSpec = {
    title: asQuestion(title, LIMITS.predictionTitle),
    outcomes: o.items,
    windowSec: clampDuration(
      seconds ?? ctx.defaultPredictionWindowSec,
      LIMITS.predictionMinWindow,
      LIMITS.predictionMaxWindow,
    ),
  };
  return { ok: true, command: { kind: 'prediction.create', spec } };
}

/** Parse command text (wake word already removed) into a Command. */
export function parseCommand(input: string, ctx: GrammarContext): ParseResult {
  const text = cleanCommandText(input);
  if (!text) return { ok: false, error: 'Heard the wake word but no command.' };

  if (RE.pendingCancel.test(text)) return { ok: true, command: { kind: 'pending.cancel' } };
  if (RE.pollEnd.test(text)) return { ok: true, command: { kind: 'poll.end' } };
  if (RE.pollCancel.test(text)) return { ok: true, command: { kind: 'poll.cancel' } };
  if (RE.pollRepeat.test(text)) return { ok: true, command: { kind: 'poll.repeat' } };
  if (RE.predLock.test(text)) return { ok: true, command: { kind: 'prediction.lock' } };
  if (RE.predCancel.test(text)) return { ok: true, command: { kind: 'prediction.cancel' } };

  const pred = RE.predCreate.exec(text);
  if (pred) {
    const { body, seconds } = splitDuration((pred[1] ?? '').split(' ').filter(Boolean));
    const joined = body.join(' ');
    if (!joined) return { ok: false, error: 'What should the prediction be? Try "predict win or loss".' };
    const preset = findPreset(joined, ctx.presets);
    if (preset) return { ok: true, command: presetCommand({ ...preset, kind: 'prediction' }, seconds) };
    return buildPrediction(joined, seconds, ctx);
  }

  const poll = RE.pollCreate.exec(text);
  if (poll) {
    const { body, seconds } = splitDuration((poll[1] ?? '').split(' ').filter(Boolean));
    const joined = body.join(' ');
    if (!joined) return { ok: false, error: 'What should the poll be? Try "poll win or loss".' };
    const preset = findPreset(joined, ctx.presets);
    if (preset) return { ok: true, command: presetCommand(preset, seconds) };
    return buildPoll(joined, seconds, ctx);
  }

  const resolved = RE.resolvePrefix.exec(text) ?? RE.resolveSuffix.exec(text);
  if (resolved?.[1]) return { ok: true, command: { kind: 'prediction.resolve', outcome: resolved[1] } };

  const { body, seconds } = splitDuration(text.split(' '));
  const preset = findPreset(body.join(' '), ctx.presets);
  if (preset) return { ok: true, command: presetCommand(preset, seconds) };

  return { ok: false, error: `Didn't recognize a command in "${text}".` };
}

// ---------------------------------------------------------------------------
// Prediction outcome matching
// ---------------------------------------------------------------------------

const ORDINALS: Record<string, number> = {
  first: 0,
  one: 0,
  '1': 0,
  second: 1,
  two: 1,
  '2': 1,
  third: 2,
  three: 2,
  '3': 2,
  fourth: 3,
  four: 3,
  '4': 3,
  fifth: 4,
  five: 4,
  '5': 4,
};

/** Match a spoken outcome ("blue", "option two", "the win one") against a prediction's outcomes. */
export function matchOutcome(spoken: string, outcomes: { id: string; title: string; color: string }[]): string | null {
  const full = normalize(spoken).replace(/^(?:the|team|option|outcome|number|side) /, '');
  const s = full.replace(/ (?:one|side|team|outcome)$/, '').trim();
  if (!s) return null;
  const titles = outcomes.map((o) => normalize(o.title));

  const exact = titles.indexOf(full) >= 0 ? titles.indexOf(full) : titles.indexOf(s);
  if (exact >= 0) return outcomes[exact]!.id;

  const byColor = outcomes.find((o) => o.color.toLowerCase() === s);
  if (byColor) return byColor.id;

  const ord = ORDINALS[s];
  if (ord !== undefined && outcomes[ord]) return outcomes[ord].id;

  const prefix = titles.findIndex((t) => t.startsWith(s) || s.startsWith(t));
  if (prefix >= 0) return outcomes[prefix]!.id;

  const words = new Set(s.split(' '));
  let best = -1;
  let bestScore = 0;
  titles.forEach((t, i) => {
    const tw = t.split(' ');
    const overlap = tw.filter((w) => words.has(w)).length;
    const score = overlap / Math.max(tw.length, words.size);
    if (score > bestScore) [best, bestScore] = [i, score];
  });
  return best >= 0 && bestScore >= 0.5 ? outcomes[best]!.id : null;
}

/** Human-readable summary of a command, used in logs, chat replies and the confirm toast. */
export function describeCommand(cmd: Command): string {
  switch (cmd.kind) {
    case 'poll.create':
      return `poll "${cmd.spec.title}" [${cmd.spec.choices.join(' / ')}] for ${cmd.spec.durationSec}s`;
    case 'poll.end':
      return 'end the active poll';
    case 'poll.cancel':
      return 'cancel (archive) the active poll';
    case 'poll.repeat':
      return 'repeat the last poll';
    case 'prediction.create':
      return `prediction "${cmd.spec.title}" [${cmd.spec.outcomes.join(' / ')}], window ${cmd.spec.windowSec}s`;
    case 'prediction.lock':
      return 'lock the active prediction';
    case 'prediction.resolve':
      return `resolve the prediction: "${cmd.outcome}" wins`;
    case 'prediction.cancel':
      return 'cancel the prediction (refund points)';
    case 'pending.cancel':
      return 'cancel the pending command';
  }
}
