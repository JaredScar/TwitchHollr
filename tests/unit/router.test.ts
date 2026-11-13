import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, sanitizeSettings } from '@shared/defaults';
import type { Command, PollState, PredictionState, Settings } from '@shared/types';
import { CommandRouter, type LiveState } from '../../src/main/commands/router';

function setup(overrides: Partial<Settings> = {}, live: Partial<LiveState> = {}) {
  let settings = sanitizeSettings({ ...DEFAULT_SETTINGS, ...overrides });
  let liveState: LiveState = { activePoll: null, activePrediction: null, signedIn: true, eligible: true, ...live };
  const executed: Command[] = [];
  const execute = vi.fn(async (cmd: Command) => {
    executed.push(cmd);
    return `ok ${cmd.kind}`;
  });
  const logs: string[] = [];
  const pending = vi.fn();
  const router = new CommandRouter({
    getSettings: () => settings,
    getLive: () => liveState,
    executor: { execute },
    log: (level, _source, stage, message) => logs.push(`${level}:${stage}:${message}`),
    onPendingChange: pending,
    onCooldownChange: () => undefined,
  });
  return {
    router,
    execute,
    executed,
    logs,
    pending,
    setSettings: (s: Partial<Settings>) => (settings = sanitizeSettings(s, settings)),
    setLive: (l: Partial<LiveState>) => (liveState = { ...liveState, ...l }),
  };
}

const activePoll: PollState = {
  id: 'p1',
  title: 'Win or Loss?',
  choices: [],
  status: 'ACTIVE',
  startedAt: new Date().toISOString(),
  endsAt: null,
  endedAt: null,
};

describe('CommandRouter', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('ignores voice input without the wake word and logs nothing', async () => {
    const t = setup();
    const r = await t.router.handle({ text: 'we should poll chat about that', source: 'voice' });
    expect(r.status).toBe('ignored');
    expect(t.logs).toEqual([]);
    expect(t.execute).not.toHaveBeenCalled();
  });

  it('executes a voice poll', async () => {
    const t = setup();
    const r = await t.router.handle({ text: 'Holler, poll win or loss', source: 'voice' });
    expect(r.status).toBe('executed');
    expect(t.executed[0]).toMatchObject({ kind: 'poll.create', spec: { choices: ['Win', 'Loss'] } });
  });

  it('typed input works with or without the wake word', async () => {
    const t = setup({ cooldownSec: 0 });
    expect((await t.router.handle({ text: 'poll a or b', source: 'manual' })).status).toBe('executed');
    expect((await t.router.handle({ text: 'hollr poll c or d', source: 'manual' })).status).toBe('executed');
  });

  it('applies the cooldown to voice and chat, but not typed commands', async () => {
    const t = setup({ cooldownSec: 15 });
    await t.router.handle({ text: 'holler poll a or b', source: 'voice' });
    const second = await t.router.handle({ text: 'holler poll c or d', source: 'voice' });
    expect(second.status).toBe('rejected');
    expect(second.message).toMatch(/Cooldown/);
    expect((await t.router.handle({ text: 'poll c or d', source: 'chat' })).status).toBe('rejected');
    expect((await t.router.handle({ text: 'poll c or d', source: 'manual' })).status).toBe('executed');
    vi.advanceTimersByTime(15_000);
    expect((await t.router.handle({ text: 'holler poll e or f', source: 'voice' })).status).toBe('executed');
  });

  it('does not start a cooldown when the API call fails', async () => {
    const t = setup();
    t.execute.mockRejectedValueOnce(new Error('Twitch is down'));
    const r = await t.router.handle({ text: 'holler poll a or b', source: 'voice' });
    expect(r).toMatchObject({ status: 'failed', message: 'Twitch is down' });
    expect((await t.router.handle({ text: 'holler poll a or b', source: 'voice' })).status).toBe('executed');
  });

  it('refuses a new poll while one is active', async () => {
    const t = setup({}, { activePoll });
    const r = await t.router.handle({ text: 'holler poll a or b', source: 'voice' });
    expect(r.status).toBe('rejected');
    expect(r.message).toMatch(/already running/);
  });

  it('dry run logs without calling Twitch, even when signed out', async () => {
    const t = setup({ dryRun: true }, { signedIn: false, eligible: false });
    const r = await t.router.handle({ text: 'holler poll a or b', source: 'voice' });
    expect(r.status).toBe('dry-run');
    expect(r.message).toMatch(/\[dry run\] Would poll "A or B\?"/);
    expect(t.execute).not.toHaveBeenCalled();
  });

  it('blocks non-affiliates outside dry run', async () => {
    const t = setup({}, { eligible: false });
    const r = await t.router.handle({ text: 'holler poll a or b', source: 'voice' });
    expect(r.message).toMatch(/Affiliate or Partner/);
  });

  it('repeats the last poll', async () => {
    const t = setup({ cooldownSec: 0 });
    expect((await t.router.handle({ text: 'holler repeat poll', source: 'voice' })).status).toBe('rejected');
    await t.router.handle({ text: 'holler poll a or b for 2 minutes', source: 'voice' });
    await t.router.handle({ text: 'holler repeat poll', source: 'voice' });
    expect(t.executed[1]).toEqual(t.executed[0]);
  });

  describe('confirm mode', () => {
    it('fires after the countdown', async () => {
      const t = setup({ confirmMode: true, confirmDelaySec: 3 });
      const r = await t.router.handle({ text: 'holler poll a or b', source: 'voice' });
      expect(r.status).toBe('pending');
      expect(t.pending).toHaveBeenLastCalledWith(expect.objectContaining({ summary: expect.stringContaining('A or B') }));
      expect(t.execute).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(3000);
      expect(t.execute).toHaveBeenCalledOnce();
      expect(t.pending).toHaveBeenLastCalledWith(null);
    });

    it('"holler cancel" stops the pending command', async () => {
      const t = setup({ confirmMode: true });
      await t.router.handle({ text: 'holler poll a or b', source: 'voice' });
      const r = await t.router.handle({ text: 'holler cancel', source: 'voice' });
      expect(r.status).toBe('cancelled');
      await vi.advanceTimersByTimeAsync(5000);
      expect(t.execute).not.toHaveBeenCalled();
    });

    it('"cancel poll" during a countdown cancels the pending poll instead of archiving', async () => {
      const t = setup({ confirmMode: true });
      await t.router.handle({ text: 'holler poll a or b', source: 'voice' });
      expect((await t.router.handle({ text: 'holler cancel poll', source: 'voice' })).status).toBe('cancelled');
    });

    it('confirmPending fires immediately', async () => {
      const t = setup({ confirmMode: true });
      await t.router.handle({ text: 'holler poll a or b', source: 'voice' });
      await t.router.confirmPending();
      expect(t.execute).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(5000);
      expect(t.execute).toHaveBeenCalledOnce();
    });

    it('UI clicks skip confirm mode', async () => {
      const t = setup({ confirmMode: true });
      t.setLive({ activePoll });
      expect((await t.router.dispatch({ kind: 'poll.end' }, 'ui')).status).toBe('executed');
    });
  });

  describe('predictions', () => {
    const prediction: PredictionState = {
      id: 'pr1',
      title: 'Win?',
      status: 'ACTIVE',
      locksAt: null,
      winningOutcomeId: null,
      outcomes: [
        { id: 'o1', title: 'Win', color: 'BLUE', users: 0, channelPoints: 0 },
        { id: 'o2', title: 'Loss', color: 'PINK', users: 0, channelPoints: 0 },
      ],
    };

    it('resolves a spoken winner to an outcome id', async () => {
      const t = setup({}, { activePrediction: prediction });
      await t.router.handle({ text: 'holler loss wins', source: 'voice' });
      expect(t.executed[0]).toEqual({ kind: 'prediction.resolve', outcome: 'Loss', outcomeId: 'o2' });
    });

    it('rejects an unknown outcome', async () => {
      const t = setup({}, { activePrediction: prediction });
      const r = await t.router.handle({ text: 'holler purple wins', source: 'voice' });
      expect(r.message).toMatch(/Couldn't match "purple"/);
    });

    it('rejects resolving without a prediction', async () => {
      const t = setup();
      expect((await t.router.handle({ text: 'holler blue wins', source: 'voice' })).message).toMatch(/no open prediction/);
    });
  });
});
