import type { Command, PollState, PredictionState, Settings } from '@shared/types';
import type { TwitchService } from '../twitch/twitch.service';
import type { CommandExecutor } from './router';

export interface ExecutorDeps {
  twitch: TwitchService;
  broadcasterId(): string | null;
  getSettings(): Settings;
  getActivePoll(): PollState | null;
  getActivePrediction(): PredictionState | null;
  setPoll(active: PollState | null, last?: PollState): void;
  setPrediction(active: PredictionState | null): void;
}

export class TwitchCommandExecutor implements CommandExecutor {
  constructor(private readonly deps: ExecutorDeps) {}

  private bid(): string {
    const id = this.deps.broadcasterId();
    if (!id) throw new Error('Sign in with Twitch first.');
    return id;
  }

  private async activePollId(bid: string): Promise<string> {
    const local = this.deps.getActivePoll();
    if (local) return local.id;
    const remote = await this.deps.twitch.getActivePoll(bid);
    if (!remote) throw new Error('There is no active poll.');
    return remote.id;
  }

  private async activePrediction(bid: string): Promise<PredictionState> {
    const local = this.deps.getActivePrediction();
    if (local) return local;
    const remote = await this.deps.twitch.getActivePrediction(bid);
    if (!remote) throw new Error('There is no open prediction.');
    return remote;
  }

  async execute(cmd: Command): Promise<string> {
    const bid = this.bid();
    const { twitch } = this.deps;
    switch (cmd.kind) {
      case 'poll.create': {
        const poll = await twitch.createPoll(bid, cmd.spec, this.deps.getSettings().channelPoints);
        this.deps.setPoll(poll);
        return `Poll started: ${poll.title} (${cmd.spec.durationSec}s)`;
      }
      case 'poll.end':
      case 'poll.cancel': {
        const status = cmd.kind === 'poll.end' ? 'TERMINATED' : 'ARCHIVED';
        const poll = await twitch.endPoll(bid, await this.activePollId(bid), status);
        this.deps.setPoll(null, poll);
        return status === 'TERMINATED' ? `Poll ended: ${poll.title}` : `Poll cancelled and hidden: ${poll.title}`;
      }
      case 'prediction.create': {
        const p = await twitch.createPrediction(bid, cmd.spec);
        this.deps.setPrediction(p);
        return `Prediction started: ${p.title} (${cmd.spec.windowSec}s to predict)`;
      }
      case 'prediction.lock': {
        const current = await this.activePrediction(bid);
        const p = await twitch.endPrediction(bid, current.id, 'LOCKED');
        this.deps.setPrediction(p);
        return `Prediction locked: ${p.title}`;
      }
      case 'prediction.resolve': {
        const current = await this.activePrediction(bid);
        if (!cmd.outcomeId) throw new Error('No outcome selected.');
        await twitch.endPrediction(bid, current.id, 'RESOLVED', cmd.outcomeId);
        this.deps.setPrediction(null);
        return `Prediction resolved: "${cmd.outcome}" wins`;
      }
      case 'prediction.cancel': {
        const current = await this.activePrediction(bid);
        await twitch.endPrediction(bid, current.id, 'CANCELED');
        this.deps.setPrediction(null);
        return `Prediction cancelled; points refunded.`;
      }
      case 'poll.repeat':
      case 'pending.cancel':
        throw new Error(`"${cmd.kind}" is handled by the router.`);
    }
  }
}
