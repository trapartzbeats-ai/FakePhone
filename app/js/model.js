// Project data: defaults, event factory, the demo, and the quick-script parser.
import { uid } from './util.js';

export const CONTACT_COLORS = ['#FF9500', '#5856D6', '#FF2D55', '#34C759', '#AF52DE', '#32ADE6', '#FF3B30', '#A2845E'];

export const EVENT_TYPES = {
  msg: { label: 'Message', icon: '💬' },
  typing: { label: 'Typing (fake-out)', icon: '…' },
  pause: { label: 'Pause', icon: '⏸' },
  stamp: { label: 'Timestamp', icon: '🕘' },
  react: { label: 'Reaction', icon: '❤️' },
  read: { label: 'Read receipt', icon: '✓' },
  unsend: { label: 'Unsend message', icon: '↩' },
  notify: { label: 'Notification banner', icon: '🔔' },
  screen: { label: 'Change screen', icon: '📱' },
  swipe: { label: 'Swipe to delete chat', icon: '🗑' },
  call: { label: 'Phone call', icon: '📞' },
  voiceover: { label: 'Voice-over', icon: '🎙' },
  camera: { label: 'Camera move', icon: '🎥' },
  sound: { label: 'Sound effect', icon: '🔊' },
};

export const REACTIONS = { heart: '❤️', like: '👍', dislike: '👎', haha: '😂', '!!': '‼️', '?': '❓' };

export const SCREENS = { chat: 'Chat', inbox: 'Messages list', lock: 'Lock screen' };

// iMessage-style send effects. dur = how long the effect plays (the story waits for it).
export const BUBBLE_FX = { slam: { label: 'Slam', dur: 0.9 }, loud: { label: 'Loud', dur: 1.3 }, gentle: { label: 'Gentle', dur: 1.7 }, ink: { label: 'Invisible Ink', dur: 2.4 } };
export const SCREEN_FX = {
  confetti: { label: 'Confetti', dur: 3.2 }, balloons: { label: 'Balloons', dur: 3.8 }, fireworks: { label: 'Fireworks', dur: 3.4 },
  love: { label: 'Love', dur: 2.6 }, lasers: { label: 'Lasers', dur: 3.2 }, celebration: { label: 'Celebration', dur: 3.0 },
  spotlight: { label: 'Spotlight', dur: 3.0 }, echo: { label: 'Echo', dur: 2.6 },
};
export const CAMERA_FX = { zoom: 'Zoom in on it', punch: 'Punch-in', shake: 'Shake' };
export const CAMERA_MOVES = { zoom: 'Zoom in (stays)', push: 'Slow push-in', reset: 'Back to full view', shake: 'Shake' };
export const CAMERA_TARGETS = { last: 'Last message', composer: 'Typing box', header: 'Contact name', center: 'Middle of the screen' };

export function newEvent(type, init = {}, project = null) {
  const them = project ? project.chat.members[0] : 'c1';
  const base = {
    msg: { from: 'me', text: '', mediaId: null, typing: 'auto', typingDur: null, hold: null, pre: false, voice: null, draft: '', draftPause: null, vn: false, vnMode: 'record', effect: null, screenFx: null, cam: 'none', camZoom: 1.8 },
    typing: { from: them, dur: 2 },
    pause: { dur: 1 },
    stamp: { text: 'Today 9:41 AM', pre: false },
    react: { target: null, from: 'me', emoji: '❤️' },
    read: { text: '' },
    unsend: { target: null },
    notify: { from: them, text: '', dur: 3.5, wait: 1.6 },
    screen: { to: 'inbox' },
    swipe: { row: null },
    call: { direction: 'in', with: them, outcome: 'answer', ring: 4, talk: 3, lines: [] },
    voiceover: { text: '', voice: null, overlap: false },
    sound: { sound: 'notify', mediaId: null, wait: 0 },
    camera: { move: 'zoom', target: 'last', zoom: 1.8, dur: null, amount: 1, wait: 0.2 },
  }[type];
  return { id: uid('e'), type, ...structuredClone(base), ...init };
}

export function newProject(name = 'Untitled chat') {
  return {
    id: uid('p'),
    name,
    version: 1,
    created: Date.now(),
    updated: Date.now(),
    theme: 'imessage',
    dark: false,
    device: 'island',
    layout: 'phone',
    background: { type: 'gradient', color: '#0d0d12', color2: '#2b2140', mediaId: null },
    wallpaper: { type: 'gradient', color: '#1b2a6b', color2: '#e7a2c9', mediaId: null },
    status: { time: '9:41', battery: 82, signal: 4, wifi: true, date: 'Friday, October 31' },
    me: { name: 'Me', voiceId: '', voiceName: '' },
    contacts: [{ id: 'c1', name: 'Anthony S.', color: '#FF9500', avatar: null, voiceId: '', voiceName: '', label: 'mobile' }],
    chat: { members: ['c1'], name: '' },
    narrator: { voiceId: '', voiceName: '' },
    keyboard: 'auto',
    typingSpeed: 11,
    pace: 1,
    emojiStyle: 'noto',
    startScreen: 'chat',
    receipts: true,
    captions: false,
    showTouches: true,
    inbox: [
      { id: 'r1', name: 'Mom', preview: 'Call me when you get a chance ❤️', time: 'Yesterday', unread: false, color: '#5856D6' },
      { id: 'r2', name: 'Spam Likely', preview: 'Congrats!! You won a FREE cruise, claim now', time: 'Yesterday', unread: true, color: '#8E8E93' },
      { id: 'r3', name: 'Coach Dre', preview: 'Practice moved to 6', time: 'Tuesday', unread: false, color: '#34C759' },
      { id: 'r4', name: 'Kay', preview: 'lmaooo send me that', time: 'Monday', unread: false, color: '#FF2D55' },
    ],
    sounds: { keys: true, overrides: {} },
    narration: null,
    music: null,
    events: [],
  };
}

// Fill in anything an older or imported project is missing.
export function migrate(p) {
  const d = newProject(p.name);
  for (const k of Object.keys(d)) {
    if (p[k] === undefined) p[k] = d[k];
    else if (d[k] && typeof d[k] === 'object' && !Array.isArray(d[k]) && p[k] && typeof p[k] === 'object') {
      for (const kk of Object.keys(d[k])) if (p[k][kk] === undefined) p[k][kk] = d[k][kk];
    }
  }
  for (const e of p.events) {
    const base = newEvent(e.type, {}, p);
    for (const k of Object.keys(base)) if (e[k] === undefined) e[k] = base[k];
  }
  if (!p.chat.members.length && p.contacts.length) p.chat.members = [p.contacts[0].id];
  return p;
}

export function demoProject() {
  const p = newProject('Party at Smith\'s (demo)');
  const A = 'c1';
  const ev = (type, init) => newEvent(type, init, p);
  p.events = [
    ev('stamp', { text: 'Today 9:39 AM', pre: true }),
    ev('msg', { from: A, pre: true, text: 'Save 10% off a new party at Smith\'s! Jack\'s birthday is right around the corner so book today! Click for details: http://wfl.ink/****' }),
    ev('pause', { dur: 0.6 }),
    ev('msg', { from: 'me', text: 'can i book a party online?' }),
    ev('msg', { from: A, text: 'Yes! Just follow the link above' }),
    ev('msg', { from: 'me', text: 'Great thanks! I will book today. Looking forward to having Jack\'s party at Smith\'s! 🎉' }),
    ev('read', {}),
    ev('msg', { from: A, text: '🎂🎈🥳' }),
    ev('react', { from: 'me', emoji: '❤️' }),
    ev('typing', { from: A, dur: 2.2 }),
    ev('call', {
      direction: 'in', with: A, outcome: 'answer', ring: 3.5, talk: 2,
      lines: [
        { id: uid('l'), from: A, text: 'Hey! Quick one, do you want the bowling package too?', voice: null },
        { id: uid('l'), from: 'me', text: 'Yes please, Jack would love that.', voice: null },
      ],
    }),
    ev('msg', { from: A, text: 'Done ✅ See you Saturday at 2!' }),
    ev('screen', { to: 'inbox' }),
    ev('swipe', { row: 'r2' }),
    ev('notify', { from: 'c2', text: 'Did you book the party?? 👀' }),
    ev('pause', { dur: 1.2 }),
  ];
  p.contacts.push({ id: 'c2', name: 'Mom', color: '#5856D6', avatar: null, voiceId: '', voiceName: '', label: 'mobile' });
  return p;
}

// ---- people helpers -------------------------------------------------------
export const contact = (p, id) => p.contacts.find((c) => c.id === id);
export function nameOf(p, id) {
  if (id === 'me') return p.me.name || 'Me';
  return contact(p, id)?.name || 'Unknown';
}
export function chatTitle(p) {
  if (p.chat.name) return p.chat.name;
  return p.chat.members.map((id) => nameOf(p, id)).join(', ') || 'Unknown';
}
export const isGroup = (p) => p.chat.members.length > 1;
export function voiceIdOf(p, id) {
  if (id === 'me') return p.me.voiceId;
  if (id === 'narrator') return p.narrator.voiceId;
  return contact(p, id)?.voiceId || '';
}

// ---- quick script ---------------------------------------------------------
// One line per beat. "Name: text" is a message, [commands] do the rest, "---" ends the
// already-on-screen history, and "> Name: text" lines after [call ...] are the call dialogue.
export const SCRIPT_HELP = `Anthony: Save 10% off a new party at Smith's!
---
me: can i book a party online?
Anthony: Yes! Just follow the link above
[typing 2]
[pause 1]
[read]
[react heart]
[time Today 9:41 AM]
[notify Mom: did you book it??]
Anthony: 🎤 call me when you see this
me: ~~I love you~~ ok bet
[call in Anthony answer]
> Anthony: Hey, you there?
> me: yeah what's up
[inbox]
[delete Spam Likely]
[chat]
narrator: And that's when everything changed...`;

export function parseScript(text, p) {
  const events = [];
  const ev = (type, init) => newEvent(type, init, p);
  const lines = text.split(/\r?\n/);
  let inPre = lines.some((l) => l.trim() === '---');
  let lastFrom = 'me';
  let lastCall = null;

  const resolve = (raw) => {
    const n = raw.trim().toLowerCase();
    if (['me', 'i', 'you', 'myself'].includes(n)) return 'me';
    if (['them', 'they', 'other'].includes(n)) return p.chat.members[0] || 'me';
    let c = p.contacts.find((x) => x.name.toLowerCase() === n)
      || p.contacts.find((x) => x.name.toLowerCase().split(/\s+/)[0] === n.split(/\s+/)[0]);
    if (!c) {
      c = { id: uid('c'), name: raw.trim(), color: CONTACT_COLORS[p.contacts.length % CONTACT_COLORS.length], avatar: null, voiceId: '', voiceName: '', label: 'mobile' };
      p.contacts.push(c);
      if (!p.chat.members.length) p.chat.members.push(c.id);
    }
    return c.id;
  };
  const rowFor = (name) => {
    const n = name.trim().toLowerCase();
    const r = p.inbox.find((x) => x.name.toLowerCase() === n) || p.inbox.find((x) => x.name.toLowerCase().startsWith(n));
    return r ? r.id : 'chat';
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) continue;
    if (line === '---') { inPre = false; continue; }

    if (line.startsWith('>') && lastCall) {
      const m = line.slice(1).match(/^\s*([^:]{1,40}):\s*(.*)$/);
      if (m) lastCall.lines.push({ id: uid('l'), from: resolve(m[1]), text: m[2], voice: null });
      continue;
    }
    lastCall = null;

    const cmd = line.match(/^\[\s*([\w!?]+)\s*(.*?)\s*\]$/);
    if (cmd) {
      const name = cmd[1].toLowerCase();
      const arg = cmd[2];
      const num = parseFloat((arg.match(/[\d.]+/) || [])[0]);
      if (name === 'typing') {
        const who = arg.replace(/[\d.]+/g, '').trim();
        events.push(ev('typing', { from: who ? resolve(who) : p.chat.members[0], dur: num || 2 }));
      } else if (name === 'pause' || name === 'wait') events.push(ev('pause', { dur: num || 1 }));
      else if (name === 'time' || name === 'stamp') events.push(ev('stamp', { text: arg || 'Today 9:41 AM', pre: inPre }));
      else if (name === 'read') events.push(ev('read', { text: arg }));
      else if (name === 'react') events.push(ev('react', { emoji: REACTIONS[arg.toLowerCase()] || arg || '❤️' }));
      else if (name === 'unsend') events.push(ev('unsend', {}));
      else if (name === 'notify') {
        const m = arg.match(/^([^:]{1,40}):\s*(.*)$/);
        events.push(ev('notify', m ? { from: resolve(m[1]), text: m[2] } : { text: arg }));
      } else if (name === 'call') {
        const parts = arg.split(/\s+/);
        const dir = /^out/i.test(parts[0]) ? 'out' : 'in';
        const outcome = /decline/i.test(arg) ? 'decline' : /miss|no.?answer/i.test(arg) ? 'missed' : 'answer';
        const who = parts.filter((w, i) => !(i === 0 && /^(in|out|incoming|outgoing)$/i.test(w)) && !/^(answer|answered|decline|declined|missed|[\d.]+)$/i.test(w)).join(' ');
        lastCall = ev('call', { direction: dir, outcome, with: who ? resolve(who) : p.chat.members[0], ring: num || 4 });
        events.push(lastCall);
      } else if (['inbox', 'chat', 'lock', 'list'].includes(name)) events.push(ev('screen', { to: name === 'list' ? 'inbox' : name }));
      else if (name === 'screen') events.push(ev('screen', { to: ['inbox', 'chat', 'lock'].includes(arg) ? arg : 'inbox' }));
      else if (name === 'delete' || name === 'swipe') events.push(ev('swipe', { row: rowFor(arg) }));
      else if (name === 'vo' || name === 'narrator') events.push(ev('voiceover', { text: arg }));
      else if (name === 'sound') events.push(ev('sound', { sound: arg || 'notify' }));
      else if (name === 'camera' || name === 'shake' || name === 'zoom') {
        // [camera zoom|push|reset|shake] [last|typing|header|center] [amount] [seconds]
        const words = (name === 'camera' ? arg : `${name} ${arg}`).split(/\s+/).filter(Boolean);
        const move = ['zoom', 'push', 'reset', 'shake'].includes(words[0]) ? words[0] : 'zoom';
        const target = words.find((w) => ['last', 'typing', 'composer', 'header', 'center'].includes(w));
        const nums = words.map(Number).filter((x) => !Number.isNaN(x));
        events.push(ev('camera', { move, target: target === 'typing' ? 'composer' : target || (move === 'push' ? 'center' : 'last'), ...(nums[0] ? { zoom: move === 'shake' ? 1 : nums[0], amount: move === 'shake' ? nums[0] : 1 } : {}), ...(nums[1] ? { dur: nums[1] } : {}) }));
      }
      continue;
    }

    const m = line.match(/^([^:]{1,40}):\s*(.*)$/);
    if (m && !/^https?$/i.test(m[1].trim())) {
      if (/^(narrator|vo|voice ?over)$/i.test(m[1].trim())) { events.push(ev('voiceover', { text: m[2] })); continue; }
      lastFrom = resolve(m[1]);
      events.push(ev('msg', { from: lastFrom, pre: inPre, ...msgText(m[2]) }));
      continue;
    }
    events.push(ev('msg', { from: lastFrom, pre: inPre, ...msgText(line) }));
  }
  return events;
}

// "🎤 text" is a voice note (text = what is said), "~~draft~~ text" types the draft, deletes it,
// then types and sends the text ("~~draft~~" alone never sends).
// Trailing {tags} add effects: {slam} {loud} {gentle} {ink}, {confetti} {balloons} ..., {zoom} {punch} {shake}.
function msgText(raw) {
  let s = raw.trim();
  const fx = {};
  let tag;
  while ((tag = s.match(/\s*\{(\w+)\}\s*$/))) {
    const k = tag[1].toLowerCase();
    if (BUBBLE_FX[k]) fx.effect = k;
    else if (SCREEN_FX[k]) fx.screenFx = k;
    else if (CAMERA_FX[k]) fx.cam = k;
    else break;
    s = s.slice(0, tag.index).trim();
  }
  const vn = s.match(/^(?:🎤|\(voice\))\s*(.*)$/iu);
  if (vn) return { ...fx, vn: true, text: vn[1] };
  const d = s.match(/^~~(.+?)~~\s*(.*)$/);
  if (d) return { ...fx, draft: d[1], text: d[2] };
  return { ...fx, text: s };
}

function fxTags(e) {
  return [e.effect, e.screenFx, e.cam && e.cam !== 'none' ? e.cam : null].filter(Boolean).map((k) => ` {${k}}`).join('');
}

// Script text for the current project (round-trips through parseScript for messages and commands).
export function toScript(p) {
  const out = [];
  const hasPre = p.events.some((e) => e.pre);
  let preDone = !hasPre;
  const n = (id) => nameOf(p, id);
  for (const e of p.events) {
    if (!preDone && !e.pre) { out.push('---'); preDone = true; }
    switch (e.type) {
      case 'msg': {
        const body = e.vn ? `🎤 ${e.text}` : `${e.draft ? `~~${e.draft}~~ ` : ''}${e.text || (e.mediaId ? '[image]' : '')}`;
        out.push(`${e.from === 'me' ? 'me' : n(e.from)}: ${body.trimEnd()}${fxTags(e)}`);
        break;
      }
      case 'typing': out.push(`[typing ${n(e.from)} ${e.dur}]`); break;
      case 'pause': out.push(`[pause ${e.dur}]`); break;
      case 'stamp': out.push(`[time ${e.text}]`); break;
      case 'read': out.push(e.text ? `[read ${e.text}]` : '[read]'); break;
      case 'react': out.push(`[react ${e.emoji}]`); break;
      case 'unsend': out.push('[unsend]'); break;
      case 'notify': out.push(`[notify ${n(e.from)}: ${e.text}]`); break;
      case 'screen': out.push(`[${e.to}]`); break;
      case 'swipe': out.push(`[delete ${e.row === 'chat' ? chatTitle(p) : (p.inbox.find((r) => r.id === e.row)?.name || '')}]`); break;
      case 'call':
        out.push(`[call ${e.direction} ${n(e.with)} ${e.outcome} ${e.ring}]`);
        for (const l of e.lines) out.push(`> ${l.from === 'me' ? 'me' : n(l.from)}: ${l.text}`);
        break;
      case 'voiceover': out.push(`narrator: ${e.text}`); break;
      case 'sound': out.push(`[sound ${e.sound}]`); break;
      case 'camera': {
        const parts = ['camera', e.move];
        if (e.move === 'zoom' || e.move === 'push') parts.push(e.target || 'last', e.zoom);
        if (e.move === 'shake') parts.push(e.amount ?? 1);
        if (e.dur && e.move !== 'reset') parts.push(e.dur);
        out.push(`[${parts.join(' ')}]`);
        break;
      }
    }
  }
  return out.join('\n');
}
