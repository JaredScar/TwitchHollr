import type { AppInfo, AppState, Command, LogEntry, Settings } from './types';

/** invoke() channels: renderer → main, with a response. */
export const IpcInvoke = {
  getState: 'state:get',
  getSettings: 'settings:get',
  updateSettings: 'settings:update',
  getLogs: 'logs:get',
  authStart: 'auth:start',
  authCancel: 'auth:cancel',
  authSignOut: 'auth:sign-out',
  openActivation: 'auth:open-activation',
  runText: 'command:run-text',
  execute: 'command:execute',
  setListening: 'listening:set',
  armPushToTalk: 'listening:arm-ptt',
  confirmPending: 'pending:confirm',
  cancelPending: 'pending:cancel',
  downloadModel: 'model:download',
  reportMic: 'mic:report',
  openOverlay: 'overlay:open',
  openLogs: 'logs:open-folder',
  appInfo: 'app:info',
} as const;

/** send() channels: main → renderer. */
export const IpcEvent = {
  state: 'state:changed',
  settings: 'settings:changed',
  log: 'log:entry',
  partial: 'stt:partial',
  sttPort: 'stt:port',
} as const;

/** window.postMessage tag the preload uses to hand the STT MessagePort to the page. */
export const STT_PORT_MESSAGE = 'hollr:stt-port';

export interface InvokeContract {
  [IpcInvoke.getState]: { args: []; result: AppState };
  [IpcInvoke.getSettings]: { args: []; result: Settings };
  [IpcInvoke.updateSettings]: { args: [patch: Partial<Settings>]; result: Settings };
  [IpcInvoke.getLogs]: { args: []; result: LogEntry[] };
  [IpcInvoke.authStart]: { args: []; result: void };
  [IpcInvoke.authCancel]: { args: []; result: void };
  [IpcInvoke.authSignOut]: { args: []; result: void };
  [IpcInvoke.openActivation]: { args: []; result: void };
  [IpcInvoke.runText]: { args: [text: string]; result: void };
  [IpcInvoke.execute]: { args: [command: Command]; result: void };
  [IpcInvoke.setListening]: { args: [on: boolean]; result: void };
  [IpcInvoke.armPushToTalk]: { args: []; result: void };
  [IpcInvoke.confirmPending]: { args: []; result: void };
  [IpcInvoke.cancelPending]: { args: []; result: void };
  [IpcInvoke.downloadModel]: { args: [modelId: string]; result: void };
  [IpcInvoke.reportMic]: { args: [error: string | null]; result: void };
  [IpcInvoke.openOverlay]: { args: []; result: void };
  [IpcInvoke.openLogs]: { args: []; result: void };
  [IpcInvoke.appInfo]: { args: []; result: AppInfo };
}

export interface EventContract {
  [IpcEvent.state]: AppState;
  [IpcEvent.settings]: Settings;
  [IpcEvent.log]: LogEntry;
  [IpcEvent.partial]: string;
}

export type InvokeChannel = keyof InvokeContract;
export type EventChannel = keyof EventContract;

/** The API exposed on window.hollr by the preload script. */
export interface HollrApi {
  getState(): Promise<AppState>;
  getSettings(): Promise<Settings>;
  updateSettings(patch: Partial<Settings>): Promise<Settings>;
  getLogs(): Promise<LogEntry[]>;
  startSignIn(): Promise<void>;
  cancelSignIn(): Promise<void>;
  signOut(): Promise<void>;
  openActivation(): Promise<void>;
  runText(text: string): Promise<void>;
  execute(command: Command): Promise<void>;
  setListening(on: boolean): Promise<void>;
  armPushToTalk(): Promise<void>;
  confirmPending(): Promise<void>;
  cancelPending(): Promise<void>;
  downloadModel(modelId: string): Promise<void>;
  reportMic(error: string | null): Promise<void>;
  openOverlay(): Promise<void>;
  openLogs(): Promise<void>;
  appInfo(): Promise<AppInfo>;
  onState(cb: (state: AppState) => void): () => void;
  onSettings(cb: (settings: Settings) => void): () => void;
  onLog(cb: (entry: LogEntry) => void): () => void;
  onPartial(cb: (text: string) => void): () => void;
}
