// AI control for Fake Phone. An AI (through the MCP server in mcp/, or any HTTP client) calls
//   POST http://127.0.0.1:47680/agent/call   { cmd, args }   with   Authorization: Bearer <token>
// and the open Fake Phone window does the work: the page long-polls this module for commands, runs them
// (app/js/agent.js) and posts the result back. Off by default; local only; token required; requests that
// carry a browser Origin header are refused (so web pages cannot reach it).
import http from 'node:http';
import crypto from 'node:crypto';

export const DEFAULT_AGENT_PORT = 47680;
const MAX_BODY = 300 * 1024 * 1024;     // a video sent as base64
const POLL_HOLD_MS = 20000;
const PAGE_ALIVE_MS = 45000;
const LONG_COMMANDS = new Set(['export_video', 'generate_voices']);

function readJson(req, limit = MAX_BODY) {
  return new Promise((resolve, reject) => {
    const parts = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error('request too large'), { status: 413 })); req.destroy(); return; }
      parts.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(parts).toString('utf8');
      if (!raw.trim()) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { reject(Object.assign(new Error('body is not JSON'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}
const send = (res, code, obj) => {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(body);
};

// info.mcp = { command, args, env }: how to start the MCP server (the token and port are added here)
export function createAgent({ port = DEFAULT_AGENT_PORT, enabled = false, token = '', version = '', info = {}, onConfig = () => {} } = {}) {
  const st = { enabled: false, port, token, listening: false, error: '' };
  let server = null;
  const queue = [];                 // commands waiting for the page
  const inflight = new Map();       // commands the page is running
  const inflightJobs = new Map();   // every job by id (queued or running)
  const cancelled = new Set();      // ids of jobs a client gave up on
  let held = null;                  // the page's open long poll { res, timer }
  let lastPoll = 0;
  let seq = 0;

  const connected = () => !!held || inflight.size > 0 || Date.now() - lastPoll < PAGE_ALIVE_MS;
  const newToken = () => crypto.randomBytes(24).toString('hex');
  const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

  function publicConfig() {
    return {
      enabled: st.enabled, port: st.port, token: st.token, listening: st.listening, error: st.error, pageConnected: connected(), version,
      url: `http://127.0.0.1:${st.port}`,
      mcp: info.mcp ? { command: info.mcp.command, args: info.mcp.args, env: { ...(info.mcp.env || {}), FAKE_PHONE_URL: `http://127.0.0.1:${st.port}`, FAKE_PHONE_TOKEN: st.token } } : null,
    };
  }

  // ---- commands going to the page ---------------------------------------------------------------
  function dispatch() {
    if (!held || !queue.length) return;
    const job = queue.shift();
    job.sent = true;
    clearTimeout(job.connectTimer);
    inflight.set(job.id, job);
    clearTimeout(held.timer);
    const r = held.res;
    held = null;
    send(r, 200, { id: job.id, cmd: job.cmd, args: job.args });
  }

  // returns { promise, cancel }: cancel() stops a waiting command and tells the page to abort a running one
  function callJob(cmd, args, ms) {
    const job = { id: `${++seq}-${crypto.randomBytes(3).toString('hex')}`, cmd, args, sent: false, watchers: [] };
    const drop = () => { const i = queue.indexOf(job); if (i >= 0) queue.splice(i, 1); inflight.delete(job.id); clearTimeout(job.timer); clearTimeout(job.connectTimer); };
    const tell = (msg) => { for (const w of job.watchers) { clearTimeout(w.timer); send(w.res, 200, msg); } job.watchers = []; };
    const promise = new Promise((resolve, reject) => {
      job.resolve = (v) => { drop(); tell({ done: true }); resolve(v); };
      job.reject = (e) => { drop(); tell({ done: true }); reject(e); };
      job.timer = setTimeout(() => { tell({ cancelled: true }); job.reject(Object.assign(new Error(`Timed out after ${Math.round(ms / 1000)}s waiting for Fake Phone`), { status: 504 })); }, ms);
      queue.push(job);
      if (!connected()) {
        // nobody is polling: give the window a moment (it may be starting), then say so
        job.connectTimer = setTimeout(() => { if (!job.sent) job.reject(Object.assign(new Error('The Fake Phone window is not connected. Open the app and keep AI control switched on.'), { status: 503 })); }, 8000);
      }
      dispatch();
    });
    job.cancel = () => {
      if (!queue.includes(job) && !inflight.has(job.id)) return;
      cancelled.add(job.id);
      setTimeout(() => cancelled.delete(job.id), 120000);
      tell({ cancelled: true });
      job.reject(Object.assign(new Error('cancelled'), { status: 499 }));
    };
    inflightJobs.set(job.id, job);
    promise.finally(() => inflightJobs.delete(job.id)).catch(() => {});
    return { promise, cancel: job.cancel };
  }
  const call = (cmd, args, ms) => callJob(cmd, args, ms).promise;

  // ---- routes the page uses (same origin as the app) ---------------------------------------------
  async function handleInternal(req, res, u) {
    try {
      if (u.pathname === '/api/agent/config') {
        if (req.method === 'POST') { const b = await readJson(req, 1e5); return send(res, 200, await configure({ enabled: b.enabled, rotate: !!b.rotate })); }
        return send(res, 200, publicConfig());
      }
      if (u.pathname === '/api/agent/poll') {
        if (!st.enabled) return send(res, 200, { disabled: true });
        lastPoll = Date.now();
        if (held) { clearTimeout(held.timer); send(held.res, 200, {}); held = null; }
        const timer = setTimeout(() => { if (held && held.res === res) { held = null; send(res, 200, {}); } }, POLL_HOLD_MS);
        held = { res, timer };
        res.on('close', () => { if (held && held.res === res) { clearTimeout(timer); held = null; lastPoll = Date.now(); } });
        return dispatch();
      }
      // the page asks, while it runs a long command, whether the client gave up (answers {cancelled} / {done} / {} after 20 s)
      if (u.pathname === '/api/agent/cancelwatch') {
        const id = u.searchParams.get('id');
        const job = inflight.get(id);
        if (cancelled.has(id)) return send(res, 200, { cancelled: true });
        if (!job) return send(res, 200, { done: true });
        const timer = setTimeout(() => { job.watchers = job.watchers.filter((w) => w.res !== res); send(res, 200, {}); }, POLL_HOLD_MS);
        job.watchers.push({ res, timer });
        res.on('close', () => { clearTimeout(timer); job.watchers = job.watchers.filter((w) => w.res !== res); });
        return;
      }
      if (u.pathname === '/api/agent/result' && req.method === 'POST') {
        const job = inflight.get(u.searchParams.get('id'));
        const b = await readJson(req);
        lastPoll = Date.now();
        if (!job) return send(res, 404, { ok: false, error: 'unknown command id (it timed out?)' });
        inflight.delete(job.id);
        clearTimeout(job.timer);
        if (b.ok) job.resolve(b.result); else job.reject(Object.assign(new Error(b.error || 'command failed'), { status: 422 }));
        return send(res, 200, { ok: true });
      }
      return send(res, 404, { error: 'not found' });
    } catch (e) { return send(res, e.status || 500, { ok: false, error: String(e.message || e) }); }
  }

  // ---- the public API for the AI ------------------------------------------------------------------
  async function external(req, res) {
    try {
      const host = String(req.headers.host || '').toLowerCase();
      if (host !== `127.0.0.1:${st.port}` && host !== `localhost:${st.port}`) return send(res, 403, { ok: false, error: 'bad Host header' });
      if (req.headers.origin) return send(res, 403, { ok: false, error: 'requests from web pages are not allowed' });
      const auth = String(req.headers.authorization || '');
      const given = auth.startsWith('Bearer ') ? auth.slice(7) : String(req.headers['x-fake-phone-token'] || '');
      if (!st.token || !same(given, st.token)) return send(res, 401, { ok: false, error: 'missing or wrong token (see Voices & Keys > AI control in Fake Phone)' });
      const u = new URL(req.url, 'http://127.0.0.1');
      if (req.method === 'GET' && u.pathname === '/agent/status') {
        return send(res, 200, { ok: true, app: 'fake-phone', version, pageConnected: connected(), pending: queue.length + inflight.size });
      }
      if (req.method === 'POST' && u.pathname === '/agent/call') {
        const b = await readJson(req);
        if (typeof b.cmd !== 'string' || !/^[a-z_]{1,40}$/.test(b.cmd)) return send(res, 400, { ok: false, error: 'cmd must be a command name' });
        const ms = (Number(b.timeoutSec) || (LONG_COMMANDS.has(b.cmd) ? 1800 : 120)) * 1000;
        // a slow command (an export): after 15 s answer "200" and keep the connection alive with spaces, so clients
        // do not give up (Node's fetch waits 5 min for a header); the JSON, with ok true/false, follows at the end
        let streaming = false, ka = null;
        const slow = setTimeout(() => {
          streaming = true;
          res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
          res.write(' ');
          ka = setInterval(() => res.write(' '), 10000);
        }, 15000);
        const finish = (code, obj) => { clearTimeout(slow); clearInterval(ka); if (res.destroyed) return; if (streaming) res.end(JSON.stringify(obj)); else send(res, code, obj); };
        const job = callJob(b.cmd, b.args && typeof b.args === 'object' ? b.args : {}, ms);
        res.on('close', () => { clearTimeout(slow); clearInterval(ka); if (!res.writableEnded) job.cancel(); });   // the client gave up
        try { return finish(200, { ok: true, result: await job.promise }); }
        catch (e) { return finish(e.status || 500, { ok: false, error: String(e.message || e) }); }
      }
      return send(res, 404, { ok: false, error: 'unknown route' });
    } catch (e) { return send(res, e.status || 500, { ok: false, error: String(e.message || e) }); }
  }

  function listen() {
    if (server) return Promise.resolve();
    return new Promise((resolve) => {
      const s = http.createServer((req, res) => { external(req, res); });
      s.once('error', (e) => {
        st.listening = false;
        st.error = e.code === 'EADDRINUSE' ? `Port ${st.port} is in use (is another Fake Phone open?)` : String(e.message || e);
        server = null;
        resolve();
      });
      s.listen(st.port, '127.0.0.1', () => { server = s; st.listening = true; st.error = ''; resolve(); });
    });
  }
  function unlisten() {
    for (const j of [...queue, ...inflight.values()]) j.fail(Object.assign(new Error('AI control was turned off'), { status: 503 }));
    if (held) { clearTimeout(held.timer); send(held.res, 200, { disabled: true }); held = null; }
    st.listening = false;
    if (!server) return Promise.resolve();
    const s = server;
    server = null;
    return new Promise((resolve) => { s.close(() => resolve()); s.closeAllConnections?.(); });
  }

  // enabled / rotate: turn it on or off, or make a new token. Persists through onConfig.
  async function configure({ enabled: want, rotate } = {}) {
    const on = want ?? st.enabled;
    if (rotate || (on && !st.token)) st.token = newToken();
    st.enabled = on;
    if (on) { st.error = ''; await listen(); } else { await unlisten(); st.error = ''; }
    onConfig({ enabled: st.enabled, token: st.token });
    return publicConfig();
  }

  return { configure, handleInternal, publicConfig, start: () => configure({ enabled }), close: unlisten, call };
}
