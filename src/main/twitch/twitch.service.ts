import type { PollSpec, PollState, PollStatus, PredictionSpec, PredictionState, PredictionStatus } from '@shared/types';

const HELIX = 'https://api.twitch.tv/helix';

export class TwitchApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly twitchMessage = '',
  ) {
    super(message);
  }
}

export interface TwitchDeps {
  fetch: typeof fetch;
  clientId(): string;
  getAccessToken(): Promise<string>;
  /** Called on a 401; should refresh and resolve, or reject if the user must sign in again. */
  onUnauthorized(): Promise<unknown>;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

interface HelixPoll {
  id: string;
  title: string;
  choices: { id: string; title: string; votes: number; channel_points_votes?: number; bits_votes?: number }[];
  status: PollStatus;
  started_at: string;
  ended_at: string | null;
  duration: number;
}

interface HelixPrediction {
  id: string;
  title: string;
  status: PredictionStatus;
  winning_outcome_id: string | null;
  prediction_window: number;
  created_at: string;
  locked_at: string | null;
  outcomes: { id: string; title: string; color: string; users: number; channel_points: number }[];
}

export function mapPoll(p: HelixPoll): PollState {
  const endsAt = p.status === 'ACTIVE' ? new Date(Date.parse(p.started_at) + p.duration * 1000).toISOString() : null;
  return {
    id: p.id,
    title: p.title,
    status: p.status,
    choices: p.choices.map((c) => ({ id: c.id, title: c.title, votes: c.votes ?? 0 })),
    startedAt: p.started_at,
    endsAt,
    endedAt: p.ended_at,
  };
}

export function mapPrediction(p: HelixPrediction): PredictionState {
  return {
    id: p.id,
    title: p.title,
    status: p.status,
    winningOutcomeId: p.winning_outcome_id,
    locksAt:
      p.status === 'ACTIVE'
        ? new Date(Date.parse(p.created_at) + p.prediction_window * 1000).toISOString()
        : p.locked_at,
    outcomes: p.outcomes.map((o) => ({
      id: o.id,
      title: o.title,
      color: o.color,
      users: o.users ?? 0,
      channelPoints: o.channel_points ?? 0,
    })),
  };
}

/** Turn an HTTP failure into a message a streamer can act on. */
export function explainError(status: number, twitchMessage: string, what: string): string {
  const m = twitchMessage.toLowerCase();
  if (status === 401) return 'Your Twitch sign-in expired. Please sign in again.';
  if (status === 403) {
    return `Twitch refused to ${what}: polls and predictions need an Affiliate or Partner channel and the right permissions. Try signing out and back in.`;
  }
  if (status === 409 || (status === 400 && /active|already|in progress/.test(m))) {
    return `Couldn't ${what}: one is already running on your channel.`;
  }
  if (status === 400) return `Twitch rejected the request to ${what}: ${twitchMessage || 'invalid request'}.`;
  if (status === 404) return `Couldn't ${what}: Twitch couldn't find it (it may have already ended).`;
  if (status === 429) return 'Twitch is rate limiting requests. Wait a moment and try again.';
  if (status >= 500) return `Twitch is having trouble right now (HTTP ${status}). Try again shortly.`;
  return `Couldn't ${what} (HTTP ${status}${twitchMessage ? `: ${twitchMessage}` : ''}).`;
}

interface RequestOpts {
  query?: Record<string, string>;
  body?: unknown;
  what: string;
}

export class TwitchService {
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;

  constructor(private readonly deps: TwitchDeps) {
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.random = deps.random ?? Math.random;
  }

  async request<T>(method: string, path: string, opts: RequestOpts): Promise<T> {
    const url = new URL(HELIX + path);
    for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, v);

    let retriedServer = false;
    let retriedAuth = false;
    for (;;) {
      const token = await this.deps.getAccessToken();
      let res: Response;
      try {
        res = await this.deps.fetch(url, {
          method,
          headers: {
            Authorization: `Bearer ${token}`,
            'Client-Id': this.deps.clientId(),
            ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
          },
          body: opts.body ? JSON.stringify(opts.body) : undefined,
        });
      } catch {
        if (!retriedServer) {
          retriedServer = true;
          await this.sleep(250 + this.random() * 500);
          continue;
        }
        throw new TwitchApiError(`Couldn't reach Twitch to ${opts.what}. Check your internet connection.`, 0);
      }

      if (res.ok) {
        if (res.status === 204) return undefined as T;
        return (await res.json()) as T;
      }
      if (res.status === 401 && !retriedAuth) {
        retriedAuth = true;
        await this.deps.onUnauthorized();
        continue;
      }
      if (res.status >= 500 && !retriedServer) {
        retriedServer = true;
        await this.sleep(250 + this.random() * 500);
        continue;
      }
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      const tm = body.message ?? '';
      throw new TwitchApiError(explainError(res.status, tm, opts.what), res.status, tm);
    }
  }

  // ---- Polls ------------------------------------------------------------------

  async createPoll(
    broadcasterId: string,
    spec: PollSpec,
    channelPoints?: { enabled: boolean; perVote: number },
  ): Promise<PollState> {
    const res = await this.request<{ data: HelixPoll[] }>('POST', '/polls', {
      what: 'start the poll',
      body: {
        broadcaster_id: broadcasterId,
        title: spec.title,
        choices: spec.choices.map((title) => ({ title })),
        duration: spec.durationSec,
        ...(channelPoints?.enabled
          ? { channel_points_voting_enabled: true, channel_points_per_vote: channelPoints.perVote }
          : {}),
      },
    });
    return mapPoll(res.data[0]!);
  }

  async endPoll(broadcasterId: string, id: string, status: 'TERMINATED' | 'ARCHIVED'): Promise<PollState> {
    const res = await this.request<{ data: HelixPoll[] }>('PATCH', '/polls', {
      what: status === 'TERMINATED' ? 'end the poll' : 'cancel the poll',
      body: { broadcaster_id: broadcasterId, id, status },
    });
    return mapPoll(res.data[0]!);
  }

  async getActivePoll(broadcasterId: string): Promise<PollState | null> {
    const res = await this.request<{ data: HelixPoll[] }>('GET', '/polls', {
      what: 'check the current poll',
      query: { broadcaster_id: broadcasterId, first: '1' },
    });
    const p = res.data[0];
    return p && p.status === 'ACTIVE' ? mapPoll(p) : null;
  }

  // ---- Predictions ------------------------------------------------------------

  async createPrediction(broadcasterId: string, spec: PredictionSpec): Promise<PredictionState> {
    const res = await this.request<{ data: HelixPrediction[] }>('POST', '/predictions', {
      what: 'start the prediction',
      body: {
        broadcaster_id: broadcasterId,
        title: spec.title,
        outcomes: spec.outcomes.map((title) => ({ title })),
        prediction_window: spec.windowSec,
      },
    });
    return mapPrediction(res.data[0]!);
  }

  async endPrediction(
    broadcasterId: string,
    id: string,
    status: 'RESOLVED' | 'CANCELED' | 'LOCKED',
    winningOutcomeId?: string,
  ): Promise<PredictionState> {
    const what = { RESOLVED: 'resolve the prediction', CANCELED: 'cancel the prediction', LOCKED: 'lock the prediction' }[
      status
    ];
    const res = await this.request<{ data: HelixPrediction[] }>('PATCH', '/predictions', {
      what,
      body: {
        broadcaster_id: broadcasterId,
        id,
        status,
        ...(winningOutcomeId ? { winning_outcome_id: winningOutcomeId } : {}),
      },
    });
    return mapPrediction(res.data[0]!);
  }

  async getActivePrediction(broadcasterId: string): Promise<PredictionState | null> {
    const res = await this.request<{ data: HelixPrediction[] }>('GET', '/predictions', {
      what: 'check the current prediction',
      query: { broadcaster_id: broadcasterId, first: '1' },
    });
    const p = res.data[0];
    return p && (p.status === 'ACTIVE' || p.status === 'LOCKED') ? mapPrediction(p) : null;
  }

  // ---- EventSub & chat ----------------------------------------------------------

  async subscribe(type: string, version: string, condition: Record<string, string>, sessionId: string): Promise<void> {
    await this.request('POST', '/eventsub/subscriptions', {
      what: `subscribe to ${type}`,
      body: { type, version, condition, transport: { method: 'websocket', session_id: sessionId } },
    });
  }

  async sendChatMessage(broadcasterId: string, senderId: string, message: string, replyTo?: string): Promise<void> {
    await this.request('POST', '/chat/messages', {
      what: 'send a chat message',
      body: {
        broadcaster_id: broadcasterId,
        sender_id: senderId,
        message: message.slice(0, 500),
        ...(replyTo ? { reply_parent_message_id: replyTo } : {}),
      },
    });
  }
}
