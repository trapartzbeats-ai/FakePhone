// Motion curves for every animation on the phone, built on PulseCore's easing library and spring
// physics (vendor/pulse). Springs are simulated once and baked into a lookup table so any frame can
// be evaluated at any time: scrubbing and export stay deterministic.
import { Easing } from './vendor/pulse/easing.js';
import { Spring } from './vendor/pulse/spring.js';

export const SPRINGS = {
  'spring.gentle': { label: 'Spring · gentle', stiffness: 120, damping: 17 },
  'spring.snappy': { label: 'Spring · snappy', stiffness: 300, damping: 24 },
  'spring.bouncy': { label: 'Spring · bouncy', stiffness: 240, damping: 13 },
  'spring.wobbly': { label: 'Spring · wobbly', stiffness: 180, damping: 8 },
};

export const EASE_NAMES = [...Object.keys(Easing).filter((k) => k !== 'wobble'), ...Object.keys(SPRINGS)];

// What each animation does by default. dur in seconds.
export const MOTION_KEYS = {
  send: { label: 'Sent bubble', dur: 0.32, ease: 'easeOutCubic' },
  receive: { label: 'Received bubble pop', dur: 0.34, ease: 'easeOutBack' },
  grow: { label: 'Chat scroll / make room', dur: 0.3, ease: 'easeOutCubic' },
  remove: { label: 'Unsend / remove', dur: 0.4, ease: 'easeInCubic' },
  keyboard: { label: 'Keyboard slide', dur: 0.32, ease: 'easeOutQuart' },
  screen: { label: 'Screen change', dur: 0.45, ease: 'easeInOutCubic' },
  banner: { label: 'Notification drop', dur: 0.55, ease: 'spring.snappy' },
  lockNote: { label: 'Lock screen notification', dur: 0.5, ease: 'spring.gentle' },
  reaction: { label: 'Reaction pop', dur: 0.38, ease: 'easeOutBack' },
  appOpen: { label: 'Open / close an app', dur: 0.5, ease: 'easeOutCubic' },
  swipe: { label: 'Swipe to delete (whole gesture)', dur: 1.7, ease: 'easeOutCubic' },
  call: { label: 'Call screen fade', dur: 0.35, ease: 'easeOutCubic' },
  camera: { label: 'Camera zoom / reset', dur: 0.7, ease: 'easeInOutCubic' },
  punch: { label: 'Camera punch-in', dur: 0.24, ease: 'spring.bouncy' },
};

const bakedSprings = new Map();
function bakeSpring(opts) {
  const key = `${opts.stiffness}|${opts.damping}|${opts.mass || 1}`;
  if (bakedSprings.has(key)) return bakedSprings.get(key);
  const s = new Spring(opts);
  const dt = 1 / 480;
  const xs = [0];
  let x = 0;
  for (let i = 0; i < 480 * 4; i++) {
    x = s.step(x, dt);
    xs.push(x);
    if (i > 24 && s.settled(x)) break;
  }
  xs[xs.length - 1] = 1;
  const n = xs.length - 1;
  const fn = (t) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    const f = t * n, i = Math.floor(f);
    return xs[i] + (xs[i + 1] - xs[i]) * (f - i);
  };
  bakedSprings.set(key, fn);
  return fn;
}

export function curve(name) {
  if (SPRINGS[name]) return bakeSpring(SPRINGS[name]);
  const f = Easing[name] || Easing.easeOutCubic;
  return (t) => (t <= 0 ? 0 : t >= 1 ? 1 : f(t));
}

let lastKey = '', lastMo = null;
// Resolved motion for a project: { key: { dur, ease, f } }, with the project's overrides applied.
export function resolveMotion(p) {
  const over = p.motion || {};
  const speed = p.motionSpeed || 1;
  const key = JSON.stringify(over) + speed;
  if (key === lastKey) return lastMo;
  const mo = {};
  for (const [k, d] of Object.entries(MOTION_KEYS)) {
    const o = over[k] || {};
    const ease = o.ease || d.ease;
    mo[k] = { dur: Math.max(0.05, (o.dur ?? d.dur) / speed), ease, f: curve(ease) };
  }
  lastKey = key;
  lastMo = mo;
  return mo;
}

// progress (0..1, linear) and eased value of a motion that starts at `start`.
export const lin = (m, t, start) => Math.max(0, Math.min(1, (t - start) / m.dur));
export const val = (m, t, start) => m.f(lin(m, t, start));
