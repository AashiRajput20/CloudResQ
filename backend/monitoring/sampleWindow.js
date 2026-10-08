// A sliding window of recent measurements (e.g. the last 60 s of CPU readings).
// "ready" means the samples cover the whole period, so a short spike cannot trigger a rule.
class SampleWindow {
  constructor(sustainSeconds, intervalMs) {
    this.sustainMs = sustainSeconds * 1000;
    this.intervalMs = intervalMs;
    this.samples = []; // [{ t: ms, v: number }]
  }

  add(value, now = Date.now()) {
    this.samples.push({ t: now, v: value });
    const cutoff = now - this.sustainMs - this.intervalMs;
    while (this.samples.length && this.samples[0].t < cutoff) this.samples.shift();
  }

  clear() {
    this.samples = [];
  }

  // Each sample represents one interval, so coverage = span + one interval.
  get ready() {
    if (this.samples.length === 0) return false;
    const span = this.samples[this.samples.length - 1].t - this.samples[0].t;
    return span + this.intervalMs >= this.sustainMs;
  }

  get average() {
    if (this.samples.length === 0) return 0;
    return this.samples.reduce((sum, s) => sum + s.v, 0) / this.samples.length;
  }
}

module.exports = SampleWindow;