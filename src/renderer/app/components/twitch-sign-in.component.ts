import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { HollrService } from '../core/hollr.service';

@Component({
  selector: 'hl-twitch-sign-in',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let a = auth();
    @if (a) {
      @if (a.status === 'signed-in' && a.user) {
        <div class="spread">
          <div class="row">
            <img class="avatar" [src]="a.user.profileImageUrl" alt="" />
            <div>
              <strong>{{ a.user.displayName }}</strong>
              <div class="muted">{{ a.user.broadcasterType || 'not affiliate' }}</div>
            </div>
          </div>
          <button class="btn" (click)="hollr.api.signOut()">Sign out</button>
        </div>
        @if (!a.eligible) {
          <p class="banner warn">
            Twitch only allows polls and predictions on Affiliate or Partner channels. You can still test everything
            with dry run.
          </p>
        }
      } @else if (a.status === 'pending' && a.device) {
        <div class="stack">
          <div>Enter this code at <strong>twitch.tv/activate</strong>:</div>
          <div class="code">{{ a.device.userCode }}</div>
          <div class="row">
            <button class="btn primary" (click)="hollr.api.openActivation()">Open twitch.tv/activate</button>
            <button class="btn" (click)="hollr.api.cancelSignIn()">Cancel</button>
            <span class="muted">Expires in {{ expiresIn() }}</span>
          </div>
        </div>
      } @else {
        <div class="stack">
          @if (!a.clientIdConfigured) {
            <p class="banner error">
              No Twitch Client ID is configured. Add one under Settings → Advanced (or build with
              MAIN_VITE_TWITCH_CLIENT_ID).
            </p>
          }
          @if (a.error) {
            <p class="banner error">{{ a.error }}</p>
          }
          <div class="row">
            <button class="btn primary" [disabled]="!a.clientIdConfigured" (click)="hollr.api.startSignIn()">
              Sign in with Twitch
            </button>
            <span class="muted">Hollr asks for permission to manage polls/predictions and read/send chat.</span>
          </div>
        </div>
      }
    }
  `,
  styles: `
    .avatar { width: 40px; height: 40px; border-radius: 50%; }
    .code { font-size: 32px; font-weight: 800; letter-spacing: .18em; font-family: 'Cascadia Code', Consolas, monospace; }
    p { margin: 8px 0 0; }
  `,
})
export class TwitchSignInComponent {
  readonly hollr = inject(HollrService);
  readonly auth = computed(() => this.hollr.state()?.auth ?? null);
  readonly expiresIn = computed(() => {
    const at = this.auth()?.device?.expiresAt ?? 0;
    const s = Math.max(0, Math.round((at - this.hollr.now()) / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  });
}
