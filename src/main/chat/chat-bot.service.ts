import type { PollState, PredictionState, Settings } from '@shared/types';
import type { RouteOutcome, RouterInput } from '../commands/router';
import type { ChatMessageEvent } from '../twitch/events';
import { formatPollResults } from '../twitch/events';

interface Logger {
  info(...a: unknown[]): void;
  warn(...a: unknown[]): void;
}

export interface ChatBotDeps {
  getSettings(): Settings;
  broadcasterId(): string | null;
  route(input: RouterInput): Promise<RouteOutcome>;
  /** Waits for a confirm-mode command to fire or be cancelled. */
  awaitPending(): Promise<RouteOutcome>;
  send(message: string, replyTo?: string): Promise<void>;
  log: Logger;
  minIntervalMs?: number;
}

const HELP =
  'Hollr commands: poll <a> or <b> [for N seconds] · poll <title> options <a> or <b> · end poll · cancel poll · repeat poll · predict <a> or <b> · lock · <outcome> wins · cancel prediction';

/**
 * The in-app Twitch chat bot. It runs as the broadcaster's own account: it reads chat through EventSub
 * (channel.chat.message), runs prefixed commands from permitted users through the same router as voice,
 * and announces poll/prediction lifecycle events in chat.
 */
export class ChatBotService {
  private queue: { message: string; replyTo?: string }[] = [];
  private flushing = false;
  private lastSent = 0;

  constructor(private readonly deps: ChatBotDeps) {}

  canUse(e: ChatMessageEvent, s: Settings): boolean {
    const badges = new Set(e.badges.map((b) => b.set_id));
    if (badges.has('broadcaster') || e.chatter_user_id === this.deps.broadcasterId()) return true;
    if (s.chat.allowModerators && badges.has('moderator')) return true;
    if (s.chat.allowVips && badges.has('vip')) return true;
    return false;
  }

  /** Returns the command text if the message starts with the prefix, otherwise null. */
  static extract(text: string, prefix: string): string | null {
    const t = text.trim();
    if (!t.toLowerCase().startsWith(prefix)) return null;
    const rest = t.slice(prefix.length);
    if (rest && !/^\s/.test(rest)) return null;
    return rest.trim();
  }

  async onMessage(e: ChatMessageEvent): Promise<void> {
    const s = this.deps.getSettings();
    if (!s.chat.enabled) return;
    const rest = ChatBotService.extract(e.message.text, s.chat.prefix);
    if (rest === null || !this.canUse(e, s)) return;

    if (rest === '' || rest === 'help' || rest === 'commands') {
      this.say(HELP, e.message_id);
      return;
    }
    const outcome = await this.deps.route({ text: rest, source: 'chat', actor: e.chatter_user_name });
    const at = `@${e.chatter_user_name}`;
    switch (outcome.status) {
      case 'rejected':
      case 'failed':
        this.say(`${at} ${outcome.message}`, e.message_id);
        break;
      case 'dry-run':
        this.say(`${at} ${outcome.message}`, e.message_id);
        break;
      case 'pending': {
        this.say(`${at} ${outcome.message.replace('Say "cancel"', `Type "${s.chat.prefix} cancel"`)}`, e.message_id);
        const settled = await this.deps.awaitPending();
        if (settled.status === 'failed') this.say(`${at} ${settled.message}`, e.message_id);
        break;
      }
      case 'cancelled':
        this.say(`${at} ${outcome.message}`, e.message_id);
        break;
      default:
        break;
    }
  }

  // ---- Announcements (driven by EventSub, so they also cover polls made elsewhere) ----

  announcePollBegin(p: PollState): void {
    if (!this.announcing()) return;
    const secs = p.endsAt ? Math.max(0, Math.round((Date.parse(p.endsAt) - Date.parse(p.startedAt)) / 1000)) : null;
    this.say(`📊 POLL: ${p.title} ${p.choices.map((c) => `[${c.title}]`).join(' ')}${secs ? ` (${secs}s)` : ''} Vote now!`);
  }

  announcePollEnd(p: PollState): void {
    if (!this.announcing() || p.status === 'ARCHIVED') return;
    this.say(`📊 Results: ${formatPollResults(p)}`);
  }

  announcePrediction(p: PredictionState, phase: 'begin' | 'lock' | 'end'): void {
    if (!this.announcing()) return;
    if (phase === 'begin') {
      this.say(`🔮 PREDICTION: ${p.title} ${p.outcomes.map((o) => `[${o.title}]`).join(' ')} Get your points in!`);
    } else if (phase === 'lock') {
      this.say(`🔒 Predictions are locked: ${p.title}`);
    } else if (p.status === 'CANCELED') {
      this.say(`🔮 Prediction cancelled, points refunded: ${p.title}`);
    } else {
      const winner = p.outcomes.find((o) => o.id === p.winningOutcomeId);
      if (winner) this.say(`🏆 ${winner.title} wins! (${p.title})`);
    }
  }

  private announcing(): boolean {
    const s = this.deps.getSettings();
    return s.chat.enabled && s.chat.announce && !s.dryRun;
  }

  private say(message: string, replyTo?: string): void {
    this.queue.push({ message, replyTo });
    void this.flush();
  }

  private async flush(): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;
    const gap = this.deps.minIntervalMs ?? 1200;
    try {
      while (this.queue.length) {
        const wait = this.lastSent + gap - Date.now();
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
        const next = this.queue.shift()!;
        this.lastSent = Date.now();
        await this.deps.send(next.message, next.replyTo).catch((err) => this.deps.log.warn('Chat send failed', err));
      }
    } finally {
      this.flushing = false;
    }
  }
}
