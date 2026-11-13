import Store from 'electron-store';
import { DEFAULT_SETTINGS, sanitizeSettings } from '@shared/defaults';
import type { Settings } from '@shared/types';

type Listener = (next: Settings, prev: Settings) => void;

export class SettingsStore {
  private readonly store = new Store<{ settings: Settings }>({
    name: 'settings',
    defaults: { settings: DEFAULT_SETTINGS },
  });
  private current: Settings;
  private listeners: Listener[] = [];

  constructor(overrides?: Partial<Settings>) {
    this.current = sanitizeSettings({ ...this.store.get('settings'), ...overrides });
  }

  get(): Settings {
    return this.current;
  }

  update(patch: Partial<Settings>): Settings {
    const prev = this.current;
    this.current = sanitizeSettings(patch, prev);
    this.store.set('settings', this.current);
    for (const l of this.listeners) l(this.current, prev);
    return this.current;
  }

  onChange(l: Listener): void {
    this.listeners.push(l);
  }
}
