// AudioWorklet: downsample the mic to 16 kHz mono Int16 and post ~100 ms chunks, plus a ~20 Hz RMS level.
// Box-filter decimation (averaging each output window) doubles as a cheap anti-alias filter for speech.
class Pcm16Capture extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = (options && options.processorOptions) || {};
    this.target = o.targetRate || 16000;
    this.chunk = o.chunkSamples || 1600;
    this.ratio = Math.max(1, sampleRate / this.target);
    this.buf = new Int16Array(this.chunk);
    this.len = 0;
    this.phase = 0;
    this.acc = 0;
    this.accN = 0;
    this.sumSq = 0;
    this.count = 0;
    this.levelEvery = Math.round(sampleRate / 20);
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      const s = ch[i];
      this.sumSq += s * s;
      this.acc += s;
      this.accN++;
      this.phase += 1;
      if (this.phase >= this.ratio) {
        this.phase -= this.ratio;
        const v = Math.max(-1, Math.min(1, this.acc / this.accN));
        this.acc = 0;
        this.accN = 0;
        this.buf[this.len++] = v < 0 ? v * 0x8000 : v * 0x7fff;
        if (this.len === this.chunk) {
          this.port.postMessage({ type: 'pcm', pcm: this.buf.buffer }, [this.buf.buffer]);
          this.buf = new Int16Array(this.chunk);
          this.len = 0;
        }
      }
    }
    this.count += ch.length;
    if (this.count >= this.levelEvery) {
      this.port.postMessage({ type: 'level', rms: Math.sqrt(this.sumSq / this.count) });
      this.sumSq = 0;
      this.count = 0;
    }
    return true;
  }
}

registerProcessor('pcm16-capture', Pcm16Capture);
