// Messages list (with swipe-to-delete), lock screen, call screen and notification banners.
import { font } from '../themes.js';
import { clamp, lerp, prog, ease, fmtClock } from '../util.js';
import { unreadAt } from '../timeline.js';
import { lin, val } from '../motion.js';
import { chatTitle, nameOf, contact } from '../model.js';
import { visual, frameAt } from '../media.js';
import { fillRR, circle, wrap, icon, chevron, avatar, avatarOf, ellipsize, fillBackdrop, appIcon, touchDot } from './draw.js';

// ---- messages list -----------------------------------------------------------------
function lastPreview(R, t) {
  let last = null;
  for (const it of R.tl.items) {
    if ((it.kind === 'msg' || it.kind === 'image' || it.kind === 'voice') && it.tIn <= t && !(it.tOut != null && t >= it.tOut)) last = it;
  }
  if (!last) return '';
  if (last.kind === 'image') return last.side === 'me' ? 'You sent an image' : 'Image';
  if (last.kind === 'voice') return R.fam === 'ios' ? 'Audio Message' : (last.side === 'me' ? 'You: ' : '') + '🎤 Voice message';
  return (R.fam === 'whatsapp' || R.fam === 'instagram') && last.side === 'me' ? (R.fam === 'instagram' ? 'You: ' : '') + last.text : last.text;
}

export function drawInbox(ctx, R, t) {
  const { W, H, pal, dev, p } = R;
  const fam = R.fam;
  const androidOS = pal.os === 'android';
  const mo = R.tl.mo;
  ctx.fillStyle = fam === 'android' ? pal.bg : pal.dark ? '#000000' : '#FFFFFF';
  ctx.fillRect(0, 0, W, H);
  const top = dev.safeTop;
  let y;

  if (fam === 'ios' || (fam === 'whatsapp' && !androidOS)) {
    const title = fam === 'whatsapp' ? 'Chats' : 'Messages';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.font = font(17, 400);
    ctx.fillStyle = fam === 'whatsapp' ? pal.icon : pal.accent;
    ctx.fillText('Edit', 16, top + 22);
    icon(ctx, 'edit', W - 26, top + 22, 24, fam === 'whatsapp' ? pal.icon : pal.accent);
    ctx.font = font(34, 700);
    ctx.fillStyle = pal.text;
    ctx.fillText(title, 16, top + 66);
    fillRR(ctx, 16, top + 94, W - 32, 36, 10, pal.dark ? '#1C1C1E' : '#EEEEF0');
    icon(ctx, 'search', 34, top + 112, 20, pal.sub);
    ctx.font = font(17, 400);
    ctx.fillStyle = pal.sub;
    ctx.fillText('Search', 48, top + 112);
    icon(ctx, 'mic', W - 34, top + 112, 19, pal.sub);
    y = top + 142;
  } else if (fam === 'instagram') {
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    chevron(ctx, 16, top + 24, 18, pal.text, 'left', 2.6);
    ctx.font = font(21, 700);
    ctx.fillStyle = pal.text;
    const handle = (p.me.name || 'me').toLowerCase().replace(/\s+/g, '_');
    ctx.fillText(handle, 40, top + 24);
    icon(ctx, 'edit', W - 26, top + 24, 24, pal.text);
    fillRR(ctx, 16, top + 50, W - 32, 36, 10, pal.dark ? '#262626' : '#EFEFEF');
    icon(ctx, 'search', 34, top + 68, 20, pal.sub);
    ctx.font = font(16, 400);
    ctx.fillStyle = pal.sub;
    ctx.fillText('Search', 50, top + 68);
    ctx.font = font(16, 700);
    ctx.fillStyle = pal.text;
    ctx.fillText('Messages', 16, top + 112);
    ctx.font = font(15, 600);
    ctx.fillStyle = '#3797F0';
    ctx.textAlign = 'right';
    ctx.fillText('Requests', W - 16, top + 112);
    y = top + 130;
  } else {
    // Android Messages / Android WhatsApp
    const wa = fam === 'whatsapp';
    ctx.textBaseline = 'middle';
    if (wa) {
      ctx.fillStyle = pal.dark ? '#1F2C34' : '#008069';
      ctx.fillRect(0, 0, W, top + 58);
      ctx.textAlign = 'left';
      ctx.font = font(21, 500);
      ctx.fillStyle = '#FFFFFF';
      ctx.fillText('WhatsApp', 18, top + 28);
      icon(ctx, 'camera', W - 104, top + 28, 22, '#FFFFFF');
      icon(ctx, 'search', W - 62, top + 28, 22, '#FFFFFF');
      icon(ctx, 'more', W - 22, top + 28, 22, '#FFFFFF');
    } else {
      ctx.textAlign = 'center';
      ctx.font = font(22, 400);
      ctx.fillStyle = pal.text;
      ctx.fillText('Messages', W / 2, top + 28);
      icon(ctx, 'search', 28, top + 28, 24, pal.icon);
      avatar(ctx, p, 'me', W - 30, top + 28, 16, t);
    }
    y = top + 64;
  }

  // rows
  const rows = [
    { id: 'chat', name: chatTitle(p), preview: lastPreview(R, t), time: p.status.time, unread: unreadAt(R.tl, t), who: p.chat.members[0], group: R.group },
    ...p.inbox.map((r) => ({ ...r, contactLike: { name: r.name, color: r.color, avatar: r.avatar } })),
  ];
  const rowH = fam === 'instagram' ? 72 : 76;
  const avR = fam === 'instagram' ? 28 : fam === 'android' ? 24 : 26;
  const textX = fam === 'ios' ? 84 : fam === 'android' ? 84 : 82;
  const swipes = R.tl.swipes;
  const sw = mo.swipe;

  for (const row of rows) {
    const s = swipes.find((x) => x.row === row.id && t >= x.t0);
    let dx = 0, hk = 1, phase = null;
    if (s) {
      const d = (t - s.t0) / sw.dur;      // 0..1 over the whole gesture
      if (d >= 1) continue;
      phase = d;
      const drag = sw.f(clamp(d / 0.38, 0, 1));
      dx = -92 * drag;
      if (d > 0.56) dx = lerp(-92, -W, ease(clamp((d - 0.56) / 0.18, 0, 1)));
      if (d > 0.74) hk = 1 - ease(clamp((d - 0.74) / 0.26, 0, 1));
    }
    const h = rowH * hk;
    ctx.save();
    ctx.beginPath(); ctx.rect(0, y, W, h); ctx.clip();
    if (dx < 0) {
      ctx.fillStyle = '#FF3B30';
      ctx.fillRect(W + dx, y, -dx, rowH);
      const bw = Math.max(-dx, 0);
      const cx = W + dx + bw / 2;
      if (bw > 40) {
        icon(ctx, 'trash', cx, y + rowH / 2 - 9, 22, '#FFFFFF');
        ctx.font = font(13, 500); ctx.fillStyle = '#FFFFFF'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('Delete', cx, y + rowH / 2 + 14);
      }
    }
    ctx.translate(dx, 0);
    ctx.fillStyle = fam === 'android' ? pal.bg : pal.dark ? '#000000' : '#FFFFFF';
    if (fam === 'whatsapp' && pal.dark) ctx.fillStyle = pal.bg;
    ctx.fillRect(0, y, W, rowH);
    drawInboxRow(ctx, R, row, y, rowH, avR, textX, t);
    ctx.restore();
    if (phase != null && p.showTouches) {
      // finger: drag left, lift, then tap Delete
      if (phase < 0.42) touchDot(ctx, W - 60 + dx, y + rowH / 2, clamp(phase / 0.04, 0, 1) * (1 - clamp((phase - 0.36) / 0.06, 0, 1)));
      else if (phase > 0.46 && phase < 0.6) touchDot(ctx, W - 46, y + rowH / 2, 1 - clamp((phase - 0.55) / 0.05, 0, 1), phase > 0.5 ? 0.6 : 1);
    }
    y += h;
  }

  if (fam === 'android') {
    // Start chat FAB
    const fw = 142, fh = 56, fx = W - fw - 16, fy = H - dev.safeBottom - fh - 16;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.2)'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 2;
    fillRR(ctx, fx, fy, fw, fh, 16, pal.dark ? '#004A77' : '#C2E7FF');
    ctx.restore();
    icon(ctx, 'message', fx + 28, fy + fh / 2, 22, pal.dark ? '#C2E7FF' : '#001D35');
    ctx.font = font(15, 500); ctx.fillStyle = pal.dark ? '#C2E7FF' : '#001D35'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText('Start chat', fx + 48, fy + fh / 2);
  }
}

function drawInboxRow(ctx, R, row, y, rowH, avR, textX, t) {
  const { W, pal, p } = R;
  const fam = R.fam;
  const cy = y + rowH / 2;
  const ax = fam === 'ios' ? 20 + avR + 6 : 16 + avR;
  if (row.id === 'chat') {
    if (row.group) {
      const ids = p.chat.members.slice(0, 2);
      ids.forEach((id, i) => avatar(ctx, p, id, ax + (i ? 9 : -7), cy + (i ? 8 : -7), avR * 0.66, t, { ios: fam === 'ios' }));
    } else avatar(ctx, p, row.who, ax, cy, avR, t, { ios: fam === 'ios' });
  } else avatarOf(ctx, row.contactLike, ax, cy, avR, t, { ios: fam === 'ios' && !row.color });

  if (row.unread && fam === 'ios') circle(ctx, 10, cy, 5, pal.accent);
  const right = W - 16;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  const bold = row.unread && fam !== 'ios';
  ctx.font = font(fam === 'instagram' ? 15 : 17, fam === 'ios' || fam === 'whatsapp' ? 600 : bold ? 700 : 400);
  ctx.fillStyle = pal.text;
  ctx.fillText(ellipsize(ctx, row.name, right - textX - 90), textX, fam === 'instagram' ? cy - 3 : cy - 8);
  // time
  ctx.textAlign = 'right';
  ctx.font = font(fam === 'android' ? 13 : 15, 400);
  ctx.fillStyle = row.unread && fam === 'whatsapp' ? '#25D366' : pal.sub;
  if (fam === 'instagram') {
    if (row.unread) circle(ctx, right - 4, cy, 4.5, '#3797F0');
  } else if (fam === 'ios') {
    ctx.fillText(row.time, right - 14, cy - 8);
    chevron(ctx, right - 4, cy - 13, 11, pal.sub, 'right', 2);
  } else ctx.fillText(row.time, right, cy - 8);
  // preview
  ctx.textAlign = 'left';
  ctx.font = font(fam === 'instagram' ? 14 : 15, bold || (row.unread && fam === 'instagram') ? 600 : 400);
  ctx.fillStyle = bold ? pal.text : pal.sub;
  const pw = right - textX - (fam === 'whatsapp' && row.unread ? 30 : 4);
  if (fam === 'ios') {
    const lines = wrap(ctx, row.preview || '', pw).slice(0, 2);
    if (wrap(ctx, row.preview || '', pw).length > 2) lines[1] = ellipsize(ctx, lines[1] + '…', pw);
    lines.forEach((l, i) => ctx.fillText(l, textX, cy + 13 + i * 19));
  } else {
    ctx.fillText(ellipsize(ctx, (row.preview || '').replace(/\n/g, ' '), pw), textX, fam === 'instagram' ? cy + 16 : cy + 14);
  }
  if (fam === 'whatsapp' && row.unread) {
    circle(ctx, right - 10, cy + 9, 10, '#25D366');
    ctx.font = font(12, 600); ctx.fillStyle = pal.dark ? '#0B141A' : '#FFFFFF'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('1', right - 10, cy + 9.5);
  }
  // separator
  if (fam === 'ios' || fam === 'whatsapp') { ctx.fillStyle = pal.sep; ctx.fillRect(textX, y + rowH - 0.5, W - textX, 0.5); }
}

// ---- lock screen -------------------------------------------------------------------
export function drawLock(ctx, R, t) {
  const { W, H, p, dev } = R;
  const android = dev.os === 'android';
  fillBackdrop(ctx, p.wallpaper, 0, 0, W, H, t);
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, 'rgba(0,0,0,0.22)'); g.addColorStop(0.45, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.25)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  const top = dev.safeTop;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  if (!android) icon(ctx, 'lock', W / 2, top + 6, 16, '#FFFFFF');
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.font = font(android ? 15 : 20, 600);
  ctx.fillText(p.status.date || '', W / 2, top + (android ? 40 : 46));
  ctx.fillStyle = '#FFFFFF';
  ctx.font = font(android ? 84 : 96, android ? 300 : 700);
  ctx.fillText(p.status.time, W / 2, top + (android ? 130 : 142));

  // notifications (newest on top)
  const mo = R.tl.mo;
  const notes = R.tl.lockNotes.filter((n) => n.t <= t).slice().reverse().slice(0, 5);
  let y = top + (android ? 170 : 190);
  for (const n of notes) {
    const k = val(mo.lockNote, t, n.t);
    const a = clamp(lin(mo.lockNote, t, n.t) * 3, 0, 1);
    const h = noteHeight(ctx, R, n);
    ctx.save();
    ctx.globalAlpha = a;
    const cy = y + h / 2;
    const sc = lerp(0.9, 1, k);
    ctx.translate(W / 2, cy + (1 - k) * 30);
    ctx.scale(sc, sc);
    ctx.translate(-W / 2, -cy);
    drawNoteCard(ctx, R, n, 10, y, W - 20, h, android ? 'android-lock' : 'lock');
    ctx.restore();
    y += (h + 8) * clamp(k, 0, 1);
  }

  // quick actions
  const by = H - (android ? 70 : 92);
  if (android) {
    icon(ctx, 'phone', 44, by, 26, '#FFFFFF');
    icon(ctx, 'camera', W - 44, by, 26, '#FFFFFF');
    icon(ctx, 'lock', W / 2, by - 10, 22, '#FFFFFF');
  } else {
    circle(ctx, 56, by, 25, 'rgba(0,0,0,0.28)');
    icon(ctx, 'flashlight', 56, by, 22, '#FFFFFF');
    circle(ctx, W - 56, by, 25, 'rgba(0,0,0,0.28)');
    icon(ctx, 'camera', W - 56, by, 22, '#FFFFFF');
  }
}

function noteLines(ctx, R, n, w) {
  ctx.font = font(15, 400);
  return wrap(ctx, n.text || '', w - 82).slice(0, 4);
}
function noteHeight(ctx, R, n) {
  return 44 + noteLines(ctx, R, n, R.W - 20).length * 19;
}

// Notification card shared by banners and the lock screen.
function drawNoteCard(ctx, R, n, x, y, w, h, style) {
  const { pal, p } = R;
  const lock = style === 'lock' || style === 'android-lock';
  const dark = lock ? false : pal.dark;
  ctx.save();
  if (!lock) { ctx.shadowColor = 'rgba(0,0,0,0.22)'; ctx.shadowBlur = 18; ctx.shadowOffsetY = 4; }
  const bg = lock ? 'rgba(245,245,247,0.78)' : dark ? 'rgba(44,44,46,0.97)' : 'rgba(250,250,250,0.97)';
  fillRR(ctx, x, y, w, h, style === 'android' || style === 'android-lock' ? 24 : 22, bg);
  ctx.restore();
  const ink = dark ? '#FFFFFF' : '#000000';
  const sub = dark ? 'rgba(235,235,245,0.6)' : 'rgba(60,60,67,0.6)';
  const app = n.call ? 'phone' : p.theme === 'sms' ? 'imessage' : p.theme;
  appIcon(ctx, app, x + 12, y + 13, 38);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.font = font(15, 600);
  ctx.fillStyle = ink;
  ctx.fillText(ellipsize(ctx, nameOf(p, n.from), w - 130), x + 62, y + 30);
  ctx.font = font(13, 400);
  ctx.fillStyle = sub;
  ctx.textAlign = 'right';
  ctx.fillText('now', x + w - 14, y + 29);
  ctx.textAlign = 'left';
  ctx.font = font(15, 400);
  ctx.fillStyle = ink;
  noteLines(ctx, R, n, w + 20).forEach((l, i) => ctx.fillText(l, x + 62, y + 50 + i * 19));
}

export function drawBanners(ctx, R, t) {
  const { W, dev } = R;
  const mo = R.tl.mo;
  for (const b of R.tl.banners) {
    if (t < b.t0 || t > b.t1 + mo.banner.dur) continue;
    const kIn = val(mo.banner, t, b.t0);
    const kOut = t > b.t1 ? mo.banner.f(lin(mo.banner, t, b.t1)) : 0;
    const h = noteHeight(ctx, R, b);
    const restY = dev.os === 'android' ? dev.safeTop - 2 : dev.safeTop - 6;
    const y = lerp(-h - 20, restY, kIn) - kOut * (h + restY + 30);
    drawNoteCard(ctx, R, b, 8, y, W - 16, h, dev.os === 'android' ? 'android' : 'banner');
  }
}

// ---- calls ---------------------------------------------------------------------------
const blurCache = new Map();
function blurredAvatar(id, color) {
  const key = id || color;
  if (blurCache.has(key)) return blurCache.get(key);
  const v = id ? visual(id) : null;
  if (id && !v) return null;
  const c = new OffscreenCanvas(195, 422);
  const g = c.getContext('2d');
  if (v) {
    g.filter = 'blur(24px) saturate(1.3)';
    const bmp = frameAt(v, 0);
    const s = Math.max(c.width / bmp.width, c.height / bmp.height) * 1.3;
    g.drawImage(bmp, (c.width - bmp.width * s) / 2, (c.height - bmp.height * s) / 2, bmp.width * s, bmp.height * s);
    g.filter = 'none';
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.fillRect(0, 0, c.width, c.height);
  } else {
    const gr = g.createLinearGradient(0, 0, 0, c.height);
    gr.addColorStop(0, shade(color, 0.55)); gr.addColorStop(1, '#0b0b0f');
    g.fillStyle = gr;
    g.fillRect(0, 0, c.width, c.height);
  }
  blurCache.set(key, c);
  return c;
}
function shade(hex, k) {
  const m = (hex || '#555555').replace('#', '').match(/^([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i);
  if (!m) return '#333333';
  return `rgb(${m.slice(1).map((x) => Math.round(parseInt(x, 16) * k)).join(',')})`;
}

export function drawCall(ctx, R, c, t) {
  const { W, H, p, dev } = R;
  const mo = R.tl.mo;
  const who = contact(p, c.who) || { name: nameOf(p, c.who), color: '#8E8E93' };
  const style = R.fam === 'whatsapp' ? 'whatsapp' : dev.os === 'android' ? 'android' : 'ios';
  const answered = c.tAnswer != null && t >= c.tAnswer;
  const ended = t >= c.tEnd;
  const ringing = !answered && !ended;
  const inc = c.dir === 'in';
  const top = dev.safeTop;

  // background
  if (style === 'whatsapp') {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#13232B'); g.addColorStop(1, '#0B141A');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  } else {
    const bg = blurredAvatar(who.avatar, who.color);
    if (bg) ctx.drawImage(bg, 0, 0, W, H);
    else { ctx.fillStyle = '#111114'; ctx.fillRect(0, 0, W, H); }
  }

  // status line
  let status;
  if (ended) status = c.endLabel || (c.outcome === 'answer' ? 'Call Ended' : '');
  else if (answered) status = fmtClock(t - c.tAnswer);
  else if (inc) status = style === 'whatsapp' ? 'WhatsApp voice call' : style === 'android' ? 'Incoming call' : who.label || 'mobile';
  else status = style === 'whatsapp' ? (t - c.t0 > 1.2 ? 'Ringing' : 'Calling') : style === 'android' ? 'Calling…' : `calling ${who.label || 'mobile'}…`;

  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const inCall = !inc || answered;
  if (style === 'ios') {
    ctx.fillStyle = '#FFFFFF';
    ctx.font = font(ringing && inc ? 40 : 32, 400);
    ctx.fillText(ellipsize(ctx, who.name, W - 40), W / 2, top + (ringing && inc ? 120 : 90));
    ctx.font = font(18, 400);
    ctx.fillStyle = 'rgba(255,255,255,0.72)';
    ctx.fillText(status, W / 2, top + (ringing && inc ? 152 : 120));
  } else if (style === 'android') {
    avatarOf(ctx, who, W / 2, top + 130, 52, t);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = font(30, 400);
    ctx.fillText(ellipsize(ctx, who.name, W - 40), W / 2, top + 230);
    ctx.font = font(16, 400);
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillText(status, W / 2, top + 262);
  } else {
    icon(ctx, 'lock', W / 2 - 66, top + 22, 13, 'rgba(233,237,239,0.7)');
    ctx.font = font(13, 400);
    ctx.fillStyle = 'rgba(233,237,239,0.7)';
    ctx.fillText('End-to-end encrypted', W / 2 + 6, top + 27);
    ctx.fillStyle = '#E9EDEF';
    ctx.font = font(26, 500);
    ctx.fillText(ellipsize(ctx, who.name, W - 40), W / 2, top + 80);
    ctx.font = font(15, 400);
    ctx.fillStyle = 'rgba(233,237,239,0.7)';
    ctx.fillText(status, W / 2, top + 106);
    avatarOf(ctx, who, W / 2, H * 0.42, 70, t);
  }

  // press feedback around the decision moment
  const decideT = answered ? c.tAnswer : c.tEnd;
  const pressK = clamp(1 - Math.abs(t - (decideT - 0.15)) / 0.18, 0, 1);

  const dim = ended ? 0.45 : 1;
  if (inc && !inCall && !(ended && c.outcome !== 'decline' && false)) {
    // ringing (or declined / missed): Decline + Accept
    const by = H - (style === 'android' ? 120 : 150);
    const lx = W * 0.25, rx = W * 0.75;
    const declining = c.outcome === 'decline';
    const pressX = declining ? lx : rx;
    ctx.globalAlpha = ended ? 1 - prog(t, c.tEnd, 0.3) : 1;
    if (style === 'ios') {
      smallAction(ctx, lx, by - 112, 'bell', 'Remind Me');
      smallAction(ctx, rx, by - 112, 'message', 'Message');
    }
    callButton(ctx, lx, by, 37, '#EB4E3D', 'callEnd', 'Decline', declining ? pressK : 0);
    const wob = style === 'android' && ringing ? Math.sin(t * 9) * 3 * (Math.sin(t * 2.2) > 0 ? 1 : 0) : 0;
    callButton(ctx, rx, by + wob, 37, '#67CE67', 'phone', style === 'android' ? 'Answer' : 'Accept', !declining && c.outcome === 'answer' ? pressK : 0);
    ctx.globalAlpha = 1;
    if (p.showTouches && pressK > 0 && c.outcome !== 'missed') touchDot(ctx, pressX, by, pressK, 0.8);
  } else {
    // in-call controls
    ctx.globalAlpha = dim;
    if (style === 'whatsapp') {
      const py = H - 118;
      fillRR(ctx, 16, py, W - 32, 84, 28, '#1D282F');
      const xs = [0.18, 0.39, 0.6, 0.82].map((f) => 16 + (W - 32) * f);
      icon(ctx, 'speaker', xs[0], py + 42, 26, '#E9EDEF');
      icon(ctx, 'video', xs[1], py + 42, 26, '#E9EDEF');
      icon(ctx, 'micOff', xs[2], py + 42, 26, '#E9EDEF');
      circle(ctx, xs[3], py + 42, 27, '#EA0038');
      icon(ctx, 'callEnd', xs[3], py + 42, 28, '#FFFFFF');
    } else {
      const grid = [['speaker', 'speaker'], ['video', 'FaceTime'], ['micOff', 'mute'], ['personAdd', 'add'], [null, 'end'], ['keypad', 'keypad']];
      const gx = [W * 0.22, W * 0.5, W * 0.78];
      const gy0 = style === 'android' ? H * 0.52 : H * 0.48;
      grid.forEach(([ic, label], i) => {
        const x = gx[i % 3], y = gy0 + Math.floor(i / 3) * 112;
        if (label === 'end') return;
        circle(ctx, x, y, 36, 'rgba(255,255,255,0.18)');
        if (ic === 'keypad') keypadGlyph(ctx, x, y);
        else icon(ctx, ic, x, y, 30, '#FFFFFF');
        ctx.font = font(13, 500); ctx.fillStyle = '#FFFFFF'; ctx.textAlign = 'center';
        ctx.fillText(style === 'android' && label === 'FaceTime' ? 'video' : label, x, y + 56);
      });
      ctx.globalAlpha = 1;
      const ex = W / 2, ey = H - 128;
      callButton(ctx, ex, ey, 37, '#EB4E3D', 'callEnd', '', ended ? 0 : pressK * (t > decideT - 0.4 ? 1 : 0));
    }
    ctx.globalAlpha = 1;
    if (p.showTouches && !ended && t > c.tEnd - 0.35 && c.outcome === 'answer') {
      const k = clamp(1 - Math.abs(t - (c.tEnd - 0.15)) / 0.18, 0, 1);
      touchDot(ctx, style === 'whatsapp' ? 16 + (W - 32) * 0.82 : W / 2, style === 'whatsapp' ? H - 76 : H - 128, k, 0.8);
    }
  }
}

function callButton(ctx, x, y, r, color, ic, label, press) {
  const s = 1 - 0.08 * press;
  ctx.save();
  ctx.translate(x, y); ctx.scale(s, s); ctx.translate(-x, -y);
  circle(ctx, x, y, r, color);
  if (press > 0) { ctx.globalAlpha *= 0.25 * press; circle(ctx, x, y, r, '#000000'); ctx.globalAlpha /= 0.25 * press || 1; }
  icon(ctx, ic, x, y, ic === 'callEnd' ? 36 : 32, '#FFFFFF');
  ctx.restore();
  if (label) {
    ctx.font = font(14, 500); ctx.fillStyle = '#FFFFFF'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(label, x, y + r + 24);
  }
}

function smallAction(ctx, x, y, ic, label) {
  icon(ctx, ic, x, y, 24, 'rgba(255,255,255,0.9)');
  ctx.font = font(13, 400); ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.fillText(label, x, y + 28);
}

function keypadGlyph(ctx, x, y) {
  for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) {
    if (r === 3 && c !== 1) continue;
    circle(ctx, x + (c - 1) * 8, y + (r - 1.5) * 7.5, 2.4, '#FFFFFF');
  }
}

