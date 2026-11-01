#!/usr/bin/env node
// Fake Phone MCP server (stdio, no dependencies). It lets an AI client (Claude Desktop, Claude Code...) drive the
// open Fake Phone app: write the script, change the look, check frames, export the video.
//
//   FAKE_PHONE_TOKEN   the token from Fake Phone > Voices & Keys > AI control   (required)
//   FAKE_PHONE_URL     default http://127.0.0.1:47680
//
// The app has to be open with AI control switched on. Run it with Node, or with the app's own Node:
//   ELECTRON_RUN_AS_NODE=1 "Fake Phone.exe" fake-phone-mcp.mjs
import fs from 'node:fs';
import path from 'node:path';

const BASE = (process.env.FAKE_PHONE_URL || 'http://127.0.0.1:47680').replace(/\/+$/, '');
const TOKEN = process.env.FAKE_PHONE_TOKEN || '';
const VERSION = '1.0.0';
const PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];

// ---- talking to the app --------------------------------------------------------------------------------------
async function callApp(cmd, args = {}, timeoutSec) {
  let r;
  try {
    r = await fetch(`${BASE}/agent/call`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ cmd, args, ...(timeoutSec ? { timeoutSec } : {}) }),
    });
  } catch {
    throw new Error(`Cannot reach Fake Phone at ${BASE}. Open the app, go to Voices & Keys > AI control and switch it on (and check FAKE_PHONE_URL).`);
  }
  let j;
  try { j = await r.json(); } catch { throw new Error(`Fake Phone answered ${r.status} with something that is not JSON`); }
  if (!j.ok) throw new Error(j.error || `Fake Phone answered ${r.status}`);
  return j.result;
}

async function appStatus() {
  let r;
  try { r = await fetch(`${BASE}/agent/status`, { headers: { authorization: `Bearer ${TOKEN}` } }); } catch { throw new Error(`Cannot reach Fake Phone at ${BASE}.`); }
  const j = await r.json().catch(() => ({}));
  if (!j.ok) throw new Error(j.error || `Fake Phone answered ${r.status}`);
  return j;
}

// ---- files: the AI gives a path or a URL, the app gets base64 ------------------------------------------------
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.mp4': 'video/mp4', '.m4v': 'video/mp4',
  '.mov': 'video/quicktime', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4' };
const MAX_FILE = 200 * 1024 * 1024;

async function readSource({ path: file, url, data_base64, mime, name }) {
  if (data_base64) return { data_base64, mime: mime || fail('mime is required with data_base64'), name: name || 'upload' };
  if (file) {
    const abs = path.resolve(String(file));
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) fail(`No such file: ${abs}`);
    if (fs.statSync(abs).size > MAX_FILE) fail('That file is over 200 MB');
    const m = mime || MIME[path.extname(abs).toLowerCase()];
    if (!m) fail(`Cannot tell the file type of ${path.basename(abs)}. Pass mime (like image/png).`);
    return { data_base64: fs.readFileSync(abs).toString('base64'), mime: m, name: name || path.basename(abs) };
  }
  if (url) {
    if (!/^https?:\/\//i.test(String(url))) fail('url must start with http:// or https://');
    const r = await fetch(url);
    if (!r.ok) fail(`Could not download ${url} (${r.status})`);
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > MAX_FILE) fail('That download is over 200 MB');
    const m = mime || (r.headers.get('content-type') || '').split(';')[0] || MIME[path.extname(new URL(url).pathname).toLowerCase()];
    if (!m) fail('Cannot tell the file type; pass mime');
    return { data_base64: buf.toString('base64'), mime: m, name: name || path.basename(new URL(url).pathname) || 'download' };
  }
  return fail('Give a local file path, a url, or data_base64 + mime');
}
function fail(msg) { throw new Error(msg); }

const file = {
  path: { type: 'string', description: 'Path of a file on this computer' },
  url: { type: 'string', description: 'http(s) address of a file to download' },
  mime: { type: 'string', description: 'File type, e.g. image/png (usually worked out from the file name)' },
};

// ---- the tools -----------------------------------------------------------------------------------------------
// run(args) -> { text?, images?, data? }; tools without run call the app command of the same name
const object = (properties = {}, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const TOOLS = [
  { name: 'guide', description: 'READ THIS FIRST. How Fake Phone works: the script format, every event type and its fields, looks, apps, tags. Also shows what the current project is.', schema: object(),
    run: async () => ({ text: (await callApp('guide')).guide }) },
  { name: 'status', description: 'Check that the Fake Phone app is reachable and its window is connected.', schema: object(),
    run: async () => ({ data: await appStatus() }) },
  { name: 'get_project', description: 'The whole current project: look, people, photos (yes/no), conversations, home screen, and every event with its id, type, a description and its start/end time in the video. Use the times with preview.',
    schema: object({ include_script: { type: 'boolean', description: 'Also return the script text' } }) },
  { name: 'get_script', description: 'The current project as script text (round-trips through set_script; effects/media that a script cannot express are not included).', schema: object() },
  { name: 'set_script', description: 'Write messages and actions as a script (see guide). mode "replace" (default) replaces all events; "append" adds to the end. New names become people, and whoever sends messages joins the chat. The easiest way to build a conversation.',
    schema: object({ script: { type: 'string' }, mode: { type: 'string', enum: ['replace', 'append'] } }, ['script']) },
  { name: 'add_event', description: 'Add one event (any type, with all its fields: effects, camera, video, notification app...). after: "start", "end" (default), an event id (insert after it) or a number (insert at that position). Fields are listed in guide.',
    schema: object({ type: { type: 'string' }, fields: { type: 'object', description: 'e.g. {from:"Jess", text:"hi", effect:"slam"}; from/with take a person name or "me"' }, after: { type: ['string', 'number'] } }, ['type']) },
  { name: 'update_event', description: 'Change fields of an existing event (id from get_project).', schema: object({ id: { type: 'string' }, fields: { type: 'object' } }, ['id', 'fields']) },
  { name: 'remove_event', description: 'Delete an event by id or position.', schema: object({ id: { type: ['string', 'number'] } }, ['id']) },
  { name: 'set_project', description: 'Change the look and settings: theme (imessage, sms, android, whatsapp, instagram), device (island, notch, android), dark, layout, status bar (time, date, battery, signal, wifi), background and wallpaper ({type, color, color2, media_id}), keyboard, pace, typingSpeed, captions, startScreen (chat, inbox, lock, home), chat_name, narrator_voice_id, voice_model. Everything is checked before anything changes.',
    schema: object({
      name: { type: 'string' }, theme: { type: 'string' }, device: { type: 'string' }, dark: { type: 'boolean' }, layout: { type: 'string', enum: ['phone', 'screen'] },
      keyboard: { type: 'string', enum: ['auto', 'always', 'never'] }, typingSpeed: { type: 'number' }, pace: { type: 'number' }, emojiStyle: { type: 'string', enum: ['noto', 'system'] },
      startScreen: { type: 'string' }, receipts: { type: 'boolean' }, captions: { type: 'boolean' }, showTouches: { type: 'boolean' },
      status: { type: 'object', description: '{time:"9:41", date:"Friday, October 31", battery:0-100, signal:0-4, wifi:true, carrier:"..."}' },
      background: { type: 'object' }, wallpaper: { type: 'object' }, chat_name: { type: 'string' }, narrator_voice_id: { type: 'string' }, voice_model: { type: 'string' },
    }) },
  { name: 'set_person', description: 'Change a person: who is "me" or a name. Set name, colour (#rrggbb), label, voiceId (from list_voices) and in_chat (true adds them to the chat, making a group chat). create:true adds a new person.',
    schema: object({ who: { type: 'string' }, name: { type: 'string' }, color: { type: 'string' }, label: { type: 'string' }, voiceId: { type: 'string' }, in_chat: { type: 'boolean' }, create: { type: 'boolean' } }, ['who']) },
  { name: 'remove_person', description: 'Delete a person.', schema: object({ who: { type: 'string' } }, ['who']) },
  { name: 'upload_media', description: 'Put a picture, GIF or video into the app and get its media id (use it as media_id, mediaId, iconId, imageId...). Give a local path, a url, or data_base64 + mime.',
    schema: object({ ...file, data_base64: { type: 'string' }, name: { type: 'string' } }),
    run: async (a) => ({ data: await callApp('upload_media', await readSource(a)) }) },
  { name: 'set_photo', description: 'Set (or remove) a profile picture. target: "me", a person, "group" (the group chat photo) or another conversation from the messages list. Give media_id, or a path/url to upload now; remove:true clears it.',
    schema: object({ target: { type: 'string' }, media_id: { type: 'string' }, ...file, remove: { type: 'boolean' } }, ['target']),
    run: async (a) => {
      let media_id = a.media_id || null;
      if (!media_id && !a.remove && (a.path || a.url)) media_id = (await callApp('upload_media', await readSource(a))).id;
      if (!media_id && !a.remove) fail('Give media_id, path or url (or remove:true)');
      return { data: await callApp('set_photo', { target: a.target, media_id }) };
    } },
  { name: 'set_inbox', description: 'Replace the "other conversations" shown in the messages list: rows of {name, preview, time, unread, color, photo_id}.',
    schema: object({ rows: { type: 'array', items: { type: 'object' } } }, ['rows']) },
  { name: 'set_home', description: 'Set the home screen: apps and dock are lists of {app, name, badge, color, icon_id} (app = a preset like facebook, snapchat, cashapp, or "custom" with name + icon_id). The dock holds up to 4. wallpaper {type,color,color2,media_id} or null (= the lock screen wallpaper). labels shows app names.',
    schema: object({ apps: { type: 'array', items: { type: ['object', 'string'] } }, dock: { type: 'array', items: { type: ['object', 'string'] } }, wallpaper: { type: ['object', 'null'] }, labels: { type: 'boolean' } }) },
  { name: 'preview', description: 'SEE the video: renders frames at the given times (seconds) and returns them as images. sheet:true puts them all in one grid image (up to 12 frames; best for checking a whole story). Use after every few changes. Times come from get_project.',
    schema: object({ times: { type: 'array', items: { type: 'number' } }, sheet: { type: 'boolean' }, width: { type: 'number', description: 'Width of one frame in pixels (default 540, or 360 in a sheet)' }, format: { type: 'string', enum: ['jpeg', 'png'] } }),
    run: async (a) => {
      const r = await callApp('preview', a);
      return { text: `Duration ${r.duration}s. ${r.images.length} image${r.images.length > 1 ? 's' : ''}${a.sheet ? ' (grid, left to right then down: ' + JSON.stringify(r.images[0].t) + ')' : ': ' + r.images.map((i) => i.t + 's').join(', ')}.`, images: r.images };
    } },
  { name: 'list_voices', description: 'The ElevenLabs voices the user has loaded (id, name, tags). reload:true fetches them again with the user\'s saved key. The key itself is never shown.', schema: object({ reload: { type: 'boolean' } }) },
  { name: 'generate_voices', description: 'Make AI voice audio for every spoken line whose speaker has a voice. SPENDS THE USER\'S ELEVENLABS CREDITS: first call without confirm to see the plan (lines, characters), tell the user, and only pass confirm:true when they agree.',
    schema: object({ confirm: { type: 'boolean' } }) },
  { name: 'export_video', description: 'Render the project to an MP4 with sound and return the file path. Takes about as long as the video (more at 1080p). resolution "1080" (default) or "720" (faster).',
    schema: object({ resolution: { type: 'string', enum: ['720', '1080'] }, fps: { type: 'number', enum: [24, 30, 60] }, name: { type: 'string' } }) },
  { name: 'list_projects', description: 'The saved projects.', schema: object() },
  { name: 'new_project', description: 'Start a new empty project (demo:true starts from the demo chat).', schema: object({ name: { type: 'string' }, demo: { type: 'boolean' } }) },
  { name: 'open_project', description: 'Open a saved project by id or name.', schema: object({ id: { type: 'string' }, name: { type: 'string' } }) },
  { name: 'duplicate_project', description: 'Copy the current project and open the copy (a safe way to try big changes).', schema: object({ name: { type: 'string' } }) },
  { name: 'undo', description: 'Undo the last change.', schema: object() },
  { name: 'redo', description: 'Redo.', schema: object() },
];

const INSTRUCTIONS = `Fake Phone makes videos of a phone: text conversations, notifications, calls, a home screen, voices.
Start with "guide". Build the story with set_script (fast) and add_event/update_event (full control: effects, camera, video, notification apps).
Look at the result with "preview" (sheet:true shows many moments in one image) and fix what looks wrong before export_video.
generate_voices spends the user's ElevenLabs credits: show the plan first and ask.
The open project may be the user's own work: call new_project (or duplicate_project) before replacing or deleting anything, unless they asked you to edit the open one. undo reverts your last change.`;

// ---- MCP over stdio -------------------------------------------------------------------------------------------
const send = (obj) => process.stdout.write(JSON.stringify(obj) + '\n');
const ok = (id, result) => send({ jsonrpc: '2.0', id, result });
const err = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });

async function callTool(name, args) {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) { const e = new Error(`Unknown tool ${name}`); e.code = -32602; throw e; }
  const out = tool.run ? await tool.run(args) : { data: await callApp(name, args, name === 'export_video' || name === 'generate_voices' ? 1800 : undefined) };
  const content = [];
  if (out.text != null) content.push({ type: 'text', text: out.text });
  if (out.data !== undefined) {
    let t = JSON.stringify(out.data, null, 2);
    if (t.length > 80000) t = t.slice(0, 80000) + '\n… (truncated)';
    content.push({ type: 'text', text: t });
  }
  for (const im of out.images || []) content.push({ type: 'image', data: im.data_base64, mimeType: im.mime });
  return { content };
}

async function handle(msg) {
  const { id, method, params } = msg;
  if (id === undefined || id === null) return;        // notifications (initialized, cancelled...) need no answer
  try {
    if (method === 'initialize') {
      const want = params?.protocolVersion;
      return ok(id, { protocolVersion: PROTOCOLS.includes(want) ? want : PROTOCOLS[0], capabilities: { tools: {} }, serverInfo: { name: 'fake-phone', version: VERSION }, instructions: INSTRUCTIONS });
    }
    if (method === 'ping') return ok(id, {});
    if (method === 'tools/list') return ok(id, { tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.schema })) });
    if (method === 'tools/call') {
      try { return ok(id, await callTool(params?.name, params?.arguments || {})); }
      catch (e) {
        if (e.code === -32602) return err(id, -32602, e.message);
        return ok(id, { isError: true, content: [{ type: 'text', text: String(e.message || e) }] });
      }
    }
    return err(id, -32601, `Method not found: ${method}`);
  } catch (e) { return err(id, -32603, String(e.message || e)); }
}

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { err(null, -32700, 'Parse error'); continue; }
    handle(msg);
  }
});
process.stdin.on('end', () => process.exit(0));
if (!TOKEN) process.stderr.write('fake-phone-mcp: FAKE_PHONE_TOKEN is not set (copy it from Fake Phone > Voices & Keys > AI control)\n');
