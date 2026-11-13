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
        <div class="brand">
          <span class="logo">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z" />
              <path d="M19 11a7 7 0 0 1-14 0M12 18v3" />
            </svg>
          </span>
          <span class="name">Hollr</span>
        </div>
        <div class="section-label">Menu</div>
        <a routerLink="/dashboard" routerLinkActive="active">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" />
            <rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" />
          </svg>
          Dashboard
        </a>
        <a routerLink="/settings" routerLinkActive="active">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 7h10M18 7h2M4 17h2M10 17h10" /><circle cx="16" cy="7" r="2" /><circle cx="8" cy="17" r="2" />
          </svg>
          Settings
        </a>
        <a routerLink="/onboarding" routerLinkActive="active">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="9" /><path d="m10 8 6 4-6 4V8Z" />
          </svg>
          Setup guide
        </a>
        <div class="grow"></div>
        @if (hollr.settings()?.dryRun) {
          <div class="dry">
            <span class="chip warn">Dry run</span>
            <span class="muted">Nothing is sent to Twitch</span>
          </div>
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
    .shell { display: grid; grid-template-columns: 224px 1fr; height: 100vh; }
    nav { display: flex; flex-direction: column; gap: 4px; padding: 20px 14px 16px; background: rgba(10, 10, 16, 0.55);
          border-right: 1px solid var(--border); backdrop-filter: blur(14px); }
    .brand { display: flex; align-items: center; gap: 10px; padding: 2px 10px 22px; }
    .logo { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 10px; color: #fff;
            background: var(--accent-grad); box-shadow: 0 8px 20px -6px rgba(145, 71, 255, 0.8), 0 1px 0 rgba(255,255,255,.3) inset; }
    .name { font-size: 20px; font-weight: 750; letter-spacing: -0.02em; }
    .section-label { font-size: 10.5px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; color: var(--faint); padding: 0 12px 6px; }
    nav a { position: relative; display: flex; align-items: center; gap: 12px; color: var(--muted); text-decoration: none;
            padding: 9px 12px; border-radius: 10px; font-weight: 600; transition: background .18s, color .18s; }
    nav a:hover { background: var(--panel-2); color: var(--fg); }
    nav a.active { background: rgba(145, 71, 255, 0.16); color: #fff; box-shadow: inset 0 0 0 1px rgba(145, 71, 255, 0.35); }
    nav a.active svg { color: var(--accent-2); }
    nav a.active::before { content: ''; position: absolute; left: -14px; top: 9px; bottom: 9px; width: 3px; border-radius: 0 3px 3px 0; background: var(--accent-grad); }
    .grow { flex: 1; }
    .dry { display: flex; flex-direction: column; gap: 6px; align-items: flex-start; padding: 12px; margin-bottom: 8px;
           border-radius: 12px; background: rgba(251, 191, 36, 0.07); border: 1px solid rgba(251, 191, 36, 0.2); font-size: 12px; }
    .version { padding: 4px 12px 0; font-size: 12px; }
    main { overflow-y: auto; padding: 28px 36px 40px; display: flex; flex-direction: column; gap: 16px; }
    main > * { width: 100%; max-width: 1100px; margin-inline: auto; }
    main > *:not(.banner) { display: block; }
    main > router-outlet { display: none; }
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
