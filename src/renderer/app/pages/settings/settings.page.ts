import { ChangeDetectionStrategy, Component, effect, inject, signal } from '@angular/core';
import type { Hotkeys, Preset, Settings } from '@shared/types';
import { MicPickerComponent } from '../../components/mic-picker.component';
import { ModelPanelComponent } from '../../components/model-panel.component';
import { TwitchSignInComponent } from '../../components/twitch-sign-in.component';
import { HollrService } from '../../core/hollr.service';

const HOTKEY_LABELS: Record<keyof Hotkeys, string> = {
  toggleListening: 'Mute / unmute listening',
  pushToTalk: 'Push-to-talk (opens the mic for a few seconds)',
  endPoll: 'End the active poll',
  cancelPending: 'Cancel a pending confirm',
};

const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta']);

function accelerator(e: KeyboardEvent): string | null {
  if (MODIFIER_KEYS.has(e.key)) return null;
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('CommandOrControl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  let key = e.key;
  if (key === ' ') key = 'Space';
  else if (key.length === 1) key = key.toUpperCase();
  else if (key.startsWith('Arrow')) key = key.slice(5);
  parts.push(key);
  return parts.join('+');
}

@Component({
  selector: 'hl-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TwitchSignInComponent, MicPickerComponent, ModelPanelComponent],
  template: `
    @let s = hollr.settings();
    @if (s) {
      <h1>Settings</h1>
      <div class="cols">
        <section class="card stack">
          <h3>Twitch</h3>
          <hl-twitch-sign-in />
        </section>

        <section class="card stack">
          <h3>Microphone</h3>
          <hl-mic-picker />
          <label class="field">
            Listening mode
            <select [value]="s.listenMode" (change)="set({ listenMode: $any($event.target).value })">
              <option value="always">Always listening (wake word required)</option>
              <option value="push-to-talk">Push-to-talk hotkey</option>
            </select>
          </label>
          @if (s.listenMode === 'push-to-talk') {
            <label class="field">
              Push-to-talk window (seconds)
              <input type="number" min="2" max="30" [value]="s.pttWindowSec" (change)="num('pttWindowSec', $event)" />
            </label>
          }
        </section>

        <section class="card stack">
          <h3>Wake word</h3>
          <label class="field">
            Wake word
            <input type="text" [value]="s.wakeWord" (change)="set({ wakeWord: $any($event.target).value })" />
          </label>
          <label class="field">
            Aliases (comma separated, for common mishearings)
            <input type="text" [value]="s.wakeAliases.join(', ')" (change)="list('wakeAliases', $event)" />
          </label>
          <div class="muted">
            The wake word must be the first thing you say (fillers like "hey" are fine), so mentioning it mid-sentence
            won't trigger anything.
          </div>
        </section>

        <section class="card stack">
          <h3>Polls &amp; predictions</h3>
          <div class="two">
            <label class="field">
              Default poll duration (s)
              <input type="number" min="15" max="1800" [value]="s.defaultPollDurationSec" (change)="num('defaultPollDurationSec', $event)" />
            </label>
            <label class="field">
              Default prediction window (s)
              <input type="number" min="30" max="1800" [value]="s.defaultPredictionWindowSec" (change)="num('defaultPredictionWindowSec', $event)" />
            </label>
            <label class="field">
              Cooldown between commands (s)
              <input type="number" min="0" max="600" [value]="s.cooldownSec" (change)="num('cooldownSec', $event)" />
            </label>
            <label class="field">
              Confirm delay (s)
              <input type="number" min="1" max="15" [value]="s.confirmDelaySec" (change)="num('confirmDelaySec', $event)" />
            </label>
          </div>
          <label class="check">
            <input type="checkbox" [checked]="s.confirmMode" (change)="set({ confirmMode: $any($event.target).checked })" />
            Confirm mode: show a countdown before firing; say "cancel" to stop it
          </label>
          <label class="check">
            <input type="checkbox" [checked]="s.dryRun" (change)="set({ dryRun: $any($event.target).checked })" />
            Dry run: parse and log commands without calling Twitch
          </label>
          <label class="check">
            <input
              type="checkbox"
              [checked]="s.channelPoints.enabled"
              (change)="set({ channelPoints: { enabled: $any($event.target).checked, perVote: s.channelPoints.perVote } })"
            />
            Allow extra votes with Channel Points
          </label>
          @if (s.channelPoints.enabled) {
            <label class="field">
              Channel Points per extra vote
              <input
                type="number"
                min="1"
                [value]="s.channelPoints.perVote"
                (change)="set({ channelPoints: { enabled: true, perVote: +$any($event.target).value } })"
              />
            </label>
          }
        </section>

        <section class="card stack wide">
          <div class="spread">
            <h3>Presets</h3>
            <div class="row">
              <button class="btn small" (click)="addPreset()">Add preset</button>
              <button class="btn small primary" [disabled]="!presetsDirty()" (click)="savePresets()">Save presets</button>
            </div>
          </div>
          <div class="muted">Say "{{ s.wakeWord }} poll &lt;trigger&gt;" (or "predict &lt;trigger&gt;") to run a preset.</div>
          @for (p of presets(); track p.id; let i = $index) {
            <div class="preset">
              <label class="field">Trigger<input type="text" [value]="p.trigger" (input)="editPreset(i, { trigger: $any($event.target).value })" /></label>
              <label class="field">
                Type
                <select [value]="p.kind" (change)="editPreset(i, { kind: $any($event.target).value })">
                  <option value="poll">Poll</option>
                  <option value="prediction">Prediction</option>
                </select>
              </label>
              <label class="field">Title<input type="text" maxlength="60" [value]="p.title" (input)="editPreset(i, { title: $any($event.target).value })" /></label>
              <label class="field">
                Choices (comma separated)
                <input type="text" [value]="p.choices.join(', ')" (input)="editPreset(i, { choices: split($any($event.target).value) })" />
              </label>
              <label class="field">Seconds<input type="number" min="15" max="1800" [value]="p.durationSec" (input)="editPreset(i, { durationSec: +$any($event.target).value })" /></label>
              <button class="btn small danger" (click)="removePreset(i)">Remove</button>
            </div>
          }
        </section>

        <section class="card stack">
          <h3>Chat bot</h3>
          <label class="check">
            <input type="checkbox" [checked]="s.chat.enabled" (change)="chat({ enabled: $any($event.target).checked })" />
            Enable chat commands &amp; announcements
          </label>
          <label class="field">
            Command prefix
            <input type="text" [value]="s.chat.prefix" (change)="chat({ prefix: $any($event.target).value })" />
          </label>
          <label class="check">
            <input type="checkbox" [checked]="s.chat.allowModerators" (change)="chat({ allowModerators: $any($event.target).checked })" />
            Moderators can run commands
          </label>
          <label class="check">
            <input type="checkbox" [checked]="s.chat.allowVips" (change)="chat({ allowVips: $any($event.target).checked })" />
            VIPs can run commands
          </label>
          <label class="check">
            <input type="checkbox" [checked]="s.chat.announce" (change)="chat({ announce: $any($event.target).checked })" />
            Announce polls, results and predictions in chat
          </label>
          <div class="muted">
            The bot posts as your account. Try <code>{{ s.chat.prefix }} poll win or loss</code> or
            <code>{{ s.chat.prefix }} help</code> in chat.
          </div>
        </section>

        <section class="card stack">
          <h3>Hotkeys</h3>
          @for (k of hotkeyKeys; track k) {
            <label class="field">
              {{ hotkeyLabels[k] }}
              <div class="row">
                <input
                  type="text"
                  readonly
                  class="grow"
                  [value]="recording() === k ? 'Press a key combination…' : s.hotkeys[k]"
                  (focus)="recording.set(k)"
                  (blur)="recording.set(null)"
                  (keydown)="record(k, $event)"
                />
                <button class="btn small" (click)="setHotkey(k, '')">Clear</button>
              </div>
            </label>
          }
        </section>

        <section class="card stack">
          <h3>Speech engine</h3>
          <label class="field">
            Engine
            <select [value]="s.stt.engine" (change)="stt({ engine: $any($event.target).value })">
              <option value="sherpa">Streaming Zipformer (fast, default)</option>
              <option value="whisper">Whisper (more accurate, heavier)</option>
            </select>
          </label>
          @if (s.stt.engine === 'whisper') {
            <label class="field">
              Whisper model
              <select [value]="s.stt.whisperModel" (change)="stt({ whisperModel: $any($event.target).value })">
                <option value="base.en">base.en</option>
                <option value="small.en">small.en</option>
              </select>
            </label>
            <label class="check">
              <input type="checkbox" [checked]="s.stt.useGpu" (change)="stt({ useGpu: $any($event.target).checked })" />
              Try GPU (CUDA); falls back to CPU automatically
            </label>
          }
          <label class="field">
            CPU threads
            <input type="number" min="1" max="8" [value]="s.stt.numThreads" (change)="stt({ numThreads: +$any($event.target).value })" />
          </label>
          <hl-model-panel />
        </section>

        <section class="card stack">
          <h3>App</h3>
          <label class="check">
            <input type="checkbox" [checked]="s.startWithWindows" (change)="set({ startWithWindows: $any($event.target).checked })" />
            Start with Windows (minimized to tray)
          </label>
          <label class="check">
            <input type="checkbox" [checked]="s.minimizeToTray" (change)="set({ minimizeToTray: $any($event.target).checked })" />
            Closing the window keeps Hollr running in the tray
          </label>
          <label class="check">
            <input type="checkbox" [checked]="s.overlay.enabled" (change)="set({ overlay: { enabled: $any($event.target).checked, port: s.overlay.port } })" />
            OBS overlay server
          </label>
          <label class="field">
            Overlay port
            <input type="number" min="1024" max="65535" [value]="s.overlay.port" (change)="set({ overlay: { enabled: s.overlay.enabled, port: +$any($event.target).value } })" />
          </label>
          @if (hollr.state()?.overlayUrl; as url) {
            <div class="muted">Add a Browser Source in OBS pointing to <code>{{ url }}</code> (800×600, transparent).</div>
          }
          <details>
            <summary class="muted">Advanced</summary>
            <label class="field">
              Twitch Client ID override
              <input type="text" [value]="s.twitchClientId" placeholder="Uses the built-in Client ID when empty" (change)="set({ twitchClientId: $any($event.target).value })" />
            </label>
          </details>
          <button class="btn small" (click)="hollr.api.openLogs()">Open log folder</button>
        </section>
      </div>
    }
  `,
  styles: `
    .cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(380px, 1fr)); gap: 12px; }
    .wide { grid-column: 1 / -1; }
    .two { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .preset { display: grid; grid-template-columns: 1fr 120px 1.4fr 1.6fr 90px auto; gap: 8px; align-items: end; }
    .grow { flex: 1; }
    details label { margin-top: 8px; }
  `,
})
export class SettingsPage {
  readonly hollr = inject(HollrService);
  readonly hotkeyKeys = Object.keys(HOTKEY_LABELS) as (keyof Hotkeys)[];
  readonly hotkeyLabels = HOTKEY_LABELS;
  readonly recording = signal<keyof Hotkeys | null>(null);
  readonly presets = signal<Preset[]>([]);
  readonly presetsDirty = signal(false);

  constructor() {
    effect(() => {
      const s = this.hollr.settings();
      if (s && !this.presetsDirty()) this.presets.set(structuredClone(s.presets));
    });
  }

  set(patch: Partial<Settings>): void {
    void this.hollr.update(patch);
  }

  num(key: keyof Settings, e: Event): void {
    this.set({ [key]: Number((e.target as HTMLInputElement).value) } as Partial<Settings>);
  }

  split(v: string): string[] {
    return v.split(',').map((x) => x.trim()).filter(Boolean);
  }

  list(key: 'wakeAliases', e: Event): void {
    this.set({ [key]: this.split((e.target as HTMLInputElement).value) });
  }

  chat(patch: Partial<Settings['chat']>): void {
    const s = this.hollr.settings();
    if (s) this.set({ chat: { ...s.chat, ...patch } });
  }

  stt(patch: Partial<Settings['stt']>): void {
    const s = this.hollr.settings();
    if (s) this.set({ stt: { ...s.stt, ...patch } });
  }

  setHotkey(key: keyof Hotkeys, value: string): void {
    const s = this.hollr.settings();
    if (s) this.set({ hotkeys: { ...s.hotkeys, [key]: value } });
  }

  record(key: keyof Hotkeys, e: KeyboardEvent): void {
    e.preventDefault();
    if (e.key === 'Escape') {
      (e.target as HTMLElement).blur();
      return;
    }
    const accel = accelerator(e);
    if (!accel) return;
    this.setHotkey(key, accel);
    (e.target as HTMLElement).blur();
  }

  addPreset(): void {
    this.presets.update((p) => [
      ...p,
      { id: `preset-${Date.now()}`, trigger: '', kind: 'poll', title: '', choices: [], durationSec: 90 },
    ]);
    this.presetsDirty.set(true);
  }

  editPreset(i: number, patch: Partial<Preset>): void {
    this.presets.update((list) => list.map((p, j) => (j === i ? { ...p, ...patch } : p)));
    this.presetsDirty.set(true);
  }

  removePreset(i: number): void {
    this.presets.update((list) => list.filter((_, j) => j !== i));
    this.presetsDirty.set(true);
  }

  async savePresets(): Promise<void> {
    await this.hollr.update({ presets: this.presets() });
    this.presetsDirty.set(false);
  }
}
