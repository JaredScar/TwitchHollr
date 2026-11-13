import { contextBridge, ipcRenderer } from 'electron';
import {
  type EventChannel,
  type EventContract,
  type HollrApi,
  type InvokeChannel,
  type InvokeContract,
  IpcEvent,
  IpcInvoke,
  STT_PORT_MESSAGE,
} from '@shared/ipc';

const invoke = <C extends InvokeChannel>(channel: C, ...args: InvokeContract[C]['args']) =>
  ipcRenderer.invoke(channel, ...args) as Promise<InvokeContract[C]['result']>;

const on = <C extends EventChannel>(channel: C, cb: (payload: EventContract[C]) => void) => {
  const listener = (_e: Electron.IpcRendererEvent, payload: EventContract[C]) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
};

const api: HollrApi = {
  getState: () => invoke(IpcInvoke.getState),
  getSettings: () => invoke(IpcInvoke.getSettings),
  updateSettings: (patch) => invoke(IpcInvoke.updateSettings, patch),
  getLogs: () => invoke(IpcInvoke.getLogs),
  startSignIn: () => invoke(IpcInvoke.authStart),
  cancelSignIn: () => invoke(IpcInvoke.authCancel),
  signOut: () => invoke(IpcInvoke.authSignOut),
  openActivation: () => invoke(IpcInvoke.openActivation),
  runText: (text) => invoke(IpcInvoke.runText, text),
  execute: (command) => invoke(IpcInvoke.execute, command),
  setListening: (on) => invoke(IpcInvoke.setListening, on),
  armPushToTalk: () => invoke(IpcInvoke.armPushToTalk),
  confirmPending: () => invoke(IpcInvoke.confirmPending),
  cancelPending: () => invoke(IpcInvoke.cancelPending),
  downloadModel: (id) => invoke(IpcInvoke.downloadModel, id),
  reportMic: (error) => invoke(IpcInvoke.reportMic, error),
  openOverlay: () => invoke(IpcInvoke.openOverlay),
  openLogs: () => invoke(IpcInvoke.openLogs),
  appInfo: () => invoke(IpcInvoke.appInfo),
  onState: (cb) => on(IpcEvent.state, cb),
  onSettings: (cb) => on(IpcEvent.settings, cb),
  onLog: (cb) => on(IpcEvent.log, cb),
  onPartial: (cb) => on(IpcEvent.partial, cb),
};

contextBridge.exposeInMainWorld('hollr', api);

// MessagePorts can't cross contextBridge, so hand the STT audio port to the page via window.postMessage.
ipcRenderer.on(IpcEvent.sttPort, (e) => {
  window.postMessage({ type: STT_PORT_MESSAGE }, window.location.origin === 'null' ? '*' : window.location.origin, [
    ...e.ports,
  ]);
});
