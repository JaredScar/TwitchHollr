import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MicCaptureService } from '../../audio/mic-capture.service';
import { ActivityLogComponent } from '../../components/activity-log.component';
import { CommandBoxComponent } from '../../components/command-box.component';
import { LevelMeterComponent } from '../../components/level-meter.component';
import { PollCardComponent } from '../../components/poll-card.component';
import { PredictionCardComponent } from '../../components/prediction-card.component';
import { HollrService } from '../../core/hollr.service';

@Component({
  selector: 'hl-dashboard',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ActivityLogComponent, CommandBoxComponent, LevelMeterComponent, PollCardComponent, PredictionCardComponent],
  template: `
    @let s = hollr.state();
    @let st = hollr.settings();
    @if (s && st) {
      <header class="page-head">
        <h1>Dashboard</h1>
        <p>Run polls and predictions with your voice, chat, or the box below.</p>
      </header>
      <div class="grid">
        <section class="card listen" [class.live]="s.listening && s.stt.status === 'ready'" [class.hot]="s.gateOpen">
          <button
            class="mic-btn"
            [class.on]="s.listening"
            [class.hot]="s.gateOpen"
            (click)="hollr.api.setListening(!s.listening)"
            [title]="s.listening ? 'Click to mute' : 'Click to listen'"
            [attr.aria-label]="s.listening ? 'Mute microphone' : 'Start listening'"
          >
            <span class="ring"></span>
            @if (s.listening) {
              <svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z" />
                <path d="M19 11a7 7 0 0 1-14 0M12 18v3" />
              </svg>
            } @else {
              <svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
                <path d="m3 3 18 18M9 9v3a3 3 0 0 0 5.1 2.1M15 9.3V6a3 3 0 0 0-5.7-1.3" />
                <path d="M19 11a7 7 0 0 1-1.2 3.9M5 11a7 7 0 0 0 11.2 5.6M12 18v3" />
              </svg>
            }
          </button>
          <div class="stack grow">
            <div class="spread">
              <h2>{{ listenLabel() }}</h2>
              @if (st.listenMode === 'push-to-talk') {
                <button class="btn small" (click)="hollr.api.armPushToTalk()">Talk ({{ st.hotkeys.pushToTalk }})</button>
              }
            </div>
            <div class="muted">
              Say <strong class="say">"{{ st.wakeWord }}, poll win or loss"</strong> · wake word must start the sentence
            </div>
            <hl-level-meter [level]="mic.level()" [live]="s.gateOpen" />
            <div class="transcript" [class.empty]="!hollr.partial()">{{ hollr.partial() || '…' }}</div>
          </div>
        </section>

        <section class="card status stack">
          <h3>Status</h3>
          <div class="row">
            <span class="chip" [class.ok]="s.auth.status === 'signed-in'" [class.bad]="s.auth.status !== 'signed-in'">
              Twitch {{ s.auth.user ? '· ' + s.auth.user.displayName : 'signed out' }}
            </span>
            <span class="chip" [class.ok]="s.stt.status === 'ready'" [class.warn]="s.stt.status === 'loading'" [class.bad]="s.stt.status === 'error'">
              Speech · {{ s.stt.status }}{{ s.stt.provider ? ' (' + s.stt.provider + ')' : '' }}
            </span>
            <span class="chip" [class.ok]="s.eventsub === 'connected'" [class.warn]="s.eventsub === 'connecting'" [class.bad]="s.eventsub === 'error'">
              Live events · {{ s.eventsub }}
            </span>
            <span class="chip" [class.ok]="s.chat === 'connected'" [class.warn]="s.chat === 'connecting'" [class.bad]="s.chat === 'error'">
              Chat bot · {{ s.chat }}
            </span>
          </div>
          <div class="row">
            <label class="check">
              <input type="checkbox" data-testid="dry-run" [checked]="st.dryRun" (change)="hollr.update({ dryRun: $any($event.target).checked })" />
              Dry run (log only, don't touch Twitch)
            </label>
            <label class="check">
              <input type="checkbox" [checked]="st.confirmMode" (change)="hollr.update({ confirmMode: $any($event.target).checked })" />
              Confirm mode ({{ st.confirmDelaySec }}s)
            </label>
            @if (hollr.cooldownLeft() > 0) {
              <span class="chip warn">Cooldown {{ hollr.cooldownLeft() }}s</span>
            }
          </div>
          @if (s.overlayUrl) {
            <div class="muted">
              OBS overlay: <code>{{ s.overlayUrl }}</code>
              <button class="btn small" (click)="hollr.api.openOverlay()">Preview</button>
            </div>
          }
        </section>

        @if (s.pending; as p) {
          <section class="card pending full">
            <div class="spread">
              <div>
                <h3>Firing in {{ pendingLeft() }}s</h3>
                <h2>{{ p.summary }}</h2>
              </div>
              <div class="row">
                <button class="btn primary" (click)="hollr.api.confirmPending()">Fire now</button>
                <button class="btn danger" (click)="hollr.api.cancelPending()">Cancel ({{ st.hotkeys.cancelPending }})</button>
              </div>
            </div>
          </section>
        }

        <section class="full">
          <hl-command-box [wakeWord]="st.wakeWord" />
        </section>

        @if (s.activePoll || s.lastPoll) {
          <section><hl-poll-card [poll]="s.activePoll ?? s.lastPoll" /></section>
        }
        @if (s.activePrediction) {
          <section><hl-prediction-card [prediction]="s.activePrediction" /></section>
        }

        <section class="card full logcard">
          <div class="spread">
            <h3>Activity</h3>
            <button class="btn small" (click)="hollr.api.openLogs()">Open log files</button>
          </div>
          <hl-activity-log [entries]="hollr.logs()" [wakeWord]="st.wakeWord" />
        </section>
      </div>
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 16px; }
    .grid { display: grid; grid-template-columns: 1.15fr 1fr; gap: 16px; }
    .full { grid-column: 1 / -1; }
    .grid > section { min-width: 0; }
    .listen { display: flex; gap: 22px; align-items: center; overflow: hidden; }
    .listen::before { content: ''; position: absolute; inset: -40% auto auto -10%; width: 340px; height: 340px; border-radius: 50%;
                      background: radial-gradient(circle, rgba(145,71,255,.18), transparent 65%); opacity: 0; transition: opacity .5s; pointer-events: none; }
    .listen.live::before { opacity: 1; }
    .listen.hot::before { background: radial-gradient(circle, rgba(52,211,153,.2), transparent 65%); opacity: 1; }
    .listen > * { position: relative; }
    .grow { flex: 1; min-width: 0; }
    .say { color: var(--fg); font-weight: 600; }
    .mic-btn { position: relative; display: grid; place-items: center; width: 96px; height: 96px; border-radius: 50%; flex-shrink: 0;
               border: 1px solid var(--border-strong); background: radial-gradient(circle at 30% 25%, rgba(255,255,255,.12), rgba(255,255,255,.03));
               color: var(--muted); cursor: pointer; transition: transform .2s var(--ease), color .2s, border-color .2s, box-shadow .3s; }
    .mic-btn:hover { transform: scale(1.04); color: var(--fg); }
    .mic-btn:focus-visible { outline: none; box-shadow: var(--ring); }
    .mic-btn.on { color: #fff; border-color: rgba(145,71,255,.7); background: var(--accent-grad); box-shadow: 0 14px 34px -10px rgba(145,71,255,.9); }
    .mic-btn.hot { border-color: rgba(52,211,153,.8); background: linear-gradient(135deg, #34d399, #059669); box-shadow: 0 14px 34px -10px rgba(52,211,153,.9); }
    .ring { position: absolute; inset: -6px; border-radius: 50%; border: 2px solid currentColor; opacity: 0; pointer-events: none; }
    .mic-btn.on .ring { border-color: rgba(145,71,255,.8); animation: pulse 2.6s var(--ease) infinite; }
    .mic-btn.hot .ring { border-color: rgba(52,211,153,.9); animation-duration: 1.2s; }
    @keyframes pulse { 0% { transform: scale(.92); opacity: .7; } 100% { transform: scale(1.35); opacity: 0; } }
    .transcript { font-size: 15px; min-height: 24px; padding: 8px 12px; border-radius: 10px; background: rgba(0,0,0,.25);
                  border: 1px solid var(--border); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .transcript.empty { color: var(--faint); }
    .status h3 { margin-bottom: -2px; }
    .status .row { gap: 8px; }
    .pending { border-color: rgba(251,191,36,.45); background: linear-gradient(180deg, rgba(251,191,36,.1), rgba(251,191,36,.03)); }
    .logcard { height: 340px; display: flex; flex-direction: column; gap: 10px; }
    .logcard hl-activity-log { flex: 1; min-height: 0; }
    @media (max-width: 860px) { .grid { grid-template-columns: 1fr; } }
  `,
})
export class DashboardPage {
  readonly hollr = inject(HollrService);
  readonly mic = inject(MicCaptureService);

  readonly listenLabel = computed(() => {
    const s = this.hollr.state();
    const st = this.hollr.settings();
    if (!s || !st) return '';
    if (!s.listening) return 'Muted';
    const notReady: Partial<Record<typeof s.stt.status, string>> = {
      'no-model': 'Speech model needed',
      downloading: 'Downloading speech model…',
      loading: 'Starting speech engine…',
      error: 'Speech engine error',
      stopped: 'Speech engine off',
    };
    if (s.stt.status !== 'ready') return notReady[s.stt.status] ?? '';
    if (st.listenMode === 'push-to-talk') return s.gateOpen ? 'Listening (push-to-talk)…' : 'Push-to-talk: press the hotkey';
    return 'Listening';
  });

  readonly pendingLeft = computed(() =>
    Math.max(0, Math.ceil(((this.hollr.state()?.pending?.firesAt ?? 0) - this.hollr.now()) / 1000)),
  );
}
