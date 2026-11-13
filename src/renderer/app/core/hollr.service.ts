import { Injectable, computed, signal } from '@angular/core';
import type { AppInfo, AppState, Command, LogEntry, Settings } from '@shared/types';

const MAX_LOGS = 300;

/** Signal-based facade over the preload API (window.hollr). */
@Injectable({ providedIn: 'root' })
export class HollrService {
  readonly api = window.hollr;
  readonly state = signal<AppState | null>(null);
  readonly settings = signal<Settings | null>(null);
  readonly logs = signal<LogEntry[]>([]);
  readonly partial = signal('');
  readonly info = signal<AppInfo | null>(null);
  /** Ticks 4×/s so countdowns re-render. */
  readonly now = signal(Date.now());

  readonly signedIn = computed(() => this.state()?.auth.status === 'signed-in');
  readonly cooldownLeft = computed(() => Math.max(0, Math.ceil(((this.state()?.cooldownUntil ?? 0) - this.now()) / 1000)));

  private partialTimer: ReturnType<typeof setTimeout> | null = null;

  async init(): Promise<void> {
    const [state, settings, logs, info] = await Promise.all([
      this.api.getState(),
      this.api.getSettings(),
      this.api.getLogs(),
      this.api.appInfo(),
    ]);
    this.state.set(state);
    this.settings.set(settings);
    this.logs.set(logs);
    this.info.set(info);
    this.api.onState((s) => this.state.set(s));
    this.api.onSettings((s) => this.settings.set(s));
    this.api.onLog((e) => this.logs.update((l) => [...l.slice(-(MAX_LOGS - 1)), e]));
    this.api.onPartial((t) => {
      this.partial.set(t);
      if (this.partialTimer) clearTimeout(this.partialTimer);
      this.partialTimer = setTimeout(() => this.partial.set(''), 4000);
    });
    setInterval(() => this.now.set(Date.now()), 250);
  }

  async update(patch: Partial<Settings>): Promise<Settings> {
    const next = await this.api.updateSettings(patch);
    this.settings.set(next);
    return next;
  }

  run(text: string): Promise<void> {
    return this.api.runText(text);
  }

  execute(cmd: Command): Promise<void> {
    return this.api.execute(cmd);
  }
}
