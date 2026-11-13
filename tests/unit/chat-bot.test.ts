import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, sanitizeSettings } from '@shared/defaults';
import type { Settings } from '@shared/types';
import { ChatBotService } from '../../src/main/chat/chat-bot.service';
import type { RouteOutcome } from '../../src/main/commands/router';
import type { ChatMessageEvent } from '../../src/main/twitch/events';

const msg = (text: string, badges: string[] = [], user = 'mod1'): ChatMessageEvent => ({
  broadcaster_user_id: '42',
  chatter_user_id: user === 'streamer' ? '42' : '7',
  chatter_user_login: user,
  chatter_user_name: user,
  message_id: 'm1',
  message: { text },
  badges: badges.map((set_id) => ({ set_id, id: '1' })),
});

function setup(settings: Partial<Settings> = {}, outcome: RouteOutcome = { status: 'executed', message: 'ok' }) {
  const s = sanitizeSettings({ ...DEFAULT_SETTINGS, ...settings });
  const route = vi.fn(async () => outcome);
  const send = vi.fn(async (_message: string, _replyTo?: string) => undefined);
  const bot = new ChatBotService({
    getSettings: () => s,
    broadcasterId: () => '42',
    route,
    awaitPending: async () => ({ status: 'executed', message: '' }),
    send,
    log: { info: () => {}, warn: () => {} },
    minIntervalMs: 0,
  });
  return { bot, route, send };
}

const flush = () => new Promise((r) => setTimeout(r, 5));

describe('ChatBotService', () => {
  it('extracts the command after the prefix', () => {
    expect(ChatBotService.extract('!hollr poll a or b', '!hollr')).toBe('poll a or b');
    expect(ChatBotService.extract('!HOLLR end poll', '!hollr')).toBe('end poll');
    expect(ChatBotService.extract('!hollrpoll', '!hollr')).toBeNull();
    expect(ChatBotService.extract('hello', '!hollr')).toBeNull();
  });

  it('routes commands from moderators and the broadcaster', async () => {
    const { bot, route } = setup();
    await bot.onMessage(msg('!hollr poll a or b', ['moderator']));
    await bot.onMessage(msg('!hollr end poll', ['broadcaster'], 'streamer'));
    expect(route).toHaveBeenCalledTimes(2);
    expect(route).toHaveBeenCalledWith({ text: 'poll a or b', source: 'chat', actor: 'mod1' });
  });

  it('ignores regular viewers, and VIPs unless allowed', async () => {
    const { bot, route } = setup();
    await bot.onMessage(msg('!hollr poll a or b'));
    await bot.onMessage(msg('!hollr poll a or b', ['vip']));
    expect(route).not.toHaveBeenCalled();
    const vip = setup({ chat: { ...DEFAULT_SETTINGS.chat, allowVips: true } });
    await vip.bot.onMessage(msg('!hollr poll a or b', ['vip']));
    expect(vip.route).toHaveBeenCalledOnce();
  });

  it('replies with the reason when a command is rejected', async () => {
    const { bot, send } = setup({}, { status: 'rejected', message: 'Cooldown active: try again in 5s.' });
    await bot.onMessage(msg('!hollr poll a or b', ['moderator']));
    await flush();
    expect(send).toHaveBeenCalledWith('@mod1 Cooldown active: try again in 5s.', 'm1');
  });

  it('answers help', async () => {
    const { bot, send, route } = setup();
    await bot.onMessage(msg('!hollr help', ['moderator']));
    await flush();
    expect(route).not.toHaveBeenCalled();
    expect(send.mock.calls[0]![0]).toMatch(/Hollr commands/);
  });

  it('announces poll results, but not archived polls', async () => {
    const { bot, send } = setup();
    const poll = {
      id: 'p',
      title: 'Win or Loss?',
      startedAt: '',
      endsAt: null,
      endedAt: null,
      choices: [
        { id: 'a', title: 'Win', votes: 3 },
        { id: 'b', title: 'Loss', votes: 1 },
      ],
    };
    bot.announcePollEnd({ ...poll, status: 'ARCHIVED' });
    bot.announcePollEnd({ ...poll, status: 'TERMINATED' });
    await flush();
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0]![0]).toBe('📊 Results: Win or Loss? → Win 3 (75%) · Loss 1 (25%)');
  });

  it('stays quiet in dry run', async () => {
    const { bot, send } = setup({ dryRun: true });
    bot.announcePrediction(
      { id: 'x', title: 't', status: 'ACTIVE', locksAt: null, winningOutcomeId: null, outcomes: [] },
      'begin',
    );
    await flush();
    expect(send).not.toHaveBeenCalled();
  });
});
