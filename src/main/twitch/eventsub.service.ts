import WebSocket from 'ws';
import type { ConnectionStatus } from '@shared/types';

const EVENTSUB_URL = 'wss://eventsub.wss.twitch.tv/ws';

export interface Subscription {
  type: string;
  version: string;
  condition: Record<string, string>;
}

interface Logger {
  info(...a: unknown[]): void;
  warn(...a: unknown[]): void;
}

export interface EventSubDeps {
  subscribe(type: string, version: string, condition: Record<string, string>, sessionId: string): Promise<void>;
  onEvent(type: string, event: unknown): void;
  onStatus(status: ConnectionStatus): void;
  /** Reports which subscription types succeeded/failed after each fresh session. */
  onSubscribed?(ok: string[], failed: { type: string; error: string }[]): void;
  log: Logger;
  url?: string;
}

interface Envelope {
  metadata: { message_id: string; message_type: string; subscription_type?: string };
  payload: {
    session?: { id: string; keepalive_timeout_seconds: number | null; reconnect_url: string | null };
    subscription?: { type: string };
    event?: unknown;
  };
}

export class EventSubService {
  private socket: WebSocket | null = null;
  private subs: Subscription[] = [];
  private stopped = true;
  private backoffMs = 1000;
  private watchdog: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private keepaliveSec = 10;
  private readonly seen: string[] = [];

  constructor(private readonly deps: EventSubDeps) {}

  start(subs: Subscription[]): void {
    this.stop();
    this.subs = subs;
    this.stopped = false;
    this.connect(this.deps.url ?? EVENTSUB_URL, false);
  }

  stop(): void {
    this.stopped = true;
    if (this.watchdog) clearTimeout(this.watchdog);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    const s = this.socket;
    this.socket = null;
    s?.removeAllListeners();
    s?.on('error', () => undefined);
    s?.close();
    this.deps.onStatus('off');
  }

  private connect(url: string, isReconnect: boolean): void {
    if (!isReconnect) this.deps.onStatus('connecting');
    const ws = new WebSocket(url);
    const previous = this.socket;
    if (!isReconnect) this.socket = ws;

    ws.on('message', (data) => {
      let msg: Envelope;
      try {
        msg = JSON.parse(data.toString()) as Envelope;
      } catch {
        return;
      }
      if (this.isDuplicate(msg.metadata.message_id)) return;
      this.armWatchdog();
      switch (msg.metadata.message_type) {
        case 'session_welcome': {
          const session = msg.payload.session!;
          this.keepaliveSec = session.keepalive_timeout_seconds ?? 10;
          this.armWatchdog();
          if (isReconnect) {
            this.socket = ws;
            previous?.removeAllListeners();
            previous?.on('error', () => undefined);
            previous?.close();
            this.deps.onStatus('connected');
          } else {
            void this.subscribeAll(session.id);
          }
          this.backoffMs = 1000;
          break;
        }
        case 'session_reconnect': {
          const next = msg.payload.session?.reconnect_url;
          if (next) this.connect(next, true);
          break;
        }
        case 'notification': {
          const type = msg.payload.subscription?.type ?? msg.metadata.subscription_type;
          if (type) this.deps.onEvent(type, msg.payload.event);
          break;
        }
        case 'revocation':
          this.deps.log.warn('EventSub subscription revoked', msg.payload.subscription);
          break;
      }
    });

    ws.on('close', (code) => {
      if (this.stopped || ws !== this.socket) return;
      this.deps.log.warn(`EventSub socket closed (${code}); reconnecting in ${this.backoffMs}ms`);
      this.scheduleReconnect();
    });
    ws.on('error', (err) => this.deps.log.warn('EventSub socket error', err.message));
  }

  private async subscribeAll(sessionId: string): Promise<void> {
    const results = await Promise.allSettled(
      this.subs.map((s) => this.deps.subscribe(s.type, s.version, s.condition, sessionId)),
    );
    const ok: string[] = [];
    const failed: { type: string; error: string }[] = [];
    results.forEach((r, i) => {
      const type = this.subs[i]!.type;
      if (r.status === 'fulfilled') ok.push(type);
      else failed.push({ type, error: r.reason instanceof Error ? r.reason.message : String(r.reason) });
    });
    if (failed.length) this.deps.log.warn('Some EventSub subscriptions failed', failed);
    this.deps.onStatus(ok.length ? 'connected' : 'error');
    this.deps.onSubscribed?.(ok, failed);
  }

  private armWatchdog(): void {
    if (this.watchdog) clearTimeout(this.watchdog);
    this.watchdog = setTimeout(
      () => {
        this.deps.log.warn('EventSub keepalive missed; reconnecting');
        const s = this.socket;
        this.socket = null;
        s?.removeAllListeners();
        s?.on('error', () => undefined);
        s?.terminate();
        this.scheduleReconnect();
      },
      (this.keepaliveSec + 10) * 1000,
    );
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    if (this.watchdog) clearTimeout(this.watchdog);
    this.deps.onStatus('connecting');
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      if (!this.stopped) this.connect(this.deps.url ?? EVENTSUB_URL, false);
    }, this.backoffMs);
    this.backoffMs = Math.min(this.backoffMs * 2, 30_000);
  }

  private isDuplicate(id: string): boolean {
    if (this.seen.includes(id)) return true;
    this.seen.push(id);
    if (this.seen.length > 200) this.seen.shift();
    return false;
  }
}
