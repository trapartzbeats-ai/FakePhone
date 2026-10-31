// Video export. Main path: frame-exact offline render (WebCodecs H.264 + offline audio mix) muxed
// to MP4 by the local server's ffmpeg. Fallback: realtime canvas + MediaRecorder capture.
import { renderFrame } from './render/renderer.js';
import { encodeWav } from './audio.js';
import { ensureVisuals } from './media.js';
import { download } from './util.js';

export async function preloadAssets(p, tl) {
  const ids = [p.background.mediaId, p.wallpaper.mediaId, p.me.avatar, ...p.contacts.map((c) => c.avatar), ...p.inbox.map((r) => r.avatar), ...tl.items.map((i) => i.mediaId)];
  await ensureVisuals(ids.filter(Boolean));
  const text = p.events.map((e) => [e.text, ...(e.lines || []).map((l) => l.text)].join(' ')).join(' ') + p.contacts.map((c) => c.name).join(' ');
  await Promise.all([
    document.fonts.load('17px Inter'), document.fonts.load('600 17px Inter'), document.fonts.load('700 17px Inter'),
    document.fonts.load('17px Roboto'), document.fonts.load('17px "Noto Color Emoji"', text || '🙂'),
  ]).catch(() => {});
}

async function pickCodec(w, h, fps, bitrate) {
  if (!('VideoEncoder' in window)) return null;
  for (const codec of ['avc1.640028', 'avc1.4d0028', 'avc1.42002a', 'avc1.640033']) {
    const cfg = { codec, width: w, height: h, bitrate, framerate: fps, avc: { format: 'annexb' }, latencyMode: 'quality' };
    try { if ((await VideoEncoder.isConfigSupported(cfg)).supported) return cfg; } catch { /* try next */ }
  }
  return null;
}

// onProgress(fraction, label). Returns { url, file } from the server.
export async function exportVideo({ p, tl, engine, width, height, fps, name, onProgress, signal }) {
  await preloadAssets(p, tl);
  const info = await fetch('/api/info').then((r) => r.json()).catch(() => null);
  const cfg = info?.ffmpeg ? await pickCodec(width, height, fps, width >= 1080 ? 12e6 : 7e6) : null;
  if (!cfg) return exportRealtime({ p, tl, engine, width, height, fps, name, onProgress, signal, serverOk: !!info });

  onProgress(0, 'Mixing audio');
  const mix = await engine.renderMix(tl, p);
  const job = (await (await fetch('/api/export/begin', { method: 'POST' })).json()).job;
  await fetch(`/api/export/${job}/audio`, { method: 'POST', body: encodeWav(mix) });

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  let pending = [], pendingBytes = 0, failed = null, first = true;
  const flush = async () => {
    if (!pending.length) return;
    const body = new Blob(pending);
    pending = []; pendingBytes = 0;
    const r = await fetch(`/api/export/${job}/video${first ? '' : '?append=1'}`, { method: 'POST', body });
    first = false;
    if (!r.ok) throw new Error('upload failed');
  };
  const enc = new VideoEncoder({
    output: (chunk) => { const b = new Uint8Array(chunk.byteLength); chunk.copyTo(b); pending.push(b); pendingBytes += b.byteLength; },
    error: (e) => { failed = e; },
  });
  enc.configure(cfg);
  const total = Math.ceil(tl.duration * fps);
  for (let i = 0; i < total; i++) {
    if (signal?.aborted) { enc.close(); throw new Error('Export cancelled'); }
    if (failed) throw failed;
    renderFrame(ctx, p, tl, i / fps);
    const frame = new VideoFrame(canvas, { timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps) });
    enc.encode(frame, { keyFrame: i % (fps * 2) === 0 });
    frame.close();
    if (enc.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 0));
    if (pendingBytes > 4e6) await flush();
    if (i % 10 === 0) { onProgress(i / total, `Rendering frame ${i} / ${total}`); await new Promise((r) => setTimeout(r, 0)); }
  }
  await enc.flush();
  enc.close();
  await flush();
  onProgress(1, 'Muxing MP4');
  const r = await fetch(`/api/export/${job}/finish?fps=${fps}&name=${encodeURIComponent(name)}`, { method: 'POST' });
  const out = await r.json();
  if (!r.ok) throw new Error(out.error || 'ffmpeg failed');
  return out;
}

// Plays the timeline in real time and records the canvas + audio. Keep the tab visible.
async function exportRealtime({ p, tl, engine, width, height, fps, name, onProgress, signal, serverOk }) {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');
  const dest = engine.ctx.createMediaStreamDestination();
  engine.master.connect(dest);
  const stream = new MediaStream([...canvas.captureStream(fps).getVideoTracks(), ...dest.stream.getAudioTracks()]);
  const mime = ['video/mp4;codecs=avc1,mp4a.40.2', 'video/webm;codecs=vp9,opus', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m));
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 10e6 });
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  await engine.prepare(tl, p);
  renderFrame(ctx, p, tl, 0);
  rec.start(500);
  engine.play(tl, p, 0);
  await new Promise((resolve) => {
    const loop = () => {
      const t = engine.now();
      engine.tick();
      renderFrame(ctx, p, tl, Math.min(t, tl.duration));
      onProgress(t / tl.duration, 'Recording in real time (keep this tab visible)');
      if (t >= tl.duration || signal?.aborted) return resolve();
      requestAnimationFrame(loop);
    };
    loop();
  });
  engine.stop();
  await new Promise((r) => { rec.onstop = r; rec.stop(); });
  engine.master.disconnect(dest);
  const blob = new Blob(chunks, { type: rec.mimeType });
  const ext = rec.mimeType.includes('mp4') ? 'mp4' : 'webm';
  if (serverOk) {
    onProgress(1, 'Saving');
    const r = await fetch(`/api/export/upload?name=${encodeURIComponent(name)}&ext=${ext}`, { method: 'POST', body: blob });
    if (r.ok) return r.json();
  }
  download(blob, `${name}.${ext}`);
  return { url: null, file: `${name}.${ext} (downloaded)` };
}
