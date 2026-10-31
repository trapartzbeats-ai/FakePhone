// Conversation screen: header, scrolling bubbles, typing indicator, reactions, receipts,
// composer with typed text, and the keyboard.
import { font, emojiFont } from '../themes.js';
import { graphemes, ease, easeBack, prog, lerp, clamp, rnd, hashInt } from '../util.js';
import { composeAt, kbAt, recordAt } from '../timeline.js';
import { lin, val } from '../motion.js';
import { kbHeight } from '../keys.js';
import { visual, frameAt, videoOf, syncVideo } from '../media.js';
import { chatTitle, nameOf, contact } from '../model.js';
import { rr, fillRR, circle, tw, wrap, lineWithLinks, icon, chevron, sendArrow, avatar, avatarOf, ellipsize } from './draw.js';
import { drawKeyboard } from './keyboard.js';

export const STYLE = {
  ios: { size: 17, lineH: 22, padX: 12, padY: 7, radius: 18, maxW: 0.7, gapSame: 2, gapGroup: 9, margin: 16, avatar: 28, headerH: 74, barH: 52 },
  android: { size: 16, lineH: 22, padX: 14, padY: 9, radius: 20, small: 5, maxW: 0.72, gapSame: 2, gapGroup: 10, margin: 12, avatar: 30, headerH: 64, barH: 64 },
  whatsapp: { size: 16, lineH: 21, padX: 9, padY: 6, radius: 8, maxW: 0.78, gapSame: 2, gapGroup: 9, margin: 12, avatar: 28, headerH: 54, barH: 52 },
  instagram: { size: 16, lineH: 21, padX: 13, padY: 9, radius: 20, small: 5, maxW: 0.68, gapSame: 2, gapGroup: 9, margin: 12, avatar: 28, headerH: 58, barH: 60 },
};
const TYPING = { w: 64, h: 38 };

const mcache = new Map();
function metrics(ctx, R, it) {
  const v = it.mediaId ? (it.kind === 'video' ? videoOf(it.mediaId, it.evId) : visual(it.mediaId)) : null;
  const key = `${R.sig}|${it.id}|${it.kind}|${it.text || ''}|${it.mediaId || ''}|${v ? 1 : 0}`;
  let m = mcache.get(key);
  if (m) return m;
  const S = R.S;
  const maxW = Math.round(R.W * S.maxW);
  if (it.kind === 'stamp') m = { h: R.fam === 'whatsapp' ? 34 : 30 };
  else if (it.kind === 'typing') m = { w: TYPING.w, h: TYPING.h };
  else if (it.kind === 'voice') {
    const w = clamp(Math.round(176 + it.dur * 8), 196, Math.round(R.W * 0.7));
    m = { w: R.fam === 'whatsapp' ? w + 44 : w, h: R.fam === 'whatsapp' ? 58 : R.fam === 'android' ? 52 : 44 };
  } else if (it.kind === 'image' || it.kind === 'video') {
    let w = 220, h = it.kind === 'video' ? 300 : 160;
    if (v) {
      // videos are shown larger than pictures
      const s = it.kind === 'video' ? Math.min(Math.round(R.W * 0.66) / v.w, 360 / v.h) : Math.min(Math.round(R.W * 0.62) / v.w, 300 / v.h);
      w = Math.round(v.w * s); h = Math.round(v.h * s);
      if (w < 120) { h = Math.round(h * 120 / w); w = 120; }
    }
    m = { w, h };
  } else if (it.big) {
    const n = graphemes(it.text.replace(/\s+/g, '')).length;
    const size = n === 1 ? 54 : n === 2 ? 46 : 40;
    ctx.font = emojiFont(size);
    m = { big: true, size, w: tw(ctx, it.text.trim()) + 4, h: Math.round(size * 1.22) };
  } else {
    ctx.font = font(S.size, 400);
    const inner = maxW - S.padX * 2;
    const lines = wrap(ctx, it.text || ' ', inner);
    let w = Math.max(...lines.map((l) => tw(ctx, l)));
    let h = lines.length * S.lineH + S.padY * 2;
    let metaInline = true;
    if (R.fam === 'whatsapp') {
      ctx.font = font(11, 400);
      const metaW = tw(ctx, R.p.status.time) + (it.side === 'me' ? 20 : 0) + 8;
      ctx.font = font(S.size, 400);
      const lastW = tw(ctx, lines[lines.length - 1]);
      if (lastW + metaW <= inner) w = Math.max(w, lastW + metaW);
      else { metaInline = false; h += 14; w = Math.max(w, metaW); }
    }
    m = { lines, w: Math.ceil(w) + S.padX * 2, h, metaInline };
    if (R.fam === 'ios') m.w = Math.max(m.w, 36);
  }
  if (mcache.size > 4000) mcache.clear();
  mcache.set(key, m);
  return m;
}

const isBubble = (it) => it.kind === 'msg' || it.kind === 'image' || it.kind === 'video' || it.kind === 'voice';

// Rows on screen at time t with their animated heights.
function layout(ctx, R, t) {
  const S = R.S;
  const mo = R.tl.mo;
  const rows = [];
  for (const it of R.tl.items) {
    if (it.tIn > t) continue;
    const a = it.tIn < 0 ? 1 : lin(it.side === 'me' ? mo.send : mo.receive, t, it.tIn);
    const g = it.tIn < 0 ? 1 : val(mo.grow, t, it.tIn);
    let r = 0;
    if (it.tOut != null && t >= it.tOut) {
      if (it.swap) continue;
      r = lin(mo.remove, t, it.tOut);
      if (r >= 1) continue;
    }
    rows.push({ it, a, g, r, m: metrics(ctx, R, it) });
  }

  // grouping (typing bubbles stand alone)
  for (let i = 0; i < rows.length; i++) {
    const v = rows[i], prev = rows[i - 1], next = rows[i + 1];
    v.first = !(prev && isBubble(prev.it) && isBubble(v.it) && prev.it.from === v.it.from);
    v.last = !(next && isBubble(next.it) && isBubble(v.it) && next.it.from === v.it.from);
  }

  // receipt under my latest message
  let rec = null;
  for (const x of R.tl.receipts) if (x.t <= t) rec = x;
  if (rec && R.fam !== 'whatsapp' && !(R.fam === 'instagram' && !rec.read)) {
    const idx = rows.map((v) => v.it.evId).lastIndexOf(rec.target);
    const after = idx >= 0 ? rows.slice(idx + 1) : [];
    if (idx >= 0 && !after.some((v) => isBubble(v.it) && v.it.side === 'them') && rows[idx].r === 0) {
      const label = R.fam === 'instagram' ? 'Seen' : rec.label;
      const ra = rec.read ? 1 : prog(t, rec.t, 0.3);
      rows.splice(idx + 1, 0, { it: { kind: 'receipt', id: 'rcpt' }, label, a: ra, g: ease(ra), r: 0, m: { h: 15 } });
    }
  }

  const reactionsByTarget = {};
  for (const x of R.tl.reactions) if (x.t <= t) (reactionsByTarget[x.target] ||= []).push(x);
  const lastRowOfEvent = {};
  rows.forEach((v, i) => { if (isBubble(v.it)) lastRowOfEvent[v.it.evId] = i; });

  for (let i = 0; i < rows.length; i++) {
    const v = rows[i];
    const k = v.it.kind;
    v.gap = i === 0 ? 0 : k === 'receipt' ? 2 : k === 'stamp' || rows[i - 1].it.kind === 'stamp' ? 8 : v.first ? S.gapGroup : S.gapSame;
    v.top = 0; v.bottom = 0;
    if (R.group && k !== 'stamp' && k !== 'receipt' && v.it.side === 'them' && v.first && (isBubble(v.it) || k === 'typing')) v.top += 16;
    const reacts = reactionsByTarget[v.it.evId];
    if (reacts && lastRowOfEvent[v.it.evId] === i) {
      v.reacts = reacts;
      const ra = clamp(val(mo.reaction, t, reacts[0].t), 0, 1);
      if (R.fam === 'ios') v.top += 12 * ra; else v.bottom += 14 * ra;
    }
    v.full = v.gap + v.top + v.m.h + v.bottom;
    let f = clamp(v.g, 0, 1);
    if (v.it.grow && v.g < 1) {
      const start = (S.gapGroup + TYPING.h) / v.full;
      f = lerp(Math.min(1, start), 1, clamp(v.g, 0, 1));
    }
    if (v.r > 0) f *= 1 - mo.remove.f(clamp((v.r - 0.3) / 0.7, 0, 1));
    v.eff = v.full * f;
  }
  return rows;
}

export function drawChat(ctx, R, t) {
  const { W, H, pal } = R;
  const g = chatGeometry(ctx, R, t);
  const { kbK, kbY, cs, bar, barBottom, barTop, headerBottom, rows } = g;

  // background
  ctx.fillStyle = pal.bg;
  ctx.fillRect(0, 0, W, H);
  if (R.fam === 'whatsapp') doodles(ctx, W, H, pal.doodle);

  // messages
  if (R.fam === 'instagram' && !R.meGrad) {
    R.meGrad = ctx.createLinearGradient(0, headerBottom, 0, barTop);
    pal.meGrad.forEach((c, i) => R.meGrad.addColorStop(i / (pal.meGrad.length - 1), c));
  }
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, R.fam === 'ios' ? 0 : headerBottom, W, barTop - (R.fam === 'ios' ? 0 : headerBottom));
  ctx.clip();
  for (const v of rows) {
    if (v.by + v.m.h > -50 && v.by < H + 50 && !v.overlay) drawRow(ctx, R, v, v.by, t);
  }
  ctx.restore();
  // bubbles mid-effect (slam / loud) draw over everything in the chat area
  for (const v of rows) if (v.overlay) drawRow(ctx, R, v, v.by, t);

  drawHeader(ctx, R, t);
  drawComposer(ctx, R, bar, barTop, cs, t);
  // area between composer and keyboard / home indicator
  if (kbK > 0) drawKeyboard(ctx, R, kbY, t);
  else if (pal.bar !== 'transparent') { ctx.fillStyle = pal.bar; ctx.fillRect(0, barBottom, W, H - barBottom); }
}

// Where everything sits at time t (screen coordinates). Shared by drawing, the camera (zoom
// targets) and screen effects (spotlight, love, echo). Cached per frame time.
export function chatGeometry(ctx, R, t) {
  R.geo ||= new Map();
  if (R.geo.has(t)) return R.geo.get(t);
  const { H, S, dev } = R;
  const kbK = kbAt(R.tl, t);
  const kbH = kbHeight(R.tl.kbStyle) + (R.tl.kbStyle === 'gboard' ? dev.safeBottom : 0);
  const kbY = H - kbH * ease(kbK);
  const cs = composeAt(R.tl, t);
  const bar = composerMetrics(ctx, R, cs ? cs.text : '');
  const barBottom = Math.min(H - dev.safeBottom, kbY);
  const barTop = barBottom - bar.h;
  const headerBottom = dev.safeTop + S.headerH;
  const rows = layout(ctx, R, t);
  const total = rows.reduce((a, v) => a + v.eff, 0) + 12;
  let y = Math.min(headerBottom + 10, barTop - 4 - total);
  const byEvent = {};
  for (const v of rows) {
    const slotBottom = y + v.eff;
    v.by = slotBottom - v.bottom - v.m.h;
    if (v.m.w != null) {
      v.x = bubbleX(R, v);
      if (isBubble(v.it) || v.it.kind === 'typing') byEvent[v.it.evId] = v;
    }
    const age = t - v.it.tIn;
    v.overlay = (v.it.effect === 'slam' && age < 0.5) || (v.it.effect === 'loud' && age < 1.2);
    y = slotBottom;
  }
  const latest = [...rows].reverse().find((v) => isBubble(v.it) && v.r === 0);
  const g = { kbK, kbY, cs, bar, barBottom, barTop, headerBottom, rows, byEvent, latest };
  if (R.geo.size > 4) R.geo.clear();
  R.geo.set(t, g);
  return g;
}

function bubbleX(R, v) {
  const { W, S } = R;
  const me = v.it.side === 'me';
  const avatarCol = !me && (R.group || R.fam === 'android' || R.fam === 'instagram');
  return me ? W - S.margin - v.m.w : S.margin + (avatarCol ? S.avatar + 8 : 0);
}

// ---- rows -----------------------------------------------------------------------
function drawRow(ctx, R, v, by, t) {
  const { W, pal, S } = R;
  const it = v.it;
  const k = it.kind;
  if (k === 'stamp') return drawStamp(ctx, R, it.text, by + v.m.h / 2, v.a);
  if (k === 'receipt') {
    ctx.save();
    ctx.globalAlpha = ease(v.a);
    const [first, ...rest] = v.label.split(' ');
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'right';
    ctx.fillStyle = pal.sub;
    const x = W - S.margin - 2;
    ctx.font = font(11.5, 400);
    const restText = rest.length ? ' ' + rest.join(' ') : '';
    ctx.fillText(restText, x, by + 8);
    ctx.font = font(11.5, 600);
    ctx.fillText(first, x - tw(ctx, restText), by + 8);
    ctx.restore();
    return;
  }
  const me = it.side === 'me';
  const avatarCol = !me && (R.group || R.fam === 'android' || R.fam === 'instagram');
  const left = S.margin + (avatarCol ? S.avatar + 8 : 0);
  const w = v.m.w, h = v.m.h;
  const x = me ? W - S.margin - w : left;

  ctx.save();
  // appear / remove animation
  let alpha = 1, sc = 1, dy = 0;
  if (v.a < 1) {
    const e = (me ? R.tl.mo.send : R.tl.mo.receive).f(v.a);
    sc = me ? lerp(0.86, 1, e) : lerp(it.grow ? 0.75 : 0.55, 1, e);
    alpha = clamp(v.a * 2.2, 0, 1);
    dy = me ? (1 - e) * 10 : 0;
  }
  if (v.r > 0) { const rr2 = R.tl.mo.remove.f(clamp(v.r / 0.5, 0, 1)); sc *= 1 - 0.35 * rr2; alpha *= 1 - rr2; }
  const fx = it.effect && it.tIn >= 0 && v.r === 0 ? bubbleFx(it.effect, t - it.tIn) : null;
  let ox = me ? x + w : x, oy = by + h, rot = 0;
  if (fx) {
    // grow from the bubble's own side so a big Slam / Loud stays on screen
    ({ sc, alpha, dy, rot } = fx);
    oy = by + h / 2;
  } else {
    // while the slot is still opening, a tall bubble (image) must not spill over the rows above
    const room = v.eff - v.gap - v.top - v.bottom;
    if (v.r === 0 && room < h) sc = Math.min(sc, Math.max(0, room / h));
  }
  ctx.globalAlpha = alpha;
  ctx.translate(ox, oy + dy);
  ctx.rotate(rot);
  ctx.scale(sc, sc);
  ctx.translate(-ox, -oy);

  // group: sender name + avatar
  if (!me && R.group && v.first && it.kind !== 'typing') {
    ctx.font = font(11.5, 400);
    ctx.fillStyle = pal.sub;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(nameOf(R.p, it.from), x + (R.fam === 'ios' ? 12 : 4), by - 4);
  }
  if (avatarCol && (v.last || it.kind === 'typing')) avatar(ctx, R.p, it.from, S.margin + S.avatar / 2, by + h - S.avatar / 2, S.avatar / 2, t, { ios: R.fam === 'ios' });

  if (k === 'typing') drawTyping(ctx, R, x, by, t);
  else if (k === 'voice') drawVoiceBubble(ctx, R, v, x, by, t);
  else if (k === 'image') drawImageBubble(ctx, R, it, x, by, w, h, t);
  else if (k === 'video') drawVideoBubble(ctx, R, it, x, by, w, h, t);
  else if (v.m.big) {
    ctx.font = emojiFont(v.m.size);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = pal.text;
    ctx.fillText(it.text.trim(), x + 2, by + h / 2 + 2);
  } else drawTextBubble(ctx, R, v, x, by, t);

  if (v.reacts) drawReactions(ctx, R, v, x, by, w, h, t);
  ctx.restore();
}

// Send effects: transform of the bubble `age` seconds after it lands (null when finished).
function bubbleFx(kind, age) {
  const a = clamp(age / 0.08, 0, 1);
  if (kind === 'slam' && age < 0.5) {
    if (age < 0.26) { const k = age / 0.26; return { sc: lerp(2.8, 1, k * k), alpha: a, dy: -70 * (1 - k) * (1 - k), rot: -0.05 * (1 - k) }; }
    const q = (age - 0.26) / 0.24;
    return { sc: 1 + 0.08 * Math.sin(q * Math.PI) * (1 - q), alpha: 1, dy: 0, rot: 0 };
  }
  if (kind === 'loud' && age < 1.2) {
    let sc;
    if (age < 0.25) sc = lerp(1, 1.9, easeBack(age / 0.25));
    else if (age < 0.8) sc = 1.9 + 0.05 * Math.sin(age * 55);
    else sc = lerp(1.9, 1, ease((age - 0.8) / 0.4));
    const shake = age > 0.2 && age < 0.85 ? 1 : 0;
    return { sc, alpha: a, dy: 0, rot: shake * 0.045 * Math.sin(age * 62) };
  }
  if (kind === 'gentle' && age < 1.6) return { sc: lerp(0.45, 1, ease(age / 1.6)), alpha: clamp(age / 0.35, 0, 1), dy: 0, rot: 0 };
  return null;
}

// Invisible ink: drifting specks over the text until it is revealed.
function inkSpecks(ctx, x, y, w, h, t, seed, color, alpha) {
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.fillStyle = color;
  const n = Math.round((w * h) / 22);
  for (let i = 0; i < n; i++) {
    const bx = x + 8 + rnd(seed + i) * (w - 16), byy = y + 6 + rnd(seed + i + 7919) * (h - 12);
    const ph = rnd(seed + i + 31337) * 6.28;
    const px = bx + Math.sin(t * 2.3 + ph) * 2.2, py = byy + Math.cos(t * 1.9 + ph) * 1.6;
    ctx.globalAlpha = alpha * (0.45 + 0.55 * Math.abs(Math.sin(t * 3 + ph)));
    ctx.fillRect(px, py, 1.3, 1.3);
  }
  ctx.restore();
}

function bubblePath(ctx, R, v, x, y, w, h) {
  const { S } = R;
  const me = v.it.side === 'me';
  if (R.fam === 'ios') {
    rr(ctx, x, y, w, h, Math.min(S.radius, h / 2));
    if (v.last) {
      if (me) {
        const Rx = x + w, B = y + h;
        ctx.moveTo(Rx - 1, B - 17);
        ctx.quadraticCurveTo(Rx - 0.5, B - 3, Rx + 6, B);
        ctx.quadraticCurveTo(Rx - 4, B + 0.5, Rx - 14, B - 3);
        ctx.closePath();
      } else {
        // same winding as the rounded rect so the overlap stays filled
        const L = x, B = y + h;
        ctx.moveTo(L + 14, B - 3);
        ctx.quadraticCurveTo(L + 4, B + 0.5, L - 6, B);
        ctx.quadraticCurveTo(L + 0.5, B - 3, L + 1, B - 17);
        ctx.closePath();
      }
    }
  } else if (R.fam === 'whatsapp') {
    const r = S.radius;
    if (v.first) {
      if (me) {
        rr(ctx, x, y, w, h, [r, 0, r, r]);
        ctx.moveTo(x + w - 2, y); ctx.lineTo(x + w + 8, y); ctx.quadraticCurveTo(x + w + 6, y + 2, x + w, y + 10); ctx.closePath();
      } else {
        rr(ctx, x, y, w, h, [0, r, r, r]);
        ctx.moveTo(x + 2, y); ctx.lineTo(x - 8, y); ctx.quadraticCurveTo(x - 6, y + 2, x, y + 10); ctx.closePath();
      }
    } else rr(ctx, x, y, w, h, r);
  } else {
    const r = Math.min(S.radius, h / 2), s = S.small;
    const top = v.first ? r : s, bot = v.last ? r : s;
    rr(ctx, x, y, w, h, me ? [r, top, bot, r] : [top, r, r, bot]);
  }
}

function drawTextBubble(ctx, R, v, x, y, t) {
  const { pal, S } = R;
  const it = v.it, m = v.m;
  const me = it.side === 'me';
  bubblePath(ctx, R, v, x, y, m.w, m.h);
  ctx.fillStyle = me ? (R.fam === 'instagram' ? R.meGrad : pal.me) : pal.them;
  ctx.fill();
  if (R.fam === 'whatsapp') {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.13)';
    ctx.shadowOffsetY = 1;
    ctx.shadowBlur = 0.5;
    ctx.globalCompositeOperation = 'destination-over';
    ctx.fill();
    ctx.restore();
  }
  ctx.font = font(S.size, 400);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const color = me ? pal.meText : pal.themText;
  const link = me ? pal.meText : pal.link;
  // invisible ink: specks until revealed, then the text fades in
  const reveal = it.inkUntil ? clamp((t - it.inkUntil) / 0.6, 0, 1) : 1;
  if (reveal < 1) inkSpecks(ctx, x, y, m.w, m.h, t, hashInt(it.id), color, 1 - reveal);
  ctx.save();
  ctx.globalAlpha *= reveal;
  m.lines.forEach((line, i) => {
    lineWithLinks(ctx, line, x + S.padX, y + S.padY + S.lineH * (i + 0.5) + 0.5, color, link, S.size * 0.55);
  });
  ctx.restore();
  if (R.fam === 'whatsapp') {
    const metaY = y + m.h - 9;
    let mx = x + m.w - 7;
    if (me) {
      const st = tickState(R, it, t);
      icon(ctx, st === 'sent' ? 'check' : 'doneAll', mx - 8, metaY, 16, st === 'read' ? pal.tick : pal.sub);
      mx -= 19;
    }
    ctx.font = font(11, 400);
    ctx.textAlign = 'right';
    ctx.fillStyle = me && R.pal.dark ? 'rgba(233,237,239,0.6)' : pal.sub;
    ctx.fillText(R.p.status.time, mx, metaY);
  }
}

function tickState(R, it, t) {
  if (it.pre) return 'read';
  for (const r of R.tl.receipts) if (r.read && r.t <= t && r.t >= it.tIn) return 'read';
  return t >= it.tIn + 0.5 ? 'delivered' : 'sent';
}

function drawImageBubble(ctx, R, it, x, y, w, h, t) {
  const v = visual(it.mediaId);
  ctx.save();
  rr(ctx, x, y, w, h, R.fam === 'whatsapp' ? 8 : 18);
  ctx.clip();
  if (v) {
    const bmp = frameAt(v, t - it.tIn);
    ctx.drawImage(bmp, x, y, w, h);
  } else {
    ctx.fillStyle = R.pal.them;
    ctx.fillRect(x, y, w, h);
    icon(ctx, 'image', x + w / 2, y + h / 2, 40, R.pal.sub);
  }
  ctx.restore();
}

// Video message: the first frame with a play button, then the video playing (time left in the corner).
function drawVideoBubble(ctx, R, it, x, y, w, h, t) {
  const v = videoOf(it.mediaId, it.evId);
  const tPlay = it.tPlay ?? Infinity;
  const playing = t >= tPlay && t < tPlay + it.dur;
  const lt = clamp(t - tPlay, 0, it.dur);
  ctx.save();
  rr(ctx, x, y, w, h, R.fam === 'whatsapp' ? 8 : 18);
  ctx.clip();
  if (v) {
    syncVideo(v, lt, playing);
    const k = Math.max(w / v.w, h / v.h);
    ctx.drawImage(v.el, x + (w - v.w * k) / 2, y + (h - v.h * k) / 2, v.w * k, v.h * k);
  } else {
    ctx.fillStyle = '#1b1b1f';
    ctx.fillRect(x, y, w, h);
  }
  if (!playing) {
    circle(ctx, x + w / 2, y + h / 2, 25, 'rgba(0,0,0,0.5)');
    ctx.beginPath(); ctx.moveTo(x + w / 2 - 7, y + h / 2 - 11); ctx.lineTo(x + w / 2 - 7, y + h / 2 + 11); ctx.lineTo(x + w / 2 + 13, y + h / 2); ctx.closePath();
    ctx.fillStyle = '#FFFFFF'; ctx.fill();
  }
  const left = t >= tPlay + it.dur ? it.dur : Math.max(0, it.dur - lt);     // the full length again once it has played
  const sec = Math.ceil(left - 1e-6);
  const label = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  ctx.font = font(11.5, 600);
  const pw = tw(ctx, label) + 16;
  fillRR(ctx, x + 8, y + h - 26, pw, 19, 9.5, 'rgba(0,0,0,0.5)');
  ctx.fillStyle = '#FFFFFF'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText(label, x + 16, y + h - 16.5);
  ctx.restore();
}

function drawTyping(ctx, R, x, y, t) {
  const { pal } = R;
  const w = TYPING.w, h = TYPING.h;
  ctx.fillStyle = pal.them;
  if (R.fam === 'ios') {
    circle(ctx, x + 2, y + h - 2, 6, pal.them);
    circle(ctx, x - 3.5, y + h + 4.5, 3, pal.them);
  }
  rr(ctx, x, y, w, h, h / 2);
  ctx.fill();
  for (let i = 0; i < 3; i++) {
    const ph = ((t * 1.5 - i * 0.18) % 1 + 1) % 1;
    const k = Math.max(0, Math.sin(ph * Math.PI * 2));
    ctx.globalAlpha = 0.35 + 0.5 * k;
    circle(ctx, x + w / 2 + (i - 1) * 12, y + h / 2 - (R.fam === 'ios' ? 0 : k * 2), 4.6, R.pal.dark ? '#9A9A9F' : '#8E8E93');
  }
  ctx.globalAlpha = 1;
}

function drawReactions(ctx, R, v, x, y, w, h, t) {
  const me = v.it.side === 'me';
  v.reacts.forEach((r, i) => {
    const k = val(R.tl.mo.reaction, t, r.t);
    if (k <= 0) return;
    const mine = r.from === 'me';
    ctx.save();
    if (R.fam === 'ios') {
      const cx = me ? x + 4 - i * 20 : x + w - 4 + i * 20, cy = y - 4;
      ctx.translate(cx, cy); ctx.scale(k, k); ctx.translate(-cx, -cy);
      const fill = mine ? R.pal.me : R.pal.them;
      const ring = R.pal.bg;
      circle(ctx, cx, cy, 17, ring);
      circle(ctx, cx, cy, 15, fill);
      circle(ctx, cx + (me ? 9 : -9), cy + 13, 4.5, ring);
      circle(ctx, cx + (me ? 9 : -9), cy + 13, 3.2, fill);
      ctx.font = emojiFont(16);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(r.emoji, cx, cy + 1);
    } else {
      const cx = me ? x + w - 18 - i * 30 : x + 18 + i * 30, cy = y + h + 4;
      ctx.translate(cx, cy); ctx.scale(k, k); ctx.translate(-cx, -cy);
      fillRR(ctx, cx - 15, cy - 11, 30, 22, 11, R.pal.bg);
      fillRR(ctx, cx - 13, cy - 9, 26, 18, 9, R.pal.dark ? '#2A2C2F' : R.fam === 'whatsapp' ? '#FFFFFF' : '#EFEFEF');
      ctx.font = emojiFont(12);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(r.emoji, cx, cy + 0.5);
    }
    ctx.restore();
  });
}

function drawStamp(ctx, R, text, cy, a) {
  const { W, pal } = R;
  ctx.save();
  ctx.globalAlpha = ease(a);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (R.fam === 'whatsapp') {
    ctx.font = font(12.5, 500);
    const w = tw(ctx, text) + 20;
    fillRR(ctx, W / 2 - w / 2, cy - 12, w, 24, 8, pal.dark ? '#182229' : '#FFFFFF');
    ctx.fillStyle = pal.sub;
    ctx.fillText(text, W / 2, cy + 0.5);
  } else if (R.fam === 'ios') {
    const m = text.match(/^(\S+)\s+(.*)$/);
    if (m && /^(today|yesterday|mon|tue|wed|thu|fri|sat|sun)/i.test(m[1])) {
      ctx.font = font(11.5, 600);
      const w1 = tw(ctx, m[1] + ' ');
      ctx.font = font(11.5, 400);
      const w2 = tw(ctx, m[2]);
      const x0 = W / 2 - (w1 + w2) / 2;
      ctx.textAlign = 'left';
      ctx.fillStyle = pal.sub;
      ctx.font = font(11.5, 600); ctx.fillText(m[1], x0, cy);
      ctx.font = font(11.5, 400); ctx.fillText(m[2], x0 + w1, cy);
    } else { ctx.font = font(11.5, 500); ctx.fillStyle = pal.sub; ctx.fillText(text, W / 2, cy); }
  } else {
    ctx.font = font(12, 500);
    ctx.fillStyle = pal.sub;
    ctx.fillText(text, W / 2, cy);
  }
  ctx.restore();
}

let doodleCache = null;
function doodles(ctx, W, H, color) {
  if (!doodleCache || doodleCache.color !== color) {
    const c = new OffscreenCanvas(160, 160);
    const g = c.getContext('2d');
    g.strokeStyle = color;
    g.fillStyle = color;
    g.lineWidth = 1.6;
    g.lineCap = 'round';
    const shapes = [
      () => { g.beginPath(); g.arc(22, 24, 9, 0, Math.PI * 2); g.stroke(); },
      () => { g.beginPath(); g.moveTo(70, 14); g.lineTo(84, 34); g.lineTo(56, 34); g.closePath(); g.stroke(); },
      () => { g.beginPath(); g.moveTo(118, 18); g.bezierCurveTo(108, 6, 96, 22, 118, 36); g.bezierCurveTo(140, 22, 128, 6, 118, 18); g.stroke(); },
      () => { g.strokeRect(18, 70, 18, 14); g.beginPath(); g.moveTo(18, 70); g.lineTo(27, 78); g.lineTo(36, 70); g.stroke(); },
      () => { g.beginPath(); g.arc(80, 78, 10, 0.2, Math.PI - 0.2); g.stroke(); g.beginPath(); g.arc(76, 74, 1.5, 0, 7); g.arc(84, 74, 1.5, 0, 7); g.fill(); },
      () => { g.beginPath(); for (let i = 0; i < 5; i++) { const a = -Math.PI / 2 + i * 2.513; g.lineTo(128 + Math.cos(a) * 10, 78 + Math.sin(a) * 10); } g.closePath(); g.stroke(); },
      () => { g.beginPath(); g.moveTo(14, 130); g.quadraticCurveTo(30, 112, 46, 130); g.quadraticCurveTo(30, 148, 14, 130); g.stroke(); },
      () => { g.beginPath(); g.moveTo(66, 122); g.lineTo(66, 146); g.moveTo(54, 134); g.lineTo(78, 134); g.stroke(); },
      () => { g.beginPath(); g.arc(122, 134, 4, 0, 7); g.stroke(); g.beginPath(); g.arc(122, 134, 11, 0, 7); g.stroke(); },
    ];
    shapes.forEach((s) => s());
    doodleCache = { color, pattern: ctx.createPattern(c, 'repeat') };
  }
  ctx.fillStyle = doodleCache.pattern;
  ctx.fillRect(0, 0, W, H);
}

// ---- header ---------------------------------------------------------------------
// The group photo in a group chat that has one, else the first person.
function headerAvatar(ctx, R, cx, cy, r, t, opts = {}) {
  const { p } = R;
  if (R.group && p.chat.avatar) avatarOf(ctx, { name: chatTitle(p), color: '#8E8E93', avatar: p.chat.avatar }, cx, cy, r, t, opts);
  else avatar(ctx, p, p.chat.members[0], cx, cy, r, t, opts);
}

function drawHeader(ctx, R, t) {
  const { W, pal, S, dev, p } = R;
  const top = dev.safeTop;
  const H = top + S.headerH;
  const title = chatTitle(p);
  const who = p.chat.members[0];
  const sub = headerSub(R, t);
  if (R.fam === 'ios') frost(ctx, 0, 0, W, H, pal.bg);
  ctx.fillStyle = pal.header;
  ctx.fillRect(0, 0, W, H);
  if (R.fam !== 'android') { ctx.fillStyle = pal.sep; ctx.fillRect(0, H - 0.5, W, 0.5); }
  const ac = pal.icon;

  if (R.fam === 'ios') {
    chevron(ctx, 14, top + 26, 21, pal.accent, 'left', 3);
    if (R.group && !p.chat.avatar) {
      const ids = p.chat.members.slice(0, 3);
      ids.forEach((id, i) => avatar(ctx, p, id, W / 2 + (i - (ids.length - 1) / 2) * 22, top + 25, 17, t, { ios: true }));
    } else headerAvatar(ctx, R, W / 2, top + 25, 25, t, { ios: true });
    ctx.font = font(11.5, 400);
    const nm = ellipsize(ctx, title, W - 140);
    const nw = tw(ctx, nm);
    ctx.fillStyle = pal.headerText;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(nm, W / 2 - 4, top + 62);
    chevron(ctx, W / 2 + nw / 2 + 1, top + 62, 7, pal.sub, 'right', 1.6);
    icon(ctx, 'video', W - 30, top + 26, 30, pal.accent);
  } else if (R.fam === 'android') {
    const cy = top + S.headerH / 2;
    icon(ctx, 'back', 26, cy, 24, pal.headerText);
    headerAvatar(ctx, R, 70, cy, 19, t);
    ctx.font = font(19, 400);
    ctx.fillStyle = pal.headerText;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(ellipsize(ctx, title, W - 230), 98, cy);
    icon(ctx, 'phone', W - 122, cy, 23, ac);
    icon(ctx, 'video', W - 76, cy, 25, ac);
    icon(ctx, 'more', W - 28, cy, 24, ac);
  } else if (R.fam === 'whatsapp') {
    const cy = top + S.headerH / 2;
    const androidOS = R.pal.os === 'android';
    if (androidOS) icon(ctx, 'back', 22, cy, 23, pal.headerText);
    else chevron(ctx, 12, cy, 20, ac, 'left', 3);
    headerAvatar(ctx, R, androidOS ? 62 : 52, cy, 18, t);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const nx = androidOS ? 88 : 78;
    ctx.font = font(16.5, 600);
    ctx.fillStyle = pal.headerText;
    ctx.fillText(ellipsize(ctx, title, W - nx - 110), nx, sub ? cy - 9 : cy);
    if (sub) {
      ctx.font = font(12.5, 400);
      ctx.fillStyle = androidOS && !pal.dark ? 'rgba(255,255,255,0.85)' : sub === 'typing…' ? pal.accent : pal.sub;
      ctx.fillText(sub, nx, cy + 10);
    }
    icon(ctx, 'video', W - (androidOS ? 112 : 78), cy, 25, ac);
    icon(ctx, 'phone', W - (androidOS ? 66 : 32), cy, 22, ac);
    if (androidOS) icon(ctx, 'more', W - 22, cy, 22, ac);
  } else {
    const cy = top + S.headerH / 2;
    chevron(ctx, 14, cy, 20, pal.headerText, 'left', 2.6);
    headerAvatar(ctx, R, 56, cy, 18, t);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = font(15.5, 700);
    ctx.fillStyle = pal.headerText;
    ctx.fillText(ellipsize(ctx, title, W - 190), 82, cy - 8);
    ctx.font = font(12, 400);
    ctx.fillStyle = pal.sub;
    const handle = R.group ? `${p.chat.members.length + 1} members` : (contact(p, who)?.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    ctx.fillText(sub === 'typing…' ? 'typing…' : handle, 82, cy + 10);
    icon(ctx, 'phone', W - 76, cy, 25, pal.headerText);
    icon(ctx, 'video', W - 30, cy, 27, pal.headerText);
  }
}

// Frosted glass: blur whatever is already drawn under (x, y, w, h), over an opaque base.
let scratch = null;
function frost(ctx, x, y, w, h, base) {
  const m = ctx.getTransform();
  const dx = Math.round(m.a * x + m.e), dy = Math.round(m.d * y + m.f);
  const dw = Math.round(m.a * w), dh = Math.round(m.d * h);
  if (dw <= 0 || dh <= 0) return;
  if (!scratch || scratch.width < dw || scratch.height < dh) scratch = new OffscreenCanvas(dw, dh);
  const g = scratch.getContext('2d');
  g.clearRect(0, 0, dw, dh);
  g.drawImage(ctx.canvas, dx, dy, dw, dh, 0, 0, dw, dh);
  ctx.save();
  ctx.fillStyle = base;
  ctx.fillRect(x, y, w, h);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.beginPath();
  ctx.rect(dx, dy, dw, dh);
  ctx.clip();
  ctx.filter = `blur(${Math.max(4, Math.round(16 * m.a))}px) saturate(1.8)`;
  ctx.drawImage(scratch, 0, 0, dw, dh, dx, dy, dw, dh);
  ctx.restore();
}

function headerSub(R, t) {
  for (const h of R.tl.headerStatus) if (t >= h.t0 && t < h.t1) return h.text;
  if (R.fam === 'whatsapp') return R.group ? 'tap here for group info' : 'online';
  return '';
}

// ---- composer -------------------------------------------------------------------
function composerMetrics(ctx, R, text) {
  const { W, S } = R;
  const fieldX = R.fam === 'ios' ? 46 : R.fam === 'android' ? 54 : R.fam === 'whatsapp' ? (R.pal.os === 'android' ? 8 : 40) : 12;
  const fieldR = R.fam === 'ios' ? W - 10 : R.fam === 'android' ? W - 62 : R.fam === 'whatsapp' ? (R.pal.os === 'android' ? W - 60 : W - 80) : W - 12;
  const inL = R.fam === 'instagram' ? 50 : R.fam === 'android' || (R.fam === 'whatsapp' && R.pal.os === 'android') ? 44 : 14;
  const inR = R.fam === 'ios' ? 40 : R.fam === 'instagram' ? 60 : R.fam === 'whatsapp' ? (R.pal.os === 'android' ? 72 : 36) : 44;
  const textW = fieldR - fieldX - inL - inR;
  ctx.font = font(S.size, 400);
  const lines = text ? wrap(ctx, text, textW) : [];
  const shown = lines.slice(-5);
  const lineH = S.lineH;
  const minField = R.fam === 'ios' ? 36 : R.fam === 'android' ? 48 : R.fam === 'instagram' ? 44 : 38;
  const fieldH = Math.max(minField, shown.length * lineH + (minField - lineH));
  return { fieldX, fieldR, inL, inR, lines: shown, fieldH, h: fieldH + (S.barH - minField), textW };
}

function drawComposer(ctx, R, bar, top, cs, t) {
  const rec = recordAt(R.tl, t);
  if (rec) { drawRecordingBar(ctx, R, bar, top, rec, t); return; }
  const { W, pal, S } = R;
  const has = bar.lines.length > 0;
  if (pal.bar !== 'transparent') { ctx.fillStyle = pal.bar; ctx.fillRect(0, top, W, bar.h + 2); }
  const fy = top + (bar.h - bar.fieldH) / 2;
  const fx = bar.fieldX, fw = bar.fieldR - bar.fieldX, fh = bar.fieldH;
  const pressing = cs && cs.sendIn < 0.18 ? 0.86 : 1;
  const ph = R.theme.placeholder;
  const fam = R.fam;
  const androidOS = pal.os === 'android';

  if (fam === 'ios') {
    circle(ctx, 24, fy + fh - 18, 16, pal.dark ? '#2C2C2E' : '#E9E9EB');
    icon(ctx, 'add', 24, fy + fh - 18, 22, pal.sub);
    rr(ctx, fx, fy, fw, fh, 18);
    ctx.fillStyle = pal.inputBg; ctx.fill();
    ctx.lineWidth = 1; ctx.strokeStyle = pal.inputBorder; ctx.stroke();
    if (has) {
      ctx.save();
      const bx = fx + fw - 18, by = fy + fh - 18;
      ctx.translate(bx, by); ctx.scale(pressing, pressing); ctx.translate(-bx, -by);
      sendArrow(ctx, bx, by, 14, pal.me, '#FFFFFF');
      ctx.restore();
    } else icon(ctx, 'mic', fx + fw - 20, fy + fh / 2, 20, pal.sub);
  } else if (fam === 'android') {
    circle(ctx, 28, fy + fh / 2, 18, pal.dark ? '#2A2C2F' : '#E9EEF6');
    icon(ctx, 'add', 28, fy + fh / 2, 24, pal.icon);
    fillRR(ctx, fx, fy, fw, fh, 24, pal.inputBg);
    icon(ctx, 'emoji', fx + 22, fy + fh - 24, 22, pal.icon);
    icon(ctx, 'image', fx + fw - 22, fy + fh - 24, 22, pal.icon);
    ctx.save();
    const bx = W - 32, by = fy + fh / 2;
    ctx.translate(bx, by); ctx.scale(pressing, pressing); ctx.translate(-bx, -by);
    if (has) { circle(ctx, bx, by, 22, pal.accent === '#A8C7FA' ? '#A8C7FA' : '#0B57D0'); icon(ctx, 'send', bx + 1, by, 20, pal.dark ? '#062E6F' : '#FFFFFF'); }
    else { circle(ctx, bx, by, 22, pal.dark ? '#2A2C2F' : '#D3E3FD'); icon(ctx, 'mic', bx, by, 22, pal.dark ? '#E3E3E3' : '#041E49'); }
    ctx.restore();
  } else if (fam === 'whatsapp') {
    if (androidOS) {
      fillRR(ctx, fx, fy, fw, fh, 22, pal.inputBg);
      icon(ctx, 'emoji', fx + 22, fy + fh - 19, 23, pal.sub);
      if (!has) icon(ctx, 'camera', fx + fw - 22, fy + fh - 19, 22, pal.sub);
      icon(ctx, 'attach', fx + fw - (has ? 22 : 56), fy + fh - 19, 22, pal.sub);
      ctx.save();
      const bx = W - 30, by = fy + fh - 19;
      ctx.translate(bx, by); ctx.scale(pressing, pressing); ctx.translate(-bx, -by);
      circle(ctx, bx, by, 23, '#00A884');
      icon(ctx, has ? 'send' : 'mic', bx + (has ? 1.5 : 0), by, 21, '#FFFFFF');
      ctx.restore();
    } else {
      icon(ctx, 'add', 20, fy + fh - 18, 28, pal.icon);
      fillRR(ctx, fx, fy, fw, fh, 18, pal.inputBg);
      if (!pal.dark) { rr(ctx, fx, fy, fw, fh, 18); ctx.strokeStyle = '#E2E2E2'; ctx.lineWidth = 1; ctx.stroke(); }
      icon(ctx, 'sticker', fx + fw - 18, fy + fh - 18, 20, pal.icon);
      if (has) {
        ctx.save();
        const bx = W - 34, by = fy + fh - 18;
        ctx.translate(bx, by); ctx.scale(pressing, pressing); ctx.translate(-bx, -by);
        circle(ctx, bx, by, 16, '#00A884');
        icon(ctx, 'send', bx + 1, by, 17, '#FFFFFF');
        ctx.restore();
      } else {
        icon(ctx, 'camera', W - 58, fy + fh - 18, 24, pal.icon);
        icon(ctx, 'mic', W - 22, fy + fh - 18, 24, pal.icon);
      }
    }
  } else {
    fillRR(ctx, fx, fy, fw, fh, 22, pal.inputBg);
    circle(ctx, fx + 22, fy + fh - 22, 17, '#3797F0');
    icon(ctx, 'camera', fx + 22, fy + fh - 22, 19, '#FFFFFF');
    if (has) {
      ctx.save();
      ctx.font = font(15.5, 600);
      ctx.fillStyle = '#3797F0';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.globalAlpha = pressing < 1 ? 0.5 : 1;
      ctx.fillText('Send', fx + fw - 16, fy + fh - 22);
      ctx.restore();
    } else {
      icon(ctx, 'mic', fx + fw - 92, fy + fh / 2, 22, pal.text);
      icon(ctx, 'image', fx + fw - 56, fy + fh / 2, 22, pal.text);
      icon(ctx, 'sticker', fx + fw - 20, fy + fh / 2, 22, pal.text);
    }
  }

  // text / placeholder + caret
  const tx = fx + bar.inL;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = font(S.size, 400);
  const lineH = S.lineH;
  const ty0 = fy + (fh - bar.lines.length * lineH) / 2;
  if (has) {
    ctx.fillStyle = pal.text;
    bar.lines.forEach((l, i) => ctx.fillText(l, tx, ty0 + lineH * (i + 0.5)));
  } else {
    ctx.fillStyle = pal.placeholder;
    ctx.fillText(ph, tx + (cs ? 2 : 0), fy + fh / 2);
  }
  if (cs) {
    const lastAge = cs.last ? t - cs.last.t : 1;
    const blinkOn = lastAge < 0.5 || Math.floor(t * 1.9) % 2 === 0;
    if (blinkOn) {
      const last = bar.lines[bar.lines.length - 1] || '';
      const cx = tx + (has ? tw(ctx, last) + 1 : 0);
      const cy = has ? ty0 + lineH * (bar.lines.length - 0.5) : fy + fh / 2;
      ctx.fillStyle = fam === 'whatsapp' ? '#00A884' : fam === 'android' ? pal.accent : fam === 'instagram' ? '#3797F0' : '#007AFF';
      ctx.fillRect(cx, cy - 11, 2, 22);
    }
  }
}

// ---- voice notes ------------------------------------------------------------------
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// n bar heights 0..1 from the audio's peaks (or a stable made-up shape before audio exists)
function barHeights(peaks, seed, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    if (peaks && peaks.length) {
      const f = (i / Math.max(1, n - 1)) * (peaks.length - 1), j = Math.floor(f);
      const a = peaks[j], b = peaks[Math.min(peaks.length - 1, j + 1)];
      out.push(Math.max(0.16, Math.sqrt((a + (b - a) * (f - j)) / 100)));     // sqrt: quiet syllables stay visible
    } else out.push(0.2 + 0.8 * Math.abs(Math.sin(i * 0.9 + (seed % 7))) * rnd(seed + i));
  }
  return out;
}

function waveform(ctx, x0, x1, cy, maxH, heights, progress, on, off, gap = 4.2, bw = 2.4) {
  const n = heights.length;
  for (let i = 0; i < n; i++) {
    const h = Math.max(3, heights[i] * maxH);
    ctx.fillStyle = i / n < progress ? on : off;
    fillRR(ctx, x0 + i * gap, cy - h / 2, bw, h, bw / 2, ctx.fillStyle);
  }
  return x0 + n * gap;
}

function playGlyph(ctx, cx, cy, s, color, playing) {
  ctx.fillStyle = color;
  if (playing) {
    fillRR(ctx, cx - s * 0.42, cy - s * 0.5, s * 0.3, s, 1.5, color);
    fillRR(ctx, cx + s * 0.12, cy - s * 0.5, s * 0.3, s, 1.5, color);
  } else {
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.35, cy - s * 0.55);
    ctx.lineTo(cx + s * 0.55, cy);
    ctx.lineTo(cx - s * 0.35, cy + s * 0.55);
    ctx.closePath();
    ctx.fill();
  }
}

function drawVoiceBubble(ctx, R, v, x, y, t) {
  const { pal } = R;
  const it = v.it, m = v.m;
  const me = it.side === 'me';
  bubblePath(ctx, R, v, x, y, m.w, m.h);
  ctx.fillStyle = me ? (R.fam === 'instagram' ? R.meGrad : pal.me) : pal.them;
  ctx.fill();
  const progress = it.tPlay != null ? clamp((t - it.tPlay) / it.dur, 0, 1) : 0;
  const playing = it.tPlay != null && t >= it.tPlay && t < it.tPlay + it.dur;
  const fg = me ? pal.meText : pal.themText;
  const wa = R.fam === 'whatsapp';
  const cy = wa ? y + 25 : y + m.h / 2;
  const elapsed = playing ? t - it.tPlay : it.dur;

  if (wa) {
    // [avatar w/ mic] [play] [waveform + dot]   time under the wave, clock/ticks at the right
    const ax = me ? x + m.w - 28 : x + 28;
    avatar(ctx, R.p, it.from, ax, cy, 19, t);
    circle(ctx, ax + (me ? -14 : 14), cy + 13, 7, me ? pal.me : pal.them);
    icon(ctx, 'mic', ax + (me ? -14 : 14), cy + 13, 11, playing || progress >= 1 ? '#53BDEB' : '#00A884');
    const px = me ? x + 20 : x + 64;
    playGlyph(ctx, px, cy, 16, pal.sub, playing);
    const x0 = px + 18, x1 = me ? x + m.w - 58 : x + m.w - 14;
    const n = Math.max(8, Math.floor((x1 - x0) / 3.6));
    const end = waveform(ctx, x0, x1, cy, 22, barHeights(it.peaks, it.seed, n), progress, pal.dark ? '#AEBAC1' : '#8696A0', pal.dark ? 'rgba(174,186,193,0.45)' : 'rgba(134,150,160,0.5)', 3.6, 2.2);
    circle(ctx, x0 + (end - x0) * progress, cy, 6, me ? '#53BDEB' : '#00A884');
    ctx.font = font(11, 400);
    ctx.fillStyle = pal.sub;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(mmss(elapsed), x0, y + m.h - 11);
    ctx.textAlign = 'right';
    // mine: avatar sits at the right, so time + ticks go to its left
    const tx = me ? x + m.w - 74 : x + m.w - 8;
    ctx.fillText(R.p.status.time, tx, y + m.h - 11);
    if (me) icon(ctx, tickState(R, it, t) === 'sent' ? 'check' : 'doneAll', tx + 13, y + m.h - 11, 15, tickState(R, it, t) === 'read' ? pal.tick : pal.sub);
    return;
  }

  const android = R.fam === 'android';
  const px = x + (android ? 24 : 20);
  if (android) circle(ctx, px, cy, 15, me ? 'rgba(255,255,255,0.22)' : pal.dark ? '#3C4043' : '#D3E3FD');
  playGlyph(ctx, px + (playing ? 0 : 1), cy, android ? 12 : 14, fg, playing);
  ctx.font = font(13, 500);
  const label = mmss(elapsed);
  const lw = tw(ctx, '0:00');
  const x0 = px + (android ? 24 : 18), x1 = x + m.w - lw - 20;
  const n = Math.max(8, Math.floor((x1 - x0) / 3.8));
  const off = me ? 'rgba(255,255,255,0.45)' : pal.dark ? 'rgba(255,255,255,0.35)' : 'rgba(60,60,67,0.35)';
  waveform(ctx, x0, x1, cy, m.h * 0.56, barHeights(it.peaks, it.seed, n), progress, fg, off, 3.8, 2.4);
  ctx.fillStyle = fg;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x + m.w - 12, cy + 0.5);
}

// Composer while a voice note is being recorded (the voice plays as it "records").
function drawRecordingBar(ctx, R, bar, top, rec, t) {
  const { W, pal } = R;
  if (pal.bar !== 'transparent') { ctx.fillStyle = pal.bar; ctx.fillRect(0, top, W, bar.h + 2); }
  const fh = bar.fieldH, fy = top + (bar.h - fh) / 2;
  const k = clamp((t - rec.t0) / rec.dur, 0, 1);
  const secs = clamp(t - rec.t0, 0, rec.dur);
  const pressing = t >= rec.t1 && t < rec.t1 + 0.3 ? 0.86 : 1;
  const blink = 0.45 + 0.55 * Math.abs(Math.sin(t * 3.2));
  ctx.textBaseline = 'middle';
  if (R.fam === 'whatsapp') {
    const fx = 8, fw = W - 76;
    fillRR(ctx, fx, fy, fw, fh, fh / 2, pal.inputBg);
    ctx.globalAlpha = blink;
    icon(ctx, 'mic', fx + 22, fy + fh / 2, 20, '#EA0038');
    ctx.globalAlpha = 1;
    ctx.font = font(15, 400);
    ctx.fillStyle = pal.text;
    ctx.textAlign = 'left';
    ctx.fillText(mmss(secs), fx + 40, fy + fh / 2);
    ctx.fillStyle = pal.sub;
    ctx.textAlign = 'center';
    ctx.fillText('‹  slide to cancel', fx + fw / 2 + 30, fy + fh / 2);
    ctx.save();
    const bx = W - 34, by = fy + fh / 2, s = 1.25 * pressing;
    ctx.translate(bx, by); ctx.scale(s, s); ctx.translate(-bx, -by);
    circle(ctx, bx, by, 23, '#00A884');
    icon(ctx, t >= rec.t1 ? 'send' : 'mic', bx, by, 21, '#FFFFFF');
    ctx.restore();
    return;
  }
  const fx = 12, fw = W - 24;
  fillRR(ctx, fx, fy, fw, fh, fh / 2, pal.dark ? 'rgba(255,69,58,0.2)' : 'rgba(255,59,48,0.1)');
  ctx.globalAlpha = blink;
  circle(ctx, fx + 18, fy + fh / 2, 5, '#FF3B30');
  ctx.globalAlpha = 1;
  ctx.font = font(15, 500);
  ctx.fillStyle = '#FF3B30';
  ctx.textAlign = 'left';
  ctx.fillText(mmss(secs), fx + 30, fy + fh / 2);
  const x0 = fx + 76, x1 = fx + fw - 44;
  const n = Math.max(8, Math.floor((x1 - x0) / 4.2));
  const hs = barHeights(rec.peaks, rec.seed, n).map((hh, i) => (i / n < k ? hh : 0));
  waveform(ctx, x0, x1, fy + fh / 2, fh * 0.55, hs, 1, '#FF3B30', '#FF3B30');
  ctx.save();
  const bx = fx + fw - 18, by = fy + fh / 2;
  ctx.translate(bx, by); ctx.scale(pressing, pressing); ctx.translate(-bx, -by);
  sendArrow(ctx, bx, by, 14, R.fam === 'instagram' ? '#3797F0' : R.fam === 'android' ? '#0B57D0' : pal.me, '#FFFFFF');
  ctx.restore();
}

// A copy of a row's bubble drawn at (x, y) (screen effects: Echo).
export function drawBubbleCopy(ctx, R, v, x, y, t) {
  if (v.it.kind === 'voice') drawVoiceBubble(ctx, R, v, x, y, t);
  else if (v.it.kind === 'image') drawImageBubble(ctx, R, v.it, x, y, v.m.w, v.m.h, t);
  else if (v.it.kind === 'video') drawVideoBubble(ctx, R, v.it, x, y, v.m.w, v.m.h, t);
  else if (v.m.big) { ctx.font = emojiFont(v.m.size); ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(v.it.text.trim(), x + 2, y + v.m.h / 2 + 2); }
  else drawTextBubble(ctx, R, { ...v, it: { ...v.it, inkUntil: 0 }, last: true, first: true }, x, y, t);
}
