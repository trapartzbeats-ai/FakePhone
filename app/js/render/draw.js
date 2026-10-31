// Canvas primitives shared by every screen: shapes, text wrapping, icons, avatars, status bar.
import { font } from '../themes.js';
import { visual, frameAt } from '../media.js';
import { initials } from '../util.js';
import { contact } from '../model.js';

export function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}
export function fillRR(ctx, x, y, w, h, r, color) {
  rr(ctx, x, y, w, h, r);
  ctx.fillStyle = color;
  ctx.fill();
}
export function circle(ctx, cx, cy, r, color) {
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}

// ---- text ---------------------------------------------------------------------
const mcache = new Map();
export function tw(ctx, s) {
  const k = ctx.font + '\u0001' + s;
  let v = mcache.get(k);
  if (v === undefined) {
    v = ctx.measureText(s).width;
    if (mcache.size > 20000) mcache.clear();
    mcache.set(k, v);
  }
  return v;
}
export function clearMeasureCache() { mcache.clear(); }

const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
export function wrap(ctx, text, maxW) {
  const lines = [];
  for (const para of String(text).split('\n')) {
    const tokens = para.match(/\S+\s*|\s+/g) || [''];
    let line = '';
    for (let tok of tokens) {
      if (tw(ctx, line + tok.trimEnd()) <= maxW) { line += tok; continue; }
      if (line) { lines.push(line.trimEnd()); line = ''; }
      while (tw(ctx, tok.trimEnd()) > maxW) {
        let cut = '';
        for (const { segment } of seg.segment(tok)) {
          if (tw(ctx, cut + segment) > maxW && cut) break;
          cut += segment;
        }
        lines.push(cut);
        tok = tok.slice(cut.length);
      }
      line = tok;
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

export function text(ctx, s, x, y, size, weight, color, align = 'left', baseline = 'alphabetic') {
  ctx.font = font(size, weight);
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  ctx.fillText(s, x, y);
}

export function ellipsize(ctx, s, maxW) {
  if (tw(ctx, s) <= maxW) return s;
  const g = Array.from(seg.segment(s), (x) => x.segment);
  while (g.length && tw(ctx, g.join('') + '…') > maxW) g.pop();
  return g.join('') + '…';
}

const URL_RE = /(https?:\/\/[^\s]+|www\.[^\s]+)/g;
// Draws one wrapped line, painting links in linkColor with an underline.
export function lineWithLinks(ctx, line, x, y, color, linkColor, underlineY) {
  URL_RE.lastIndex = 0;
  if (!URL_RE.test(line)) { ctx.fillStyle = color; ctx.fillText(line, x, y); return; }
  URL_RE.lastIndex = 0;
  let last = 0, cx = x, m;
  while ((m = URL_RE.exec(line))) {
    const before = line.slice(last, m.index);
    ctx.fillStyle = color; ctx.fillText(before, cx, y); cx += tw(ctx, before);
    const w = tw(ctx, m[0]);
    ctx.fillStyle = linkColor; ctx.fillText(m[0], cx, y);
    ctx.fillRect(cx, y + underlineY, w, 1);
    cx += w; last = m.index + m[0].length;
  }
  ctx.fillStyle = color; ctx.fillText(line.slice(last), cx, y);
}

// ---- icons (Material Design paths, Apache 2.0) ----------------------------------
const PATHS = {
  phone: 'M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z',
  video: 'M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z',
  mic: 'M12 14c1.66 0 2.99-1.34 2.99-3L15 5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z',
  micOff: 'M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73 4.27 3z',
  search: 'M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z',
  camera: 'M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4zM9 2L7.17 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2h-3.17L15 2H9zm3 15c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5z',
  trash: 'M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z',
  more: 'M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z',
  back: 'M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z',
  speaker: 'M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z',
  personAdd: 'M15 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm-9-2V7H4v3H1v2h3v3h2v-3h3v-2H6zm9 4c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z',
  person: 'M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z',
  callEnd: 'M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08c-.18-.17-.29-.42-.29-.7 0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28-.79-.74-1.69-1.36-2.67-1.85-.33-.16-.56-.5-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z',
  add: 'M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z',
  image: 'M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z',
  emoji: 'M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm3.5-9c.83 0 1.5-.67 1.5-1.5S16.33 8 15.5 8 14 8.67 14 9.5s.67 1.5 1.5 1.5zm-7 0c.83 0 1.5-.67 1.5-1.5S9.33 8 8.5 8 7 8.67 7 9.5 7.67 11 8.5 11zm3.5 6.5c2.33 0 4.31-1.46 5.11-3.5H6.89c.8 2.04 2.78 3.5 5.11 3.5z',
  attach: 'M16.5 6v11.5c0 2.21-1.79 4-4 4s-4-1.79-4-4V5c0-1.38 1.12-2.5 2.5-2.5s2.5 1.12 2.5 2.5v10.5c0 .55-.45 1-1 1s-1-.45-1-1V6H10v9.5c0 1.38 1.12 2.5 2.5 2.5s2.5-1.12 2.5-2.5V5c0-2.21-1.79-4-4-4S7 2.79 7 5v12.5c0 3.04 2.46 5.5 5.5 5.5s5.5-2.46 5.5-5.5V6h-1.5z',
  send: 'M2.01 21L23 12 2.01 3 2 10l15 2-15 2z',
  lock: 'M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z',
  flashlight: 'M6 2h12v5l-2 4v11H8V11L6 7V2zm6 10.5c-.83 0-1.5.67-1.5 1.5s.67 1.5 1.5 1.5 1.5-.67 1.5-1.5-.67-1.5-1.5-1.5zM8 4v2h8V4H8z',
  edit: 'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z',
  backspace: 'M22 3H7c-.69 0-1.23.35-1.59.88L0 12l5.41 8.11c.36.53.9.89 1.59.89h15c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-3 12.59L17.59 17 14 13.41 10.41 17 9 15.59 12.59 12 9 8.41 10.41 7 14 10.59 17.59 7 19 8.41 15.41 12 19 15.59z',
  doneAll: 'M18 7l-1.41-1.41-6.34 6.34 1.41 1.41L18 7zm4.24-1.41L11.66 16.17 7.48 12l-1.41 1.41L11.66 19l12-12-1.42-1.41zM.41 13.41L6 19l1.41-1.41L1.83 12 .41 13.41z',
  check: 'M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z',
  message: 'M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z',
  bell: 'M12 22c1.1 0 2-.9 2-2h-4c0 1.1.89 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z',
  sticker: 'M18 2H6c-2.2 0-4 1.8-4 4v12c0 2.2 1.8 4 4 4h9l7-7V6c0-2.2-1.8-4-4-4zM14 20v-2c0-2.2 1.8-4 4-4h2l-6 6z',
  heart: 'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z',
  info: 'M11 7h2v2h-2zm0 4h2v6h-2zm1-9C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z',
};
const pathCache = {};
export function icon(ctx, name, cx, cy, size, color) {
  const p = pathCache[name] || (pathCache[name] = new Path2D(PATHS[name]));
  ctx.save();
  ctx.translate(cx - size / 2, cy - size / 2);
  ctx.scale(size / 24, size / 24);
  ctx.fillStyle = color;
  ctx.fill(p);
  ctx.restore();
}

export function chevron(ctx, x, y, size, color, dir = 'left', lw = 3) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  const h = size / 2, w = size * 0.32;
  if (dir === 'left') { ctx.moveTo(x + w, y - h); ctx.lineTo(x, y); ctx.lineTo(x + w, y + h); }
  else if (dir === 'right') { ctx.moveTo(x, y - h); ctx.lineTo(x + w, y); ctx.lineTo(x, y + h); }
  else if (dir === 'up') { ctx.moveTo(x - h, y + w / 2); ctx.lineTo(x, y - w / 2); ctx.lineTo(x + h, y + w / 2); }
  ctx.stroke();
  ctx.restore();
}

// Up arrow inside a filled circle (iMessage send button).
export function sendArrow(ctx, cx, cy, r, bg, fg) {
  circle(ctx, cx, cy, r, bg);
  ctx.save();
  ctx.strokeStyle = fg;
  ctx.lineWidth = r * 0.2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(cx, cy + r * 0.5); ctx.lineTo(cx, cy - r * 0.48);
  ctx.moveTo(cx - r * 0.42, cy - r * 0.08); ctx.lineTo(cx, cy - r * 0.5); ctx.lineTo(cx + r * 0.42, cy - r * 0.08);
  ctx.stroke();
  ctx.restore();
}

// ---- avatars --------------------------------------------------------------------
export function avatar(ctx, p, who, cx, cy, r, t = 0, opts = {}) {
  const c = who === 'me' ? { name: p.me.name, color: '#8E8E93', avatar: p.me.avatar } : contact(p, who) || { name: '?', color: '#8E8E93' };
  avatarOf(ctx, c, cx, cy, r, t, opts);
}

// c = { name, color, avatar (media id) }
export function avatarOf(ctx, c, cx, cy, r, t = 0, opts = {}) {
  const v = c.avatar ? visual(c.avatar) : null;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  if (v) {
    const bmp = frameAt(v, t);
    const s = Math.max((2 * r) / bmp.width, (2 * r) / bmp.height);
    ctx.drawImage(bmp, cx - (bmp.width * s) / 2, cy - (bmp.height * s) / 2, bmp.width * s, bmp.height * s);
  } else {
    const g = ctx.createLinearGradient(0, cy - r, 0, cy + r);
    if (opts.ios) { g.addColorStop(0, '#A7ACB8'); g.addColorStop(1, '#858A95'); }
    else { g.addColorStop(0, lighten(c.color || '#8E8E93', 0.18)); g.addColorStop(1, c.color || '#8E8E93'); }
    ctx.fillStyle = g;
    ctx.fillRect(cx - r, cy - r, 2 * r, 2 * r);
    const ini = initials(c.name);
    if (ini === '?' || opts.silhouette) {
      icon(ctx, 'person', cx, cy + r * 0.12, r * 1.6, 'rgba(255,255,255,0.92)');
    } else {
      ctx.font = font(r * (ini.length > 1 ? 0.78 : 0.9), 600);
      ctx.fillStyle = '#FFFFFF';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(ini, cx, cy + r * 0.04);
    }
  }
  ctx.restore();
}

export function lighten(hex, amt) {
  const m = hex.replace('#', '').match(/^([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i);
  if (!m) return hex;
  const ch = m.slice(1).map((x) => Math.round(parseInt(x, 16) + (255 - parseInt(x, 16)) * amt));
  return `rgb(${ch.join(',')})`;
}

// Wallpaper or background fill (gradient / color / image).
export function fillBackdrop(ctx, spec, x, y, w, h, t = 0) {
  if (spec.type === 'image' && spec.mediaId) {
    const v = visual(spec.mediaId);
    if (v) {
      const bmp = frameAt(v, t);
      const s = Math.max(w / bmp.width, h / bmp.height);
      ctx.save();
      ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
      ctx.drawImage(bmp, x + (w - bmp.width * s) / 2, y + (h - bmp.height * s) / 2, bmp.width * s, bmp.height * s);
      ctx.restore();
      return;
    }
  }
  if (spec.type === 'green') { ctx.fillStyle = '#00FF00'; ctx.fillRect(x, y, w, h); return; }
  if (spec.type === 'color') { ctx.fillStyle = spec.color; ctx.fillRect(x, y, w, h); return; }
  const g = ctx.createLinearGradient(x, y, x + w * 0.4, y + h);
  g.addColorStop(0, spec.color);
  g.addColorStop(1, spec.color2 || spec.color);
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
}

// ---- status bar -------------------------------------------------------------------
export function statusBar(ctx, p, W, color, dev) {
  const st = p.status;
  const os = dev.os;
  const y = os === 'android' ? 20 : dev.safeTop === 59 ? 31 : 25;
  ctx.save();
  if (os === 'android') {
    text(ctx, st.time, 26, y + 6, 15, 500, color);
  } else {
    text(ctx, st.time, dev.safeTop === 59 ? 58 : 50, y + 7, 17, 600, color, 'center');
  }
  // right cluster: signal, wifi, battery
  let x = W - (os === 'android' ? 22 : 30);
  // battery
  const bw = os === 'android' ? 10 : 25, bh = os === 'android' ? 17 : 12;
  ctx.globalAlpha = 1;
  if (os === 'android') {
    const bx = x - bw, by = y - bh / 2 + 1;
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.35;
    fillRR(ctx, bx, by, bw, bh, 2, color);
    ctx.globalAlpha = 1;
    const fh = bh * (st.battery / 100);
    fillRR(ctx, bx, by + bh - fh, bw, fh, 2, color);
    fillRR(ctx, bx + 3, by - 2, 4, 2.5, 1, color);
    x = bx - 8;
  } else {
    const bx = x - bw, by = y - bh / 2 + 1;
    ctx.globalAlpha = 0.4;
    rr(ctx, bx, by, bw, bh, 3.6);
    ctx.lineWidth = 1;
    ctx.strokeStyle = color;
    ctx.stroke();
    fillRR(ctx, bx + bw + 1.5, by + 4, 1.6, 4, 1, color);
    ctx.globalAlpha = 1;
    const low = st.battery <= 20;
    fillRR(ctx, bx + 2, by + 2, Math.max(2, (bw - 4) * st.battery / 100), bh - 4, 2, low ? '#FF3B30' : color);
    x = bx - 7;
  }
  // wifi
  if (st.wifi) {
    const cx = x - 8, cy = y + 5;
    ctx.save();
    ctx.fillStyle = color;
    const a0 = -Math.PI * 0.75, a1 = -Math.PI * 0.25;
    for (const [ri, ro] of [[0, 3.4], [5.2, 7.9], [9.7, 12.4]]) {
      ctx.beginPath();
      ctx.arc(cx, cy, ro, a0, a1);
      if (ri > 0) ctx.arc(cx, cy, ri, a1, a0, true);
      else ctx.lineTo(cx, cy);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
    x = cx - 14;
  }
  // signal bars
  const bars = Math.max(0, Math.min(4, st.signal));
  for (let i = 3; i >= 0; i--) {
    const h = os === 'android' ? 4 + i * 3 : 4 + i * 2.6;
    ctx.globalAlpha = i < bars ? 1 : 0.3;
    fillRR(ctx, x - (3 - i) * 4.6 - 3, y + 6 - h, 3, h, 1, color);
  }
  ctx.globalAlpha = 1;
  if (st.carrier) text(ctx, st.carrier, x - 20, y + 6, 13, 500, color, 'right');
  ctx.restore();
}

export function homeIndicator(ctx, W, H, color, os) {
  if (os === 'android') fillRR(ctx, W / 2 - 54, H - 10, 108, 4, 2, color);
  else fillRR(ctx, W / 2 - 67, H - 9, 134, 5, 2.5, color);
}

// App icon used in banners and lock notifications.
export function appIcon(ctx, theme, x, y, s) {
  ctx.save();
  if (theme === 'phone') {
    const g = ctx.createLinearGradient(0, y, 0, y + s);
    g.addColorStop(0, '#67FF72'); g.addColorStop(1, '#0BBD27');
    rr(ctx, x, y, s, s, s * 0.23); ctx.fillStyle = g; ctx.fill();
    icon(ctx, 'phone', x + s / 2, y + s / 2, s * 0.58, '#FFFFFF');
  } else if (theme === 'whatsapp') {
    fillRR(ctx, x, y, s, s, s * 0.23, '#25D366');
    circle(ctx, x + s / 2, y + s / 2, s * 0.3, '#FFFFFF');
    circle(ctx, x + s / 2, y + s / 2, s * 0.24, '#25D366');
    icon(ctx, 'phone', x + s / 2, y + s / 2, s * 0.3, '#FFFFFF');
  } else if (theme === 'instagram') {
    const g = ctx.createLinearGradient(x, y + s, x + s, y);
    g.addColorStop(0, '#FEDA75'); g.addColorStop(0.35, '#FA7E1E'); g.addColorStop(0.6, '#D62976'); g.addColorStop(1, '#4F5BD5');
    rr(ctx, x, y, s, s, s * 0.23); ctx.fillStyle = g; ctx.fill();
    ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = s * 0.07;
    rr(ctx, x + s * 0.22, y + s * 0.22, s * 0.56, s * 0.56, s * 0.16); ctx.stroke();
    ctx.beginPath(); ctx.arc(x + s / 2, y + s / 2, s * 0.13, 0, Math.PI * 2); ctx.stroke();
    circle(ctx, x + s * 0.66, y + s * 0.34, s * 0.035, '#FFFFFF');
  } else if (theme === 'android') {
    fillRR(ctx, x, y, s, s, s / 2, '#0B57D0');
    icon(ctx, 'message', x + s / 2, y + s / 2 + s * 0.02, s * 0.56, '#FFFFFF');
  } else {
    const g = ctx.createLinearGradient(0, y, 0, y + s);
    g.addColorStop(0, '#67FF72'); g.addColorStop(1, '#0BBD27');
    rr(ctx, x, y, s, s, s * 0.23); ctx.fillStyle = g; ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.ellipse(x + s / 2, y + s * 0.47, s * 0.33, s * 0.27, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x + s * 0.3, y + s * 0.62);
    ctx.quadraticCurveTo(x + s * 0.28, y + s * 0.76, x + s * 0.2, y + s * 0.8);
    ctx.quadraticCurveTo(x + s * 0.38, y + s * 0.78, x + s * 0.45, y + s * 0.7);
    ctx.fill();
  }
  ctx.restore();
}

// Translucent touch dot (for showing taps and swipes in videos).
export function touchDot(ctx, x, y, alpha, pressed = 1) {
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha * 0.55;
  circle(ctx, x, y, 22 * (0.85 + 0.15 * pressed), 'rgba(140,140,140,0.75)');
  ctx.globalAlpha = alpha * 0.9;
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.beginPath(); ctx.arc(x, y, 22 * (0.85 + 0.15 * pressed), 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
}
