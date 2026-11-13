import { STT_PORT_MESSAGE } from '@shared/ipc';

// Registered at module load (before Angular bootstraps) so the first port, sent on did-finish-load, is never missed.
let current: MessagePort | null = null;
const listeners = new Set<(port: MessagePort) => void>();

window.addEventListener('message', (e: MessageEvent) => {
  if (e.source !== window || (e.data as { type?: string })?.type !== STT_PORT_MESSAGE) return;
  const port = e.ports[0];
  if (!port) return;
  current?.close();
  current = port;
  port.start();
  for (const l of listeners) l(port);
});

export function sttPort(): MessagePort | null {
  return current;
}

export function onSttPort(cb: (port: MessagePort) => void): () => void {
  listeners.add(cb);
  if (current) cb(current);
  return () => listeners.delete(cb);
}
