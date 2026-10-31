// Compiles a project's event list into a timed timeline. Everything the renderer and the audio
// engine need is derived here, so playback, scrubbing and export are deterministic.
import { clamp, graphemes, hashInt, rnd, words, isEmojiOnly } from './util.js';
import { keyFor } from './keys.js';
import { THEMES, DEVICES, soundSet } from './themes.js';
import { resolveMotion, curve } from './motion.js';
import { BUBBLE_FX, SCREEN_FX } from './model.js';
import { themeApp } from './apps.js';

const speakEstimate = (text) => 0.5 + words(text) * 0.36;
const R_AUDIO = { ios: 'Audio Message', whatsapp: '🎤 Voice message', android: 'Voice message', instagram: 'Sent a voice message' };

export function compile(p) {
  const pace = p.pace || 1;
  const cps = p.typingSpeed || 11;
  const kbStyle = DEVICES[p.device]?.os === 'android' ? 'gboard' : 'ios';
  const snd = soundSet(p.theme);
  const theme = THEMES[p.theme] || THEMES.imessage;
  const members = p.chat.members;
  // home screen: which icon opens the chat app, and the red badge counts
  const homeAll = [...(p.home?.apps || []), ...(p.home?.dock || [])];
  const themeKey = themeApp(p.theme);
  const themeHome = () => homeAll.find((a) => a.app === themeKey) || null;
  const badgeCount = {};
  for (const a of homeAll) if (badgeCount[a.app] == null) badgeCount[a.app] = a.badge || 0;
  const setBadge = (key, n, at) => { if (!key) return; badgeCount[key] = n; out.badges.push({ t: at, key, n }); };
  const mo = resolveMotion(p);
  const TRANS = mo.screen.dur, KB_SLIDE = mo.keyboard.dur, SWIPE_LEN = mo.swipe.dur, CALL_FADE = mo.call.dur;

  const out = {
    mo,
    pre: [], items: [], kbShow: [], compose: [], receipts: [], reactions: [],
    screens: [{ t: -1, to: p.startScreen, from: p.startScreen }],
    banners: [], lockNotes: [], swipes: [], calls: [], audio: [], captions: [], taps: [], badges: [], players: [],
    headerStatus: [], unread: [], records: [], shots: [], shakes: [], fx: [], marks: {}, duration: 0, kbStyle,
  };

  let t = 0.5;
  let screen = p.startScreen;
  let kbOn = p.keyboard === 'always' && screen === 'chat';
  out.kbShow.push({ t: -1, on: kbOn });
  // message ids still on screen, newest last (unsend removes); reactions/receipts target these
  const msgs = [], mine = [];
  const lastOf = (a) => a[a.length - 1] || null;

  // Camera: shots blend from wherever the camera is to a target; message moves return to the base
  // view set by the latest camera event. 'latest' follows the newest bubble on screen.
  let camBase = { target: { kind: 'full' }, Z: 1 };
  const camTarget = (tg) => (!tg || tg === 'last' ? { kind: 'latest' } : ['composer', 'header', 'center'].includes(tg) ? { kind: tg } : { kind: 'msg', evId: tg });
  const camFor = (ev, tIn, tEnd) => {
    const cam = ev.cam || 'none';
    const Z = ev.camZoom || 1.8;
    if (cam === 'shake') out.shakes.push({ t0: tIn, dur: 0.6, amp: 1 });
    else if (cam === 'punch') {
      out.shots.push({ t: tIn, target: { kind: 'msg', evId: ev.id }, Z: 1.3, dur: mo.punch.dur, f: mo.punch.f });
      out.shots.push({ t: tIn + 0.85, ...camBase, dur: 0.5, f: mo.camera.f });
    } else if (cam === 'zoom') {
      const seg = out.compose.find((c) => c.evId === ev.id);
      if (seg) out.shots.push({ t: seg.t0, target: { kind: 'composer' }, Z, dur: mo.camera.dur, f: mo.camera.f });
      out.shots.push({ t: seg ? tIn : Math.max(0, tIn - 0.05), target: { kind: 'msg', evId: ev.id }, Z, dur: seg ? 0.45 : mo.camera.dur, f: mo.camera.f });
      out.shots.push({ t: tEnd, ...camBase, dur: mo.camera.dur, f: mo.camera.f });
    }
  };

  const setKb = (on, at) => { if (on !== kbOn) { kbOn = on; out.kbShow.push({ t: at, on }); } };
  const sfx = (name, at, extra = {}) => out.audio.push({ t: at, sfx: name, ...extra });
  const voice = (v, at, who, text) => {
    if (!v || !v.mediaId || v.src === 'none') return 0;
    const dur = v.dur || speakEstimate(text);
    out.audio.push({ t: at, media: v.mediaId, dur, bus: 'voice' });
    if (p.captions) out.captions.push({ t0: at, t1: at + dur, text: v.say || text, who });
    return dur;
  };
  const go = (to, at, x = {}) => {
    if (to === screen) return 0;
    const entry = { t: at, to, from: screen };
    // between the home screen and an app the app grows out of / shrinks into its icon
    if ((screen === 'home' && (to === 'chat' || to === 'inbox')) || (to === 'home' && (screen === 'chat' || screen === 'inbox'))) {
      entry.kind = 'app';
      entry.dur = mo.appOpen.dur;
      entry.app = x.app || themeHome()?.id || null;
      if (to !== 'home') { const a = homeAll.find((h) => h.id === entry.app); if (a) setBadge(a.app, 0, at); }
    }
    out.screens.push(entry);
    if (to !== 'chat') setKb(false, at);
    else if (p.keyboard === 'always') setKb(true, at + (entry.dur ?? TRANS) * 0.6);
    if (to === 'chat') out.unread.push({ t: at, unread: false });
    if (screen === 'lock') sfx('unlock', at);
    if (to === 'lock') sfx('lock', at);
    screen = to;
    return (entry.dur ?? TRANS) + 0.15;
  };

  for (const ev of p.events) {
    const t0 = t;
    switch (ev.type) {
      case 'msg': {
        const side = ev.from === 'me' ? 'me' : 'them';
        const vn = !!ev.vn;
        const isImage = !!ev.mediaId && !vn;
        const isVideo = isImage && ev.mediaKind === 'video';
        const text = ev.text || '';
        const draft = side === 'me' && !vn ? (ev.draft || '').trim() : '';
        const items = [];
        if (vn) {
          items.push({ id: ev.id, evId: ev.id, kind: 'voice', side, from: ev.from, dur: ev.voice?.dur || speakEstimate(text), peaks: ev.voice?.peaks || null, seed: hashInt(ev.id) });
        } else {
          if (isImage) items.push({ id: ev.id, evId: ev.id, kind: isVideo ? 'video' : 'image', side, from: ev.from, mediaId: ev.mediaId, ...(isVideo ? { dur: ev.mediaDur || 5 } : {}) });
          if (text || (!isImage && !draft)) items.push({ id: isImage ? ev.id + '_t' : ev.id, evId: ev.id, kind: 'msg', side, from: ev.from, text, big: isEmojiOnly(text) });
        }
        const sends = items.length > 0;     // a draft with no text is typed, deleted and never sent

        if (ev.pre) {
          for (const it of items) { it.tIn = -1; it.pre = true; out.pre.push(it); }
          msgs.push(ev.id);
          if (side === 'me') mine.push(ev.id);
          break;
        }

        let tIn;
        let typed = false;
        if (side === 'me') {
          let mode = ev.typing || 'auto';
          if (mode === 'auto' || mode === 'indicator') mode = p.keyboard === 'never' || isImage ? 'instant' : 'keyboard';
          if (screen !== 'chat') mode = 'instant';
          if (vn && screen === 'chat' && (ev.vnMode || 'record') === 'record') {
            // recorded live: the voice plays while the recording bar runs, then it is sent
            const d = items[0].dur;
            const r0 = t + 0.35;
            out.records.push({ evId: ev.id, t0: r0, t1: r0 + d, dur: d, peaks: items[0].peaks, seed: items[0].seed });
            sfx('tap', r0 - 0.1);
            voice(ev.voice, r0, ev.from, text);
            tIn = r0 + d + 0.35;
          } else if (!vn && mode === 'keyboard' && (text || draft)) {
            if (!kbOn) { setKb(true, t); t += KB_SLIDE + 0.1; }
            t += 0.25;
            const seed = hashInt(ev.id);
            const ops = [];
            let ct = t, layout = 'abc';
            const typeOut = (str, base) => graphemes(str).forEach((g, i) => {
              const k = keyFor(g, kbStyle);
              let dt = (1 / cps) * (0.6 + 0.8 * rnd(seed + base + i));
              if (k.layout && k.layout !== layout) { dt += 0.16; layout = k.layout; }
              if (k.shift) dt += 0.05;
              if (/[.,!?]/.test(g)) dt += 0.07;
              if (k.emoji) dt += 0.12;
              ct += dt;
              ops.push({ t: ct, g, key: k.key, layout: k.layout || layout, shift: !!k.shift });
              if (p.sounds.keys !== false) sfx(g === ' ' ? 'keySpace' : 'key', ct, { bus: 'keys' });
            });
            if (draft) {
              typeOut(draft, 0);
              ct += ev.draftPause ?? 0.9;
              // holding delete: starts slow, speeds up
              const n = graphemes(draft).length;
              for (let i = 0; i < n; i++) {
                ct += Math.max(0.045, 0.13 * Math.pow(0.86, i));
                ops.push({ t: ct, del: true, key: 'del', layout });
                if (p.sounds.keys !== false) sfx('keyDel', ct, { bus: 'keys' });
              }
              ct += 0.5;
            }
            if (text) typeOut(text, 1000);
            tIn = ct + 0.32;
            out.compose.push({ evId: ev.id, t0: t, tSend: tIn, chars: ops, text, noSend: !text });
            typed = true;
          } else {
            if (mode === 'keyboard' && !kbOn && !vn) { setKb(true, t); t += KB_SLIDE; }
            tIn = t + 0.15;
            if (vn) items[0].tPlay = tIn + 0.6;
          }
          if (sends) {
            if (screen === 'chat') sfx(snd.send, tIn);
            if (theme.receipts && p.receipts) out.receipts.push({ t: tIn + 0.6, label: 'Delivered', target: ev.id });
            mine.push(ev.id);
          }
        } else {
          const mode = ev.typing || 'auto';
          const indicator = (mode === 'auto' || mode === 'indicator' || mode === 'keyboard') && screen === 'chat';
          let grow = 0;
          if (indicator) {
            const d = ev.typingDur ?? (vn ? 1.6 : clamp(0.7 + graphemes(text).length * 0.035, 1.0, 3.0)) * pace;
            if (p.theme === 'whatsapp') out.headerStatus.push({ t0: t, t1: t + d, text: vn ? 'recording audio…' : 'typing…' });
            else { out.items.push({ id: ev.id + '_typ', kind: 'typing', side: 'them', from: ev.from, tIn: t, tOut: t + d, swap: true }); grow = 1; }
            t += d;
          }
          tIn = t + (indicator ? 0 : 0.15);
          if (grow) items.forEach((it) => { it.grow = true; });
          if (vn) items[0].tPlay = tIn + 0.6;
          const note = vn ? (R_AUDIO[theme.family] || 'Voice message') : text || (isVideo ? 'Sent a video' : 'Sent an image');
          if (screen === 'chat') sfx(snd.receive, tIn);
          else if (screen === 'lock') { out.lockNotes.push({ t: tIn, from: ev.from, text: note }); sfx(snd.notify, tIn); }
          else if (screen === 'inbox') { out.unread.push({ t: tIn, unread: true }); sfx(snd.receive, tIn); }
        }

        if (!sends) { t = tIn + 0.3; break; }
        for (const it of items) { it.tIn = tIn; out.items.push(it); }
        msgs.push(ev.id);

        const n = words(text);
        let hold = ev.hold;
        if (hold == null) {
          if (vn) hold = 0.9;
          else if (isImage && !text) hold = 1.7;
          else if (typed) hold = 0.45 + n * 0.04;
          else hold = 0.7 + n * 0.17;
          hold *= pace;
        }
        if (vn && items[0].tPlay) {
          // received / sent-then-played voice note: plays a moment after it lands
          const vd = voice(ev.voice, items[0].tPlay, ev.from, text) || items[0].dur;
          hold = Math.max(hold, items[0].tPlay - tIn + vd + 0.4);
        } else if (!vn) {
          const vd = voice(ev.voice, tIn, ev.from, text);
          if (vd) hold = Math.max(hold, vd + 0.25);
        }
        // a video plays in its bubble, or (default) someone taps it and it opens in a full-screen player
        const vid = isVideo ? items.find((it) => it.kind === 'video') : null;
        if (vid) {
          let tPlay;
          if (ev.vmode !== 'inline' && screen === 'chat') {
            const tTap = tIn + 0.75, tOpen = tTap + 0.35, openDur = 0.45, closeDur = 0.4;
            tPlay = tOpen + openDur + 0.1;
            const tEnd = tPlay + vid.dur, tClose = tEnd + 0.7;
            out.players.push({ evId: ev.id, mediaId: ev.mediaId, side, from: ev.from, tTap, tOpen, openDur, tPlay, dur: vid.dur, tEnd, tClose, closeDur });
            sfx('tap', tTap + 0.28);
            hold = Math.max(hold, tClose + closeDur + 0.35 - tIn);
          } else {
            tPlay = tIn + 0.6;
            hold = Math.max(hold, tPlay + vid.dur + 0.5 - tIn);
          }
          vid.tPlay = tPlay;
          out.audio.push({ t: tPlay, media: ev.mediaId, dur: vid.dur, bus: 'voice' });
        }
        if (screen === 'chat') {
          if (BUBBLE_FX[ev.effect]) {
            items.forEach((it) => { it.effect = ev.effect; if (ev.effect === 'ink') it.inkUntil = tIn + BUBBLE_FX.ink.dur; });
            hold = Math.max(hold, BUBBLE_FX[ev.effect].dur + 0.3);
            sfx('fx_' + ev.effect, tIn);
            if (ev.effect === 'slam') out.shakes.push({ t0: tIn + 0.26, dur: 0.45, amp: 0.8 });
          }
          if (SCREEN_FX[ev.screenFx]) {
            out.fx.push({ t0: tIn + 0.15, kind: ev.screenFx, evId: ev.id, side, dur: SCREEN_FX[ev.screenFx].dur });
            hold = Math.max(hold, SCREEN_FX[ev.screenFx].dur + 0.35);
            sfx('fx_' + ev.screenFx, tIn + 0.15);
          }
          // give a camera move time to land before the camera eases back
          if (ev.cam === 'zoom') hold = Math.max(hold, 1.5 * pace);
          if (ev.cam === 'punch') hold = Math.max(hold, 0.9);
          camFor(ev, tIn, tIn + hold);
        }
        t = tIn + hold;
        break;
      }

      case 'typing': {
        const d = ev.dur ?? 2;
        if (p.theme === 'whatsapp') out.headerStatus.push({ t0: t, t1: t + d, text: 'typing…' });
        else out.items.push({ id: ev.id, evId: ev.id, kind: 'typing', side: 'them', from: ev.from || members[0], tIn: t, tOut: t + d });
        t += d + 0.35;
        break;
      }

      case 'pause': t += Math.max(0, ev.dur ?? 1); break;

      case 'stamp': {
        const it = { id: ev.id, evId: ev.id, kind: 'stamp', text: ev.text || '', tIn: ev.pre ? -1 : t, pre: !!ev.pre };
        (ev.pre ? out.pre : out.items).push(it);
        if (!ev.pre) t += 0.4;
        break;
      }

      case 'read': {
        if (lastOf(mine)) out.receipts.push({ t, label: ev.text || `Read ${p.status.time}`, target: lastOf(mine), read: true });
        t += 0.7 * pace;
        break;
      }

      case 'react': {
        const target = ev.target || lastOf(msgs);
        if (target) {
          out.reactions.push({ t: t + 0.15, target, emoji: ev.emoji || '❤️', from: ev.from || 'me' });
          sfx('tapback', t + 0.15);
        }
        t += 1.0 * pace;
        break;
      }

      case 'unsend': {
        const target = ev.target || lastOf(mine);
        for (const it of [...out.pre, ...out.items]) if (it.evId === target && it.tOut == null) { it.tOut = t + 0.1; it.unsent = true; }
        if (target) sfx('poof', t + 0.1);
        for (const a of [msgs, mine]) { const i = a.lastIndexOf(target); if (i >= 0) a.splice(i, 1); }
        t += 0.9;
        break;
      }

      case 'notify': {
        const from = ev.from || members[0];
        // which app it comes from, an optional bold title, sender photo and attached picture
        const note = { from, text: ev.text, title: ev.title || '', app: ev.app || 'auto', appName: ev.appName || '', appColor: ev.appColor, iconId: ev.iconId || null, photo: !!ev.photo, imageId: ev.imageId || null };
        if (screen === 'lock') out.lockNotes.push({ t, ...note });
        else out.banners.push({ t0: t, t1: t + (ev.dur ?? 3.5), ...note });
        if (ev.badge !== false) { const key = ev.app === 'custom' ? null : ev.app && ev.app !== 'auto' ? ev.app : themeKey; if (key) setBadge(key, (badgeCount[key] || 0) + 1, t + 0.35); }
        sfx(snd.notify, t);
        t += ev.wait ?? 1.6;
        break;
      }

      case 'screen': t += go(ev.to || 'chat', t); break;

      case 'openapp': {
        // go to the home screen, tap the app's icon, and it opens
        if (screen !== 'home') t += go('home', t) + 0.15;
        const app = ev.app && ev.app !== 'auto' ? homeAll.find((a) => a.id === ev.app) : themeHome();
        out.taps.push({ t0: t, app: app?.id || null });
        sfx('tap', t + 0.3);
        t += 0.55;
        t += go(ev.to === 'inbox' ? 'inbox' : 'chat', t, { app: app?.id });
        break;
      }

      case 'swipe': {
        if (screen !== 'inbox') t += go('inbox', t) + 0.2;
        out.swipes.push({ t0: t, row: ev.row || 'chat', evId: ev.id });
        sfx('swoosh', t + SWIPE_LEN * 0.56);
        t += SWIPE_LEN + 0.2;
        break;
      }

      case 'call': {
        const dir = ev.direction === 'out' ? 'out' : 'in';
        const outcome = ev.outcome || 'answer';
        const ring = Math.max(0.8, ev.ring ?? 4);
        const c = { t0: t, dir, who: ev.with || members[0], outcome, lines: [], evId: ev.id };
        if (dir === 'in') sfx('ringtone', t + 0.1, { dur: ring - 0.1, loop: true });
        else sfx('ringback', t + 0.5, { dur: ring - 0.5, loop: true });
        if (outcome === 'answer') {
          c.tAnswer = t + ring;
          sfx('connect', c.tAnswer);
          let lt = c.tAnswer + 0.7;
          for (const l of ev.lines || []) {
            const d = l.voice?.mediaId ? voice(l.voice, lt, l.from, l.text) : speakEstimate(l.text);
            if (!l.voice?.mediaId && p.captions) out.captions.push({ t0: lt, t1: lt + d, text: l.text, who: l.from });
            c.lines.push({ t0: lt, t1: lt + d, text: l.text, from: l.from });
            lt += d + 0.35;
          }
          c.tEnd = Math.max(lt, c.tAnswer + (ev.talk ?? 3));
          sfx('hangup', c.tEnd);
          c.endLabel = 'Call Ended';
          c.tBack = c.tEnd + 1.3;
        } else if (outcome === 'decline') {
          c.tEnd = t + ring;
          c.endLabel = dir === 'in' ? '' : 'Call Failed';
          sfx(dir === 'in' ? 'tap' : 'busy', c.tEnd);
          c.tBack = c.tEnd + (dir === 'in' ? 0.45 : 1.8);
        } else {
          c.tEnd = t + ring;
          c.endLabel = dir === 'in' ? '' : 'No Answer';
          c.tBack = c.tEnd + (dir === 'in' ? 0.2 : 1.6);
          if (dir === 'in') {
            const at = c.tBack + CALL_FADE;
            if (screen === 'lock') out.lockNotes.push({ t: at, from: c.who, text: 'Missed Call', call: true });
            else out.banners.push({ t0: at, t1: at + 3.2, from: c.who, text: 'Missed Call', call: true });
            sfx(snd.notify, at);
          }
        }
        out.calls.push(c);
        t = c.tBack + CALL_FADE + 0.25;
        break;
      }

      case 'voiceover': {
        const d = ev.voice?.mediaId ? voice(ev.voice, t, 'narrator', ev.text) : 0;
        if (!d && p.captions && ev.text) out.captions.push({ t0: t, t1: t + speakEstimate(ev.text), text: ev.text, who: 'narrator' });
        if (!ev.overlap) t += (d || speakEstimate(ev.text)) + 0.2;
        break;
      }

      case 'camera': {
        const move = ev.move || 'zoom';
        if (move === 'shake') out.shakes.push({ t0: t, dur: ev.dur ?? 0.7, amp: ev.amount ?? 1 });
        else if (move === 'reset') {
          camBase = { target: { kind: 'full' }, Z: 1 };
          out.shots.push({ t, ...camBase, dur: ev.dur ?? mo.camera.dur, f: mo.camera.f });
        } else if (move === 'push') {
          camBase = { target: camTarget(ev.target || 'center'), Z: ev.zoom ?? 1.25 };
          out.shots.push({ t, ...camBase, dur: ev.dur ?? 5, f: curve('easeInOutSine') });
        } else {
          camBase = { target: camTarget(ev.target), Z: ev.zoom ?? 1.8 };
          out.shots.push({ t, ...camBase, dur: ev.dur ?? mo.camera.dur, f: mo.camera.f });
        }
        t += ev.wait ?? 0.2;
        break;
      }

      case 'sound': {
        if (ev.mediaId) out.audio.push({ t, media: ev.mediaId, dur: ev.dur || 0, bus: 'sfx' });
        else sfx(ev.sound || 'notify', t);
        t += ev.wait ?? 0;
        break;
      }
    }
    out.marks[ev.id] = { t0, t1: t };
  }

  let end = t + 0.8;
  if (p.narration?.mediaId) {
    const d = p.narration.dur || 0;
    out.audio.push({ t: p.narration.offset || 0, media: p.narration.mediaId, dur: d, bus: 'voice' });
    end = Math.max(end, (p.narration.offset || 0) + d + 0.3);
  }
  for (const a of out.audio) if (a.dur) end = Math.max(end, a.t + a.dur + 0.2);
  out.duration = end;
  if (p.music?.mediaId) {
    const voices = out.audio.filter((a) => a.bus === 'voice');
    out.audio.push({ t: 0, media: p.music.mediaId, dur: end, bus: 'music', loop: p.music.loop !== false, start: p.music.start || 0, env: musicEnvelope(voices, end, p.music) });
  }
  out.audio.sort((a, b) => a.t - b.t);
  out.shots.sort((a, b) => a.t - b.t);
  // a new banner replaces the one still showing (which leaves as the next one drops in)
  out.banners.sort((a, b) => a.t0 - b.t0);
  out.banners.forEach((b, i) => { const nx = out.banners[i + 1]; if (nx && nx.t0 < b.t1) b.t1 = Math.max(b.t0 + 0.4, nx.t0); });
  out.items = [...out.pre, ...out.items];
  return out;
}

// ---- queries used by the renderer ----------------------------------------
export function screenAt(tl, t) {
  let cur = tl.screens[0], prev = null;
  for (const s of tl.screens) if (s.t <= t) { prev = cur; cur = s; }
  const k = cur.t < 0 ? 1 : clamp((t - cur.t) / (cur.dur ?? tl.mo.screen.dur), 0, 1);
  return { to: cur.to, from: cur.from, k, t: cur.t, prev, kind: cur.kind || null, app: cur.app || null };
}

export function kbAt(tl, t) {
  let cur = tl.kbShow[0];
  for (const s of tl.kbShow) if (s.t <= t) cur = s;
  const k = cur.t < 0 ? 1 : tl.mo.keyboard.f(clamp((t - cur.t) / tl.mo.keyboard.dur, 0, 1));
  return cur.on ? k : 1 - k;
}

export function composeAt(tl, t) {
  for (const c of tl.compose) {
    if (t < c.t0) break;
    if (t < c.tSend) {
      const gs = [];
      let last = null, next = null;
      for (const ch of c.chars) {
        if (ch.t <= t) { if (ch.del) gs.pop(); else gs.push(ch.g); last = ch; } else { next = ch; break; }
      }
      return { text: gs.join(''), last, next, seg: c, sendIn: c.noSend ? Infinity : c.tSend - t };
    }
  }
  return null;
}

export function recordAt(tl, t) {
  for (const r of tl.records) if (t >= r.t0 - 0.3 && t < r.t1 + 0.35) return r;
  return null;
}

export function callAt(tl, t) {
  for (const c of tl.calls) if (t >= c.t0 && t < c.tBack + tl.mo.call.dur) return c;
  return null;
}

export function unreadAt(tl, t) {
  let u = false;
  for (const x of tl.unread) if (x.t <= t) u = x.unread;
  return u;
}

// Music level over time: fades in and out, and dips under every voice. Sampled every 50 ms into
// automation points (flat runs collapsed) that the audio engine ramps between.
function musicEnvelope(voices, end, m) {
  const V = m.volume ?? 0.3, duck = m.duck ?? 0.25, fi = m.fadeIn ?? 1, fo = m.fadeOut ?? 2;
  const attack = 0.25, release = 0.6;
  const wins = [];
  for (const c of voices.map((v) => [v.t - 0.1, v.t + (v.dur || 0) + 0.1]).sort((a, b) => a[0] - b[0])) {
    const lastWin = wins[wins.length - 1];
    if (lastWin && c[0] - lastWin[1] < 0.8) lastWin[1] = Math.max(lastWin[1], c[1]);   // short gaps stay ducked (no pumping)
    else wins.push(c);
  }
  const at = (t) => {
    let w = 0;
    for (const [a, b] of wins) {
      if (t < a - attack || t > b + release) continue;
      w = Math.max(w, t < a ? (t - (a - attack)) / attack : t > b ? 1 - (t - b) / release : 1);
    }
    const fade = Math.min(1, fi > 0 ? t / fi : 1, fo > 0 ? (end - t) / fo : 1);
    return Math.max(0, V * fade * (1 - (1 - duck) * w));
  };
  const pts = [];
  for (let t = 0; t <= end + 1e-6; t += 0.05) {
    const g = at(t);
    const n = pts.length;
    if (n >= 2 && Math.abs(pts[n - 1].g - g) < 1e-4 && Math.abs(pts[n - 2].g - g) < 1e-4) pts[n - 1].t = t;
    else pts.push({ t, g });
  }
  return pts;
}

export function envAt(env, t) {
  if (!env.length || t <= env[0].t) return env[0]?.g ?? 0;
  for (let i = 1; i < env.length; i++) {
    if (t <= env[i].t) {
      const a = env[i - 1], b = env[i];
      return a.g + (b.g - a.g) * ((t - a.t) / (b.t - a.t || 1));
    }
  }
  return env[env.length - 1].g;
}
