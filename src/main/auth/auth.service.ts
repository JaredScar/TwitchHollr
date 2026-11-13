import type { AuthState, TwitchUser } from '@shared/types';
import type { StoredTokens, TokenStore } from '../store/token-store';

export const TWITCH_SCOPES = [
  'channel:manage:polls',
  'channel:manage:predictions',
  'user:read:chat',
  'user:write:chat',
] as const;

const ID_BASE = 'https://id.twitch.tv/oauth2';
const HELIX_BASE = 'https://api.twitch.tv/helix';
const VALIDATE_INTERVAL_MS = 60 * 60 * 1000;
const REFRESH_SKEW_MS = 60 * 1000;

export class AuthError extends Error {}

interface Logger {
  info(...a: unknown[]): void;
  warn(...a: unknown[]): void;
  error(...a: unknown[]): void;
}

export interface AuthDeps {
  fetch: typeof fetch;
  store: TokenStore;
  clientId(): string;
  onChange(state: AuthState): void;
  log?: Logger;
  now?: () => number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope?: string[];
}

const abortableSleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new AuthError('Sign-in cancelled.'));
    });
  });

const silent: Logger = { info: () => {}, warn: () => {}, error: () => {} };

export class AuthService {
  private _state: AuthState;
  private refreshing: Promise<StoredTokens> | null = null;
  private deviceAbort: AbortController | null = null;
  private validateTimer: ReturnType<typeof setInterval> | null = null;
  private readonly now: () => number;
  private readonly sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  private readonly log: Logger;

  constructor(private readonly deps: AuthDeps) {
    this.now = deps.now ?? Date.now;
    this.sleep = deps.sleep ?? abortableSleep;
    this.log = deps.log ?? silent;
    this._state = {
      status: 'signed-out',
      user: null,
      eligible: false,
      device: null,
      error: null,
      clientIdConfigured: Boolean(deps.clientId()),
    };
  }

  get state(): AuthState {
    return this._state;
  }

  get user(): TwitchUser | null {
    return this._state.user;
  }

  get clientId(): string {
    return this.deps.clientId();
  }

  /** Re-emit state after the configured Client ID changes. */
  notifyConfigChanged(): void {
    this.set({});
  }

  private set(patch: Partial<AuthState>): void {
    this._state = { ...this._state, clientIdConfigured: Boolean(this.deps.clientId()), ...patch };
    this.deps.onChange(this._state);
  }

  /** Restore a saved session and start the hourly validation loop Twitch requires. */
  async init(): Promise<void> {
    this.set({});
    if (this.deps.store.load()) {
      try {
        if (await this.validate()) await this.loadUser();
      } catch (err) {
        this.log.warn('Session restore failed', err);
      }
    }
    this.validateTimer ??= setInterval(() => void this.validate().catch(() => undefined), VALIDATE_INTERVAL_MS);
  }

  dispose(): void {
    if (this.validateTimer) clearInterval(this.validateTimer);
    this.validateTimer = null;
    this.deviceAbort?.abort();
  }

  // ---- Device Code Grant Flow -------------------------------------------------

  async startDeviceFlow(): Promise<void> {
    const clientId = this.deps.clientId();
    if (!clientId) {
      this.set({ status: 'error', error: 'No Twitch Client ID configured. Add one in Settings → Advanced.' });
      throw new AuthError('No Twitch Client ID configured.');
    }
    this.deviceAbort?.abort();
    const abort = new AbortController();
    this.deviceAbort = abort;

    const scopes = TWITCH_SCOPES.join(' ');
    const res = await this.deps.fetch(`${ID_BASE}/device`, {
      method: 'POST',
      body: new URLSearchParams({ client_id: clientId, scopes }),
    });
    if (!res.ok) {
      const msg = `Twitch rejected the sign-in request (HTTP ${res.status}). Check the Client ID.`;
      this.set({ status: 'error', error: msg, device: null });
      throw new AuthError(msg);
    }
    const device = (await res.json()) as {
      device_code: string;
      user_code: string;
      verification_uri: string;
      expires_in: number;
      interval: number;
    };
    const expiresAt = this.now() + device.expires_in * 1000;
    this.set({
      status: 'pending',
      error: null,
      device: { userCode: device.user_code, verificationUri: device.verification_uri, expiresAt },
    });

    let interval = Math.max(1, device.interval) * 1000;
    try {
      while (this.now() < expiresAt) {
        await this.sleep(interval, abort.signal);
        const tokenRes = await this.deps.fetch(`${ID_BASE}/token`, {
          method: 'POST',
          body: new URLSearchParams({
            client_id: clientId,
            scopes,
            device_code: device.device_code,
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          }),
          signal: abort.signal,
        });
        if (tokenRes.ok) {
          this.saveTokens((await tokenRes.json()) as TokenResponse);
          this.set({ device: null });
          await this.loadUser();
          return;
        }
        const body = (await tokenRes.json().catch(() => ({}))) as { message?: string };
        const message = body.message ?? '';
        if (message === 'authorization_pending') continue;
        if (message === 'slow_down') {
          interval += 5000;
          continue;
        }
        if (message.includes('denied')) throw new AuthError('Sign-in was denied on Twitch.');
        throw new AuthError(`Sign-in failed: ${message || `HTTP ${tokenRes.status}`}`);
      }
      throw new AuthError('The sign-in code expired. Please try again.');
    } catch (err) {
      if (abort.signal.aborted) {
        this.set({ status: 'signed-out', device: null, error: null });
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      this.set({ status: 'error', device: null, error: msg });
      throw err;
    } finally {
      if (this.deviceAbort === abort) this.deviceAbort = null;
    }
  }

  cancelDeviceFlow(): void {
    this.deviceAbort?.abort();
  }

  // ---- Tokens -----------------------------------------------------------------

  private saveTokens(t: TokenResponse): StoredTokens {
    const tokens: StoredTokens = {
      accessToken: t.access_token,
      refreshToken: t.refresh_token,
      expiresAt: this.now() + t.expires_in * 1000,
      scopes: t.scope ?? [],
    };
    this.deps.store.save(tokens);
    return tokens;
  }

  async getAccessToken(): Promise<string> {
    const tokens = this.deps.store.load();
    if (!tokens) throw new AuthError('Not signed in to Twitch.');
    if (tokens.expiresAt - this.now() < REFRESH_SKEW_MS) return (await this.refresh()).accessToken;
    return tokens.accessToken;
  }

  /**
   * Refresh the access token. Public-client refresh tokens are single-use, so concurrent callers share one
   * in-flight request and the new pair is persisted before anyone uses it.
   */
  refresh(): Promise<StoredTokens> {
    this.refreshing ??= this.doRefresh().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async doRefresh(): Promise<StoredTokens> {
    const current = this.deps.store.load();
    if (!current) throw new AuthError('Not signed in to Twitch.');
    const res = await this.deps.fetch(`${ID_BASE}/token`, {
      method: 'POST',
      body: new URLSearchParams({
        client_id: this.deps.clientId(),
        grant_type: 'refresh_token',
        refresh_token: current.refreshToken,
      }),
    });
    if (res.status === 400 || res.status === 401) {
      this.deps.store.clear();
      this.set({
        status: 'signed-out',
        user: null,
        eligible: false,
        error: 'Your Twitch session expired. Please sign in again.',
      });
      throw new AuthError('Your Twitch session expired. Please sign in again.');
    }
    if (!res.ok) throw new AuthError(`Couldn't refresh the Twitch session (HTTP ${res.status}).`);
    return this.saveTokens((await res.json()) as TokenResponse);
  }

  /** GET /oauth2/validate. Returns false when signed out. Network errors keep the current state. */
  async validate(): Promise<boolean> {
    const tokens = this.deps.store.load();
    if (!tokens) return false;
    let res: Response;
    try {
      res = await this.deps.fetch(`${ID_BASE}/validate`, {
        headers: { Authorization: `OAuth ${tokens.accessToken}` },
      });
    } catch (err) {
      this.log.warn('Token validation skipped (network error)', err);
      return true;
    }
    if (res.status === 401) {
      try {
        await this.refresh();
        return this.validate();
      } catch {
        return false;
      }
    }
    if (!res.ok) return true;
    const body = (await res.json()) as { scopes?: string[] };
    const missing = TWITCH_SCOPES.filter((s) => !(body.scopes ?? []).includes(s));
    if (missing.length) {
      this.set({ status: 'error', error: `Hollr needs new Twitch permissions (${missing.join(', ')}). Sign in again.` });
      return false;
    }
    return true;
  }

  private async loadUser(): Promise<void> {
    const token = await this.getAccessToken();
    const res = await this.deps.fetch(`${HELIX_BASE}/users`, {
      headers: { Authorization: `Bearer ${token}`, 'Client-Id': this.deps.clientId() },
    });
    if (!res.ok) throw new AuthError(`Couldn't load your Twitch profile (HTTP ${res.status}).`);
    const body = (await res.json()) as {
      data: { id: string; login: string; display_name: string; broadcaster_type: string; profile_image_url: string }[];
    };
    const u = body.data[0];
    if (!u) throw new AuthError('Twitch returned no user for this token.');
    const user: TwitchUser = {
      id: u.id,
      login: u.login,
      displayName: u.display_name,
      broadcasterType: (u.broadcaster_type as TwitchUser['broadcasterType']) || '',
      profileImageUrl: u.profile_image_url,
    };
    const eligible = user.broadcasterType === 'affiliate' || user.broadcasterType === 'partner';
    this.set({ status: 'signed-in', user, eligible, error: null, device: null });
    this.log.info(`Signed in as ${user.login} (${user.broadcasterType || 'not affiliate'})`);
  }

  async signOut(): Promise<void> {
    const tokens = this.deps.store.load();
    this.deps.store.clear();
    this.set({ status: 'signed-out', user: null, eligible: false, error: null, device: null });
    if (tokens) {
      await this.deps
        .fetch(`${ID_BASE}/revoke`, {
          method: 'POST',
          body: new URLSearchParams({ client_id: this.deps.clientId(), token: tokens.accessToken }),
        })
        .catch(() => undefined);
    }
  }
}
