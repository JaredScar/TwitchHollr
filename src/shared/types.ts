export type CommandSource = 'voice' | 'manual' | 'chat' | 'hotkey' | 'ui';

export interface PollSpec {
  title: string;
  choices: string[];
  durationSec: number;
}

export interface PredictionSpec {
  title: string;
  outcomes: string[];
  windowSec: number;
}

export type Command =
  | { kind: 'poll.create'; spec: PollSpec; presetTrigger?: string }
  | { kind: 'poll.end' }
  | { kind: 'poll.cancel' }
  | { kind: 'poll.repeat' }
  | { kind: 'prediction.create'; spec: PredictionSpec; presetTrigger?: string }
  | { kind: 'prediction.lock' }
  | { kind: 'prediction.resolve'; outcome: string; outcomeId?: string }
  | { kind: 'prediction.cancel' }
  | { kind: 'pending.cancel' };

export type CommandKind = Command['kind'];

export interface Preset {
  id: string;
  /** Spoken/typed trigger, e.g. "match" for "hollr poll match". */
  trigger: string;
  kind: 'poll' | 'prediction';
  title: string;
  choices: string[];
  durationSec: number;
}

export interface Hotkeys {
  toggleListening: string;
  pushToTalk: string;
  endPoll: string;
  cancelPending: string;
}

export type SttEngineId = 'sherpa' | 'whisper';
export type WhisperModelSize = 'base.en' | 'small.en';

export interface Settings {
  wakeWord: string;
  wakeAliases: string[];
  cooldownSec: number;
  defaultPollDurationSec: number;
  defaultPredictionWindowSec: number;
  channelPoints: { enabled: boolean; perVote: number };
  confirmMode: boolean;
  confirmDelaySec: number;
  dryRun: boolean;
  presets: Preset[];
  stt: { engine: SttEngineId; whisperModel: WhisperModelSize; useGpu: boolean; numThreads: number };
  mic: { deviceId: string | null; label: string | null };
  listenMode: 'always' | 'push-to-talk';
  pttWindowSec: number;
  hotkeys: Hotkeys;
  startWithWindows: boolean;
  minimizeToTray: boolean;
  chat: { enabled: boolean; prefix: string; allowModerators: boolean; allowVips: boolean; announce: boolean };
  overlay: { enabled: boolean; port: number };
  onboardingComplete: boolean;
  /** Optional override for the build-time Twitch Client ID. */
  twitchClientId: string;
}

export type PollStatus = 'ACTIVE' | 'COMPLETED' | 'TERMINATED' | 'ARCHIVED' | 'MODERATED' | 'INVALID';

export interface PollChoiceState {
  id: string;
  title: string;
  votes: number;
}

export interface PollState {
  id: string;
  title: string;
  choices: PollChoiceState[];
  status: PollStatus;
  startedAt: string;
  endsAt: string | null;
  endedAt: string | null;
}

export type PredictionStatus = 'ACTIVE' | 'LOCKED' | 'RESOLVED' | 'CANCELED';

export interface PredictionOutcomeState {
  id: string;
  title: string;
  color: string;
  users: number;
  channelPoints: number;
}

export interface PredictionState {
  id: string;
  title: string;
  outcomes: PredictionOutcomeState[];
  status: PredictionStatus;
  locksAt: string | null;
  winningOutcomeId: string | null;
}

export interface TwitchUser {
  id: string;
  login: string;
  displayName: string;
  broadcasterType: '' | 'affiliate' | 'partner';
  profileImageUrl: string;
}

export interface AuthState {
  status: 'signed-out' | 'pending' | 'signed-in' | 'error';
  user: TwitchUser | null;
  /** Affiliate or partner: Twitch only allows polls/predictions for these. */
  eligible: boolean;
  device: { userCode: string; verificationUri: string; expiresAt: number } | null;
  error: string | null;
  clientIdConfigured: boolean;
}

export type SttStatus = 'no-model' | 'downloading' | 'loading' | 'ready' | 'error' | 'stopped';

export interface ModelInfo {
  id: string;
  label: string;
  engine: SttEngineId;
  sizeBytes: number;
  installed: boolean;
}

export interface DownloadProgress {
  modelId: string;
  receivedBytes: number;
  totalBytes: number;
}

export interface PendingConfirm {
  id: number;
  summary: string;
  source: CommandSource;
  firesAt: number;
}

export type ConnectionStatus = 'off' | 'connecting' | 'connected' | 'error';

export interface AppState {
  auth: AuthState;
  listening: boolean;
  pttArmedUntil: number | null;
  /** True when audio is actually being fed to the recognizer. */
  gateOpen: boolean;
  stt: { status: SttStatus; engine: SttEngineId; error: string | null; provider: string | null };
  download: DownloadProgress | null;
  models: ModelInfo[];
  eventsub: ConnectionStatus;
  chat: ConnectionStatus;
  activePoll: PollState | null;
  lastPoll: PollState | null;
  activePrediction: PredictionState | null;
  pending: PendingConfirm | null;
  cooldownUntil: number;
  overlayUrl: string | null;
  micError: string | null;
}

export type LogLevel = 'info' | 'success' | 'warn' | 'error';
export type LogStage = 'heard' | 'parsed' | 'result' | 'system';

export interface LogEntry {
  id: number;
  ts: number;
  level: LogLevel;
  source: CommandSource | 'system' | 'twitch';
  stage: LogStage;
  message: string;
}

export interface AppInfo {
  version: string;
  platform: string;
  e2e: boolean;
}
