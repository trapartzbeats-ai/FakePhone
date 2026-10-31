// Audio: a synthesized phone sound bank (no sample files needed), media decoding, live playback
// with a lookahead scheduler, and an offline mix for export.
import { getMedia } from './store.js';
import { envAt } from './timeline.js';

const SR = 48000;

// ---- synth helpers ----------------------------------------------------------
function env(ctx, g, t, a, peak, d, sustain = 0.0001) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + a);
  g.gain.exponentialRampToValueAtTime(Math.max(sustain, 0.0001), t + a + d);
}

function bell(ctx, out, f, t, { gain = 0.3, decay = 0.6, partials = [[1, 1], [2.76, 0.22], [5.4, 0.08]], type = 'sine', attack = 0.004 } = {}) {
  for (const [ratio, amp] of partials) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = f * ratio;
    const g = ctx.createGain();
    env(ctx, g, t, attack, gain * amp, decay / Math.sqrt(ratio));
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + attack + decay + 0.05);
  }
}

function marimba(ctx, out, f, t, gain = 0.3, decay = 0.45) {
  bell(ctx, out, f, t, { gain, decay, partials: [[1, 1], [3.93, 0.18], [9.2, 0.04]], attack: 0.002 });
}

function sweep(ctx, out, t, dur, f0, f1, { gain = 0.25, type = 'sine' } = {}) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const g = ctx.createGain();
  env(ctx, g, t, 0.005, gain, dur);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + dur + 0.05);
}

let noiseBuf = null;
function noise(ctx, out, t, dur, { gain = 0.2, type = 'bandpass', f0 = 2000, f1 = f0, q = 1, attack = 0.005 } = {}) {
  if (!noiseBuf || noiseBuf.sampleRate !== ctx.sampleRate) {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    let s = 12345;
    for (let i = 0; i < d.length; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; d[i] = (s / 0x7fffffff) * 2 - 1; }
  }
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.Q.value = q;
  f.frequency.setValueAtTime(f0, t);
  f.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const g = ctx.createGain();
  env(ctx, g, t, attack, gain, dur);
  src.connect(f).connect(g).connect(out);
  src.start(t);
  src.stop(t + attack + dur + 0.05);
}

function dualTone(ctx, out, f1, f2, t, dur, gain = 0.12) {
  for (const f of [f1, f2]) {
    const o = ctx.createOscillator();
    o.frequency.value = f;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.01);
    g.gain.setValueAtTime(gain, t + dur - 0.02);
    g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + dur + 0.01);
  }
}

const N = (name) => {
  const m = name.match(/^([A-G])(#?)(\d)$/);
  const idx = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1]] + (m[2] ? 1 : 0);
  return 440 * Math.pow(2, (idx - 9 + (Number(m[3]) - 4) * 12) / 12);
};

// name -> [duration, builder(ctx, out)]
const BANK = {
  send: [0.32, (c, o) => { noise(c, o, 0, 0.26, { gain: 0.32, f0: 700, f1: 4200, q: 2.2, attack: 0.03 }); sweep(c, o, 0.02, 0.18, 380, 900, { gain: 0.05 }); }],
  receive: [0.9, (c, o) => { bell(c, o, N('E6'), 0, { gain: 0.22, decay: 0.55 }); bell(c, o, N('A6'), 0.085, { gain: 0.2, decay: 0.7 }); }],
  notify: [1.2, (c, o) => { marimba(c, o, N('G5'), 0, 0.3); marimba(c, o, N('C6'), 0.13, 0.28); marimba(c, o, N('E6'), 0.26, 0.3, 0.7); }],
  key: [0.06, (c, o) => { noise(c, o, 0, 0.018, { gain: 0.5, f0: 3600, q: 0.9, attack: 0.001 }); sweep(c, o, 0, 0.02, 180, 90, { gain: 0.12 }); }],
  keyDel: [0.06, (c, o) => { noise(c, o, 0, 0.02, { gain: 0.45, f0: 1500, q: 1.1, attack: 0.001 }); sweep(c, o, 0, 0.022, 140, 70, { gain: 0.13 }); }],
  keySpace: [0.07, (c, o) => { noise(c, o, 0, 0.024, { gain: 0.45, f0: 2200, q: 0.8, attack: 0.001 }); sweep(c, o, 0, 0.025, 150, 80, { gain: 0.14 }); }],
  tapback: [0.5, (c, o) => { sweep(c, o, 0, 0.07, 500, 1300, { gain: 0.16 }); bell(c, o, N('G6'), 0.06, { gain: 0.12, decay: 0.3 }); }],
  swoosh: [0.5, (c, o) => noise(c, o, 0, 0.38, { gain: 0.35, f0: 3600, f1: 500, q: 1.6, attack: 0.04 })],
  poof: [0.55, (c, o) => { noise(c, o, 0, 0.4, { gain: 0.4, type: 'lowpass', f0: 6000, f1: 300, q: 0.7, attack: 0.01 }); sweep(c, o, 0, 0.18, 900, 300, { gain: 0.06 }); }],
  ringtone: [3.0, (c, o) => {
    const seq = [['E5', 0], ['B5', 0.14], ['E6', 0.28], ['B5', 0.42], ['G#5', 0.56], ['B5', 0.7], ['E6', 0.84]];
    for (const rep of [0, 1.5]) for (const [n, t] of seq) marimba(c, o, N(n), rep + t, 0.32, 0.5);
  }],
  ringback: [6.0, (c, o) => dualTone(c, o, 440, 480, 0, 2.0, 0.08)],
  busy: [1.5, (c, o) => { for (const t of [0, 0.5, 1.0]) dualTone(c, o, 480, 620, t, 0.25, 0.09); }],
  connect: [0.4, (c, o) => { bell(c, o, N('A5'), 0, { gain: 0.14, decay: 0.15 }); bell(c, o, N('E6'), 0.1, { gain: 0.14, decay: 0.2 }); }],
  hangup: [0.6, (c, o) => { bell(c, o, N('E5'), 0, { gain: 0.18, decay: 0.15, partials: [[1, 1]] }); bell(c, o, N('C5'), 0.16, { gain: 0.18, decay: 0.2, partials: [[1, 1]] }); bell(c, o, N('A4'), 0.32, { gain: 0.18, decay: 0.25, partials: [[1, 1]] }); }],
  tap: [0.08, (c, o) => noise(c, o, 0, 0.03, { gain: 0.3, f0: 1800, q: 1, attack: 0.001 })],
  unlock: [0.25, (c, o) => { noise(c, o, 0, 0.03, { gain: 0.25, f0: 2500, attack: 0.001 }); sweep(c, o, 0.02, 0.12, 700, 1400, { gain: 0.05 }); }],
  lock: [0.2, (c, o) => { noise(c, o, 0, 0.05, { gain: 0.4, type: 'lowpass', f0: 1200, q: 0.7, attack: 0.001 }); sweep(c, o, 0, 0.06, 160, 70, { gain: 0.3 }); }],
  waSend: [0.25, (c, o) => sweep(c, o, 0, 0.09, 700, 1500, { gain: 0.2 })],
  waReceive: [0.4, (c, o) => { sweep(c, o, 0, 0.06, 900, 1500, { gain: 0.16 }); sweep(c, o, 0.08, 0.08, 1100, 1900, { gain: 0.14 }); }],
  waNotify: [0.9, (c, o) => { bell(c, o, N('B5'), 0, { gain: 0.22, decay: 0.3 }); bell(c, o, N('E6'), 0.11, { gain: 0.22, decay: 0.3 }); bell(c, o, N('B6'), 0.22, { gain: 0.18, decay: 0.5 }); }],
  aSend: [0.3, (c, o) => { noise(c, o, 0, 0.12, { gain: 0.2, f0: 1500, f1: 4000, q: 2, attack: 0.02 }); bell(c, o, N('C7'), 0.05, { gain: 0.05, decay: 0.1 }); }],
  aReceive: [0.8, (c, o) => { bell(c, o, N('C6'), 0, { gain: 0.2, decay: 0.4 }); bell(c, o, N('G6'), 0.09, { gain: 0.18, decay: 0.55 }); }],
  aNotify: [1.0, (c, o) => { marimba(c, o, N('D6'), 0, 0.28); marimba(c, o, N('A6'), 0.15, 0.26, 0.6); }],
  igSend: [0.3, (c, o) => sweep(c, o, 0, 0.1, 600, 1250, { gain: 0.18, type: 'triangle' })],
  igReceive: [0.6, (c, o) => { bell(c, o, N('F6'), 0, { gain: 0.18, decay: 0.3 }); bell(c, o, N('C7'), 0.07, { gain: 0.12, decay: 0.4 }); }],
  igNotify: [0.8, (c, o) => { marimba(c, o, N('A5'), 0, 0.26); marimba(c, o, N('E6'), 0.12, 0.26, 0.5); }],
  // send effects (timed to the visuals in render/chat.js and render/effects.js)
  fx_slam: [1.0, (c, o) => { noise(c, o, 0, 0.24, { gain: 0.12, f0: 400, f1: 3000, q: 1.5, attack: 0.2 }); sweep(c, o, 0.24, 0.5, 140, 38, { gain: 0.75 }); noise(c, o, 0.24, 0.35, { gain: 0.55, type: 'lowpass', f0: 1800, f1: 120, q: 0.7, attack: 0.003 }); }],
  fx_loud: [1.3, (c, o) => { noise(c, o, 0, 1.0, { gain: 0.6, type: 'lowpass', f0: 300, f1: 900, q: 2, attack: 0.15 }); sweep(c, o, 0, 0.3, 180, 520, { gain: 0.14, type: 'sawtooth' }); }],
  fx_gentle: [1.9, (c, o) => { bell(c, o, N('E6'), 0, { gain: 0.12, decay: 1.2, attack: 0.25 }); bell(c, o, N('B6'), 0.35, { gain: 0.09, decay: 1.2, attack: 0.25 }); }],
  fx_ink: [1.3, (c, o) => noise(c, o, 0, 1.0, { gain: 0.12, type: 'highpass', f0: 5000, f1: 9000, q: 0.7, attack: 0.3 })],
  fx_confetti: [2.2, (c, o) => {
    noise(c, o, 0, 0.08, { gain: 0.6, f0: 1200, q: 0.8, attack: 0.001 });
    ['C7', 'E7', 'G6', 'A6', 'D7', 'F#6', 'B6'].forEach((n, i) => bell(c, o, N(n), 0.1 + i * 0.18, { gain: 0.07, decay: 0.4 }));
  }],
  fx_balloons: [2.4, (c, o) => { noise(c, o, 0, 1.6, { gain: 0.12, f0: 300, f1: 1600, q: 1.2, attack: 0.6 }); bell(c, o, N('G5'), 0.2, { gain: 0.08, decay: 0.9 }); bell(c, o, N('C6'), 0.6, { gain: 0.07, decay: 0.9 }); }],
  fx_fireworks: [3.3, (c, o) => {
    for (let i = 0; i < 5; i++) {
      const tt = 0.35 + i * 0.45;
      sweep(c, o, tt - 0.33, 0.3, 900, 2200, { gain: 0.035 });
      sweep(c, o, tt, 0.7, 110, 40, { gain: 0.5 });
      noise(c, o, tt, 0.5, { gain: 0.38, type: 'lowpass', f0: 2500, f1: 150, q: 0.6, attack: 0.002 });
      for (let j = 0; j < 6; j++) noise(c, o, tt + 0.2 + j * 0.09, 0.03, { gain: 0.1, f0: 4000 + j * 300, q: 2, attack: 0.001 });
    }
  }],
  fx_love: [2.4, (c, o) => { for (const [n, tt] of [['C5', 0], ['E5', 0.05], ['G5', 0.1], ['C6', 0.15]]) bell(c, o, N(n), tt, { gain: 0.09, decay: 1.6, attack: 0.35, partials: [[1, 1], [2, 0.15]] }); }],
  fx_lasers: [3.0, (c, o) => { for (let i = 0; i < 12; i++) sweep(c, o, i * 0.23, 0.14, 1900, 280, { gain: 0.13, type: 'square' }); }],
  fx_celebration: [2.6, (c, o) => { for (let i = 0; i < 14; i++) bell(c, o, N(['C7', 'D7', 'E7', 'G7', 'A7'][i % 5]), 0.05 + i * 0.11, { gain: 0.05, decay: 0.35 }); }],
  fx_spotlight: [1.6, (c, o) => { noise(c, o, 0, 0.05, { gain: 0.4, type: 'lowpass', f0: 1500, q: 0.7, attack: 0.001 }); sweep(c, o, 0.02, 1.2, 72, 68, { gain: 0.12 }); }],
  fx_echo: [1.9, (c, o) => { for (let i = 0; i < 5; i++) noise(c, o, i * 0.1, 0.3, { gain: 0.12, f0: 600 + i * 500, f1: 3000 + i * 500, q: 1.4, attack: 0.05 }); }],
  ding: [1.4, (c, o) => bell(c, o, N('C7'), 0, { gain: 0.25, decay: 1.2 })],
  boom: [2.2, (c, o) => { sweep(c, o, 0, 1.6, 90, 32, { gain: 0.7 }); noise(c, o, 0, 0.9, { gain: 0.5, type: 'lowpass', f0: 900, f1: 60, q: 0.5, attack: 0.005 }); }],
  riser: [2.4, (c, o) => { noise(c, o, 0, 2.2, { gain: 0.18, f0: 300, f1: 7000, q: 3, attack: 2.0 }); sweep(c, o, 0, 2.2, 120, 900, { gain: 0.04, type: 'sawtooth' }); }],
  vibrate: [0.9, (c, o) => { for (const t of [0, 0.45]) { const x = c.createOscillator(); x.type = 'sawtooth'; x.frequency.value = 160; const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 300; const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.25, t + 0.02); g.gain.setValueAtTime(0.25, t + 0.3); g.gain.linearRampToValueAtTime(0, t + 0.34); x.connect(f).connect(g).connect(o); x.start(t); x.stop(t + 0.36); } }],
};

export const SOUND_SLOTS = {
  send: 'Send (iMessage)', receive: 'Receive (iMessage)', notify: 'Notification (iMessage)',
  waSend: 'Send (WhatsApp)', waReceive: 'Receive (WhatsApp)', waNotify: 'Notification (WhatsApp)',
  aSend: 'Send (Android)', aReceive: 'Receive (Android)', aNotify: 'Notification (Android)',
  igSend: 'Send (Instagram)', igReceive: 'Receive (Instagram)', igNotify: 'Notification (Instagram)',
  key: 'Key click', keySpace: 'Space bar', keyDel: 'Delete key', tapback: 'Reaction', swoosh: 'Swipe delete', poof: 'Unsend',
  ringtone: 'Ringtone', ringback: 'Outgoing ring', connect: 'Call connect', hangup: 'Hang up', busy: 'Call failed',
  unlock: 'Unlock', lock: 'Lock', tap: 'Tap',
  fx_slam: 'Effect: Slam', fx_loud: 'Effect: Loud', fx_gentle: 'Effect: Gentle', fx_ink: 'Effect: Invisible Ink',
  fx_confetti: 'Effect: Confetti', fx_balloons: 'Effect: Balloons', fx_fireworks: 'Effect: Fireworks', fx_love: 'Effect: Love',
  fx_lasers: 'Effect: Lasers', fx_celebration: 'Effect: Celebration', fx_spotlight: 'Effect: Spotlight', fx_echo: 'Effect: Echo',
};
export const FX_SOUNDS = ['ding', 'notify', 'receive', 'boom', 'riser', 'swoosh', 'vibrate', 'ringtone', 'tap'];

async function renderBank() {
  const out = {};
  await Promise.all(Object.entries(BANK).map(async ([name, [dur, build]]) => {
    const ctx = new OfflineAudioContext(2, Math.ceil(dur * SR), SR);
    const bus = ctx.createGain();
    bus.connect(ctx.destination);
    build(ctx, bus);
    out[name] = await ctx.startRendering();
  }));
  return out;
}

// ---- engine -----------------------------------------------------------------
const BUS_GAIN = { sfx: 0.85, keys: 0.32, voice: 1.0, music: 1.0 };

export class AudioEngine {
  constructor() {
    this.ctx = new AudioContext({ latencyHint: 'interactive', sampleRate: SR });
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.7;
    this.limiter = this.ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -2; this.limiter.ratio.value = 20; this.limiter.attack.value = 0.002; this.limiter.release.value = 0.12; this.limiter.knee.value = 0;
    this.master.connect(this.limiter).connect(this.ctx.destination);
    this.buses = this.makeBuses(this.ctx, this.master);
    this.bank = {};
    this.media = new Map();     // id -> AudioBuffer
    this.active = new Set();
    this.playing = false;
    this.ready = renderBank().then((b) => { this.bank = b; });
  }

  makeBuses(ctx, dest) {
    const b = {};
    for (const [k, v] of Object.entries(BUS_GAIN)) { b[k] = ctx.createGain(); b[k].gain.value = v; b[k].connect(dest); }
    return b;
  }

  setVolume(v) { this.master.gain.value = v; }
  resume() { if (this.ctx.state !== 'running') return this.ctx.resume(); }

  async loadMedia(id) {
    if (this.media.has(id)) return this.media.get(id);
    const rec = await getMedia(id);
    if (!rec) return null;
    try {
      const buf = await this.ctx.decodeAudioData(await rec.blob.arrayBuffer());
      this.media.set(id, buf);
      return buf;
    } catch (e) { console.warn('decode audio', id, e); return null; }
  }

  async decodeBlob(blob) {
    return this.ctx.decodeAudioData(await blob.arrayBuffer());
  }

  async prepare(tl, p) {
    await this.ready;
    const ids = new Set(tl.audio.filter((a) => a.media).map((a) => a.media));
    for (const id of Object.values(p.sounds.overrides || {})) if (id) ids.add(id);
    await Promise.all([...ids].map((id) => this.loadMedia(id)));
  }

  bufferFor(cue, p) {
    if (cue.media) return this.media.get(cue.media) || null;
    const ov = p.sounds.overrides?.[cue.sfx];
    if (ov && this.media.get(ov)) return this.media.get(ov);
    return this.bank[cue.sfx] || null;
  }

  startCue(ctx, buses, buf, cue, when, offset) {
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = !!cue.loop;
    const g = ctx.createGain();
    const lvl = cue.gain ?? 1;
    g.gain.value = lvl;
    src.connect(g).connect(buses[cue.bus || 'sfx'] || buses.sfx);
    const pos = (cue.start || 0) + offset;          // position in the file (music can start mid-track)
    if (!cue.loop && pos >= buf.duration) return null;
    src.start(when, cue.loop ? pos % buf.duration : pos);
    if (cue.env) {
      // level automation (music ducking), joined at `offset` when playback starts mid-video
      g.gain.setValueAtTime(envAt(cue.env, offset) * lvl, when);
      for (const pt of cue.env) if (pt.t > offset) g.gain.linearRampToValueAtTime(pt.g * lvl, when + pt.t - offset);
      src.stop(when + Math.max(0.05, cue.dur - offset) + 0.05);
    } else if (cue.loop && cue.dur) {
      const end = when + Math.max(0.05, cue.dur - offset);
      g.gain.setValueAtTime(lvl, Math.max(when, end - 0.08));
      g.gain.linearRampToValueAtTime(0, end);
      src.stop(end + 0.02);
    }
    return src;
  }

  // Live playback from timeline time `from`.
  play(tl, p, from) {
    this.stop();
    this.resume();
    this.tl = tl; this.p = p;
    this.from = from;
    this.t0 = this.ctx.currentTime + 0.08;
    this.cursor = 0;
    this.playing = true;
    // Cues that started before `from` but are still sounding (voices, ringtones).
    for (let i = 0; i < tl.audio.length; i++) {
      const c = tl.audio[i];
      if (c.t >= from) { this.cursor = i; break; }
      this.cursor = i + 1;
      const buf = this.bufferFor(c, p);
      if (!buf) continue;
      const len = c.loop ? c.dur : buf.duration;
      if (c.t + len > from + 0.05) this.track(this.startCue(this.ctx, this.buses, buf, c, this.t0, from - c.t));
    }
    this.tick();
  }

  now() {
    return this.playing ? this.from + (this.ctx.currentTime - this.t0) : this.from;
  }

  tick() {
    if (!this.playing) return;
    const horizon = this.now() + 1.0;
    const a = this.tl.audio;
    while (this.cursor < a.length && a[this.cursor].t <= horizon) {
      const c = a[this.cursor++];
      const buf = this.bufferFor(c, this.p);
      if (buf) this.track(this.startCue(this.ctx, this.buses, buf, c, this.t0 + (c.t - this.from), 0));
    }
  }

  track(src) {
    if (!src) return;
    this.active.add(src);
    src.onended = () => this.active.delete(src);
  }

  stop() {
    this.playing = false;
    for (const s of this.active) { try { s.stop(); } catch { /* already stopped */ } }
    this.active.clear();
  }

  // One-shot preview of a slot or media id.
  async preview(nameOrId, p) {
    await this.ready;
    this.resume();
    let buf = this.bank[nameOrId];
    const ov = p?.sounds.overrides?.[nameOrId];
    if (ov) buf = await this.loadMedia(ov);
    if (!buf) buf = await this.loadMedia(nameOrId);
    if (!buf) return;
    const cue = { bus: 'sfx', loop: false };
    this.track(this.startCue(this.ctx, this.buses, buf, cue, this.ctx.currentTime + 0.02, 0));
  }

  // Full mix rendered offline (deterministic, used by export).
  async renderMix(tl, p) {
    await this.prepare(tl, p);
    const oc = new OfflineAudioContext(2, Math.ceil(tl.duration * SR), SR);
    const lim = oc.createDynamicsCompressor();
    lim.threshold.value = -2; lim.ratio.value = 20; lim.attack.value = 0.002; lim.release.value = 0.12; lim.knee.value = 0;
    const master = oc.createGain();
    master.gain.value = 0.9;
    master.connect(lim).connect(oc.destination);
    const buses = this.makeBuses(oc, master);
    for (const c of tl.audio) {
      const buf = this.bufferFor(c, p);
      if (buf) this.startCue(oc, buses, buf, c, c.t, 0);
    }
    return oc.startRendering();
  }
}

// Waveform bars for voice-note bubbles: n values 0..100, loudest bar = 100.
export function peaksOf(buf, n = 48) {
  const d = buf.getChannelData(0);
  const step = Math.max(1, Math.floor(d.length / n));
  const out = [];
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let j = i * step; j < Math.min(d.length, (i + 1) * step); j++) sum += d[j] * d[j];
    out.push(Math.sqrt(sum / step));
  }
  const max = Math.max(...out, 1e-6);
  return out.map((v) => Math.round((v / max) * 100));
}

export function encodeWav(buf) {
  const ch = buf.numberOfChannels, len = buf.length, sr = buf.sampleRate;
  const data = new DataView(new ArrayBuffer(44 + len * ch * 2));
  const w = (o, s) => { for (let i = 0; i < s.length; i++) data.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); data.setUint32(4, 36 + len * ch * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  data.setUint32(16, 16, true); data.setUint16(20, 1, true); data.setUint16(22, ch, true);
  data.setUint32(24, sr, true); data.setUint32(28, sr * ch * 2, true); data.setUint16(32, ch * 2, true); data.setUint16(34, 16, true);
  w(36, 'data'); data.setUint32(40, len * ch * 2, true);
  const chans = Array.from({ length: ch }, (_, i) => buf.getChannelData(i));
  let o = 44;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < ch; c++) {
      const s = Math.max(-1, Math.min(1, chans[c][i]));
      data.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      o += 2;
    }
  }
  return new Blob([data], { type: 'audio/wav' });
}
