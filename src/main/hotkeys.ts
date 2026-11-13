import { globalShortcut } from 'electron';
import type { Hotkeys } from '@shared/types';

export type HotkeyAction = keyof Hotkeys;

/** (Re)register global shortcuts. Returns the accelerators that could not be registered. */
export function registerHotkeys(hotkeys: Hotkeys, handlers: Record<HotkeyAction, () => void>): string[] {
  globalShortcut.unregisterAll();
  const failed: string[] = [];
  for (const action of Object.keys(handlers) as HotkeyAction[]) {
    const accel = hotkeys[action]?.trim();
    if (!accel) continue;
    try {
      if (!globalShortcut.register(accel, handlers[action])) failed.push(accel);
    } catch {
      failed.push(accel);
    }
  }
  return failed;
}
