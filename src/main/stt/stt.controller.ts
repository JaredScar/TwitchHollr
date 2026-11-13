import { MessageChannelMain, type UtilityProcess, type WebContents, utilityProcess } from 'electron';
import { IpcEvent } from '@shared/ipc';
import type { SttStatus } from '@shared/types';
import type { FromWorker, ToWorker } from './protocol';

type InitMsg = Extract<ToWorker, { type: 'init' }>;

export interface SttControllerDeps {
  workerPath: string;
  onStatus(status: SttStatus, error: string | null, provider: string | null): void;
  onPartial(text: string): void;
  onFinal(text: string, decodeMs: number): void;
  log: { info(...a: unknown[]): void; warn(...a: unknown[]): void };
}

/** Owns the STT utilityProcess and wires the renderer's audio MessagePort straight into it. */
export class SttController {
  private child: UtilityProcess | null = null;
  private config: InitMsg | null = null;
  private renderer: WebContents | null = null;
  private gate = false;
  private crashes: number[] = [];
  private intentionalExit = false;

  constructor(private readonly deps: SttControllerDeps) {}

  start(config: InitMsg): void {
    this.stop();
    this.config = config;
    this.intentionalExit = false;
    this.deps.onStatus('loading', null, null);
    const child = utilityProcess.fork(this.deps.workerPath, [], { serviceName: 'Hollr Speech', stdio: 'inherit' });
    this.child = child;

    child.on('message', (msg: FromWorker) => {
      switch (msg.type) {
        case 'ready':
          this.deps.log.info(`STT ready (${config.engine}, ${msg.provider}) in ${msg.loadMs}ms`);
          this.deps.onStatus('ready', null, msg.provider);
          break;
        case 'error':
          this.deps.onStatus('error', msg.message, null);
          break;
        case 'partial':
          this.deps.onPartial(msg.text);
          break;
        case 'final':
          this.deps.onFinal(msg.text, msg.decodeMs);
          break;
      }
    });
    child.on('exit', (code) => {
      if (this.child !== child) return;
      this.child = null;
      if (this.intentionalExit) return;
      this.deps.log.warn(`STT worker exited (${code})`);
      const now = Date.now();
      this.crashes = [...this.crashes.filter((t) => now - t < 60_000), now];
      if (this.crashes.length > 3) {
        this.deps.onStatus('error', 'The speech engine keeps crashing. Try the other engine in Settings.', null);
        return;
      }
      this.deps.onStatus('loading', null, null);
      setTimeout(() => this.config && !this.child && this.start(this.config), 2000);
    });

    this.post(config);
    this.post({ type: 'gate', open: this.gate });
    if (this.renderer) this.attachRenderer(this.renderer);
  }

  /** Create a fresh MessageChannel: one end to the worker, the other to the renderer. */
  attachRenderer(wc: WebContents): void {
    this.renderer = wc;
    if (!this.child || wc.isDestroyed()) return;
    const { port1, port2 } = new MessageChannelMain();
    this.child.postMessage({ type: 'port' } satisfies ToWorker, [port1]);
    wc.postMessage(IpcEvent.sttPort, null, [port2]);
  }

  setGate(open: boolean): void {
    if (open === this.gate) return;
    this.gate = open;
    this.post({ type: 'gate', open });
  }

  get running(): boolean {
    return this.child !== null;
  }

  stop(): void {
    const child = this.child;
    if (!child) return;
    this.intentionalExit = true;
    this.post({ type: 'dispose' });
    this.child = null;
    setTimeout(() => child.kill(), 1500);
    this.deps.onStatus('stopped', null, null);
  }

  private post(msg: ToWorker): void {
    this.child?.postMessage(msg);
  }
}
