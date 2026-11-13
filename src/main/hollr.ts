import { join } from 'node:path';
import { type BrowserWindow, type IpcMainInvokeEvent, app, ipcMain, shell } from 'electron';
import { type InvokeChannel, type InvokeContract, IpcEvent, IpcInvoke } from '@shared/ipc';
import type { AppState, Command, CommandSource, Settings } from '@shared/types';
import { AuthService } from './auth/auth.service';
import { ChatBotService } from './chat/chat-bot.service';
import { TwitchCommandExecutor } from './commands/executor';
import { describeCommand } from './commands/grammar';
import { CommandRouter, type RouteOutcome } from './commands/router';
import { registerHotkeys } from './hotkeys';
import { ActivityLog, log } from './logger';
import { OverlayServer } from './overlay/overlay.server';
import { StateStore, initialState } from './state';
import { SafeTokenStore } from './store/secrets';
import { SettingsStore } from './store/settings';
import { COMMAND_HOTWORDS } from './stt/hotwords';
import { ModelManager, modelIdFor } from './stt/models';
import { SttController } from './stt/stt.controller';
import { AppTray } from './tray';
import {
  type ChatMessageEvent,
  type PollEvent,
  type PredictionEvent,
  pollFromEvent,
  predictionFromEvent,
} from './twitch/events';
import { EventSubService, type Subscription } from './twitch/eventsub.service';
import { TwitchService } from './twitch/twitch.service';

const UI_COMMANDS: ReadonlySet<Command['kind']> = new Set([
  'poll.end',
  'poll.cancel',
  'poll.repeat',
  'prediction.lock',
  'prediction.resolve',
  'prediction.cancel',
  'pending.cancel',
]);

export interface HollrOptions {
  e2e: boolean;
  isAppUrl(url: string): boolean;
  quit(): void;
  showWindow(): void;
}

export class HollrApp {
  readonly settings: SettingsStore;
  readonly activity = new ActivityLog();
  readonly state: StateStore;
  private readonly auth: AuthService;
  private readonly twitch: TwitchService;
  private readonly eventsub: EventSubService;
  private readonly chat: ChatBotService;
  private readonly router: CommandRouter;
  private readonly models: ModelManager;
  private readonly stt: SttController;
  private readonly overlay = new OverlayServer();
  private tray: AppTray | null = null;
  private window: BrowserWindow | null = null;
  private liveUserId: string | null = null;
  private pttTimer: ReturnType<typeof setTimeout> | null = null;
  private downloading = false;

  constructor(private readonly opts: HollrOptions) {
    this.settings = new SettingsStore(opts.e2e ? { dryRun: true, onboardingComplete: true } : undefined);
    const clientId = () => this.settings.get().twitchClientId || import.meta.env.MAIN_VITE_TWITCH_CLIENT_ID || '';

    this.auth = new AuthService({
      fetch: globalThis.fetch,
      store: new SafeTokenStore(),
      clientId,
      log,
      onChange: (auth) => {
        this.state?.patch({ auth });
        this.onAuthChanged();
      },
    });
    this.state = new StateStore({
      ...initialState(this.auth.state),
      stt: { status: 'stopped', engine: this.settings.get().stt.engine, error: null, provider: null },
    });

    this.twitch = new TwitchService({
      fetch: globalThis.fetch,
      clientId,
      getAccessToken: () => this.auth.getAccessToken(),
      onUnauthorized: () => this.auth.refresh(),
    });

    this.router = new CommandRouter({
      getSettings: () => this.settings.get(),
      getLive: () => {
        const s = this.state.get();
        const poll = s.activePoll;
        const stale = poll?.endsAt && Date.parse(poll.endsAt) + 5000 < Date.now();
        return {
          activePoll: stale ? null : poll,
          activePrediction: s.activePrediction,
          signedIn: s.auth.status === 'signed-in',
          eligible: s.auth.eligible,
        };
      },
      executor: new TwitchCommandExecutor({
        twitch: this.twitch,
        broadcasterId: () => this.auth.user?.id ?? null,
        getSettings: () => this.settings.get(),
        getActivePoll: () => this.state.get().activePoll,
        getActivePrediction: () => this.state.get().activePrediction,
        setPoll: (activePoll, last) => this.state.patch({ activePoll, ...(last ? { lastPoll: last } : {}) }),
        setPrediction: (activePrediction) => this.state.patch({ activePrediction }),
      }),
      log: (level, source, stage, message) => this.activity.command(level, source, stage, message),
      onPendingChange: (pending) => this.state.patch({ pending }),
      onCooldownChange: (cooldownUntil) => this.state.patch({ cooldownUntil }),
      onExecuted: (cmd, source) => {
        this.overlay.toast(describeCommand(cmd));
        if (source === 'voice' && this.state.get().pttArmedUntil) this.disarmPtt();
      },
    });

    this.chat = new ChatBotService({
      getSettings: () => this.settings.get(),
      broadcasterId: () => this.auth.user?.id ?? null,
      route: (input) => this.router.handle(input),
      awaitPending: () => new Promise<RouteOutcome>((resolve) => this.router.onPendingSettled(resolve)),
      send: async (message, replyTo) => {
        const id = this.auth.user?.id;
        if (id) await this.twitch.sendChatMessage(id, id, message, replyTo);
      },
      log,
    });

    this.eventsub = new EventSubService({
      subscribe: (type, version, condition, sessionId) => this.twitch.subscribe(type, version, condition, sessionId),
      onEvent: (type, event) => this.onEventSub(type, event),
      onStatus: (eventsub) => {
        const chatOn = this.settings.get().chat.enabled;
        this.state.patch({
          eventsub,
          ...(eventsub === 'connected' ? {} : { chat: chatOn && eventsub !== 'off' ? 'connecting' : 'off' }),
        });
      },
      onSubscribed: (ok, failed) => {
        const chatFail = failed.find((f) => f.type === 'channel.chat.message');
        if (!this.settings.get().chat.enabled) this.state.patch({ chat: 'off' });
        else if (ok.includes('channel.chat.message')) this.state.patch({ chat: 'connected' });
        else if (chatFail) {
          this.state.patch({ chat: 'error' });
          this.activity.system('warn', `Chat bot couldn't connect: ${chatFail.error}`);
        }
        if (ok.length) this.activity.system('info', `Connected to Twitch EventSub (${ok.length} subscriptions).`);
      },
      log,
    });

    this.models = new ModelManager(join(app.getPath('userData'), 'models'));
    this.stt = new SttController({
      workerPath: join(__dirname, '../worker/stt-worker.js'),
      onStatus: (status, error, provider) => {
        this.state.patch({ stt: { status, error, provider, engine: this.settings.get().stt.engine } });
        if (status === 'error' && error) this.activity.system('error', `Speech engine: ${error}`);
        this.updateGate();
      },
      onPartial: (text) => this.sendToRenderer(IpcEvent.partial, text),
      onFinal: (text) => void this.onFinalTranscript(text),
      log,
    });
  }

  // ---- Lifecycle --------------------------------------------------------------

  async start(): Promise<void> {
    this.state.patch({ models: this.models.list() });
    this.registerIpc();
    this.wireBroadcasts();
    this.settings.onChange((next, prev) => this.onSettingsChanged(next, prev));

    this.tray = new AppTray({
      show: () => this.opts.showWindow(),
      toggleListening: () => this.setListening(!this.state.get().listening),
      endPoll: () => void this.router.dispatch({ kind: 'poll.end' }, 'hotkey'),
      toggleDryRun: () => this.settings.update({ dryRun: !this.settings.get().dryRun }),
      quit: () => this.opts.quit(),
    });
    this.applyHotkeys();
    this.applyLoginItem();
    await this.applyOverlay();

    if (this.opts.e2e) {
      this.activity.system('info', 'Running in end-to-end test mode (dry run, no Twitch, no speech engine).');
    } else {
      this.startStt();
      void this.auth.init();
    }
    if (!this.auth.state.clientIdConfigured) {
      this.activity.system('warn', 'No Twitch Client ID configured. Set MAIN_VITE_TWITCH_CLIENT_ID or add one in Settings.');
    }
    this.activity.system('info', `Hollr ${app.getVersion()} started.`);
  }

  attachWindow(win: BrowserWindow): void {
    this.window = win;
    win.webContents.on('did-finish-load', () => this.stt.attachRenderer(win.webContents));
  }

  async shutdown(): Promise<void> {
    this.router.dispose();
    this.eventsub.stop();
    this.stt.stop();
    this.auth.dispose();
    this.tray?.destroy();
    await this.overlay.stop();
  }

  // ---- Broadcasting -----------------------------------------------------------

  private sendToRenderer(channel: string, payload: unknown): void {
    const wc = this.window?.webContents;
    if (wc && !wc.isDestroyed()) wc.send(channel, payload);
  }

  private wireBroadcasts(): void {
    this.state.onChangeBatched((s) => {
      this.sendToRenderer(IpcEvent.state, s);
      this.tray?.update(s, this.settings.get());
      this.overlay.update({ activePoll: s.activePoll, lastPoll: s.lastPoll, activePrediction: s.activePrediction });
    });
    this.activity.onEntry((e) => this.sendToRenderer(IpcEvent.log, e));
  }

  // ---- IPC --------------------------------------------------------------------

  private handle<C extends InvokeChannel>(
    channel: C,
    fn: (...args: InvokeContract[C]['args']) => InvokeContract[C]['result'] | Promise<InvokeContract[C]['result']>,
  ): void {
    ipcMain.handle(channel, (e: IpcMainInvokeEvent, ...args: unknown[]) => {
      const url = e.senderFrame?.url ?? '';
      if (!this.opts.isAppUrl(url)) throw new Error('Blocked IPC from an untrusted frame.');
      return fn(...(args as InvokeContract[C]['args']));
    });
  }

  private registerIpc(): void {
    this.handle(IpcInvoke.getState, () => this.state.get());
    this.handle(IpcInvoke.getSettings, () => this.settings.get());
    this.handle(IpcInvoke.updateSettings, (patch) => this.settings.update(patch ?? {}));
    this.handle(IpcInvoke.getLogs, () => this.activity.all());
    this.handle(IpcInvoke.authStart, async () => {
      try {
        await this.auth.startDeviceFlow();
      } catch (err) {
        this.activity.system('error', err instanceof Error ? err.message : String(err));
      }
    });
    this.handle(IpcInvoke.authCancel, () => this.auth.cancelDeviceFlow());
    this.handle(IpcInvoke.authSignOut, () => this.auth.signOut());
    this.handle(IpcInvoke.openActivation, async () => {
      const uri = this.auth.state.device?.verificationUri;
      if (uri && /^https:\/\/(www\.)?twitch\.tv\//.test(uri)) await shell.openExternal(uri);
    });
    this.handle(IpcInvoke.runText, async (text) => {
      await this.router.handle({ text: String(text ?? '').slice(0, 500), source: 'manual' });
    });
    this.handle(IpcInvoke.execute, async (cmd) => {
      if (!cmd || !UI_COMMANDS.has(cmd.kind)) throw new Error('Unsupported command.');
      await this.router.dispatch(cmd, 'ui');
    });
    this.handle(IpcInvoke.setListening, (on) => this.setListening(Boolean(on)));
    this.handle(IpcInvoke.armPushToTalk, () => this.armPtt());
    this.handle(IpcInvoke.confirmPending, async () => {
      await this.router.confirmPending();
    });
    this.handle(IpcInvoke.cancelPending, () => {
      this.router.cancelPending('ui');
    });
    this.handle(IpcInvoke.downloadModel, (id) => this.downloadModel(String(id)));
    this.handle(IpcInvoke.reportMic, (error) => {
      const micError = error ? String(error).slice(0, 300) : null;
      if (micError && micError !== this.state.get().micError) this.activity.system('error', `Microphone: ${micError}`);
      this.state.patch({ micError });
    });
    this.handle(IpcInvoke.openOverlay, async () => {
      if (this.overlay.url) await shell.openExternal(this.overlay.url);
    });
    this.handle(IpcInvoke.openLogs, async () => {
      await shell.openPath(app.getPath('logs'));
    });
    this.handle(IpcInvoke.appInfo, () => ({ version: app.getVersion(), platform: process.platform, e2e: this.opts.e2e }));
  }

  // ---- Listening / push-to-talk --------------------------------------------------

  setListening(on: boolean): void {
    this.state.patch({ listening: on });
    this.activity.system('info', on ? 'Listening on.' : 'Listening muted.');
    this.updateGate();
  }

  private armPtt(): void {
    const s = this.settings.get();
    if (this.pttTimer) clearTimeout(this.pttTimer);
    this.state.patch({ pttArmedUntil: Date.now() + s.pttWindowSec * 1000, listening: true });
    this.pttTimer = setTimeout(() => this.disarmPtt(), s.pttWindowSec * 1000);
    this.updateGate();
  }

  private disarmPtt(): void {
    if (this.pttTimer) clearTimeout(this.pttTimer);
    this.pttTimer = null;
    this.state.patch({ pttArmedUntil: null });
    this.updateGate();
  }

  private updateGate(): void {
    const s = this.state.get();
    const st = this.settings.get();
    const ptt = st.listenMode === 'push-to-talk';
    const open =
      s.listening && s.stt.status === 'ready' && (!ptt || (s.pttArmedUntil !== null && s.pttArmedUntil > Date.now()));
    this.stt.setGate(open);
    if (open !== s.gateOpen) this.state.patch({ gateOpen: open });
  }

  private async onFinalTranscript(text: string): Promise<void> {
    this.sendToRenderer(IpcEvent.partial, text);
    await this.router.handle({ text, source: 'voice' });
  }

  // ---- Speech engine ------------------------------------------------------------

  private startStt(): void {
    const s = this.settings.get();
    const modelId = modelIdFor(s.stt.engine, s.stt.whisperModel);
    if (!this.models.isInstalled(modelId)) {
      this.stt.stop();
      this.state.patch({ stt: { status: 'no-model', engine: s.stt.engine, error: null, provider: null } });
      this.updateGate();
      return;
    }
    this.stt.start({
      type: 'init',
      engine: s.stt.engine,
      modelId,
      modelDir: this.models.dirFor(modelId),
      numThreads: s.stt.numThreads,
      hotwords: [s.wakeWord, ...s.wakeAliases, ...COMMAND_HOTWORDS],
      useGpu: s.stt.useGpu,
    });
  }

  private async downloadModel(id: string): Promise<void> {
    if (this.downloading) return;
    this.downloading = true;
    let lastEmit = 0;
    const prevStt = this.state.get().stt;
    this.state.patch({ download: { modelId: id, receivedBytes: 0, totalBytes: 0 } });
    if (prevStt.status === 'no-model') this.state.patch({ stt: { ...prevStt, status: 'downloading' } });
    this.activity.system('info', `Downloading speech model ${id}…`);
    try {
      await this.models.download(id, (receivedBytes, totalBytes) => {
        const now = Date.now();
        if (now - lastEmit < 150 && receivedBytes < totalBytes) return;
        lastEmit = now;
        this.state.patch({ download: { modelId: id, receivedBytes, totalBytes } });
      });
      this.activity.system('success', `Speech model ${id} installed and verified.`);
      this.state.patch({ download: null, models: this.models.list() });
      const s = this.settings.get();
      if (modelIdFor(s.stt.engine, s.stt.whisperModel) === id) this.startStt();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.activity.system('error', `Model download failed: ${msg}`);
      this.state.patch({ download: null, stt: { ...prevStt } });
      throw err;
    } finally {
      this.downloading = false;
    }
  }

  // ---- Twitch live connection -----------------------------------------------------

  private onAuthChanged(): void {
    const a = this.auth.state;
    if (a.status === 'signed-in' && a.user && a.user.id !== this.liveUserId) {
      this.liveUserId = a.user.id;
      if (!a.eligible) {
        this.activity.system(
          'warn',
          `${a.user.displayName} isn't an Affiliate or Partner, so Twitch won't allow polls or predictions. Dry run still works.`,
        );
      }
      void this.goLive();
    } else if (a.status !== 'signed-in' && this.liveUserId) {
      this.liveUserId = null;
      this.eventsub.stop();
      this.state.patch({ activePoll: null, activePrediction: null, chat: 'off', eventsub: 'off' });
    }
  }

  private async goLive(): Promise<void> {
    const user = this.auth.user;
    if (!user) return;
    const bid = user.id;
    if (this.auth.state.eligible) {
      const [poll, prediction] = await Promise.allSettled([
        this.twitch.getActivePoll(bid),
        this.twitch.getActivePrediction(bid),
      ]);
      this.state.patch({
        activePoll: poll.status === 'fulfilled' ? poll.value : null,
        activePrediction: prediction.status === 'fulfilled' ? prediction.value : null,
      });
    }
    const c = { broadcaster_user_id: bid };
    const subs: Subscription[] = this.auth.state.eligible
      ? [
          'channel.poll.begin',
          'channel.poll.progress',
          'channel.poll.end',
          'channel.prediction.begin',
          'channel.prediction.progress',
          'channel.prediction.lock',
          'channel.prediction.end',
        ].map((type) => ({ type, version: '1', condition: c }))
      : [];
    if (this.settings.get().chat.enabled) {
      subs.push({ type: 'channel.chat.message', version: '1', condition: { broadcaster_user_id: bid, user_id: bid } });
    }
    if (subs.length) this.eventsub.start(subs);
    else this.eventsub.stop();
  }

  private onEventSub(type: string, event: unknown): void {
    switch (type) {
      case 'channel.poll.begin': {
        const poll = pollFromEvent(event as PollEvent, false);
        this.state.patch({ activePoll: poll });
        const secs = poll.endsAt ? Math.round((Date.parse(poll.endsAt) - Date.parse(poll.startedAt)) / 1000) : 90;
        this.router.rememberPoll({ title: poll.title, choices: poll.choices.map((c) => c.title), durationSec: secs });
        this.chat.announcePollBegin(poll);
        break;
      }
      case 'channel.poll.progress':
        this.state.patch({ activePoll: pollFromEvent(event as PollEvent, false) });
        break;
      case 'channel.poll.end': {
        const poll = pollFromEvent(event as PollEvent, true);
        this.state.patch({ activePoll: null, lastPoll: poll });
        this.activity.add('info', 'twitch', 'system', `Poll finished (${poll.status.toLowerCase()}): ${poll.title}`);
        this.chat.announcePollEnd(poll);
        break;
      }
      case 'channel.prediction.begin':
      case 'channel.prediction.progress':
      case 'channel.prediction.lock': {
        const phase = type.split('.').pop() as 'begin' | 'progress' | 'lock';
        const p = predictionFromEvent(event as PredictionEvent, phase);
        this.state.patch({ activePrediction: p });
        if (phase !== 'progress') this.chat.announcePrediction(p, phase);
        break;
      }
      case 'channel.prediction.end': {
        const p = predictionFromEvent(event as PredictionEvent, 'end');
        this.state.patch({ activePrediction: null });
        this.activity.add('info', 'twitch', 'system', `Prediction ${p.status.toLowerCase()}: ${p.title}`);
        this.chat.announcePrediction(p, 'end');
        break;
      }
      case 'channel.chat.message':
        void this.chat.onMessage(event as ChatMessageEvent);
        break;
    }
  }

  // ---- Settings side effects ------------------------------------------------------

  private onSettingsChanged(next: Settings, prev: Settings): void {
    this.sendToRenderer(IpcEvent.settings, next);
    const changed = (k: keyof Settings) => JSON.stringify(next[k]) !== JSON.stringify(prev[k]);

    if (changed('hotkeys')) this.applyHotkeys();
    if (changed('startWithWindows')) this.applyLoginItem();
    if (changed('overlay')) void this.applyOverlay();
    if (changed('twitchClientId')) this.auth.notifyConfigChanged();
    if (!this.opts.e2e && (changed('stt') || changed('wakeWord') || changed('wakeAliases'))) {
      this.state.patch({ stt: { ...this.state.get().stt, engine: next.stt.engine } });
      this.startStt();
    }
    if (changed('chat') && next.chat.enabled !== prev.chat.enabled && this.liveUserId) void this.goLive();
    if (changed('listenMode') || changed('pttWindowSec')) this.updateGate();
    if (changed('dryRun')) this.activity.system('info', next.dryRun ? 'Dry run ON: commands are logged, not sent.' : 'Dry run OFF.');
    this.tray?.update(this.state.get(), next);
  }

  private applyHotkeys(): void {
    const failed = registerHotkeys(this.settings.get().hotkeys, {
      toggleListening: () => this.setListening(!this.state.get().listening),
      pushToTalk: () => this.armPtt(),
      endPoll: () => void this.router.dispatch({ kind: 'poll.end' }, 'hotkey'),
      cancelPending: () => this.router.cancelPending('hotkey'),
    });
    if (failed.length) this.activity.system('warn', `Couldn't register hotkeys (in use elsewhere?): ${failed.join(', ')}`);
  }

  private applyLoginItem(): void {
    if (this.opts.e2e || !app.isPackaged) return;
    app.setLoginItemSettings({ openAtLogin: this.settings.get().startWithWindows, args: ['--hidden'] });
  }

  private async applyOverlay(): Promise<void> {
    const o = this.settings.get().overlay;
    if (!o.enabled || this.opts.e2e) {
      await this.overlay.stop();
      this.state.patch({ overlayUrl: null });
      return;
    }
    try {
      const overlayUrl = await this.overlay.start(o.port);
      this.state.patch({ overlayUrl });
    } catch (err) {
      this.state.patch({ overlayUrl: null });
      this.activity.system('warn', `Overlay server couldn't start on port ${o.port}: ${(err as Error).message}`);
    }
  }

  /** Used by tray/hotkeys and tests. */
  dispatch(cmd: Command, source: CommandSource) {
    return this.router.dispatch(cmd, source);
  }

  snapshot(): AppState {
    return this.state.get();
  }
}
