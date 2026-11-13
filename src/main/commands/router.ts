import type {
  Command,
  CommandSource,
  LogLevel,
  LogStage,
  PendingConfirm,
  PollSpec,
  PollState,
  PredictionState,
  Settings,
} from '@shared/types';
import { describeCommand, matchOutcome, normalize, parseCommand, stripWakeWord } from './grammar';

export interface RouterInput {
  text: string;
  source: CommandSource;
  /** Display name of whoever issued the command (chat). */
  actor?: string;
}

export type RouteStatus = 'ignored' | 'rejected' | 'pending' | 'executed' | 'dry-run' | 'failed' | 'cancelled';

export interface RouteOutcome {
  status: RouteStatus;
  message: string;
  command?: Command;
}

export interface CommandExecutor {
  /** Perform the command against Twitch. Resolves with a success message; rejects with a user-facing Error. */
  execute(cmd: Command): Promise<string>;
}

export interface LiveState {
  activePoll: PollState | null;
  activePrediction: PredictionState | null;
  signedIn: boolean;
  eligible: boolean;
}

export interface RouterDeps {
  getSettings(): Settings;
  getLive(): LiveState;
  executor: CommandExecutor;
  log(level: LogLevel, source: CommandSource, stage: LogStage, message: string): void;
  onPendingChange(pending: PendingConfirm | null): void;
  onCooldownChange(until: number): void;
  onExecuted?(cmd: Command, source: CommandSource, dryRun: boolean): void;
  now?: () => number;
}

const isCreate = (c: Command) => c.kind === 'poll.create' || c.kind === 'prediction.create';

/** Sources that skip the cooldown: deliberate clicks/typing in the app itself. */
const COOLDOWN_EXEMPT: ReadonlySet<CommandSource> = new Set(['ui', 'manual']);

interface Pending {
  id: number;
  cmd: Command;
  source: CommandSource;
  timer: ReturnType<typeof setTimeout>;
  done: (o: RouteOutcome) => void;
}

export class CommandRouter {
  private cooldownUntil = 0;
  private lastPoll: PollSpec | null = null;
  private pending: Pending | null = null;
  private seq = 0;
  private readonly now: () => number;

  constructor(private readonly deps: RouterDeps) {
    this.now = deps.now ?? Date.now;
  }

  get lastPollSpec(): PollSpec | null {
    return this.lastPoll;
  }

  /** Record a poll seen on the channel (e.g. created on the Twitch dashboard) so "repeat poll" can re-run it. */
  rememberPoll(spec: PollSpec): void {
    this.lastPoll = spec;
  }

  async handle(input: RouterInput): Promise<RouteOutcome> {
    const s = this.deps.getSettings();
    const normalized = normalize(input.text);
    if (!normalized) return { status: 'ignored', message: '' };
    const wakeWords = [s.wakeWord, ...s.wakeAliases];

    let commandText: string;
    if (input.source === 'voice') {
      const rest = stripWakeWord(normalized, wakeWords);
      if (rest === null) return { status: 'ignored', message: '' };
      commandText = rest;
    } else {
      commandText = stripWakeWord(normalized, wakeWords) ?? normalized;
    }
    const who = input.actor ? `${input.actor}: ` : '';
    this.deps.log('info', input.source, 'heard', `${who}"${input.text.trim()}"`);

    const parsed = parseCommand(commandText, {
      presets: s.presets,
      defaultPollDurationSec: s.defaultPollDurationSec,
      defaultPredictionWindowSec: s.defaultPredictionWindowSec,
    });
    if (!parsed.ok) {
      this.deps.log('warn', input.source, 'parsed', parsed.error);
      return { status: 'rejected', message: parsed.error };
    }
    this.deps.log('info', input.source, 'parsed', `→ ${describeCommand(parsed.command)}`);
    return this.dispatch(parsed.command, input.source);
  }

  async dispatch(command: Command, source: CommandSource): Promise<RouteOutcome> {
    const s = this.deps.getSettings();
    const live = this.deps.getLive();
    let cmd = command;
    const reject = (message: string): RouteOutcome => {
      this.deps.log('warn', source, 'result', message);
      return { status: 'rejected', message, command: cmd };
    };

    if (cmd.kind === 'pending.cancel') return this.cancelPending(source);
    if (cmd.kind === 'poll.cancel' && this.pending?.cmd.kind === 'poll.create') return this.cancelPending(source);
    if (cmd.kind === 'prediction.cancel' && this.pending?.cmd.kind === 'prediction.create') {
      return this.cancelPending(source);
    }
    if (cmd.kind === 'poll.repeat') {
      if (!this.lastPoll) return reject('There is no previous poll to repeat yet.');
      cmd = { kind: 'poll.create', spec: this.lastPoll };
    }

    if (!s.dryRun) {
      if (!live.signedIn) return reject('Sign in with Twitch first (or turn on dry run to test).');
      if (!live.eligible) {
        return reject('Twitch only allows polls and predictions on Affiliate or Partner channels.');
      }
    }

    if (isCreate(cmd)) {
      const left = Math.ceil((this.cooldownUntil - this.now()) / 1000);
      if (!COOLDOWN_EXEMPT.has(source) && left > 0) return reject(`Cooldown active: try again in ${left}s.`);
      if (this.pending) return reject('Another command is waiting to fire. Say "cancel" first.');
      if (cmd.kind === 'poll.create' && live.activePoll) {
        return reject('A poll is already running. End it first ("end poll").');
      }
      if (cmd.kind === 'prediction.create' && live.activePrediction) {
        return reject('A prediction is already open. Lock/resolve or cancel it first.');
      }
    }

    if (cmd.kind === 'prediction.resolve') {
      const p = live.activePrediction;
      if (!p) return reject('There is no open prediction to resolve.');
      const id = cmd.outcomeId ?? matchOutcome(cmd.outcome, p.outcomes);
      const outcome = p.outcomes.find((o) => o.id === id);
      if (!outcome) {
        return reject(`Couldn't match "${cmd.outcome}" to an outcome (${p.outcomes.map((o) => o.title).join(', ')}).`);
      }
      cmd = { kind: 'prediction.resolve', outcome: outcome.title, outcomeId: outcome.id };
    }
    if (cmd.kind === 'prediction.lock' && live.activePrediction?.status === 'LOCKED') {
      return reject('The prediction is already locked.');
    }

    if (isCreate(cmd) && s.confirmMode && source !== 'ui') return this.schedule(cmd, source, s.confirmDelaySec);
    return this.run(cmd, source);
  }

  confirmPending(): Promise<RouteOutcome> | null {
    const p = this.pending;
    if (!p) return null;
    clearTimeout(p.timer);
    this.clearPending();
    const result = this.run(p.cmd, p.source);
    void result.then(p.done);
    return result;
  }

  cancelPending(source: CommandSource): RouteOutcome {
    const p = this.pending;
    if (!p) {
      this.deps.log('info', source, 'result', 'Nothing to cancel.');
      return { status: 'rejected', message: 'Nothing to cancel.' };
    }
    clearTimeout(p.timer);
    this.clearPending();
    const outcome: RouteOutcome = { status: 'cancelled', message: `Cancelled: ${describeCommand(p.cmd)}`, command: p.cmd };
    this.deps.log('info', source, 'result', outcome.message);
    p.done(outcome);
    return outcome;
  }

  dispose(): void {
    if (this.pending) clearTimeout(this.pending.timer);
    this.pending = null;
  }

  private schedule(cmd: Command, source: CommandSource, delaySec: number): RouteOutcome {
    const id = ++this.seq;
    const firesAt = this.now() + delaySec * 1000;
    const summary = describeCommand(cmd);
    const timer = setTimeout(() => {
      if (this.pending?.id !== id) return;
      this.clearPending();
      void this.run(cmd, source).then(pending.done);
    }, delaySec * 1000);
    const pending: Pending = { id, cmd, source, timer, done: () => undefined };
    this.pending = pending;
    this.deps.onPendingChange({ id, summary, source, firesAt });
    const message = `Starting in ${delaySec}s: ${summary}. Say "cancel" to stop.`;
    this.deps.log('info', source, 'result', message);
    return { status: 'pending', message, command: cmd };
  }

  /** Register a callback for when the currently pending command resolves (fires or is cancelled). */
  onPendingSettled(cb: (o: RouteOutcome) => void): void {
    if (this.pending) this.pending.done = cb;
  }

  private clearPending(): void {
    this.pending = null;
    this.deps.onPendingChange(null);
  }

  private setCooldown(until: number): void {
    this.cooldownUntil = until;
    this.deps.onCooldownChange(until);
  }

  private async run(cmd: Command, source: CommandSource): Promise<RouteOutcome> {
    const s = this.deps.getSettings();
    const previousCooldown = this.cooldownUntil;
    if (isCreate(cmd)) this.setCooldown(this.now() + s.cooldownSec * 1000);
    if (cmd.kind === 'poll.create') this.lastPoll = cmd.spec;

    if (s.dryRun) {
      const message = `[dry run] Would ${describeCommand(cmd)}`;
      this.deps.log('success', source, 'result', message);
      this.deps.onExecuted?.(cmd, source, true);
      return { status: 'dry-run', message, command: cmd };
    }
    try {
      const message = await this.deps.executor.execute(cmd);
      this.deps.log('success', source, 'result', message);
      this.deps.onExecuted?.(cmd, source, false);
      return { status: 'executed', message, command: cmd };
    } catch (err) {
      if (isCreate(cmd)) this.setCooldown(previousCooldown);
      const message = err instanceof Error ? err.message : String(err);
      this.deps.log('error', source, 'result', message);
      return { status: 'failed', message, command: cmd };
    }
  }
}
