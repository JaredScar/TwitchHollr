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
      <div class="grid">
        <section class="card listen">
          <button
            class="mic-btn"
            [class.on]="s.listening"
            [class.hot]="s.gateOpen"
            (click)="hollr.api.setListening(!s.listening)"
            [title]="s.listening ? 'Click to mute' : 'Click to listen'"
          >
            {{ s.listening ? '🎙️' : '🔇' }}
          </button>
          <div class="stack grow">
            <div class="spread">
              <h2>{{ listenLabel() }}</h2>
              @if (st.listenMode === 'push-to-talk') {
                <button class="btn small" (click)="hollr.api.armPushToTalk()">Talk ({{ st.hotkeys.pushToTalk }})</button>
              }
            </div>
            <div class="muted">
              Say <strong>"{{ st.wakeWord }}, poll win or loss"</strong> · wake word must start the sentence
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
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .full { grid-column: 1 / -1; }
    .listen { display: flex; gap: 16px; align-items: center; }
    .grow { flex: 1; }
    .mic-btn { width: 88px; height: 88px; border-radius: 50%; border: 3px solid var(--border); background: var(--panel-2);
               font-size: 36px; cursor: pointer; transition: all .2s; flex-shrink: 0; }
    .mic-btn.on { border-color: var(--accent); }
    .mic-btn.hot { border-color: var(--green); box-shadow: 0 0 0 6px rgba(46,204,113,.15); }
    .transcript { font-size: 16px; font-style: italic; min-height: 24px; }
    .transcript.empty { color: var(--muted); }
    .pending { border-color: var(--amber); }
    .logcard { height: 340px; display: flex; flex-direction: column; }
    .logcard hl-activity-log { flex: 1; min-height: 0; }
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
