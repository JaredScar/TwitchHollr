import type { PollState, PollStatus, PredictionState, PredictionStatus } from '@shared/types';

export interface PollEvent {
  id: string;
  title: string;
  choices: { id: string; title: string; votes?: number }[];
  started_at: string;
  ends_at?: string;
  ended_at?: string;
  status?: 'completed' | 'archived' | 'terminated';
}

export interface PredictionEvent {
  id: string;
  title: string;
  outcomes: { id: string; title: string; color: string; users?: number; channel_points?: number }[];
  started_at: string;
  locks_at?: string;
  locked_at?: string;
  ended_at?: string;
  winning_outcome_id?: string | null;
  status?: 'resolved' | 'canceled';
}

export interface ChatMessageEvent {
  broadcaster_user_id: string;
  chatter_user_id: string;
  chatter_user_login: string;
  chatter_user_name: string;
  message_id: string;
  message: { text: string };
  badges: { set_id: string; id: string }[];
}

export function pollFromEvent(e: PollEvent, ended: boolean): PollState {
  const status: PollStatus = ended ? ((e.status ?? 'completed').toUpperCase() as PollStatus) : 'ACTIVE';
  return {
    id: e.id,
    title: e.title,
    status,
    choices: e.choices.map((c) => ({ id: c.id, title: c.title, votes: c.votes ?? 0 })),
    startedAt: e.started_at,
    endsAt: ended ? null : (e.ends_at ?? null),
    endedAt: e.ended_at ?? null,
  };
}

export function predictionFromEvent(e: PredictionEvent, phase: 'begin' | 'progress' | 'lock' | 'end'): PredictionState {
  const status: PredictionStatus =
    phase === 'end' ? (e.status === 'canceled' ? 'CANCELED' : 'RESOLVED') : phase === 'lock' ? 'LOCKED' : 'ACTIVE';
  return {
    id: e.id,
    title: e.title,
    status,
    locksAt: e.locks_at ?? e.locked_at ?? null,
    winningOutcomeId: e.winning_outcome_id ?? null,
    outcomes: e.outcomes.map((o) => ({
      id: o.id,
      title: o.title,
      color: o.color,
      users: o.users ?? 0,
      channelPoints: o.channel_points ?? 0,
    })),
  };
}

export function formatPollResults(p: PollState): string {
  const total = p.choices.reduce((n, c) => n + c.votes, 0);
  const parts = [...p.choices]
    .sort((a, b) => b.votes - a.votes)
    .map((c) => `${c.title} ${c.votes} (${total ? Math.round((c.votes / total) * 100) : 0}%)`);
  return `${p.title} → ${parts.join(' · ')}`;
}
