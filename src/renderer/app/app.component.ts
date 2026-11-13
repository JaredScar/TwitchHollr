import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { MicCaptureService } from './audio/mic-capture.service';
import { HollrService } from './core/hollr.service';

interface Banner {
  level: 'error' | 'warn' | 'info';
  text: string;
  action?: { label: string; run: () => void };
}

@Component({
  selector: 'hl-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <div class="shell">
      <nav>
        <div class="brand">📣 Hollr</div>
        <a routerLink="/dashboard" routerLinkActive="active">Dashboard</a>
        <a routerLink="/settings" routerLinkActive="active">Settings</a>
        <a routerLink="/onboarding" routerLinkActive="active">Setup guide</a>
        <div class="grow"></div>
        @if (hollr.settings()?.dryRun) {
          <span class="chip warn">Dry run</span>
        }
        <div class="muted version">v{{ hollr.info()?.version }}</div>
      </nav>
      <main>
        @for (b of banners(); track b.text) {
          <div class="banner" [class]="b.level">
            <span>{{ b.text }}</span>
            @if (b.action) {
              <button class="btn small" (click)="b.action.run()">{{ b.action.label }}</button>
            }
          </div>
        }
        <router-outlet />
      </main>
    </div>
  `,
  styles: `
    .shell { display: grid; grid-template-columns: 190px 1fr; height: 100vh; }
    nav { display: flex; flex-direction: column; gap: 4px; padding: 16px 12px; background: var(--panel); border-right: 1px solid var(--border); }
    .brand { font-size: 20px; font-weight: 800; padding: 4px 10px 16px; }
    nav a { color: var(--fg); text-decoration: none; padding: 8px 10px; border-radius: 8px; font-weight: 600; }
    nav a:hover { background: var(--panel-2); }
    nav a.active { background: var(--accent); }
    .grow { flex: 1; }
    .version { padding: 8px 10px 0; font-size: 12px; }
    nav .chip { align-self: flex-start; margin-left: 10px; }
    main { overflow-y: auto; padding: 20px 24px; display: flex; flex-direction: column; gap: 12px; }
  `,
})
export class AppComponent {
  readonly hollr = inject(HollrService);
  private readonly router = inject(Router);
  // Injected here so mic capture starts as soon as the app loads.
  private readonly mic = inject(MicCaptureService);

  readonly banners = computed<Banner[]>(() => {
    const s = this.hollr.state();
    const settings = this.hollr.settings();
    if (!s || !settings) return [];
    const out: Banner[] = [];
    const goSettings = { label: 'Fix', run: () => void this.router.navigate(['/settings']) };
    if (s.auth.status !== 'signed-in' && s.auth.status !== 'pending' && settings.onboardingComplete && !settings.dryRun) {
      out.push({
        level: 'error',
        text: s.auth.error ?? 'Not signed in to Twitch. Commands will be rejected until you sign in.',
        action: { label: 'Sign in', run: () => void this.router.navigate(['/settings']) },
      });
    }
    if (s.micError) out.push({ level: 'error', text: `Microphone: ${s.micError}`, action: goSettings });
    if (s.stt.status === 'error') out.push({ level: 'error', text: `Speech engine: ${s.stt.error}`, action: goSettings });
    if (s.stt.status === 'no-model' && settings.onboardingComplete && !this.hollr.info()?.e2e) {
      out.push({ level: 'warn', text: 'The speech model is not downloaded yet, so voice commands are off.', action: goSettings });
    }
    return out;
  });
}
