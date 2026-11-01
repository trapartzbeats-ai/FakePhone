// AI control, page side. When AI control is on, this long-polls the local server (agent.js at the repo root)
// for commands from the MCP server / HTTP API, runs them on the live editor (so you watch the AI work), and
// posts the result back. Every command validates its input and fails with a message that says what is allowed.
import { THEMES, DEVICES } from './themes.js';
import {
  newProject, demoProject, newEvent, parseScript, toScript, EVENT_TYPES, SCRIPT_HELP, SCREENS, BUBBLE_FX, SCREEN_FX, CAMERA_MOVES, CAMERA_TARGETS,
  REACTIONS, CONTACT_COLORS, chatTitle, ensureThemeApp, newHomeApp,
} from './model.js';
import { APP_NAMES } from './apps.js';
import { addMediaBlob, primeVideos, setVideoExport } from './media.js';
import { getMedia, putProject, getProject, listProjects } from './store.js';
import { renderFrame } from './render/renderer.js';
import { exportVideo, preloadAssets } from './export.js';
import { voiceLines, missingVoices, generateVoices } from './voicegen.js';
import { listVoices, ELEVEN_MODELS } from './voice.js';
import { uid, clone } from './util.js';

class AgentError extends Error {}
const fail = (msg) => { throw new AgentError(msg); };
const oneOf = (name, v, list) => { if (!list.includes(v)) fail(`${name} must be one of: ${list.join(', ')} (got ${JSON.stringify(v)})`); return v; };
const round = (n) => Math.round(n * 100) / 100;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- loop ------------------------------------------------------------------------------------------------
let editor = null;
let running = false;

export async function agentConfig(body) {
  const r = await fetch('/api/agent/config', body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
  return r.json();
}

export async function startAgent(ed) {
  editor = ed;
  window.fakePhoneAgent = { commands: () => Object.keys(CMDS), run: (cmd, args) => run(cmd, args) };
  const cfg = await agentConfig().catch(() => null);
  showPill(!!cfg?.enabled);
  if (cfg?.enabled) ensureAgentLoop();
}

export function ensureAgentLoop() {
  showPill(true);
  if (running) return;
  running = true;
  loop().finally(() => { running = false; });
}
export function stopAgentUi() { showPill(false); }

function showPill(on, busy = '') {
  const el = document.getElementById('aiPill');
  if (!el) return;
  el.hidden = !on;
  el.classList.toggle('busy', !!busy);
  el.textContent = busy ? `AI · ${busy}` : 'AI control on';
}

async function loop() {
  for (;;) {
    let job;
    try { job = await (await fetch('/api/agent/poll')).json(); } catch { await sleep(2000); continue; }
    if (job.disabled) { showPill(false); return; }
    if (!job.cmd) continue;
    showPill(true, job.cmd);
    // a long command can be stopped when the client gives up (the server tells us)
    const ac = new AbortController();
    if (LONG.has(job.cmd)) watchCancel(job.id, ac);
    let out;
    try { out = { ok: true, result: await run(job.cmd, job.args || {}, ac.signal) }; } catch (e) { out = { ok: false, error: String(e?.message || e) }; }
    ac.finished = true;
    showPill(true);
    try { await fetch('/api/agent/result?id=' + encodeURIComponent(job.id), { method: 'POST', body: JSON.stringify(out) }); } catch { /* the server went away */ }
  }
}

const LONG = new Set(['export_video', 'generate_voices']);
async function watchCancel(id, ac) {
  while (!ac.finished) {
    try {
      const j = await (await fetch('/api/agent/cancelwatch?id=' + encodeURIComponent(id))).json();
      if (j.cancelled) { ac.abort(); return; }
      if (j.done) return;
    } catch { await sleep(1000); }
  }
}

async function run(cmd, args, signal) {
  const fn = CMDS[cmd];
  if (!fn) fail(`Unknown command "${cmd}". Commands: ${Object.keys(CMDS).join(', ')}`);
  return fn(editor, args || {}, signal);
}

// ---- helpers ---------------------------------------------------------------------------------------------
// a person: 'me', an id, or a name (first names work too)
function who(p, v, { allowMe = true } = {}) {
  const n = String(v ?? '').trim().toLowerCase();
  if (allowMe && ['me', 'i', 'you', 'myself'].includes(n)) return 'me';
  const c = p.contacts.find((x) => x.id === v) || p.contacts.find((x) => x.name.toLowerCase() === n)
    || p.contacts.find((x) => x.name.toLowerCase().split(/\s+/)[0] === n.split(/\s+/)[0]);
  if (!c) fail(`Unknown person ${JSON.stringify(v)}. People: ${[...(allowMe ? ['me'] : []), ...p.contacts.map((x) => x.name)].join(', ')}`);
  return c.id;
}
function inboxRow(p, v) {
  if (v === 'chat') return 'chat';
  const n = String(v ?? '').trim().toLowerCase();
  const r = p.inbox.find((x) => x.id === v) || p.inbox.find((x) => x.name.toLowerCase() === n);
  if (!r) fail(`Unknown conversation ${JSON.stringify(v)}. Conversations: chat (this chat), ${p.inbox.map((x) => x.name).join(', ')}`);
  return r.id;
}
async function needMedia(id, kinds) {
  const rec = await getMedia(id);
  if (!rec) fail(`Unknown media id ${JSON.stringify(id)}. Upload the file first with upload_media.`);
  if (kinds && !kinds.includes(rec.kind)) fail(`That media is a ${rec.kind}; this needs ${kinds.join(' or ')}.`);
  return rec;
}
const mark = (ed, id) => { const m = ed.tl.marks[id]; return m ? { t0: round(m.t0), t1: round(m.t1) } : {}; };
const brief = (ed) => ({ duration: round(ed.tl.duration), events: ed.p.events.length });
const hex = (v) => (/^#[0-9a-f]{6}$/i.test(String(v)) ? String(v) : fail(`Colours are #rrggbb (got ${JSON.stringify(v)})`));
const bool = (name, v) => (typeof v === 'boolean' ? v : fail(`${name} must be true or false`));
const num = (name, v, lo, hi) => (Number.isFinite(Number(v)) && Number(v) >= lo && Number(v) <= hi ? Number(v) : fail(`${name} must be a number from ${lo} to ${hi}`));

async function b64ToBlob(data, mime) {
  return (await fetch(`data:${mime || 'application/octet-stream'};base64,${data}`)).blob();
}
async function blobToB64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

// ---- events ------------------------------------------------------------------------------------------------
async function normFields(ed, type, f) {
  const p = ed.p;
  const out = { ...f };
  for (const k of ['from', 'with']) if (out[k] != null) out[k] = who(p, out[k], { allowMe: !(type === 'call' && k === 'with') });
  if (type === 'swipe' && out.row != null) out.row = inboxRow(p, out.row);
  if (type === 'call') {
    if (out.direction != null) oneOf('direction', out.direction, ['in', 'out']);
    if (out.outcome != null) oneOf('outcome', out.outcome, ['answer', 'decline', 'missed']);
    if (Array.isArray(out.lines)) out.lines = out.lines.map((l) => ({ id: uid('l'), from: who(p, l.from ?? 'me'), text: String(l.text ?? ''), voice: null }));
  }
  if (type === 'react' && out.emoji != null) out.emoji = REACTIONS[out.emoji] || out.emoji;
  if (type === 'screen' && out.to != null) oneOf('to', out.to, Object.keys(SCREENS));
  if (type === 'openapp') {
    if (out.to != null) oneOf('to', out.to, ['chat', 'inbox']);
    if (out.app && out.app !== 'auto') {
      const all = [...p.home.apps, ...p.home.dock];
      const a = all.find((x) => x.id === out.app) || all.find((x) => x.name.toLowerCase() === String(out.app).toLowerCase());
      if (!a) fail(`Unknown home screen app ${JSON.stringify(out.app)}. Apps: auto, ${all.map((x) => x.name).join(', ')}`);
      out.app = a.id;
    }
  }
  if (type === 'notify' && out.app != null && out.app !== 'auto' && out.app !== 'custom' && !APP_NAMES[out.app]) fail(`notify app must be auto, custom or one of: ${Object.keys(APP_NAMES).join(', ')}`);
  if (type === 'msg') {
    if (out.effect != null) oneOf('effect', out.effect, Object.keys(BUBBLE_FX));
    if (out.screenFx != null) oneOf('screenFx', out.screenFx, Object.keys(SCREEN_FX));
    if (out.cam != null) oneOf('cam', out.cam, ['none', 'zoom', 'punch', 'shake']);
    if (out.vmode != null) oneOf('vmode', out.vmode, ['full', 'inline']);
    if (out.typing != null) oneOf('typing', out.typing, ['auto', 'keyboard', 'indicator', 'instant']);
  }
  if (type === 'camera') {
    if (out.move != null) oneOf('move', out.move, Object.keys(CAMERA_MOVES));
    if (out.target != null && !CAMERA_TARGETS[out.target] && !p.events.some((e) => e.id === out.target)) fail(`camera target must be one of: ${Object.keys(CAMERA_TARGETS).join(', ')} or a message id`);
  }
  // a picture or video: set what kind it is and how long
  if (out.mediaId) {
    const rec = await needMedia(out.mediaId, ['image', 'gif', 'video']);
    if (rec.kind === 'video') { out.mediaKind = 'video'; out.mediaDur = rec.dur || 0; } else { out.mediaKind = 'image'; out.mediaDur = 0; }
  }
  for (const k of ['iconId', 'imageId']) if (out[k]) await needMedia(out[k], ['image', 'gif']);
  return out;
}
const validKeys = (ed, type) => Object.keys(newEvent(type, {}, ed.p)).filter((k) => k !== 'id' && k !== 'type');
function checkKeys(ed, type, f) {
  const valid = validKeys(ed, type);
  const bad = Object.keys(f).filter((k) => !valid.includes(k));
  if (bad.length) fail(`Unknown field${bad.length > 1 ? 's' : ''} for a ${type} event: ${bad.join(', ')}. Fields: ${valid.join(', ')}`);
}

// ---- summaries ---------------------------------------------------------------------------------------------
function summary(ed, withScript) {
  const p = ed.p;
  const look = { theme: p.theme, device: p.device, dark: p.dark, layout: p.layout, keyboard: p.keyboard, typingSpeed: p.typingSpeed, pace: p.pace, emojiStyle: p.emojiStyle,
    startScreen: p.startScreen, receipts: p.receipts, captions: p.captions, showTouches: p.showTouches, status: p.status, background: p.background, wallpaper: p.wallpaper };
  return {
    id: p.id, name: p.name, duration: round(ed.tl.duration), look,
    me: { name: p.me.name, voiceId: p.me.voiceId || '', hasPhoto: !!p.me.avatar },
    people: p.contacts.map((c) => ({ id: c.id, name: c.name, color: c.color, label: c.label, voiceId: c.voiceId || '', hasPhoto: !!c.avatar, inChat: p.chat.members.includes(c.id) })),
    chat: { title: chatTitle(p), members: p.chat.members.map((id) => p.contacts.find((c) => c.id === id)?.name), name: p.chat.name, hasPhoto: !!p.chat.avatar },
    narratorVoiceId: p.narrator.voiceId || '',
    inbox: p.inbox.map((r) => ({ id: r.id, name: r.name, preview: r.preview, time: r.time, unread: !!r.unread, color: r.color, hasPhoto: !!r.avatar })),
    home: {
      dock: p.home.dock.map((a) => ({ id: a.id, app: a.app, name: a.name, badge: a.badge })),
      apps: p.home.apps.map((a) => ({ id: a.id, app: a.app, name: a.name, badge: a.badge })),
      wallpaper: p.home.wallpaper ? 'own' : 'same as the lock screen', labels: p.home.labels !== false,
    },
    events: p.events.map((e, index) => ({ index, id: e.id, type: e.type, ...(e.pre ? { pre: true } : {}), description: ed.describe(e), ...mark(ed, e.id) })),
    ...(withScript ? { script: toScript(p) } : {}),
  };
}

// ---- guide ---------------------------------------------------------------------------------------------------
function guide(ed) {
  const p = ed.p;
  const types = Object.entries(EVENT_TYPES).map(([t, v]) => `- ${t} (${v.label}): ${JSON.stringify(Object.fromEntries(Object.entries(newEvent(t, {}, p)).filter(([k]) => k !== 'id' && k !== 'type')))}`).join('\n');
  return `FAKE PHONE: builds videos of a phone: text conversations, notifications, calls, a home screen, with voices, exported as MP4.
A project is a list of EVENTS played in order. Write them as a SCRIPT (set_script) or one at a time (add_event / update_event).

SCRIPT (one line per beat; lines above --- are already on screen when the video starts):
${SCRIPT_HELP}
More script: [home] [lock] [inbox] [chat] change screen; [open chat] taps the chat app on the home screen; [notify Jess: tagged you {facebook}]
tags after a message: ${[...Object.keys(BUBBLE_FX), ...Object.keys(SCREEN_FX), 'zoom', 'punch', 'shake'].map((x) => `{${x}}`).join(' ')}
"me:" is the phone's owner. Any new name becomes a person (add them to the chat to make a group chat).

EVENT TYPES and their fields (add_event type + fields; update_event fields). from/with take a person's name or "me":
${types}
Notes: msg.pre=true means already on screen at the start. msg.mediaId = a picture/GIF/video from upload_media (a video gets mediaKind/mediaDur automatically; vmode 'full' = tap then full-screen player, 'inline' = plays in the bubble).
notify.app = auto (the chat app) | custom (appName + iconId) | ${Object.keys(APP_NAMES).join(' | ')}; notify.photo shows the sender's photo; notify.imageId attaches a picture.
screen.to = ${Object.keys(SCREENS).join(' | ')}. openapp.to = chat | inbox. call.lines = [{from, text}].

LOOK (set_project): theme ${Object.keys(THEMES).join(' | ')}; device ${Object.keys(DEVICES).join(' | ')}; dark true/false; layout phone | screen; startScreen ${Object.keys(SCREENS).join(' | ')}.
HOME SCREEN (set_home): apps/dock entries {app: ${Object.keys(APP_NAMES).join(' | ')} | custom, name, badge, color, icon_id}.
PICTURES: upload_media returns an id; set_photo puts it on you, a person, the group or another conversation.
CHECK YOUR WORK: preview (times in seconds, sheet:true for one grid image) shows what the video looks like; get_project lists each event's start/end time.
VOICES: give people voiceId (list_voices), then generate_voices (needs the user's ElevenLabs key and spends their credits: call it without confirm first to see the plan).
SAFETY: the open project may be the user's own work. Use new_project or duplicate_project before replacing anything, unless they asked you to edit this one; undo reverts the last change.
Current project: "${p.name}", ${p.events.length} events, ${round(ed.tl.duration)}s.`;
}

// ---- commands -------------------------------------------------------------------------------------------------
const CMDS = {
  agent_commands: () => Object.keys(CMDS),
  guide: (ed) => ({ guide: guide(ed) }),

  get_project: (ed, a) => summary(ed, !!a.include_script),
  get_script: (ed) => ({ script: toScript(ed.p), duration: round(ed.tl.duration) }),

  // ---- the script ----
  set_script(ed, { script, mode = 'replace' }) {
    if (typeof script !== 'string' || !script.trim()) fail('script must be the script text');
    oneOf('mode', mode, ['replace', 'append']);
    ed.change((p) => {
      const evs = parseScript(script, p);
      if (mode === 'replace') p.events = evs; else p.events.push(...evs);
      // whoever sends messages in the script is in the chat
      const speakers = [...new Set(evs.filter((e) => e.type === 'msg' && e.from !== 'me').map((e) => e.from))];
      if (mode === 'replace' && speakers.length) p.chat.members = speakers;
      else for (const s of speakers) if (!p.chat.members.includes(s)) p.chat.members.push(s);
    }, { inspector: true });
    ed.setSender?.(ed.sender);
    return { ...brief(ed), events_added: ed.p.events.length, script: toScript(ed.p) };
  },

  async add_event(ed, { type, fields = {}, after }) {
    oneOf('type', type, Object.keys(EVENT_TYPES));
    checkKeys(ed, type, fields);
    const e = newEvent(type, await normFields(ed, type, fields), ed.p);
    let at = ed.p.events.length;
    if (after === 'start') at = 0;
    else if (after != null && after !== 'end') {
      const i = typeof after === 'number' ? after : ed.p.events.findIndex((x) => x.id === after);
      if (i < 0 || i > ed.p.events.length) fail(`after must be "start", "end", an event id or a position from 0 to ${ed.p.events.length}`);
      at = typeof after === 'number' ? i : i + 1;
    }
    ed.change((p) => p.events.splice(at, 0, e), { inspector: true });
    return { id: e.id, index: at, description: ed.describe(e), ...mark(ed, e.id), ...brief(ed) };
  },

  async update_event(ed, { id, fields = {} }) {
    const e = ed.p.events.find((x) => x.id === id);
    if (!e) fail(`No event with id ${JSON.stringify(id)}. Ids come from get_project.`);
    checkKeys(ed, e.type, fields);
    const norm = await normFields(ed, e.type, fields);
    ed.change(() => { Object.assign(e, norm); }, { inspector: true });
    return { id, description: ed.describe(e), ...mark(ed, e.id), ...brief(ed) };
  },

  remove_event(ed, { id }) {
    const i = typeof id === 'number' ? id : ed.p.events.findIndex((x) => x.id === id);
    if (i < 0 || i >= ed.p.events.length) fail(`No such event ${JSON.stringify(id)}. Use an id or a position from get_project.`);
    ed.change((p) => p.events.splice(i, 1), { inspector: true });
    return brief(ed);
  },

  // ---- look ----
  // Everything is checked first, then applied, so a bad value changes nothing.
  async set_project(ed, a) {
    const keys = ['name', 'theme', 'dark', 'device', 'layout', 'keyboard', 'typingSpeed', 'pace', 'emojiStyle', 'startScreen', 'receipts', 'captions', 'showTouches',
      'status', 'background', 'wallpaper', 'chat_name', 'narrator_voice_id', 'voice_model'];
    const bad = Object.keys(a).filter((k) => !keys.includes(k));
    if (bad.length) fail(`Unknown setting${bad.length > 1 ? 's' : ''}: ${bad.join(', ')}. Settings: ${keys.join(', ')}`);
    const set = {};                     // top-level fields to assign
    if (a.name != null) set.name = String(a.name).slice(0, 80) || 'Untitled';
    if (a.theme != null) set.theme = oneOf('theme', a.theme, Object.keys(THEMES));
    if (a.dark != null) set.dark = bool('dark', a.dark);
    if (a.device != null) set.device = oneOf('device', a.device, Object.keys(DEVICES));
    if (a.layout != null) set.layout = oneOf('layout', a.layout, ['phone', 'screen']);
    if (a.keyboard != null) set.keyboard = oneOf('keyboard', a.keyboard, ['auto', 'always', 'never']);
    if (a.typingSpeed != null) set.typingSpeed = num('typingSpeed', a.typingSpeed, 3, 40);
    if (a.pace != null) set.pace = num('pace', a.pace, 0.3, 3);
    if (a.emojiStyle != null) set.emojiStyle = oneOf('emojiStyle', a.emojiStyle, ['noto', 'system']);
    if (a.startScreen != null) set.startScreen = oneOf('startScreen', a.startScreen, Object.keys(SCREENS));
    for (const k of ['receipts', 'captions', 'showTouches']) if (a[k] != null) set[k] = bool(k, a[k]);
    const status = {};
    if (a.status) {
      const s2 = a.status;
      if (s2.time != null) status.time = String(s2.time);
      if (s2.date != null) status.date = String(s2.date);
      if (s2.battery != null) status.battery = num('status.battery', s2.battery, 0, 100);
      if (s2.signal != null) status.signal = num('status.signal', s2.signal, 0, 4);
      if (s2.wifi != null) status.wifi = bool('status.wifi', s2.wifi);
      if (s2.carrier != null) status.carrier = String(s2.carrier);
    }
    const spec = async (name, v) => {
      if (!v || typeof v !== 'object') fail(`${name} must be an object like {type:"gradient", color:"#1b2a6b", color2:"#e7a2c9"}`);
      const o = {};
      if (v.type != null) o.type = oneOf(`${name}.type`, v.type, ['gradient', 'color', 'green', 'image']);
      if (v.color != null) o.color = hex(v.color);
      if (v.color2 != null) o.color2 = hex(v.color2);
      if (v.media_id != null) { await needMedia(v.media_id, ['image']); o.mediaId = v.media_id; }
      return o;
    };
    const bg = a.background ? await spec('background', a.background) : null;
    const wp = a.wallpaper ? await spec('wallpaper', a.wallpaper) : null;
    const model = a.voice_model != null ? oneOf('voice_model', a.voice_model, Object.keys(ELEVEN_MODELS)) : null;

    ed.change((pr) => {
      Object.assign(pr, set);
      if (set.theme) ensureThemeApp(pr);
      Object.assign(pr.status, status);
      if (bg) Object.assign(pr.background, bg);
      if (wp) Object.assign(pr.wallpaper, wp);
      if (a.chat_name != null) pr.chat.name = String(a.chat_name);
      if (a.narrator_voice_id != null) pr.narrator.voiceId = String(a.narrator_voice_id);
    }, { inspector: true });
    if (model) { ed.settings.eleven.model = model; ed.saveSettings(); }
    return { ...brief(ed), look: summary(ed).look };
  },

  // ---- people and pictures ----
  set_person(ed, { who: target, name, color, label, voiceId, in_chat, create = false }) {
    const p = ed.p;
    if (target == null || target === '') fail('who is required: "me" or a person\'s name');
    const isMe = ['me', 'you', 'i'].includes(String(target).toLowerCase());
    let c = isMe ? p.me : p.contacts.find((x) => x.id === target) || p.contacts.find((x) => x.name.toLowerCase() === String(target).toLowerCase());
    if (!c && !isMe) {
      if (!create) fail(`Unknown person ${JSON.stringify(target)}. People: ${p.contacts.map((x) => x.name).join(', ') || '(none)'}. Pass create:true to add them.`);
      ed.change((pr) => { pr.contacts.push({ id: uid('c'), name: String(target), color: CONTACT_COLORS[pr.contacts.length % CONTACT_COLORS.length], avatar: null, voiceId: '', voiceName: '', label: 'mobile' }); });
      c = ed.p.contacts[ed.p.contacts.length - 1];
    }
    ed.change((pr) => {
      const obj = isMe ? pr.me : pr.contacts.find((x) => x.id === c.id);
      if (name != null) obj.name = String(name);
      if (voiceId != null) obj.voiceId = String(voiceId);
      if (!isMe) {
        if (color != null) obj.color = hex(color);
        if (label != null) obj.label = String(label);
        if (in_chat != null) {
          if (bool('in_chat', in_chat)) { if (!pr.chat.members.includes(obj.id)) pr.chat.members.push(obj.id); }
          else if (pr.chat.members.length > 1) pr.chat.members = pr.chat.members.filter((m) => m !== obj.id);
          else fail('A chat needs at least one other person');
        }
      }
    }, { inspector: true });
    const sm = summary(ed);
    return { people: sm.people, me: sm.me };
  },

  remove_person(ed, { who: target }) {
    const id = who(ed.p, target, { allowMe: false });
    ed.change((pr) => {
      pr.contacts = pr.contacts.filter((c) => c.id !== id);
      pr.chat.members = pr.chat.members.filter((m) => m !== id);
      if (!pr.chat.members.length && pr.contacts.length) pr.chat.members = [pr.contacts[0].id];
    }, { inspector: true });
    return { people: ed.p.contacts.map((c) => c.name), ...brief(ed) };
  },

  async upload_media(ed, { data_base64, mime, name = 'upload' }) {
    if (typeof data_base64 !== 'string' || !data_base64) fail('data_base64 is required (the file as base64)');
    if (!/^(image|video|audio)\//.test(mime || '')) fail('mime must be like image/png, image/jpeg, image/gif, video/mp4 or audio/mpeg');
    let rec;
    try { rec = await addMediaBlob(await b64ToBlob(data_base64, mime), String(name)); } catch (e) { fail(e.message); }
    return { id: rec.id, kind: rec.kind, w: rec.w, h: rec.h, dur: rec.dur, bytes: rec.blob.size };
  },

  async set_photo(ed, { target, media_id = null }) {
    const p = ed.p;
    if (media_id) await needMedia(media_id, ['image', 'gif']);
    const t = String(target ?? '').toLowerCase();
    let holder;
    if (['me', 'you'].includes(t)) holder = p.me;
    else if (['group', 'chat', 'group photo'].includes(t)) holder = p.chat;
    else holder = p.contacts.find((c) => c.id === target || c.name.toLowerCase() === t) || p.inbox.find((r) => r.id === target || r.name.toLowerCase() === t);
    if (!holder) fail(`Unknown target ${JSON.stringify(target)}. Use "me", "group", a person (${p.contacts.map((c) => c.name).join(', ')}) or another conversation (${p.inbox.map((r) => r.name).join(', ')})`);
    ed.change(() => { holder.avatar = media_id || null; }, { inspector: true });
    return { ok: true, target, hasPhoto: !!media_id };
  },

  async set_inbox(ed, { rows }) {
    if (!Array.isArray(rows)) fail('rows must be a list of {name, preview, time, unread, color, photo_id}');
    const built = [];
    for (const r of rows) {
      if (!r || !r.name) fail('every row needs a name');
      if (r.photo_id) await needMedia(r.photo_id, ['image', 'gif']);
      const old = ed.p.inbox.find((x) => x.name.toLowerCase() === String(r.name).toLowerCase());
      built.push({ id: old?.id || uid('r'), name: String(r.name), preview: String(r.preview ?? ''), time: String(r.time ?? 'Yesterday'), unread: !!r.unread, color: r.color ? hex(r.color) : old?.color || CONTACT_COLORS[built.length % CONTACT_COLORS.length], avatar: r.photo_id || old?.avatar || null });
    }
    ed.change((p) => { p.inbox = built; }, { inspector: true });
    return { conversations: built.map((r) => r.name) };
  },

  // ---- home screen ----
  async set_home(ed, { apps, dock, wallpaper, labels }) {
    const p = ed.p;
    const old = [...p.home.apps, ...p.home.dock];
    const build = async (list, name) => {
      if (!Array.isArray(list)) fail(`${name} must be a list of {app, name, badge, color, icon_id}`);
      const out = [];
      for (const x of list) {
        const app = typeof x === 'string' ? x : x.app;
        if (app !== 'custom' && !APP_NAMES[app]) fail(`${name}: unknown app ${JSON.stringify(app)}. Apps: ${Object.keys(APP_NAMES).join(', ')}, custom`);
        const spec = typeof x === 'string' ? {} : x;
        if (spec.icon_id) await needMedia(spec.icon_id, ['image', 'gif']);
        const nm = spec.name || APP_NAMES[app] || 'App';
        const prev = old.find((o) => o.app === app && o.name === nm);
        out.push({ ...newHomeApp(app, { name: nm, badge: Math.max(0, Math.min(99, Number(spec.badge) || 0)), color: spec.color ? hex(spec.color) : '#5B5BD6', iconId: spec.icon_id || null }), ...(prev ? { id: prev.id } : {}) });
      }
      return out;
    };
    const nextApps = apps !== undefined ? await build(apps, 'apps') : null;
    const nextDock = dock !== undefined ? await build(dock, 'dock') : null;
    if (nextDock && nextDock.length > 4) fail('The dock holds at most 4 apps');
    let wp;
    if (wallpaper !== undefined && wallpaper !== null) {
      if (wallpaper.media_id) await needMedia(wallpaper.media_id, ['image']);
      wp = { ...clone(p.wallpaper), ...(wallpaper.type ? { type: oneOf('wallpaper.type', wallpaper.type, ['gradient', 'color', 'image']) } : {}), ...(wallpaper.color ? { color: hex(wallpaper.color) } : {}), ...(wallpaper.color2 ? { color2: hex(wallpaper.color2) } : {}), ...(wallpaper.media_id ? { mediaId: wallpaper.media_id } : {}) };
    }
    ed.change((pr) => {
      if (nextApps) pr.home.apps = nextApps;
      if (nextDock) pr.home.dock = nextDock;
      if (wallpaper === null) pr.home.wallpaper = null;
      if (wp) pr.home.wallpaper = wp;
      if (labels != null) pr.home.labels = bool('labels', labels);
      ensureThemeApp(pr);
    }, { inspector: true });
    return summary(ed).home;
  },

  // ---- look at it ----
  async preview(ed, { times, sheet = false, width, format = 'jpeg' }) {
    const dur = ed.tl.duration;
    let ts = Array.isArray(times) && times.length ? times.map(Number) : [Math.min(0.6, dur), dur / 2, Math.max(0, dur - 0.4)];
    if (ts.some((t) => !Number.isFinite(t) || t < 0)) fail('times are seconds from the start (0 to the duration)');
    if (ts.length > 12) fail('at most 12 frames per preview');
    ts = ts.map((t) => Math.min(t, dur));
    oneOf('format', format, ['jpeg', 'png']);
    const mime = format === 'png' ? 'image/png' : 'image/jpeg';
    const frameW = Math.round(Math.max(120, Math.min(1080, Number(width) || (sheet ? 360 : 540))));
    const frameH = Math.round((frameW * 16) / 9);
    await preloadAssets(ed.p, ed.tl);
    const stage = new OffscreenCanvas(1080, 1920);
    const sctx = stage.getContext('2d');
    const cols = sheet ? Math.min(ts.length, 4) : 1;
    const rows = sheet ? Math.ceil(ts.length / cols) : 1;
    const grid = sheet ? new OffscreenCanvas(cols * frameW, rows * frameH) : null;
    const gctx = grid?.getContext('2d');
    if (gctx) { gctx.fillStyle = '#111'; gctx.fillRect(0, 0, grid.width, grid.height); }
    const images = [];
    setVideoExport(true);
    try {
      for (let i = 0; i < ts.length; i++) {
        await primeVideos(ed.tl, ts[i]);
        renderFrame(sctx, ed.p, ed.tl, ts[i]);
        if (sheet) {
          gctx.drawImage(stage, (i % cols) * frameW, Math.floor(i / cols) * frameH, frameW, frameH);
        } else {
          const small = new OffscreenCanvas(frameW, frameH);
          small.getContext('2d').drawImage(stage, 0, 0, frameW, frameH);
          images.push({ t: round(ts[i]), mime, data_base64: await blobToB64(await small.convertToBlob({ type: mime, quality: 0.88 })) });
        }
      }
    } finally { setVideoExport(false); }
    if (sheet) images.push({ t: ts.map(round), mime, data_base64: await blobToB64(await grid.convertToBlob({ type: mime, quality: 0.88 })) });
    return { duration: round(dur), images };
  },

  // ---- voices ----
  async list_voices(ed, { reload = false }) {
    const s = ed.settings;
    if (reload) {
      if (!s.elevenKey) fail('No ElevenLabs key is saved in Fake Phone yet (Voices & Keys tab).');
      s.voices = await listVoices(s.elevenKey);
      ed.saveSettings();
    }
    return { hasKey: !!s.elevenKey, model: s.eleven.model, voices: (s.voices || []).map((v) => ({ id: v.id, name: v.name, tags: v.tags })) };
  },

  async generate_voices(ed, { confirm = false }, signal) {
    const s = ed.settings;
    const lines = voiceLines(ed.p);
    const todo = missingVoices(lines, s.eleven);
    const plan = {
      lines: lines.length, lines_with_a_voice: lines.filter((l) => l.voiceId).length, to_generate: todo.length,
      characters: todo.reduce((n, l) => n + l.say.length, 0), speakers_without_a_voice: [...new Set(lines.filter((l) => !l.voiceId).map((l) => (l.who === 'narrator' ? 'narrator' : l.who === 'me' ? ed.p.me.name : ed.p.contacts.find((c) => c.id === l.who)?.name)))],
      has_key: !!s.elevenKey, model: s.eleven.model,
    };
    if (!confirm) return { ...plan, generated: 0, note: 'Nothing generated yet. This spends ElevenLabs credits: call again with confirm:true to generate.' };
    if (!s.elevenKey) fail('No ElevenLabs key is saved in Fake Phone yet (Voices & Keys tab).');
    if (!todo.length) return { ...plan, generated: 0, note: 'Nothing to generate.' };
    const generated = await generateVoices(ed.engine, s.elevenKey, s.eleven, todo, () => {}, signal);
    ed.change(() => {}, { inspector: true });
    return { ...plan, generated };
  },

  // ---- video + projects ----
  async export_video(ed, { resolution = '1080', fps, name }, signal) {
    oneOf('resolution', String(resolution), ['720', '1080']);
    const f = Number(fps || ed.settings.exportFps) || 30;
    oneOf('fps', f, [24, 30, 60]);
    if (!ed.p.events.length) fail('The project has no events yet.');
    ed.pause();
    const [width, height] = String(resolution) === '720' ? [720, 1280] : [1080, 1920];
    const clean = String(name || ed.p.name).replace(/[^\w\- ()+&!',]+/g, '').trim() || 'fake-phone';
    const t0 = performance.now();
    const out = await exportVideo({ p: ed.p, tl: ed.tl, engine: ed.engine, width, height, fps: f, name: clean, onProgress() {}, signal });
    return { file: out.file, duration: round(ed.tl.duration), resolution: `${width}x${height}`, fps: f, seconds_to_render: round((performance.now() - t0) / 1000) };
  },

  async list_projects(ed) {
    return { current: ed.p.id, projects: (await listProjects()).map((x) => ({ id: x.id, name: x.name, updated: x.updated })) };
  },
  async new_project(ed, { name = 'New chat', demo = false }) {
    const p = demo ? demoProject() : newProject(String(name));
    if (!demo) p.events = [];
    else p.name = String(name);
    await putProject(p);
    ed.load(p);
    return summary(ed);
  },
  async open_project(ed, { id, name }) {
    const list = await listProjects();
    const hit = list.find((x) => x.id === id) || list.find((x) => x.name.toLowerCase() === String(name || id || '').toLowerCase());
    if (!hit) fail(`No such project. Projects: ${list.map((x) => `${x.name} (${x.id})`).join(', ')}`);
    ed.load(await getProject(hit.id));
    return summary(ed);
  },
  async duplicate_project(ed, { name }) {
    const p = clone(ed.p);
    p.id = uid('p');
    p.name = String(name || p.name + ' copy');
    p.created = p.updated = Date.now();
    await putProject(p);
    ed.load(p);
    return { id: p.id, name: p.name };
  },

  undo: (ed) => { ed.undo(); return brief(ed); },
  redo: (ed) => { ed.redo(); return brief(ed); },
};
