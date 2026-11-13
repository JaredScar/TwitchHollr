import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ActivityLogComponent } from '../../components/activity-log.component';
import { CommandBoxComponent } from '../../components/command-box.component';
import { MicPickerComponent } from '../../components/mic-picker.component';
import { ModelPanelComponent } from '../../components/model-panel.component';
import { TwitchSignInComponent } from '../../components/twitch-sign-in.component';
import { HollrService } from '../../core/hollr.service';

type Step = 0 | 1 | 2 | 3;

@Component({
  selector: 'hl-onboarding',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TwitchSignInComponent, MicPickerComponent, ModelPanelComponent, CommandBoxComponent, ActivityLogComponent],
  template: `
    @let s = hollr.state();
    @let st = hollr.settings();
    @if (s && st) {
      <div class="wrap stack">
        <h1>Welcome to Hollr</h1>
        <p class="muted">Run Twitch polls and predictions with your voice. About two minutes to set up.</p>

        <ol class="steps">
          @for (label of labels; track $index) {
            <li [class.done]="$index < step()" [class.current]="$index === step()" (click)="go($any($index))">{{ label }}</li>
          }
        </ol>

        <section class="card stack">
          @switch (step()) {
            @case (0) {
              <h2>1. Sign in with Twitch</h2>
              <hl-twitch-sign-in />
            }
            @case (1) {
              <h2>2. Pick your microphone</h2>
              <hl-mic-picker />
            }
            @case (2) {
              <h2>3. Download the speech model</h2>
              <p class="muted">Speech recognition runs on this PC. The default model is about 70 MB.</p>
              <hl-model-panel />
            }
            @case (3) {
              <h2>4. Try it (dry run)</h2>
              <p>
                Say <strong>"{{ st.wakeWord }}, poll yes or no"</strong>. Dry run is on, so nothing is sent to Twitch; watch
                the log below. You can also type a command.
              </p>
              <div class="transcript">{{ hollr.partial() || (s.gateOpen ? 'Listening…' : 'Speech engine: ' + s.stt.status) }}</div>
              <hl-command-box [wakeWord]="st.wakeWord" />
              <div class="log"><hl-activity-log [entries]="recentLogs()" [wakeWord]="st.wakeWord" /></div>
              @if (testPassed()) {
                <div class="banner info">It works! Hollr understood your command.</div>
              }
              <label class="check">
                <input type="checkbox" [checked]="keepDryRun()" (change)="keepDryRun.set($any($event.target).checked)" />
                Keep dry run on after setup
              </label>
            }
          }
        </section>

        <div class="spread">
          <button class="btn" [disabled]="step() === 0" (click)="go($any(step() - 1))">Back</button>
          <div class="row">
            <button class="btn" (click)="finish()">Skip setup</button>
            @if (step() < 3) {
              <button class="btn primary" (click)="go($any(step() + 1))">{{ canAdvance() ? 'Next' : 'Skip this step' }}</button>
            } @else {
              <button class="btn primary" (click)="finish()">Finish</button>
            }
          </div>
        </div>
      </div>
    }
  `,
  styles: `
    .wrap { max-width: 760px; margin: 0 auto; width: 100%; gap: 18px; }
    .steps { display: flex; gap: 10px; list-style: none; padding: 0; margin: 0; counter-reset: s; }
    .steps li { flex: 1; display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 12px; background: var(--panel);
                border: 1px solid var(--border); cursor: pointer; font-weight: 600; color: var(--muted); counter-increment: s;
                transition: border-color .18s, background .18s, color .18s; }
    .steps li::before { content: counter(s); display: grid; place-items: center; width: 22px; height: 22px; border-radius: 50%; font-size: 12px;
                        background: var(--panel-3); color: var(--fg); flex-shrink: 0; }
    .steps li:hover { background: var(--panel-2); }
    .steps li.current { border-color: rgba(145,71,255,.7); background: rgba(145,71,255,.14); color: var(--fg); }
    .steps li.current::before { background: var(--accent-grad); }
    .steps li.done { color: var(--green); }
    .steps li.done::before { content: '✓'; background: rgba(52,211,153,.18); color: var(--green); }
    .transcript { font-size: 16px; min-height: 28px; padding: 10px 14px; border-radius: 10px; background: rgba(0,0,0,.25); border: 1px solid var(--border); }
    .log { height: 200px; }
  `,
})
export class OnboardingPage {
  readonly hollr = inject(HollrService);
  private readonly router = inject(Router);
  readonly labels = ['Twitch', 'Microphone', 'Speech model', 'Test'];
  readonly step = signal<Step>(0);
  readonly keepDryRun = signal(false);
  private startedAt = Date.now();
  private previousDryRun: boolean | null = null;

  readonly canAdvance = computed(() => {
    const s = this.hollr.state();
    if (!s) return false;
    switch (this.step()) {
      case 0:
        return s.auth.status === 'signed-in';
      case 1:
        return !s.micError;
      case 2:
        return s.models.some((m) => m.installed && m.engine === this.hollr.settings()?.stt.engine);
      default:
        return true;
    }
  });

  readonly recentLogs = computed(() => this.hollr.logs().filter((e) => e.ts >= this.startedAt && e.source !== 'system'));
  readonly testPassed = computed(() => this.recentLogs().some((e) => e.stage === 'result' && e.level === 'success'));

  async go(step: Step): Promise<void> {
    if (step < 0 || step > 3) return;
    if (step === 3 && this.previousDryRun === null) {
      this.previousDryRun = this.hollr.settings()?.dryRun ?? false;
      this.keepDryRun.set(this.previousDryRun);
      this.startedAt = Date.now();
      await this.hollr.update({ dryRun: true });
    }
    this.step.set(step);
  }

  async finish(): Promise<void> {
    const dryRun = this.previousDryRun === null ? (this.hollr.settings()?.dryRun ?? false) : this.keepDryRun();
    await this.hollr.update({ onboardingComplete: true, dryRun });
    await this.router.navigate(['/dashboard']);
  }
}
