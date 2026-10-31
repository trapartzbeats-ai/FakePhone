// Images, GIFs and audio files stored in IndexedDB. Visuals decode to ImageBitmaps (all GIF frames
// via ImageDecoder) so the renderer can draw any frame at any time.
import { putMedia, getMedia } from './store.js';
import { uid } from './util.js';

const visuals = new Map();   // id -> { state, frames:[{bmp, t}], total, w, h }
let onChange = () => {};
export function onMediaChange(fn) { onChange = fn; }

export async function addMediaBlob(blob, name = '', extra = {}) {
  const mime = blob.type || '';
  const kind = mime.startsWith('audio/') || mime === 'video/webm' && extra.kind === 'audio' ? 'audio'
    : mime === 'image/gif' || mime === 'image/webp' && extra.animated ? 'gif' : mime.startsWith('image/') ? 'image' : extra.kind || 'file';
  const rec = { id: uid('m'), kind, mime, name, blob, created: Date.now(), ...extra };
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
