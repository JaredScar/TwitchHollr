import type { Settings } from './types';

export const LIMITS = {
  pollTitle: 60,
  pollChoice: 25,
  pollMinChoices: 2,
  pollMaxChoices: 5,
  pollMinDuration: 15,
  pollMaxDuration: 1800,
  predictionTitle: 45,
  predictionOutcome: 25,
  predictionMinOutcomes: 2,
  predictionMaxOutcomes: 10,
  predictionMinWindow: 30,
  predictionMaxWindow: 1800,
} as const;

export const DEFAULT_SETTINGS: Settings = {
  wakeWord: 'hollr',
  wakeAliases: ['holler', 'hollar', 'holla', 'haller', 'hauler', 'hollered', 'holler at', 'hollow'],
  cooldownSec: 15,
  defaultPollDurationSec: 90,
  defaultPredictionWindowSec: 120,
  channelPoints: { enabled: false, perVote: 100 },
  confirmMode: false,
  confirmDelaySec: 3,
  dryRun: false,
  presets: [
    {
      id: 'preset-match',
      trigger: 'match',
      kind: 'poll',
      title: 'Win or Loss?',
      choices: ['Win', 'Loss'],
      durationSec: 90,
    },
  ],
  stt: { engine: 'sherpa', whisperModel: 'base.en', useGpu: false, numThreads: 2 },
  mic: { deviceId: null, label: null },
  listenMode: 'always',
  pttWindowSec: 6,
  hotkeys: {
    toggleListening: 'CommandOrControl+Shift+H',
    pushToTalk: 'CommandOrControl+Shift+Space',
    endPoll: 'CommandOrControl+Shift+E',
    cancelPending: 'CommandOrControl+Shift+X',
  },
  startWithWindows: false,
  minimizeToTray: true,
  chat: { enabled: true, prefix: '!hollr', allowModerators: true, allowVips: false, announce: true },
  overlay: { enabled: true, port: 4747 },
  onboardingComplete: false,
  twitchClientId: '',
};

const clamp = (n: unknown, min: number, max: number, fallback: number): number => {
  const v = typeof n === 'number' && Number.isFinite(n) ? n : fallback;
  return Math.min(max, Math.max(min, Math.round(v)));
};

const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);
const str = (v: unknown, fallback: string): string => (typeof v === 'string' ? v : fallback);

/** Merge a stored/partial settings object onto defaults and clamp every field into a valid range. */
export function sanitizeSettings(input: Partial<Settings> | undefined, base: Settings = DEFAULT_SETTINGS): Settings {
  const s = { ...base, ...(input ?? {}) } as Settings;
  const d = DEFAULT_SETTINGS;
  const wakeWord = str(s.wakeWord, d.wakeWord).trim().toLowerCase() || d.wakeWord;
  return {
    wakeWord,
    wakeAliases: Array.isArray(s.wakeAliases)
      ? [...new Set(s.wakeAliases.map((a) => String(a).trim().toLowerCase()).filter(Boolean))]
      : d.wakeAliases,
    cooldownSec: clamp(s.cooldownSec, 0, 600, d.cooldownSec),
    defaultPollDurationSec: clamp(
      s.defaultPollDurationSec,
      LIMITS.pollMinDuration,
      LIMITS.pollMaxDuration,
      d.defaultPollDurationSec,
    ),
    defaultPredictionWindowSec: clamp(
      s.defaultPredictionWindowSec,
      LIMITS.predictionMinWindow,
      LIMITS.predictionMaxWindow,
      d.defaultPredictionWindowSec,
    ),
    channelPoints: {
      enabled: bool(s.channelPoints?.enabled, d.channelPoints.enabled),
      perVote: clamp(s.channelPoints?.perVote, 1, 1_000_000, d.channelPoints.perVote),
    },
    confirmMode: bool(s.confirmMode, d.confirmMode),
    confirmDelaySec: clamp(s.confirmDelaySec, 1, 15, d.confirmDelaySec),
    dryRun: bool(s.dryRun, d.dryRun),
    presets: Array.isArray(s.presets)
      ? s.presets
          .filter((p) => p && typeof p.trigger === 'string' && p.trigger.trim())
          .map((p, i) => ({
            id: str(p.id, `preset-${Date.now()}-${i}`),
            trigger: p.trigger.trim().toLowerCase(),
            kind: p.kind === 'prediction' ? 'prediction' : 'poll',
            title: str(p.title, '').trim(),
            choices: Array.isArray(p.choices) ? p.choices.map((c) => String(c).trim()).filter(Boolean) : [],
            durationSec: clamp(p.durationSec, LIMITS.pollMinDuration, LIMITS.pollMaxDuration, 90),
          }))
      : d.presets,
    stt: {
      engine: s.stt?.engine === 'whisper' ? 'whisper' : 'sherpa',
      whisperModel: s.stt?.whisperModel === 'small.en' ? 'small.en' : 'base.en',
      useGpu: bool(s.stt?.useGpu, d.stt.useGpu),
      numThreads: clamp(s.stt?.numThreads, 1, 8, d.stt.numThreads),
    },
    mic: {
      deviceId: typeof s.mic?.deviceId === 'string' ? s.mic.deviceId : null,
      label: typeof s.mic?.label === 'string' ? s.mic.label : null,
    },
    listenMode: s.listenMode === 'push-to-talk' ? 'push-to-talk' : 'always',
    pttWindowSec: clamp(s.pttWindowSec, 2, 30, d.pttWindowSec),
    hotkeys: {
      toggleListening: str(s.hotkeys?.toggleListening, d.hotkeys.toggleListening),
      pushToTalk: str(s.hotkeys?.pushToTalk, d.hotkeys.pushToTalk),
      endPoll: str(s.hotkeys?.endPoll, d.hotkeys.endPoll),
      cancelPending: str(s.hotkeys?.cancelPending, d.hotkeys.cancelPending),
    },
    startWithWindows: bool(s.startWithWindows, d.startWithWindows),
    minimizeToTray: bool(s.minimizeToTray, d.minimizeToTray),
    chat: {
      enabled: bool(s.chat?.enabled, d.chat.enabled),
      prefix: str(s.chat?.prefix, d.chat.prefix).trim().toLowerCase() || d.chat.prefix,
      allowModerators: bool(s.chat?.allowModerators, d.chat.allowModerators),
      allowVips: bool(s.chat?.allowVips, d.chat.allowVips),
      announce: bool(s.chat?.announce, d.chat.announce),
    },
    overlay: {
      enabled: bool(s.overlay?.enabled, d.overlay.enabled),
      port: clamp(s.overlay?.port, 1024, 65535, d.overlay.port),
    },
    onboardingComplete: bool(s.onboardingComplete, d.onboardingComplete),
    twitchClientId: str(s.twitchClientId, '').trim(),
  };
}
