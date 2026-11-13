import { describe, expect, it, vi } from 'vitest';
import { AuthService, TWITCH_SCOPES } from '../../src/main/auth/auth.service';
import { MemoryTokenStore } from '../../src/main/store/token-store';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const user = {
  data: [{ id: '42', login: 'streamer', display_name: 'Streamer', broadcaster_type: 'affiliate', profile_image_url: '' }],
};

function routeFetch(handlers: Record<string, (init?: RequestInit) => Response | Promise<Response>>) {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const key = Object.keys(handlers).find((k) => url.includes(k));
    if (!key) throw new Error(`unexpected fetch ${url}`);
    return handlers[key]!(init);
  });
}

describe('AuthService', () => {
  it('runs the device code flow, handling authorization_pending and slow_down', async () => {
    let polls = 0;
    const store = new MemoryTokenStore();
    const fetch = routeFetch({
      '/oauth2/device': () =>
        json(200, { device_code: 'dc', user_code: 'ABCD-1234', verification_uri: 'https://www.twitch.tv/activate', expires_in: 1800, interval: 5 }),
      '/oauth2/token': () => {
        polls++;
        if (polls === 1) return json(400, { status: 400, message: 'authorization_pending' });
        if (polls === 2) return json(400, { status: 400, message: 'slow_down' });
        return json(200, { access_token: 'at', refresh_token: 'rt', expires_in: 14000, scope: [...TWITCH_SCOPES] });
      },
      '/helix/users': () => json(200, user),
    });
    const sleeps: number[] = [];
    const states: string[] = [];
    const auth = new AuthService({
      fetch,
      store,
      clientId: () => 'cid',
      onChange: (s) => states.push(s.status),
      sleep: async (ms) => void sleeps.push(ms),
    });
    await auth.startDeviceFlow();
    expect(sleeps).toEqual([5000, 5000, 10000]);
    expect(store.load()?.refreshToken).toBe('rt');
    expect(auth.state).toMatchObject({ status: 'signed-in', eligible: true, user: { id: '42' } });
    expect(states).toContain('pending');
  });

  it('requests exactly the needed scopes as a public client (no secret)', async () => {
    const fetch = routeFetch({
      '/oauth2/device': () => json(500, {}),
    });
    const auth = new AuthService({ fetch, store: new MemoryTokenStore(), clientId: () => 'cid', onChange: () => {} });
    await expect(auth.startDeviceFlow()).rejects.toThrow();
    const body = fetch.mock.calls[0]![1]!.body as URLSearchParams;
    expect(body.get('scopes')).toBe(TWITCH_SCOPES.join(' '));
    expect(body.has('client_secret')).toBe(false);
  });

  it('shares one refresh between concurrent callers and saves the rotated token', async () => {
    const store = new MemoryTokenStore({ accessToken: 'old', refreshToken: 'r1', expiresAt: 0, scopes: [] });
    const save = vi.spyOn(store, 'save');
    let refreshCalls = 0;
    const fetch = routeFetch({
      '/oauth2/token': async (init) => {
        refreshCalls++;
        expect((init!.body as URLSearchParams).get('refresh_token')).toBe('r1');
        await new Promise((r) => setTimeout(r, 5));
        return json(200, { access_token: 'new', refresh_token: 'r2', expires_in: 14000 });
      },
    });
    const auth = new AuthService({ fetch, store, clientId: () => 'cid', onChange: () => {} });
    const tokens = await Promise.all([auth.getAccessToken(), auth.getAccessToken(), auth.getAccessToken()]);
    expect(tokens).toEqual(['new', 'new', 'new']);
    expect(refreshCalls).toBe(1);
    expect(save).toHaveBeenCalledOnce();
    expect(store.load()?.refreshToken).toBe('r2');
  });

  it('signs out when the refresh token is rejected', async () => {
    const store = new MemoryTokenStore({ accessToken: 'old', refreshToken: 'used', expiresAt: 0, scopes: [] });
    const fetch = routeFetch({ '/oauth2/token': () => json(400, { message: 'Invalid refresh token' }) });
    const auth = new AuthService({ fetch, store, clientId: () => 'cid', onChange: () => {} });
    await expect(auth.getAccessToken()).rejects.toThrow(/expired/);
    expect(store.load()).toBeNull();
    expect(auth.state.status).toBe('signed-out');
  });

  it('validate refreshes on 401 and flags missing scopes', async () => {
    const store = new MemoryTokenStore({ accessToken: 'a', refreshToken: 'r', expiresAt: Date.now() + 1e7, scopes: [] });
    let validations = 0;
    const fetch = routeFetch({
      '/oauth2/validate': () => (++validations === 1 ? json(401, {}) : json(200, { scopes: ['channel:manage:polls'] })),
      '/oauth2/token': () => json(200, { access_token: 'b', refresh_token: 'r2', expires_in: 14000 }),
    });
    const auth = new AuthService({ fetch, store, clientId: () => 'cid', onChange: () => {} });
    expect(await auth.validate()).toBe(false);
    expect(store.load()?.accessToken).toBe('b');
    expect(auth.state.error).toMatch(/new Twitch permissions/);
  });

  it('flags non-affiliate channels as ineligible', async () => {
    const store = new MemoryTokenStore({ accessToken: 'a', refreshToken: 'r', expiresAt: Date.now() + 1e7, scopes: [] });
    const fetch = routeFetch({
      '/oauth2/validate': () => json(200, { scopes: [...TWITCH_SCOPES] }),
      '/helix/users': () => json(200, { data: [{ ...user.data[0], broadcaster_type: '' }] }),
    });
    const auth = new AuthService({ fetch, store, clientId: () => 'cid', onChange: () => {} });
    await auth.init();
    auth.dispose();
    expect(auth.state).toMatchObject({ status: 'signed-in', eligible: false });
  });
});
