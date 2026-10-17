// WebAudio-synthesised SFX + simple generative ambient music per zone. No audio files.
const NOTE = (n) => 440 * 2 ** ((n - 69) / 12);
const SCALES = {
  village: { root: 60, steps: [0, 2, 4, 7, 9], tempo: 0.42, wave: 'triangle', pad: [48, 55, 60], bright: 1 },
  wild: { root: 57, steps: [0, 2, 4, 7, 9], tempo: 0.5, wave: 'triangle', pad: [45, 52, 57], bright: 0.8 },
  ember: { root: 52, steps: [0, 1, 4, 5, 7, 8, 10], tempo: 0.55, wave: 'sawtooth', pad: [40, 47, 52], bright: 0.5 },
  camp: { root: 55, steps: [0, 2, 3, 7, 9], tempo: 0.5, wave: 'triangle', pad: [43, 50, 55], bright: 0.7 },
  barrow: { root: 50, steps: [0, 3, 5, 7, 10], tempo: 0.7, wave: 'sine', pad: [38, 45, 50], bright: 0.4 },
  mine: { root: 45, steps: [0, 1, 3, 5, 7, 8], tempo: 0.45, wave: 'square', pad: [33, 40, 45], bright: 0.35, drum: 1 },
  boss: { root: 45, steps: [0, 1, 3, 6, 7], tempo: 0.22, wave: 'sawtooth', pad: [33, 39, 45], bright: 0.6, drum: 2 },
  vael: { root: 72, steps: [0, 3, 7, 10, 14, 12, 7, 5], tempo: 0.6, wave: 'sine', pad: null, bright: 1, box: 1 }, // Vael's music-box leitmotif, no accompaniment
};
export class Audio {
  constructor(settings) {
    this.settings = settings; this.ctx = null; this.track = null; this.stats = { sfx: 0, notes: 0, last: '' };
    this.step = 0; this.nextT = 0;
    const unlock = () => { this.init(); if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); };
    addEventListener('pointerdown', unlock); addEventListener('keydown', unlock);
  }
  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    try { this.ctx = new AC(); } catch { return; }
    const c = this.ctx;
    this.master = c.createGain(); this.master.connect(c.destination);
    this.musicG = c.createGain(); this.musicG.connect(this.master);
    this.sfxG = c.createGain(); this.sfxG.connect(this.master);
    const len = c.sampleRate * 0.5, buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
    this.apply();
    this.timer = setInterval(() => this.tick(), 120);
  }
  apply() {
    const s = this.settings; if (!this.ctx) return;
    const m = s.muted ? 0 : s.master;
    this.master.gain.setTargetAtTime(m, this.ctx.currentTime, 0.02);
    this.musicG.gain.setTargetAtTime(s.music * 0.35, this.ctx.currentTime, 0.05);
    this.sfxG.gain.setTargetAtTime(s.sfx, this.ctx.currentTime, 0.02);
  }
  get muted() { return !!this.settings.muted; }
  get gain() { return this.settings.muted ? 0 : this.settings.master; }
  // ---------- primitives ----------
  tone(f, dur, { type = 'square', vol = 0.2, slide = 0, delay = 0, dest, attack = 0.005 } = {}) {
    const c = this.ctx; if (!c) return; const t = c.currentTime + delay;
    const o = c.createOscillator(), g = c.createGain(); o.type = type; o.frequency.setValueAtTime(f, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, f + slide), t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest || this.sfxG); o.start(t); o.stop(t + dur + 0.02);
  }
  noise(dur, { vol = 0.3, freq = 1200, q = 1, type = 'bandpass', delay = 0, dest, slide = 0 } = {}) {
    const c = this.ctx; if (!c) return; const t = c.currentTime + delay;
    const s = c.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (slide) f.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(dest || this.sfxG); s.start(t); s.stop(t + dur + 0.02);
  }
  // ---------- SFX ----------
  play(name, opt = {}) {
    this.stats.sfx++; this.stats.last = name;
    if (!this.ctx || this.settings.muted) return;
    const r = 1 + (Math.random() - 0.5) * 0.12;
    switch (name) {
      case 'swing': this.noise(0.14, { vol: 0.22, freq: 2400 * r, q: 0.8, slide: -1600 }); break;
      case 'spin': this.noise(0.4, { vol: 0.25, freq: 1800, q: 0.7, slide: 1200 }); break;
      case 'hit': this.tone(180 * r, 0.1, { type: 'square', vol: 0.18, slide: -90 }); this.noise(0.08, { vol: 0.25, freq: 900 }); break;
      case 'clang': this.tone(1300 * r, 0.25, { type: 'triangle', vol: 0.15 }); this.tone(1950 * r, 0.18, { type: 'sine', vol: 0.08 }); break;
      case 'block': this.tone(900 * r, 0.12, { type: 'triangle', vol: 0.15 }); this.noise(0.05, { vol: 0.15, freq: 3000 }); break;
      case 'hurt': this.tone(320, 0.18, { type: 'sawtooth', vol: 0.14, slide: -200 }); break;
      case 'kill': this.tone(500, 0.08, { type: 'square', vol: 0.1 }); this.tone(330, 0.2, { type: 'square', vol: 0.1, delay: 0.07, slide: -150 }); break;
      case 'step': this.noise(0.05, { vol: opt.vol || 0.06, freq: opt.surface === 'wood' ? 600 : opt.surface === 'stone' ? 1800 : 900 * r, q: 1.2 }); break;
      case 'chop': this.tone(140 * r, 0.09, { type: 'triangle', vol: 0.25 }); this.noise(0.07, { vol: 0.2, freq: 500 }); break;
      case 'mine': this.tone(1800 * r, 0.12, { type: 'triangle', vol: 0.14 }); this.tone(2600 * r, 0.06, { type: 'sine', vol: 0.07 }); break;
      case 'splash': this.noise(0.35, { vol: 0.2, freq: 700, q: 0.6, slide: -400 }); break;
      case 'sizzle': this.noise(0.6, { vol: 0.08, freq: 5000, q: 0.5, type: 'highpass' }); break;
      case 'craft': this.tone(660, 0.07, { type: 'triangle', vol: 0.12 }); this.tone(990, 0.1, { type: 'triangle', vol: 0.1, delay: 0.06 }); break;
      case 'anvil': this.tone(1500 * r, 0.3, { type: 'triangle', vol: 0.16 }); this.noise(0.05, { vol: 0.2, freq: 2500 }); break;
      case 'ui': this.tone(880, 0.05, { type: 'square', vol: 0.06 }); break;
      case 'coin': this.tone(1320, 0.06, { type: 'square', vol: 0.08 }); this.tone(1760, 0.1, { type: 'square', vol: 0.08, delay: 0.05 }); break;
      case 'pickup': this.tone(700, 0.06, { type: 'triangle', vol: 0.1 }); this.tone(1050, 0.08, { type: 'triangle', vol: 0.1, delay: 0.05 }); break;
      case 'fuse': this.noise(0.5, { vol: 0.06, freq: 6000, q: 2 }); break;
      case 'boom': this.noise(0.9, { vol: 0.7, freq: 400, q: 0.5, type: 'lowpass', slide: -300 }); this.tone(70, 0.6, { type: 'sine', vol: 0.5, slide: -40 }); break;
      case 'throw': this.noise(0.12, { vol: 0.12, freq: 1500, slide: -800 }); break;
      case 'bow': this.tone(220, 0.1, { type: 'triangle', vol: 0.12, slide: 200 }); this.noise(0.1, { vol: 0.1, freq: 3000 }); break;
      case 'spell': this.tone(520, 0.3, { type: 'sine', vol: 0.12, slide: 700 }); this.tone(780, 0.3, { type: 'sine', vol: 0.08, slide: 900, delay: 0.04 }); break;
      case 'heal': [0, 4, 7, 12].forEach((n, i) => this.tone(NOTE(72 + n), 0.2, { type: 'sine', vol: 0.1, delay: i * 0.06 })); break;
      case 'door': this.tone(110, 0.25, { type: 'sawtooth', vol: 0.06, slide: 40 }); this.noise(0.15, { vol: 0.08, freq: 400 }); break;
      case 'place': this.tone(160, 0.08, { type: 'square', vol: 0.12 }); this.noise(0.05, { vol: 0.12, freq: 700 }); break;
      case 'grapple': this.noise(0.25, { vol: 0.12, freq: 2500, slide: -1500 }); this.tone(1200, 0.08, { type: 'square', vol: 0.06, delay: 0.2 }); break;
      case 'fire': this.noise(0.3, { vol: 0.15, freq: 900, slide: -500 }); break;
      case 'roar': this.tone(90, 1.0, { type: 'sawtooth', vol: 0.25, slide: -40 }); this.noise(1.0, { vol: 0.2, freq: 300, type: 'lowpass' }); break;
      case 'fade': this.tone(200, 0.6, { type: 'sine', vol: 0.06, slide: -100 }); break;
      case 'quest': [0, 4, 7, 12, 16].forEach((n, i) => this.tone(NOTE(67 + n), 0.25, { type: 'triangle', vol: 0.12, delay: i * 0.09 })); break;
      case 'level': [0, 4, 7, 12, 7, 12].forEach((n, i) => this.tone(NOTE(64 + n + (opt.pitch || 0)), 0.22, { type: 'square', vol: 0.08, delay: i * 0.1 })); break;
      case 'cape': [0, 4, 7, 12, 16, 19, 24].forEach((n, i) => this.tone(NOTE(60 + n), 0.4, { type: 'triangle', vol: 0.12, delay: i * 0.12 })); break;
      case 'trap': this.tone(300, 0.08, { type: 'square', vol: 0.1 }); this.tone(200, 0.1, { type: 'square', vol: 0.1, delay: 0.08 }); break;
      case 'pet': this.tone(1200, 0.08, { type: 'sine', vol: 0.1, slide: 300 }); this.tone(1500, 0.1, { type: 'sine', vol: 0.08, delay: 0.1, slide: -200 }); break;
      default: this.tone(600, 0.05, { vol: 0.05 });
    }
  }
  // ---------- music ----------
  setTrack(name) { if (this.track === name) return; this.track = name; this.step = 0; this.stats.track = name; }
  tick() {
    const c = this.ctx; if (!c || !this.track || this.settings.muted || this.settings.music <= 0) return;
    const S = SCALES[this.track]; if (!S) return;
    if (this.nextT < c.currentTime) this.nextT = c.currentTime + 0.05;
    while (this.nextT < c.currentTime + 0.3) {
      const i = this.step++, t = this.nextT - c.currentTime;
      if (S.box) { // music box: a fixed, lonely melody
        const n = S.steps[i % S.steps.length]; this.tone(NOTE(S.root + n), 1.2, { type: 'sine', vol: 0.16, delay: t, dest: this.musicG, attack: 0.002 }); this.tone(NOTE(S.root + n + 12), 0.5, { type: 'sine', vol: 0.04, delay: t, dest: this.musicG, attack: 0.002 });
      } else {
        if (i % 16 === 0 && S.pad) for (const p of S.pad) this.tone(NOTE(p), S.tempo * 16, { type: 'sine', vol: 0.05, delay: t, dest: this.musicG, attack: 0.6 });
        const seed = Math.sin(i * 12.9898 + this.track.length * 7.1) * 43758.5453, rr = seed - Math.floor(seed);
        if (rr < 0.62) { const n = S.steps[Math.floor(rr * 97) % S.steps.length] + (rr > 0.5 ? 12 : 0); this.tone(NOTE(S.root + 12 + n), S.tempo * 1.8, { type: S.wave, vol: 0.05 * S.bright + 0.02, delay: t, dest: this.musicG, attack: 0.01 }); this.stats.notes++; }
        if (S.drum && i % (S.drum === 2 ? 2 : 4) === 0) this.noise(0.12, { vol: 0.12, freq: 120, type: 'lowpass', delay: t, dest: this.musicG });
      }
      this.nextT += S.tempo;
    }
  }
}
