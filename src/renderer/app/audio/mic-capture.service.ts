import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import { HollrService } from '../core/hollr.service';
import { sttPort } from '../core/stt-port';

export interface MicDevice {
  deviceId: string;
  label: string;
}

const TARGET_RATE = 16000;
const CHUNK_SAMPLES = 1600;

/**
 * Captures only the chosen microphone (never desktop/game audio), downsamples it to 16 kHz Int16 in an
 * AudioWorklet and streams it straight to the STT worker over a MessagePort while the main process says
 * the gate is open.
 */
@Injectable({ providedIn: 'root' })
export class MicCaptureService {
  private readonly hollr = inject(HollrService);

  readonly devices = signal<MicDevice[]>([]);
  readonly level = signal(0);
  readonly running = signal(false);
  readonly activeLabel = signal<string | null>(null);
  readonly error = signal<string | null>(null);

  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private startedFor: string | null = null;
  private starting: Promise<void> | null = null;

  constructor() {
    navigator.mediaDevices.addEventListener('devicechange', () => {
      void this.refreshDevices().then(() => this.restart());
    });
    effect(() => {
      const mic = this.hollr.settings()?.mic;
      const wanted = mic ? `${mic.deviceId ?? ''}|${mic.label ?? ''}` : null;
      if (wanted === null || this.hollr.info()?.e2e) return;
      untracked(() => {
        if (wanted !== this.startedFor) void this.start();
      });
    });
  }

  async refreshDevices(): Promise<MicDevice[]> {
    const all = await navigator.mediaDevices.enumerateDevices();
    const mics = all
      .filter((d) => d.kind === 'audioinput')
      .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Microphone ${i + 1}` }));
    this.devices.set(mics);
    return mics;
  }

  private resolveDevice(mics: MicDevice[]): MicDevice | undefined {
    const pref = this.hollr.settings()?.mic;
    return (
      mics.find((m) => m.deviceId === pref?.deviceId) ??
      (pref?.label ? mics.find((m) => m.label === pref.label) : undefined) ??
      mics.find((m) => m.deviceId === 'default') ??
      mics[0]
    );
  }

  restart(): Promise<void> {
    this.startedFor = null;
    return this.start();
  }

  async start(): Promise<void> {
    if (this.starting) return this.starting;
    this.starting = this.doStart().finally(() => (this.starting = null));
    return this.starting;
  }

  private async doStart(): Promise<void> {
    this.stop();
    const mic = this.hollr.settings()?.mic;
    this.startedFor = `${mic?.deviceId ?? ''}|${mic?.label ?? ''}`;
    try {
      // A first permission grant is required before device labels are visible.
      if (!this.devices().some((d) => d.label && !d.label.startsWith('Microphone '))) {
        const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
        probe.getTracks().forEach((t) => t.stop());
      }
      const device = this.resolveDevice(await this.refreshDevices());
      if (!device) throw new Error('No microphone found.');

      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: { exact: device.deviceId },
          channelCount: 1,
          echoCancellation: false,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      try {
        this.ctx = new AudioContext({ sampleRate: TARGET_RATE });
      } catch {
        this.ctx = new AudioContext();
      }
      await this.ctx.audioWorklet.addModule('pcm16-worklet.js');
      const source = this.ctx.createMediaStreamSource(this.stream);
      const node = new AudioWorkletNode(this.ctx, 'pcm16-capture', {
        processorOptions: { targetRate: TARGET_RATE, chunkSamples: CHUNK_SAMPLES },
      });
      const sink = this.ctx.createGain();
      sink.gain.value = 0;
      source.connect(node).connect(sink).connect(this.ctx.destination);

      node.port.onmessage = (e: MessageEvent<{ type: 'pcm'; pcm: ArrayBuffer } | { type: 'level'; rms: number }>) => {
        const msg = e.data;
        if (msg.type === 'level') {
          this.level.set(Math.min(1, Math.sqrt(msg.rms) * 1.6));
          return;
        }
        if (this.hollr.state()?.gateOpen) sttPort()?.postMessage(msg.pcm);
      };

      this.stream.getAudioTracks()[0]?.addEventListener('ended', () => {
        this.error.set('The microphone was disconnected.');
        void this.hollr.api.reportMic('The microphone was disconnected.');
      });
      this.running.set(true);
      this.activeLabel.set(device.label);
      this.error.set(null);
      await this.hollr.api.reportMic(null);
    } catch (err) {
      const msg =
        err instanceof DOMException && err.name === 'NotAllowedError'
          ? 'Microphone access was denied.'
          : err instanceof Error
            ? err.message
            : String(err);
      this.error.set(msg);
      this.running.set(false);
      await this.hollr.api.reportMic(msg);
    }
  }

  stop(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    void this.ctx?.close();
    this.ctx = null;
    this.running.set(false);
    this.level.set(0);
  }
}
