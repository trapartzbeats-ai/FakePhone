// On-screen keyboard (iOS or Gboard) with key presses driven by the timeline.
import { kbGeometry, kbHeight, KB_STYLE } from '../keys.js';
import { composeAt } from '../timeline.js';
import { font } from '../themes.js';
import { fillRR, icon } from './draw.js';

// What the keyboard shows at time t: layout, shift, and the key being pressed.
export function kbState(tl, t) {
  const cs = composeAt(tl, t);
  const st = { layout: 'abc', shift: false, pressed: null, age: 1 };
  if (!cs) return st;
  if (cs.last) { st.layout = cs.last.layout; st.pressed = cs.last.key; st.age = t - cs.last.t; }
  const nx = cs.next;
  if (nx) {
    const dt = nx.t - t;
    if (nx.layout && nx.layout !== st.layout) {
      if (dt < 0.12) st.layout = nx.layout;
      else if (dt < 0.24) { st.pressed = modeKey(st.layout, nx.layout, tl.kbStyle); st.age = 0.02; }
    }
    if (nx.shift) {
      if (dt < 0.2) st.shift = true;
      if (dt < 0.2 && dt > 0.1 && st.layout === 'abc') { st.pressed = 'shift'; st.age = 0.02; }
    }
  }
  if (st.pressed && st.pressed === cs.last?.key && cs.last?.shift && st.age < 0.1) st.shift = true;
  return st;
}

function modeKey(from, to, style) {
  if (to === 'abc') return 'ABC';
  if (style === 'gboard') return from === 'abc' ? '?123' : to === 'sym' ? '=\\<' : '?123';
  return from === 'abc' ? '123' : to === 'sym' ? '#+=' : '123';
}

export function drawKeyboard(ctx, R, y, t) {
  const { W, pal } = R;
  const style = R.tl.kbStyle;
  const S = KB_STYLE[style];
  const k = pal.kb;
  const h = kbHeight(style) + (style === 'gboard' ? R.dev.safeBottom : 0);
  ctx.save();
  ctx.translate(0, y);
  ctx.fillStyle = k.bg;
  ctx.fillRect(0, 0, W, h + 40);
  const st = kbState(R.tl, t);
  const keys = kbGeometry(style, st.layout, W);
  const pressedKey = st.age < 0.11 ? st.pressed : null;
  const ios = style === 'ios';

  if (!ios) {
    // Gboard suggestion strip icons
    const iy = 23;
    const icons = ['emoji', 'sticker', 'image', 'more', 'mic'];
    icons.forEach((n, i) => icon(ctx, n, 30 + i * ((W - 60) / (icons.length - 1)), iy, 20, k.label + '99'));
  }

  for (const key of keys) {
    const pressed = pressedKey && (key.label === pressedKey || (key.kind === 'char' && key.label === pressedKey));
    const special = key.kind !== 'char' && key.kind !== 'space';
    let fill = special ? k.special : k.key;
    if (ios && key.kind === 'shift' && st.shift) fill = k.key;
    if (pressed && ios) fill = special ? k.key : key.kind === 'space' ? k.special : fill;
    if (pressed && !ios) fill = k.special;
    if (!ios && key.kind === 'return') fill = k.accent;
    if (ios) {
      fillRR(ctx, key.x, key.y + 1, key.w, key.h, S.radius, k.shadow);
    }
    fillRR(ctx, key.x, key.y, key.w, key.h, S.radius, fill);
    const cx = key.x + key.w / 2, cy = key.y + key.h / 2;
    const lc = k.label;
    ctx.fillStyle = lc;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (key.kind === 'char') {
      const label = st.shift && st.layout === 'abc' ? key.label.toUpperCase() : key.label;
      ctx.font = font(ios ? 23 : 22, ios ? 300 : 400);
      ctx.fillText(label, cx, cy + (ios ? -1 : 0));
    } else if (key.kind === 'shift') {
      shiftGlyph(ctx, cx, cy, ios ? 20 : 19, lc, st.shift);
    } else if (key.kind === 'del') {
      delGlyph(ctx, cx, cy, ios ? 24 : 22, lc);
    } else if (key.kind === 'space') {
      if (ios) { ctx.font = font(16, 400); ctx.fillText('space', cx, cy); }
    } else if (key.kind === 'return') {
      if (ios) { ctx.font = font(16, 400); ctx.fillText('return', cx, cy); }
      else icon(ctx, 'send', cx, cy, 20, k.accentLabel);
    } else if (key.kind === 'emoji') {
      icon(ctx, 'emoji', cx, cy, 20, lc);
    } else {
      ctx.font = font(ios ? 16 : 15, 400);
      ctx.fillText(key.label.replace('\\', '\\'), cx, cy);
    }
  }

  if (ios) {
    const by = S.top + 4 * S.keyH + 3 * S.rowGap + 26;
    icon(ctx, 'emoji', 34, by, 28, k.label + 'cc');
    icon(ctx, 'mic', W - 34, by, 26, k.label + 'cc');
  }

  // Key popup balloon for pressed character keys.
  if (pressedKey && st.age < 0.11) {
    const key = keys.find((kk) => kk.kind === 'char' && kk.label === pressedKey);
    if (key) {
      const label = st.shift && st.layout === 'abc' ? key.label.toUpperCase() : key.label;
      if (ios) balloonIOS(ctx, key, label, k, W);
      else balloonGboard(ctx, key, label, k);
    }
  }
  ctx.restore();
}

function balloonIOS(ctx, key, label, k, W) {
  const bw = key.w * 1.55, bh = key.h * 1.2;
  let bx = key.x + key.w / 2 - bw / 2;
  bx = Math.max(1, Math.min(W - bw - 1, bx));
  const by = key.y - bh + 6;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.3)';
  ctx.shadowBlur = 6;
  ctx.shadowOffsetY = 1;
  ctx.fillStyle = k.pop;
  ctx.beginPath();
  ctx.roundRect(bx, by, bw, bh, 9);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.beginPath();
  ctx.roundRect(key.x, key.y - 8, key.w, key.h + 8, [0, 0, 5, 5]);
  ctx.fill();
  // neck between the balloon and the key
  ctx.beginPath();
  ctx.moveTo(bx, by + bh - 6);
  ctx.quadraticCurveTo(key.x, by + bh + 2, key.x, key.y + 6);
  ctx.lineTo(key.x + key.w, key.y + 6);
  ctx.quadraticCurveTo(key.x + key.w, by + bh + 2, bx + bw, by + bh - 6);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = k.label;
  ctx.font = font(34, 300);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, bx + bw / 2, by + bh / 2 - 2);
  ctx.restore();
}

function balloonGboard(ctx, key, label, k) {
  const bw = key.w * 1.1, bh = key.h * 1.15;
  const bx = key.x + key.w / 2 - bw / 2, by = key.y - bh - 4;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.25)';
  ctx.shadowBlur = 8;
  fillRR(ctx, bx, by, bw, bh, 10, k.key);
  ctx.restore();
  ctx.fillStyle = k.label;
  ctx.font = font(28, 400);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, bx + bw / 2, by + bh / 2);
}

function shiftGlyph(ctx, cx, cy, s, color, on) {
  ctx.save();
  ctx.beginPath();
  const h = s / 2, w = s * 0.48, sw = s * 0.22;
  ctx.moveTo(cx, cy - h);
  ctx.lineTo(cx + w, cy);
  ctx.lineTo(cx + sw, cy);
  ctx.lineTo(cx + sw, cy + h * 0.85);
  ctx.lineTo(cx - sw, cy + h * 0.85);
  ctx.lineTo(cx - sw, cy);
  ctx.lineTo(cx - w, cy);
  ctx.closePath();
  ctx.lineJoin = 'round';
  if (on) { ctx.fillStyle = color; ctx.fill(); }
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.6;
  ctx.stroke();
  ctx.restore();
}

function delGlyph(ctx, cx, cy, s, color) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.6;
  ctx.lineJoin = 'round';
  const w = s, h = s * 0.68;
  const x = cx - w / 2, y = cy - h / 2;
  ctx.beginPath();
  ctx.moveTo(x + w * 0.3, y);
  ctx.lineTo(x + w, y);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x + w * 0.3, y + h);
  ctx.lineTo(x, cy);
  ctx.closePath();
  ctx.stroke();
  const xc = x + w * 0.63, d = h * 0.22;
  ctx.beginPath();
  ctx.moveTo(xc - d, cy - d); ctx.lineTo(xc + d, cy + d);
  ctx.moveTo(xc + d, cy - d); ctx.lineTo(xc - d, cy + d);
  ctx.stroke();
  ctx.restore();
}

