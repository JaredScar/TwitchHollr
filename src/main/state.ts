import type { AppState, AuthState } from '@shared/types';

type Listener = (state: AppState, prev: AppState) => void;

export function initialState(auth: AuthState): AppState {
  return {
    auth,
    listening: true,
    pttArmedUntil: null,
    gateOpen: false,
    stt: { status: 'stopped', engine: 'sherpa', error: null, provider: null },
    download: null,
    models: [],
    eventsub: 'off',
    chat: 'off',
    activePoll: null,
    lastPoll: null,
    activePrediction: null,
    pending: null,
    cooldownUntil: 0,
    overlayUrl: null,
    micError: null,
  };
}

/** Single source of truth for live app state; every change is broadcast to the UI, tray and overlay. */
export class StateStore {
  private listeners: Listener[] = [];
  private scheduled = false;

  constructor(private state: AppState) {}

  get(): AppState {
    return this.state;
  }

  patch(patch: Partial<AppState>): void {
    const prev = this.state;
    this.state = { ...prev, ...patch };
    for (const l of this.listeners) l(this.state, prev);
  }

  onChange(l: Listener): void {
    this.listeners.push(l);
  }

  /** Coalesce bursts of changes (e.g. vote progress) into one callback per tick. */
  onChangeBatched(cb: (state: AppState) => void): void {
    this.onChange(() => {
      if (this.scheduled) return;
      this.scheduled = true;
      setImmediate(() => {
        this.scheduled = false;
        cb(this.state);
      });
    });
  }
}
