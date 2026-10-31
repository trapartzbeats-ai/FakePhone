// Small shared helpers.
export const IS_MAC = /Mac/.test(navigator.platform);
export const MOD = IS_MAC ? '⌘' : 'Ctrl+';   // shortcut labels; the key handler takes Ctrl or Cmd
// project fields that hold a stored media id (images, avatars, app icons, attached pictures, videos)
export const MEDIA_KEYS = ['mediaId', 'avatar', 'iconId', 'imageId'];
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const ease = (t) => { t = clamp(t, 0, 1); return 1 - Math.pow(1 - t, 3); };
export const easeInOut = (t) => { t = clamp(t, 0, 1); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
export const easeBack = (t) => { t = clamp(t, 0, 1); const c1 = 1.5, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
export const prog = (t, start, dur) => clamp((t - start) / dur, 0, 1);

export function uid(prefix = 'e') {
  return prefix + Math.random().toString(36).slice(2, 9);
}

// FNV-1a, returned as an unsigned int.
export function hashInt(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
export const hash = (str) => hashInt(str).toString(36);

// Deterministic 0..1 from an integer seed (mulberry32 step).
export function rnd(seed) {
  let t = (seed + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
export const graphemes = (s) => Array.from(segmenter.segment(s || ''), (x) => x.segment);

const PICTO = /\p{Extended_Pictographic}/u;
export function isEmojiOnly(s) {
  const g = graphemes((s || '').replace(/\s+/g, ''));
  return g.length > 0 && g.length <= 3 && g.every((x) => PICTO.test(x));
}
export const hasEmoji = (s) => PICTO.test(s || '');

export function words(s) {
  return (s || '').trim().split(/\s+/).filter(Boolean).length;
}

export function fmtTime(sec) {
  sec = Math.max(0, sec || 0);
  const m = Math.floor(sec / 60), s = sec - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

export function fmtClock(sec) {
  sec = Math.max(0, Math.floor(sec));
  return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
}

export const clone = (o) => structuredClone(o);

export function initials(name) {
  const parts = (name || '?').replace(/[^\p{L}\p{N} ]/gu, '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

export function debounce(fn, ms) {
  let id;
  return (...a) => { clearTimeout(id); id = setTimeout(() => fn(...a), ms); };
}

export function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}

export function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

export async function dataURLToBlob(url) {
  return (await fetch(url)).blob();
}
