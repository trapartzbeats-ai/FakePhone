// Smoke test for the desktop app. Starts it twice with throwaway data + exports folders and drives the page
// over the DevTools protocol: secure origin, WebCodecs, local fonts, the ElevenLabs proxy path, a real MP4
// export (checked with ffmpeg), and that a saved project is still there on the next launch.
// node tools/desktop-smoke.mjs ["path/to/Fake Phone.exe" | ".../Fake Phone.app/Contents/MacOS/Fake Phone"]
// (no path: Electron from source). FAKEPHONE_SMOKE_DIR sets the work folder (the CI build uploads it).
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const EXE = process.argv[2] || require('electron');
const ARGS = process.argv[2] ? [] : [ROOT];
// big files stay off C: on the author's machine
const WORK = process.env.FAKEPHONE_SMOKE_DIR || path.join(fs.existsSync('D:/Cache') ? 'D:/Cache' : os.tmpdir(), 'fakephone-smoke');
const FFMPEG = require('ffmpeg-static');
const PORT = 9339;

const results = [];
const check = (name, ok, info = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  ' + info : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// a covered window stops painting (screenshots then never come back), so keep it drawing
const FLAGS = ['--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling'];
const spawnApp = (extra = []) => spawn(EXE, [...ARGS, ...extra, ...FLAGS], {
  env: { ...process.env, FAKEPHONE_DATA_DIR: path.join(WORK, 'data'), FAKEPHONE_EXPORTS: path.join(WORK, 'exports') },
  stdio: 'ignore',
});
const exited = async (proc) => {
  for (let i = 0; i < 40 && proc.exitCode === null && proc.signalCode === null; i++) await sleep(250);
  if (proc.exitCode === null && proc.signalCode === null) { proc.kill(); for (let i = 0; i < 20 && proc.exitCode === null && proc.signalCode === null; i++) await sleep(250); }
};

async function launch() {
  const proc = spawnApp([`--remote-debugging-port=${PORT}`]);
  let target = null;
  for (let i = 0; i < 60 && !target; i++) {
    await sleep(500);
    try { target = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === 'page' && t.url.startsWith('fakephone://app')); } catch { /* not up yet */ }
  }
  if (!target) { proc.kill(); throw new Error('the app window never loaded fakephone://app'); }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let seq = 0;
  const waiting = new Map();
  const errors = [];
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && waiting.has(msg.id)) { waiting.get(msg.id)(msg); waiting.delete(msg.id); }
    if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') errors.push(msg.params.args.map((a) => a.value ?? a.description).join(' '));
  };
  // Electron 43 logs this when --remote-debugging-port meets a brand-new profile (8/8 that way, 0/6 on a fresh
  // profile without the port, 0/8 with the port on a used profile): it comes from this test, not the app
  const harness = (e) => /sandboxed_renderer\.bundle\.js script failed to run|binding\.startupData/.test(e);
  // every call has a time limit, so a stuck app fails the test instead of hanging it
  const send = (method, params = {}, secs = 60) => new Promise((r, j) => {
    const id = ++seq;
    const timer = setTimeout(() => { waiting.delete(id); j(new Error(`${method} got no answer in ${secs}s`)); }, secs * 1000);
    waiting.set(id, (msg) => { clearTimeout(timer); r(msg); });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const run = async (expr, secs) => {
    const r = await send('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true }, secs);
    if (r.error) throw new Error(r.error.message);
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || 'page error');
    return r.result?.result?.value;
  };
  // Browser.close never answers (the socket drops), so do not wait on it
  const close = async () => { send('Browser.close', {}, 5).catch(() => {}); await exited(proc); };
  await send('Runtime.enable');
  // The target is listed with its new URL before the page commits, so the first questions can reach the blank
  // page being replaced (context destroyed / no answer): ask again until the editor answers. Slow machines (the
  // Intel Mac runner) take well over 10 s to start it.
  let ready = 'not started after 60 s';
  for (const t0 = Date.now(); Date.now() - t0 < 60000; await sleep(500)) {
    try {
      ready = await run(`return window.fakePhone && window.fakePhone.tl ? 'ok' : (document.querySelector('.boot-error')?.textContent || 'starting');`, 10);
      if (ready === 'ok' || (ready && ready !== 'starting')) break;
    } catch (e) { ready = e.message; }
  }
  if (ready !== 'ok') { await close(); throw new Error('the editor did not start: ' + ready); }
  return { send, run, errors: () => errors.filter((e) => !harness(e)), close };
}

fs.rmSync(WORK, { recursive: true, force: true });
fs.mkdirSync(WORK, { recursive: true });
console.log(`app: ${EXE}\nwork: ${WORK}\n`);

// ---- first launch
let a = await launch();
const env = await a.run(`
  await document.fonts.load('17px Inter'); await document.fonts.load('17px "Noto Color Emoji"', '😀');
  const ed = window.fakePhone;
  const info = await (await fetch('/api/info')).json();
  const eleven = await fetch('/api/eleven/v1/user', { headers: { 'xi-api-key': 'not-a-real-key' } });
  // the frame-exact export needs an H.264 encoder (else it falls back to a realtime recording)
  const avc = (await VideoEncoder.isConfigSupported({ codec: 'avc1.640028', width: 720, height: 1280, bitrate: 7e6, framerate: 30, avc: { format: 'annexb' } })).supported;
  return { href: location.href, secure: isSecureContext, venc: typeof VideoEncoder, idec: typeof ImageDecoder, avc,
    inter: document.fonts.check('17px Inter'), emoji: document.fonts.check('17px "Noto Color Emoji"', '😀'),
    localFonts: !!document.querySelector('link[href="fonts/fonts.css"]') && !document.querySelector('link[href*="googleapis"]'),
    project: ed.p.name, events: ed.p.events.length, duration: ed.tl.duration, info, elevenStatus: eleven.status };
`);
check('page loads from fakephone://app', env.href.startsWith('fakephone://app/'), env.href);
check('secure context with WebCodecs + ImageDecoder', env.secure && env.venc === 'function' && env.idec === 'function');
check('H.264 encoder for the frame-exact export', env.avc);
check('fonts are local and loaded (Inter, Noto Color Emoji)', env.localFonts && env.inter && env.emoji);
check('demo project opens', env.events > 5 && env.duration > 5, `${env.project}, ${env.events} events, ${env.duration.toFixed(1)}s`);
check('server has ffmpeg', env.info.ffmpeg);
check('exports go to the test folder', path.resolve(env.info.exports) === path.resolve(WORK, 'exports'), env.info.exports);
check('ElevenLabs proxy reaches ElevenLabs (bogus key -> 401)', env.elevenStatus === 401, `status ${env.elevenStatus}`);

try {
  const shot = await a.send('Page.captureScreenshot', { format: 'png' }, 20);
  fs.writeFileSync(path.join(WORK, 'window.png'), Buffer.from(shot.result.data, 'base64'));
} catch (e) { console.log(`(no window screenshot: ${e.message})`); }

const t0 = Date.now();
const out = await a.run(`
  const { exportVideo } = await import('./js/export.js');
  const ed = window.fakePhone;
  return await exportVideo({ p: ed.p, tl: ed.tl, engine: ed.engine, width: 720, height: 1280, fps: 30, name: 'smoke test', onProgress() {} });
`, 600).catch((e) => ({ error: e.message }));
if (out?.error) console.log(`(export: ${out.error})`);
const file = out?.file || '';
check('export finishes as an MP4 in the exports folder', file.endsWith('.mp4') && fs.existsSync(file), `${path.basename(file)} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
if (fs.existsSync(file)) {
  const probe = spawnSync(FFMPEG, ['-hide_banner', '-i', file, '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' }).stderr;
  const dur = probe.match(/Duration: (\d+):(\d+):([\d.]+)/);
  const secs = dur ? +dur[1] * 3600 + +dur[2] * 60 + +dur[3] : 0;
  const mean = Number((probe.match(/mean_volume: (-?[\d.]+) dB/) || [])[1]);
  check('video is H.264 720x1280', /Video: h264.*720x1280/.test(probe));
  check('audio is AAC and not silent', /Audio: aac/.test(probe) && mean > -60, `mean ${mean} dB`);
  check('length matches the timeline', Math.abs(secs - env.duration) < 0.5, `${secs.toFixed(2)}s vs ${env.duration.toFixed(2)}s`);
}
await a.run(`const ed = window.fakePhone; ed.change(() => { ed.p.name = 'Smoke persist'; }); await ed.persist();`);
check('no page errors (first launch)', a.errors().length === 0, a.errors().slice(0, 3).join(' | '));
await a.close();
const log = fs.readFileSync(path.join(WORK, 'data', 'desktop.log'), 'utf8');
check('desktop.log records the start', /server on 127\.0\.0\.1:\d+, ffmpeg: \S+/.test(log), log.split('\n')[0].slice(25));

// ---- second launch: the server gets a new port, the saved project must still be there
a = await launch();
const again = await a.run(`return { name: window.fakePhone.p.name, exports: (await (await fetch('/api/exports')).json()).length };`);
check('saved project is back after a restart', again.name === 'Smoke persist', again.name);
check('exports list shows the video', again.exports >= 1);
const tab = await a.run(`
  document.querySelector('[data-tab="export"]').click();
  await new Promise((r) => setTimeout(r, 800));
  const text = document.body.innerText;
  return { folder: text.includes('Saved in ' + (await (await fetch('/api/info')).json()).exports),
    change: [...document.querySelectorAll('button')].some((b) => b.textContent === 'Change folder…'),
    listed: [...document.querySelectorAll('a.export-file')].some((x) => x.textContent.startsWith('smoke test.mp4')) };
`);
check('Export tab shows the folder, Change folder… and the video', tab.folder && tab.change && tab.listed, JSON.stringify(tab));

// ---- video playback: a 3 s clip whose brightness is its own clock (grey = 255 * seconds / 3), sent as a video
// message that opens full screen. The exported frames must show the right moment of the clip, and its sound.
const clip = path.join(WORK, 'exports', 'ramp.mp4');
const mk = spawnSync(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'nullsrc=s=360x640:r=30,geq=lum=16+219*T/3:cb=128:cr=128',
  '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100', '-t', '3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', '-c:a', 'aac', clip]);
check('test clip made', mk.status === 0 && fs.existsSync(clip), mk.stderr?.toString().slice(0, 120));
const vid = await a.run(`
  const media = await import('./js/media.js'), model = await import('./js/model.js'), { exportVideo } = await import('./js/export.js');
  const blob = await (await fetch('/exports/ramp.mp4')).blob();
  const rec = await media.addMediaBlob(new Blob([blob], { type: 'video/mp4' }), 'ramp.mp4');
  const ed = window.fakePhone;
  const p = model.migrate(model.newProject('video smoke'));
  p.events = [model.newEvent('msg', { from: 'c1', text: '', mediaId: rec.id, mediaKind: 'video', mediaDur: rec.dur, vmode: 'full' }, p)];
  ed.load(p);
  const pl = ed.tl.players[0];
  const out = await exportVideo({ p: ed.p, tl: ed.tl, engine: ed.engine, width: 720, height: 1280, fps: 30, name: 'video smoke', onProgress() {} });
  return { rec: { kind: rec.kind, w: rec.w, h: rec.h, dur: rec.dur }, pl, file: out.file, duration: ed.tl.duration };
`, 600).catch((e) => ({ error: e.message }));
if (vid.error) check('video message exports', false, vid.error);
else {
  check('video file is read (size, length)', vid.rec.kind === 'video' && vid.rec.w === 360 && vid.rec.h === 640 && Math.abs(vid.rec.dur - 3) < 0.2, JSON.stringify(vid.rec));
  check('video export finishes', fs.existsSync(vid.file), path.basename(vid.file));
  // grey level of a small box in the middle of the screen at time t (the player shows the clip there)
  const grey = (t) => spawnSync(FFMPEG, ['-v', 'error', '-ss', String(t), '-i', vid.file, '-frames:v', '1', '-vf', 'crop=40:40:340:620,scale=1:1', '-pix_fmt', 'gray', '-f', 'rawvideo', '-'], { maxBuffer: 1 << 20 }).stdout[0];
  const worst = [0.5, 1.4, 2.4].map((dt) => { const lt = (grey(vid.pl.tPlay + dt) / 255) * 3; return { dt, lt: Math.round(lt * 100) / 100, off: Math.abs(lt - dt) }; });
  check('exported frames show the right moment of the clip', worst.every((w) => w.off < 0.3), worst.map((w) => `${w.dt}s -> ${w.lt}s`).join(', '));
  const vol = (from, to) => Number((spawnSync(FFMPEG, ['-hide_banner', '-ss', String(from), '-t', String(to - from), '-i', vid.file, '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' }).stderr.match(/mean_volume: (-?[\d.]+) dB/) || [])[1]);
  const during = vol(vid.pl.tPlay + 0.3, vid.pl.tPlay + 2.7);
  check('the clip\'s sound is in the video while it plays', during > -35, `${during} dB`);
}
check('no page errors (second launch)', a.errors().length === 0, a.errors().slice(0, 3).join(' | '));
await a.close();

// ---- third launch, the way people start it: no debugger attached; desktop.log is the only window in
// (the old log says "page loaded" too, so it goes first; slow machines need the full minute)
const logFile = path.join(WORK, 'data', 'desktop.log');
fs.rmSync(logFile, { force: true });
const plain = spawnApp();
let plainLog = '';
for (let i = 0; i < 240 && !/page loaded/.test(plainLog); i++) { await sleep(250); try { plainLog = fs.readFileSync(logFile, 'utf8'); } catch { /* not written yet */ } }
await sleep(3000);
plainLog = fs.readFileSync(logFile, 'utf8');
check('plain launch: page loads', /page loaded/.test(plainLog));
check('plain launch: no page errors in desktop.log', !/page error|renderer gone/.test(plainLog), plainLog.split('\n').filter((l) => /page error|renderer gone/.test(l)).map((l) => l.slice(25)).join(' | '));
// opening it again while it runs: the second copy quits on its own and leaves the first one's log alone
const twice = spawnApp();
for (let i = 0; i < 80 && twice.exitCode === null && twice.signalCode === null; i++) await sleep(250);
const quitAlone = twice.exitCode !== null;
if (!quitAlone) twice.kill();
check('a second copy quits and leaves the log alone', quitAlone && /page loaded/.test(fs.readFileSync(logFile, 'utf8')));
plain.kill();
await exited(plain);

const failed = results.filter((r) => !r.ok).length;
const shotFile = path.join(WORK, 'window.png');
console.log(`\n${results.length - failed}/${results.length} passed.${fs.existsSync(shotFile) ? ' Screenshot: ' + shotFile : ''}`);
process.exit(failed ? 1 : 0);
