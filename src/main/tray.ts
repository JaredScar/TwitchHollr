import { Menu, type NativeImage, Tray, nativeImage } from 'electron';
import type { AppState, Settings } from '@shared/types';

export type TrayColor = 'green' | 'gray' | 'red' | 'amber';

const RGB: Record<TrayColor, [number, number, number]> = {
  green: [46, 204, 113],
  gray: [140, 140, 150],
  red: [231, 76, 60],
  amber: [241, 196, 15],
};

/** Draw an anti-aliased filled circle as a BGRA bitmap so no icon assets are needed. */
function dot(color: TrayColor, size = 32): NativeImage {
  const [r, g, b] = RGB[color];
  const buf = Buffer.alloc(size * size * 4);
  const c = (size - 1) / 2;
  const radius = size * 0.42;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - c, y - c);
      const alpha = Math.max(0, Math.min(1, radius - d + 0.5));
      const i = (y * size + x) * 4;
      buf[i] = b;
      buf[i + 1] = g;
      buf[i + 2] = r;
      buf[i + 3] = Math.round(alpha * 255);
    }
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size, scaleFactor: 2 });
}

export function trayColor(state: AppState, settings: Settings): TrayColor {
  const authBad = !settings.dryRun && state.auth.status !== 'signed-in';
  if (authBad || state.micError || state.stt.status === 'error') return 'red';
  if (state.stt.status === 'loading' || state.stt.status === 'downloading') return 'amber';
  if (!state.listening || state.stt.status !== 'ready') return 'gray';
  if (settings.listenMode === 'push-to-talk' && !state.gateOpen) return 'gray';
  return 'green';
}

export interface TrayActions {
  show(): void;
  toggleListening(): void;
  endPoll(): void;
  toggleDryRun(): void;
  quit(): void;
}

export class AppTray {
  private tray: Tray;
  private icons = new Map<TrayColor, NativeImage>();
  private lastKey = '';

  constructor(private readonly actions: TrayActions) {
    this.tray = new Tray(this.icon('gray'));
    this.tray.setToolTip('Hollr');
    this.tray.on('click', () => actions.show());
  }

  private icon(color: TrayColor): NativeImage {
    let img = this.icons.get(color);
    if (!img) this.icons.set(color, (img = dot(color)));
    return img;
  }

  update(state: AppState, settings: Settings): void {
    const color = trayColor(state, settings);
    const key = `${color}|${state.listening}|${settings.dryRun}|${Boolean(state.activePoll)}|${state.stt.status}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.tray.setImage(this.icon(color));
    const status =
      color === 'red'
        ? state.micError
          ? 'Mic error'
          : state.stt.status === 'error'
            ? 'Speech engine error'
            : 'Not signed in'
        : color === 'green'
          ? 'Listening'
          : color === 'amber'
            ? 'Loading speech model…'
            : 'Muted';
    this.tray.setToolTip(`Hollr: ${status}${settings.dryRun ? ' (dry run)' : ''}`);
    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: `Hollr: ${status}`, enabled: false },
        { type: 'separator' },
        { label: 'Show Hollr', click: () => this.actions.show() },
        { label: 'Listening', type: 'checkbox', checked: state.listening, click: () => this.actions.toggleListening() },
        { label: 'Dry run', type: 'checkbox', checked: settings.dryRun, click: () => this.actions.toggleDryRun() },
        { label: 'End active poll', enabled: Boolean(state.activePoll), click: () => this.actions.endPoll() },
        { type: 'separator' },
        { label: 'Quit Hollr', click: () => this.actions.quit() },
      ]),
    );
  }

  destroy(): void {
    this.tray.destroy();
  }
}
