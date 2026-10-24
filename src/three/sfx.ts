// Procedural WebAudio sound effects + custom audio asset bindings.
// Custom sounds (loaded via audio.ts) take precedence when bound to an event id.
import { audio } from './audio.ts';

class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  enabled = true;

  init() {
    audio.init();
    audio.resume();
    if (this.ctx) { if (this.ctx.state === 'suspended') void this.ctx.resume(); return; }
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
      const len = Math.floor(this.ctx.sampleRate * 1.5);
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    } catch { this.ctx = null; }
  }

  private get ready() { return this.enabled && !!this.ctx && !!this.master && !!this.noiseBuf; }

  private noise(dur: number, gain: number, f0: number, f1: number, type: BiquadFilterType = 'lowpass', q = 0.8) {
    const c = this.ctx!, t = c.currentTime;
    const src = c.createBufferSource(); src.buffer = this.noiseBuf;
    const f = c.createBiquadFilter(); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master!);
    src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.05);
  }
  private tone(f0: number, f1: number, dur: number, gain: number, type: OscillatorType = 'sine') {
    const c = this.ctx!, t = c.currentTime;
    const o = c.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master!);
    o.start(t); o.stop(t + dur + 0.05);
  }

  /** Try custom binding first; fall back to procedural. Returns true if custom played. */
  private custom(eventId: string, pos?: { x: number; y: number; z: number }): boolean {
    if (!this.enabled) return true;
    return audio.play(eventId, pos ? { spatial: true, position: pos } : {});
  }

  shot(id: string, pos?: { x: number; y: number; z: number }) {
    if (this.custom(`shot.${id}`, pos)) return;
    if (!this.ready) return;
    switch (id) {
      case 'autocannon': this.noise(0.18, 0.7, 1800, 200); this.tone(140, 50, 0.16, 0.5); break;
      case 'mg': this.noise(0.07, 0.35, 2500, 600, 'bandpass', 1.5); this.tone(220, 90, 0.05, 0.2, 'square'); break;
      case 'laser': this.tone(1400, 220, 0.35, 0.3, 'sawtooth'); this.tone(2200, 400, 0.25, 0.12); this.noise(0.3, 0.15, 4000, 800, 'highpass'); break;
      case 'missiles': this.noise(0.45, 0.5, 600, 3000, 'bandpass', 0.7); this.tone(90, 40, 0.3, 0.3); break;
    }
  }
  explosion(size = 1, pos?: { x: number; y: number; z: number }) {
    if (this.custom('explosion', pos)) return;
    if (!this.ready) return;
    this.noise(0.9 * size, Math.min(1.2, 0.8 * size), 2200, 60);
    this.tone(70, 25, 0.7 * size, 0.7);
    this.noise(0.25, 0.4, 5000, 300, 'highpass');
  }
  step(weight = 0.5, pos?: { x: number; y: number; z: number }) {
    if (this.custom('step', pos)) return;
    if (!this.ready) return;
    this.noise(0.12, 0.2 + weight * 0.3, 400, 60);
    this.tone(60 + weight * 20, 30, 0.14, 0.2 + weight * 0.3);
    this.noise(0.22, 0.12, 2200, 180, 'bandpass', 3);
    this.tone(170, 65, 0.18, 0.07, 'triangle');
  }
  servo(speed: number, pos?: { x: number; y: number; z: number }) { if (this.custom('servo', pos)) return; if (!this.ready) return; this.tone(130 + speed * 70, 90, 0.15, 0.045, 'sawtooth'); this.noise(0.14, 0.035, 1200, 500, 'bandpass', 3); }
  zoom(direction: number, pos?: { x: number; y: number; z: number }) { if (this.custom('zoom', pos)) return; if (!this.ready) return; this.tone(direction < 0 ? 500 : 1000, direction < 0 ? 1400 : 350, 0.12, 0.08, 'triangle'); }
  crush(pos?: { x: number; y: number; z: number }) { if (this.custom('crush', pos)) return; if (!this.ready) return; this.noise(0.5, 0.45, 3200, 120, 'bandpass', 3); this.tone(260, 45, 0.35, 0.2, 'sawtooth'); }
  tree(pos?: { x: number; y: number; z: number }) { if (this.custom('tree', pos)) return; if (!this.ready) return; this.noise(0.4, 0.6, 2200, 180); this.noise(0.1, 0.5, 4500, 800, 'highpass'); this.tone(100, 35, 0.3, 0.2); }
  land(pos?: { x: number; y: number; z: number }) { if (this.custom('land', pos)) return; if (!this.ready) return; this.noise(0.35, 0.8, 900, 50); this.tone(55, 25, 0.4, 0.8); }
  overheat(pos?: { x: number; y: number; z: number }) { if (this.custom('overheat', pos)) return; if (!this.ready) return; for (let i = 0; i < 3; i++) setTimeout(() => { if (this.ready) this.tone(880, 880, 0.12, 0.2, 'square'); }, i * 180); }
  jet(pos?: { x: number; y: number; z: number }) { if (this.custom('jet', pos)) return; if (!this.ready) return; this.noise(0.14, 0.14, 900, 500, 'bandpass', 0.5); }
  select(pos?: { x: number; y: number; z: number }) { if (this.custom('select', pos)) return; if (!this.ready) return; this.tone(900, 1300, 0.06, 0.1, 'square'); }
  hit(pos?: { x: number; y: number; z: number }) { if (this.custom('hit', pos)) return; if (!this.ready) return; this.noise(0.08, 0.3, 3000, 900, 'bandpass', 1.2); }
  enemyShoot(pos?: { x: number; y: number; z: number }) { if (this.custom('enemyShoot', pos)) return; if (!this.ready) return; this.noise(0.14, 0.45, 900, 150); this.tone(110, 45, 0.14, 0.35); }
  playerHurt(pos?: { x: number; y: number; z: number }) { if (this.custom('playerHurt', pos)) return; if (!this.ready) return; this.noise(0.25, 0.7, 500, 60); this.tone(80, 30, 0.3, 0.6); }
  win(pos?: { x: number; y: number; z: number }) { if (this.custom('win', pos)) return; if (!this.ready) return; [523, 659, 784].forEach((f, i) => setTimeout(() => { if (this.ready) this.tone(f, f, 0.22, 0.25); }, i * 160)); }
  lose(pos?: { x: number; y: number; z: number }) { if (this.custom('lose', pos)) return; if (!this.ready) return; [330, 220].forEach((f, i) => setTimeout(() => { if (this.ready) this.tone(f, f * 0.9, 0.35, 0.3, 'sawtooth'); }, i * 260)); }
}
export const sfx = new Sfx();
