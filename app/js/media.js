// Images, GIFs and audio files stored in IndexedDB. Visuals decode to ImageBitmaps (all GIF frames
// via ImageDecoder) so the renderer can draw any frame at any time.
import { putMedia, getMedia } from './store.js';
import { uid, clamp } from './util.js';

const visuals = new Map();   // id -> { state, frames:[{bmp, t}], total, w, h }
let onChange = () => {};
export function onMediaChange(fn) { onChange = fn; }

export async function addMediaBlob(blob, name = '', extra = {}) {
  const mime = blob.type || '';
  const kind = mime.startsWith('audio/') || mime === 'video/webm' && extra.kind === 'audio' ? 'audio'
    : mime.startsWith('video/') ? 'video'
    : mime === 'image/gif' || mime === 'image/webp' && extra.animated ? 'gif' : mime.startsWith('image/') ? 'image' : extra.kind || 'file';
  const rec = { id: uid('m'), kind, mime, name, blob, created: Date.now(), ...extra };
  if (kind === 'video') Object.assign(rec, await probeVideo(blob));
  if (kind === 'image' || kind === 'gif') {
    try {
      const bmp = await createImageBitmap(blob);
      rec.w = bmp.width; rec.h = bmp.height;
      bmp.close();
    } catch { /* undecodable image; still stored */ }
  }
  await putMedia(rec);
  return rec;
}

export function visual(id) {
  if (!id) return null;
  const v = visuals.get(id);
  if (v) return v.state === 'ready' ? v : null;
  const entry = { state: 'loading' };
  visuals.set(id, entry);
  load(id, entry).then(() => onChange(id)).catch((e) => { entry.state = 'error'; console.warn('media', id, e); });
  return null;
}

export function ensureVisuals(ids) {
  return Promise.all([...new Set(ids)].filter(Boolean).map(async (id) => {
    visual(id);
    for (let i = 0; i < 400 && visuals.get(id)?.state === 'loading'; i++) await new Promise((r) => setTimeout(r, 25));
  }));
}

async function load(id, entry) {
  const rec = await getMedia(id);
  if (!rec) { entry.state = 'error'; return; }
  const maxSide = 720;
  const frames = [];
  let total = 0;
  if ((rec.kind === 'gif' || rec.mime === 'image/webp') && 'ImageDecoder' in window) {
    try {
      const dec = new ImageDecoder({ data: await rec.blob.arrayBuffer(), type: rec.mime });
      await dec.completed;
      const n = Math.min(dec.tracks.selectedTrack.frameCount, 240);
      for (let i = 0; i < n; i++) {
        const { image } = await dec.decode({ frameIndex: i });
        const scale = Math.min(1, maxSide / Math.max(image.displayWidth, image.displayHeight));
        const bmp = await createImageBitmap(image, scale < 1 ? { resizeWidth: Math.round(image.displayWidth * scale), resizeHeight: Math.round(image.displayHeight * scale) } : {});
        const d = Math.max(0.02, (image.duration || 100000) / 1e6);
        frames.push({ bmp, t: total });
        total += d;
        image.close();
      }
      dec.close();
    } catch (e) { console.warn('gif decode', e); }
  }
  if (!frames.length) {
    const full = await createImageBitmap(rec.blob);
    const scale = Math.min(1, 1600 / Math.max(full.width, full.height));
    const bmp = scale < 1 ? await createImageBitmap(full, { resizeWidth: Math.round(full.width * scale), resizeHeight: Math.round(full.height * scale) }) : full;
    frames.push({ bmp, t: 0 });
  }
  Object.assign(entry, { state: 'ready', frames, total, w: frames[0].bmp.width, h: frames[0].bmp.height });
}

// Bitmap for time t (GIFs loop from their own start time).
export function frameAt(v, t) {
  if (v.frames.length === 1 || !v.total) return v.frames[0].bmp;
  const lt = ((t % v.total) + v.total) % v.total;
  let f = v.frames[0];
  for (const fr of v.frames) { if (fr.t <= lt) f = fr; else break; }
  return f.bmp;
}

export async function mediaURL(id) {
  const rec = await getMedia(id);
  return rec ? URL.createObjectURL(rec.blob) : '';
}

// ---- video ------------------------------------------------------------------------------------
// Each video lives in one hidden <video> element. In the editor the element follows the playhead
// (plays while the project plays, seeks while scrubbing); the exporter takes it over and seeks it to
// the exact frame it needs (setVideoExport), so exported videos are frame-exact.
const vids = new Map();   // id -> { state, el, url, w, h, dur }
let vidPlaying = false, vidExport = false;

function openVideo(blob) {
  const el = document.createElement('video');
  el.muted = true; el.playsInline = true; el.preload = 'auto';
  const url = URL.createObjectURL(blob);
  el.src = url;
  return { el, url };
}

// size and length of a video file; throws if this browser cannot play it
async function probeVideo(blob) {
  const { el, url } = openVideo(blob);
  try {
    await new Promise((res, rej) => { el.onloadedmetadata = res; el.onerror = () => rej(new Error('This browser cannot play that video. An .mp4 (H.264) or .webm works.')); });
    return { w: el.videoWidth, h: el.videoHeight, dur: Number.isFinite(el.duration) ? el.duration : 5 };
  } finally { URL.revokeObjectURL(url); }
}

// One element per use (message), so the same file sent twice can sit on two different frames.
export function videoOf(id, use = '') {
  if (!id) return null;
  const key = id + '|' + use;
  const v = vids.get(key);
  if (v) return v.state === 'ready' ? v : null;
  const entry = { state: 'loading' };
  vids.set(key, entry);
  loadVideo(id, entry).then(() => onChange(id)).catch((e) => { entry.state = 'error'; console.warn('video', id, e); });
  return null;
}

async function loadVideo(id, entry) {
  const rec = await getMedia(id);
  if (!rec) { entry.state = 'error'; return; }
  const { el, url } = openVideo(rec.blob);
  await new Promise((res, rej) => { el.onloadeddata = res; el.onerror = () => rej(new Error('cannot play video')); });
  Object.assign(entry, { el, url, w: el.videoWidth, h: el.videoHeight, dur: el.duration, state: 'ready' });
}

// uses = [{ mediaId, evId }]
export function ensureVideos(uses) {
  return Promise.all(uses.map(async (u) => {
    videoOf(u.mediaId, u.evId);
    for (let i = 0; i < 400 && vids.get(u.mediaId + '|' + u.evId)?.state === 'loading'; i++) await new Promise((r) => setTimeout(r, 25));
  }));
}

export function setVideoPlaying(on) {
  vidPlaying = on;
  if (!on) for (const v of vids.values()) v.el?.pause();
}
export function setVideoExport(on) {
  vidExport = on;
  if (on) for (const v of vids.values()) v.el?.pause();
}

// Make the element show the frame at `lt` seconds into the video. `active` = it should be playing now.
export function syncVideo(v, lt, active) {
  if (vidExport) return;
  const el = v.el;
  lt = clamp(lt, 0, Math.max(0, v.dur - 0.04));
  if (vidPlaying && active) {
    if (el.paused) { el.currentTime = lt; el.play().catch(() => {}); }
    else if (Math.abs(el.currentTime - lt) > 0.3) el.currentTime = lt;
  } else {
    if (!el.paused) el.pause();
    if (!el.seeking && Math.abs(el.currentTime - lt) > 0.03) { el.currentTime = lt; el.addEventListener('seeked', () => onChange(), { once: true }); }
  }
}

// Export: put every video of the timeline on its exact frame for time t before the frame is drawn.
export async function primeVideos(tl, t) {
  const jobs = [];
  for (const it of tl.items) {
    if (it.kind !== 'video') continue;
    const v = vids.get(it.mediaId + '|' + it.evId);
    if (v?.state !== 'ready') continue;
    const lt = clamp(t - (it.tPlay ?? 1e9), 0, Math.max(0, v.dur - 0.04));
    const el = v.el;
    if (Math.abs(el.currentTime - lt) < 1e-3 && !el.seeking && el.readyState >= 2) continue;
    jobs.push(new Promise((res) => {
      const done = () => { clearTimeout(timer); el.removeEventListener('seeked', done); res(); };
      const timer = setTimeout(done, 3000);
      el.addEventListener('seeked', done);
      el.currentTime = lt;
    }));
  }
  await Promise.all(jobs);
}
