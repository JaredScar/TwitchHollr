import { describe, expect, it, vi } from 'vitest';
import { TwitchApiError, TwitchService, explainError } from '../../src/main/twitch/twitch.service';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

const helixPoll = {
  id: 'p1',
  title: 'Win or Loss?',
  status: 'ACTIVE',
  duration: 90,
  started_at: '2026-01-01T00:00:00Z',
  ended_at: null,
  choices: [
    { id: 'c1', title: 'Win', votes: 0 },
    { id: 'c2', title: 'Loss', votes: 0 },
  ],
};

function service(responses: (Response | Error)[]) {
  const fetch = vi.fn(async () => {
    const next = responses.shift();
    if (!next) throw new Error('no more responses');
    if (next instanceof Error) throw next;
    return next;
  });
  const onUnauthorized = vi.fn(async () => undefined);
  const svc = new TwitchService({
    fetch: fetch as unknown as typeof globalThis.fetch,
    clientId: () => 'cid',
    getAccessToken: async () => 'token',
    onUnauthorized,
    sleep: async () => undefined,
  });
  return { svc, fetch, onUnauthorized };
}

describe('TwitchService', () => {
  it('creates a poll with the right body and headers', async () => {
    const { svc, fetch } = service([json(200, { data: [helixPoll] })]);
    const poll = await svc.createPoll('42', { title: 'Win or Loss?', choices: ['Win', 'Loss'], durationSec: 90 }, {
      enabled: true,
      perVote: 50,
    });
    expect(poll).toMatchObject({ id: 'p1', status: 'ACTIVE', endsAt: '2026-01-01T00:01:30.000Z' });
    const [url, init] = fetch.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toBe('https://api.twitch.tv/helix/polls');
    expect((init.headers as Record<string, string>)['Client-Id']).toBe('cid');
    expect(JSON.parse(init.body as string)).toEqual({
      broadcaster_id: '42',
      title: 'Win or Loss?',
      choices: [{ title: 'Win' }, { title: 'Loss' }],
      duration: 90,
      channel_points_voting_enabled: true,
      channel_points_per_vote: 50,
    });
  });

  it('retries once on 5xx', async () => {
    const { svc, fetch } = service([json(503, {}), json(200, { data: [helixPoll] })]);
    await svc.getActivePoll('42');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('retries once on a network error, then gives a clear message', async () => {
    const { svc, fetch } = service([new TypeError('fetch failed'), new TypeError('fetch failed')]);
    await expect(svc.getActivePoll('42')).rejects.toThrow(/Couldn't reach Twitch/);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('never retries a 4xx', async () => {
    const { svc, fetch } = service([json(400, { message: 'poll already active' })]);
    const err = await svc.createPoll('42', { title: 't', choices: ['a', 'b'], durationSec: 30 }).catch((e) => e);
    expect(err).toBeInstanceOf(TwitchApiError);
    expect(err.message).toMatch(/already running/);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('refreshes once on 401 and retries', async () => {
    const { svc, fetch, onUnauthorized } = service([json(401, {}), json(200, { data: [] })]);
    expect(await svc.getActivePoll('42')).toBeNull();
    expect(onUnauthorized).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('explains common errors', () => {
    expect(explainError(403, '', 'start the poll')).toMatch(/Affiliate or Partner/);
    expect(explainError(401, '', 'x')).toMatch(/sign in again/);
    expect(explainError(429, '', 'x')).toMatch(/rate limiting/);
    expect(explainError(400, 'The parameter "title" was malformed', 'start the poll')).toMatch(/malformed/);
  });
});
