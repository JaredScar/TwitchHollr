import { type IncomingMessage, type Server, type ServerResponse, createServer } from 'node:http';
import type { AppState } from '@shared/types';
import { OVERLAY_HTML } from './overlay.html';

export interface OverlaySnapshot {
  activePoll: AppState['activePoll'];
  lastPoll: AppState['lastPoll'];
  activePrediction: AppState['activePrediction'];
}

/** OBS browser-source overlay: http://127.0.0.1:<port>/overlay with live updates over Server-Sent Events. */
export class OverlayServer {
  private server: Server | null = null;
  private clients = new Set<ServerResponse>();
  private snapshot: OverlaySnapshot = { activePoll: null, lastPoll: null, activePrediction: null };
  private port = 0;

  get url(): string | null {
    return this.server ? `http://127.0.0.1:${this.port}/overlay` : null;
  }

  async start(port: number): Promise<string> {
    await this.stop();
    const server = createServer((req, res) => this.handle(req, res));
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => resolve());
    });
    this.server = server;
    this.port = port;
    return this.url!;
  }

  async stop(): Promise<void> {
    for (const c of this.clients) c.end();
    this.clients.clear();
    const s = this.server;
    this.server = null;
    if (s) await new Promise<void>((r) => s.close(() => r()));
  }

  update(snapshot: OverlaySnapshot): void {
    const changed = JSON.stringify(snapshot) !== JSON.stringify(this.snapshot);
    this.snapshot = snapshot;
    if (changed) this.broadcast('state', snapshot);
  }

  toast(text: string): void {
    this.broadcast('toast', { text });
  }

  private broadcast(event: string, data: unknown): void {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const c of this.clients) c.write(payload);
  }

  private handle(req: IncomingMessage, res: ServerResponse): void {
    const path = (req.url ?? '/').split('?')[0];
    if (req.method !== 'GET') {
      res.writeHead(405).end();
      return;
    }
    if (path === '/overlay' || path === '/') {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'",
      });
      res.end(OVERLAY_HTML);
      return;
    }
    if (path === '/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive',
      });
      res.write(`event: state\ndata: ${JSON.stringify(this.snapshot)}\n\n`);
      this.clients.add(res);
      const ping = setInterval(() => res.write(': ping\n\n'), 15_000);
      req.on('close', () => {
        clearInterval(ping);
        this.clients.delete(res);
      });
      return;
    }
    if (path === '/state') {
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(this.snapshot));
      return;
    }
    res.writeHead(404).end();
  }
}
