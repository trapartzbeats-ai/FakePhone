// Fake Phone local server: serves the app, proxies ElevenLabs + GIPHY, muxes exports with ffmpeg.
// No dependencies: node server.js [port]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(ROOT, 'app');
const EXPORTS = path.join(ROOT, 'exports');
const TMP = path.join(EXPORTS, '_tmp');
const PORT = Number(process.argv[2] || process.env.PORT || 5190);

fs.mkdirSync(TMP, { recursive: true });
const FFMPEG = spawnSync('ffmpeg', ['-version']).status === 0 ? 'ffmpeg' : null;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.woff2': 'font/woff2',
};

function send(res, code, body, type) {
  if (body !== null && typeof body === 'object' && !Buffer.isBuffer(body)) {
    body = JSON.stringify(body);
    type = 'application/json';
  }
  res.writeHead(code, { 'content-type': type || 'text/plain', 'cache-control': 'no-store' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const parts = [];
    req.on('data', (c) => parts.push(c));
    req.on('end', () => resolve(Buffer.concat(parts)));
    req.on('error', reject);
  });
}

function pipeToFile(req, file, append) {
  return new Promise((resolve, reject) => {
    const out = fs.createWriteStream(file, { flags: append ? 'a' : 'w' });
    req.pipe(out);
    out.on('finish', resolve);
    out.on('error', reject);
    req.on('error', reject);
  });
}

function safeName(s, fallback) {
  const n = String(s || '').replace(/[^\w\- .()+&!',]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 80);
  return n || fallback;
}

function uniqueFile(dir, base, ext) {
  let f = path.join(dir, base + ext);
  for (let i = 2; fs.existsSync(f); i++) f = path.join(dir, `${base} (${i})${ext}`);
  return f;
}

function ffmpeg(args) {
  return new Promise((resolve, reject) => {
    const p = spawn(FFMPEG, args, { windowsHide: true });
    let err = '';
    p.stderr.on('data', (d) => { err += d; if (err.length > 20000) err = err.slice(-20000); });
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error('ffmpeg failed: ' + err.slice(-1500)))));
    p.on('error', reject);
  });
}

async function proxy(res, url, init) {
  const r = await fetch(url, init);
  const buf = Buffer.from(await r.arrayBuffer());
  res.writeHead(r.status, { 'content-type': r.headers.get('content-type') || 'application/octet-stream', 'cache-control': 'no-store' });
  res.end(buf);
}

async function route(req, res) {
  const u = new URL(req.url, 'http://localhost');
  const p = decodeURIComponent(u.pathname);

  if (p === '/api/info') return send(res, 200, { ffmpeg: !!FFMPEG, exports: EXPORTS });

  // ElevenLabs: the key comes from the browser (the user's own key) and is only forwarded.
  if (p.startsWith('/api/eleven/')) {
    const target = 'https://api.elevenlabs.io/' + p.slice('/api/eleven/'.length) + u.search;
    const headers = {};
    for (const h of ['xi-api-key', 'content-type', 'accept']) if (req.headers[h]) headers[h] = req.headers[h];
    // Body as a string: Node 25's fetch re-reads a Buffer body on a 401 and throws (detached ArrayBuffer).
    const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : (await readBody(req)).toString('utf8');
    return proxy(res, target, { method: req.method, headers, body });
  }

  if (p === '/api/giphy') {
    const kind = u.searchParams.get('q') ? 'search' : 'trending';
    const q = new URLSearchParams({ api_key: u.searchParams.get('key') || '', limit: '30', rating: 'pg-13' });
    if (kind === 'search') q.set('q', u.searchParams.get('q'));
    return proxy(res, `https://api.giphy.com/v1/gifs/${kind}?${q}`);
  }

  if (p === '/api/fetch') {
    const target = new URL(u.searchParams.get('url'));
    if (!/(^|\.)giphy\.com$/.test(target.hostname)) return send(res, 403, { error: 'host not allowed' });
    return proxy(res, target.href);
  }

  // Offline export: browser sends raw H.264 (Annex B) + a WAV mix, ffmpeg muxes to MP4.
  if (p === '/api/export/begin' && req.method === 'POST') {
    const job = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    fs.mkdirSync(path.join(TMP, job), { recursive: true });
    return send(res, 200, { job });
  }
  let m = p.match(/^\/api\/export\/([a-z0-9]+)\/(video|audio|finish)$/);
  if (m && req.method === 'POST') {
    const dir = path.join(TMP, m[1]);
    if (!fs.existsSync(dir)) return send(res, 404, { error: 'unknown job' });
    if (m[2] === 'video') { await pipeToFile(req, path.join(dir, 'v.h264'), u.searchParams.get('append') === '1'); return send(res, 200, { ok: true }); }
    if (m[2] === 'audio') { await pipeToFile(req, path.join(dir, 'a.wav'), false); return send(res, 200, { ok: true }); }
    if (!FFMPEG) return send(res, 500, { error: 'ffmpeg not found on PATH' });
    const fps = Math.max(1, Math.min(120, Number(u.searchParams.get('fps')) || 30));
    const out = uniqueFile(EXPORTS, safeName(u.searchParams.get('name'), 'fake-phone'), '.mp4');
    const v = path.join(dir, 'v.h264'), a = path.join(dir, 'a.wav');
    // Raw H.264 has no timestamps: setts stamps frame N at N/fps (with -shortest the audio would be cut to nothing).
    const base = ['-y', '-f', 'h264', '-framerate', String(fps), '-i', v, '-i', a, '-map', '0:v:0', '-map', '1:a:0'];
    const audio = ['-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', out];
    try {
      await ffmpeg([...base, '-c:v', 'copy', '-bsf:v', `setts=ts=N/TB_OUT/${fps}`, ...audio]);
    } catch {
      await ffmpeg([...base, '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', ...audio]);
    }
    fs.rmSync(dir, { recursive: true, force: true });
    return send(res, 200, { file: out, url: '/exports/' + encodeURIComponent(path.basename(out)) });
  }

  // Realtime fallback: a finished WebM/MP4 from MediaRecorder; converted to MP4 when ffmpeg exists.
  if (p === '/api/export/upload' && req.method === 'POST') {
    const name = safeName(u.searchParams.get('name'), 'fake-phone');
    const ext = u.searchParams.get('ext') === 'mp4' ? '.mp4' : '.webm';
    const raw = uniqueFile(EXPORTS, name, ext);
    await pipeToFile(req, raw, false);
    if (ext === '.webm' && FFMPEG) {
      const out = uniqueFile(EXPORTS, name, '.mp4');
      await ffmpeg(['-y', '-i', raw, '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', out]);
      fs.rmSync(raw, { force: true });
      return send(res, 200, { file: out, url: '/exports/' + encodeURIComponent(path.basename(out)) });
    }
    return send(res, 200, { file: raw, url: '/exports/' + encodeURIComponent(path.basename(raw)) });
  }

  if (p === '/api/exports') {
    const files = fs.readdirSync(EXPORTS)
      .filter((f) => /\.(mp4|webm)$/i.test(f))
      .map((f) => ({ name: f, url: '/exports/' + encodeURIComponent(f), size: fs.statSync(path.join(EXPORTS, f)).size, time: fs.statSync(path.join(EXPORTS, f)).mtimeMs }))
      .sort((a, b) => b.time - a.time);
    return send(res, 200, files);
  }

  // Dev: save a rendered PNG (render sheets) to exports/_dev for inspection.
  if (p === '/api/dev/save' && req.method === 'POST') {
    const dir = path.join(EXPORTS, '_dev');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, safeName(u.searchParams.get('name'), 'frame') + '.png');
    await pipeToFile(req, file, false);
    return send(res, 200, { file });
  }

  if (p === '/api/open-exports' && req.method === 'POST') {
    spawn('explorer', [EXPORTS], { detached: true, stdio: 'ignore' }).unref();
    return send(res, 200, { ok: true });
  }

  // Static files: /exports/* from the exports folder, everything else from app/.
  let base = APP, rel = p;
  if (p.startsWith('/exports/')) { base = EXPORTS; rel = p.slice('/exports'.length); }
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.join(base, path.normalize(rel));
  if (!file.startsWith(base) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(res, 404, 'not found');
  res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}

http.createServer((req, res) => {
  route(req, res).catch((e) => { if (!res.headersSent) send(res, 500, { error: String(e.message || e) }); else res.end(); });
}).listen(PORT, '127.0.0.1', () => {
  console.log(`Fake Phone running at http://localhost:${PORT}  (ffmpeg: ${FFMPEG ? 'yes' : 'no'})`);
});
