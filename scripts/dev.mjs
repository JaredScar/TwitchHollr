// Dev loop: Angular dev server for the renderer + electron-vite watch for main/preload + the STT worker build.
import { spawn } from 'node:child_process';

const PORT = 4280;
const URL = `http://localhost:${PORT}`;
const shell = process.platform === 'win32';
const children = [];

function run(cmd, args, env = {}) {
  const child = spawn(cmd, args, { stdio: 'inherit', shell, env: { ...process.env, ...env } });
  children.push(child);
  child.on('exit', (code) => {
    if (code && code !== 0) shutdown(code);
  });
  return child;
}

function shutdown(code = 0) {
  for (const c of children) {
    if (c.exitCode !== null) continue;
    // With shell: true, kill() only reaches the shell on Windows; the tree must go too.
    if (shell) spawn('taskkill', ['/pid', String(c.pid), '/T', '/F'], { stdio: 'ignore' });
    else c.kill();
  }
  process.exit(code);
}
process.on('SIGINT', () => shutdown());

async function waitFor(url, timeoutMs = 120_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

await new Promise((resolve, reject) => {
  const w = spawn('npx', ['vite', 'build', '--config', 'vite.worker.config.mts'], { stdio: 'inherit', shell });
  w.on('exit', (code) => (code === 0 ? resolve() : reject(new Error('worker build failed'))));
});
run('npx', ['vite', 'build', '--config', 'vite.worker.config.mts', '--watch']);
run('npx', ['ng', 'serve', '--port', String(PORT)]);
await waitFor(URL);
const electron = run('npx', ['electron-vite', 'dev', '--watch'], { HOLLR_RENDERER_URL: URL, NODE_ENV: 'development' });
electron.on('exit', () => shutdown());
