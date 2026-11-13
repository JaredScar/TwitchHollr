import { resolve } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';

test('launch → dry run → type a command → log entry appears', async () => {
  const app = await electron.launch({
    args: [resolve(__dirname, '../..')],
    env: { ...process.env, HOLLR_E2E: '1' },
  });
  try {
    const page = await app.firstWindow();
    await page.waitForURL(/#\/dashboard/);
    await expect(page.getByTestId('dry-run')).toBeChecked();

    await page.getByTestId('command-input').fill('hollr poll win or loss for 2 minutes');
    await page.getByTestId('command-input').press('Enter');

    const log = page.getByTestId('activity-log');
    await expect(log).toContainText('"hollr poll win or loss for 2 minutes"');
    await expect(log).toContainText('[dry run] Would poll "Win or Loss?" [Win / Loss] for 120s');

    await page.getByTestId('command-input').fill('hollr make me a sandwich');
    await page.getByTestId('command-input').press('Enter');
    await expect(log).toContainText("Didn't recognize a command");

    const isolated = await page.evaluate(() => ({
      node: typeof (globalThis as { require?: unknown }).require,
      api: typeof (globalThis as { hollr?: { runText?: unknown } }).hollr?.runText,
    }));
    expect(isolated).toEqual({ node: 'undefined', api: 'function' });
  } finally {
    await app.close();
  }
});
