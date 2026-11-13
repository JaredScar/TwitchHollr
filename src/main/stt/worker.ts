import type { MessagePortMain } from 'electron';
import type { ISttEngine } from './engine';
import type { FromWorker, ToWorker } from './protocol';

// Entry point of the STT utilityProcess. The native recognizer runs here so it can never block the main
// process or the UI. Audio arrives from the renderer over a MessagePort and never passes through main.

const parent = process.parentPort;
let engine: ISttEngine | null = null;
let audioPort: MessagePortMain | null = null;
let gateOpen = false;

const send = (msg: FromWorker) => parent.postMessage(msg);

async function init(msg: Extract<ToWorker, { type: 'init' }>) {
  const started = Date.now();
  try {
    if (msg.engine === 'whisper') {
      const { WhisperEngine } = await import('./engines/whisper');
      engine = new WhisperEngine(msg.modelId);
    } else {
      const { SherpaEngine } = await import('./engines/sherpa');
      engine = new SherpaEngine();
    }
    await engine.init({
      modelDir: msg.modelDir,
      sampleRate: 16000,
      numThreads: msg.numThreads,
      hotwords: msg.hotwords,
      useGpu: msg.useGpu,
    });
    let lastAudioAt = 0;
    engine.onPartial((text) => send({ type: 'partial', text }));
    engine.onFinal((text) => send({ type: 'final', text, decodeMs: Date.now() - lastAudioAt }));
    const accept = engine.accept.bind(engine);
    engine.accept = (pcm) => {
      lastAudioAt = Date.now();
      accept(pcm);
    };
    send({ type: 'ready', provider: engine.provider, loadMs: Date.now() - started });
  } catch (err) {
    engine = null;
    send({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
}

function attachPort(port: MessagePortMain) {
  audioPort?.close();
  audioPort = port;
  port.on('message', (e) => {
    if (!gateOpen || !engine) return;
    const data = e.data as ArrayBuffer | ArrayBufferView;
    const pcm = ArrayBuffer.isView(data)
      ? new Int16Array(data.buffer, data.byteOffset, Math.floor(data.byteLength / 2))
      : new Int16Array(data);
    try {
      engine.accept(pcm);
    } catch (err) {
      send({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  });
  port.start();
}

parent.on('message', (e) => {
  const msg = e.data as ToWorker;
  switch (msg.type) {
    case 'init':
      void init(msg);
      break;
    case 'port':
      if (e.ports[0]) attachPort(e.ports[0]);
      break;
    case 'gate':
      if (gateOpen && !msg.open) engine?.reset();
      gateOpen = msg.open;
      break;
    case 'dispose':
      engine?.dispose();
      audioPort?.close();
      process.exit(0);
  }
});
