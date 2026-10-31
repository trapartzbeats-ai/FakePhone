// iMessage-style screen effects drawn over the chat. All particles come from seeded random numbers,
// so any frame renders the same way every time (scrubbing, export).
import { clamp, lerp, ease, easeBack, rnd, hashInt } from '../util.js';
import { chatGeometry, drawBubbleCopy } from './chat.js';
import { circle } from './draw.js';

const COLORS = ['#FF2D55', '#FF9500', '#FFCC00', '#34C759', '#5AC8FA', '#0A84FF', '#AF52DE', '#FF3B30'];

export function drawScreenFx(ctx, R, t) {
  for (const fx of R.tl.fx) {
    const age = t - fx.t0;
    if (age < 0 || age > fx.dur) continue;
    const g = chatGeometry(ctx, R, t);
    const v = g.byEvent[fx.evId] || null;
    const rect = v ? { x: v.x, y: v.by, w: v.m.w, h: v.m.h } : { x: R.W / 2 - 60, y: R.H / 2 - 20, w: 120, h: 40 };
    const fade = clamp((fx.dur - age) / 0.5, 0, 1);
    ctx.save();
    EFFECTS[fx.kind]?.({ ctx, R, W: R.W, H: R.H, age, dur: fx.dur, fade, seed: hashInt(fx.evId), rect, v, t });
    ctx.restore();
  }
}

function overlay(ctx, W, H, a) {
  if (a <= 0) return;
  ctx.fillStyle = `rgba(0,0,0,${a})`;
  ctx.fillRect(0, 0, W, H);
}

function heart(ctx, cx, cy, s) {
  ctx.beginPath();
  ctx.moveTo(cx, cy + s * 0.9);
  ctx.bezierCurveTo(cx - s * 1.6, cy - s * 0.1, cx - s * 0.75, cy - s * 1.25, cx, cy - s * 0.45);
  ctx.bezierCurveTo(cx + s * 0.75, cy - s * 1.25, cx + s * 1.6, cy - s * 0.1, cx, cy + s * 0.9);
  ctx.closePath();
}

function star(ctx, x, y, r) {
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    const rr = i % 2 ? r * 0.28 : r;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
}

const EFFECTS = {
  confetti({ ctx, W, H, age, fade, seed }) {
    for (let i = 0; i < 150; i++) {
      const r1 = rnd(seed + i), r2 = rnd(seed + i * 3 + 1), r3 = rnd(seed + i * 7 + 2), r4 = rnd(seed + i * 11 + 3);
      const a = age - r1 * 0.9;
      if (a < 0) continue;
      const y = -20 - r4 * 60 + a * (170 + r3 * 140) + 20 * a * a;
      if (y > H + 20) continue;
      const x = r2 * W + Math.sin(a * (2 + r4 * 3) + r1 * 6) * (14 + r4 * 18);
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.translate(x, y);
      ctx.rotate(a * (3 + r3 * 6) + r1 * 6);
      ctx.scale(1, Math.cos(a * (5 + r2 * 6) + r4 * 5));
      ctx.fillStyle = COLORS[i % COLORS.length];
      ctx.fillRect(-3.5, -5, 7, 10);
      ctx.restore();
    }
  },

  balloons({ ctx, W, H, age, fade, seed }) {
    for (let i = 0; i < 11; i++) {
      const r1 = rnd(seed + i), r2 = rnd(seed + i * 5 + 1), r3 = rnd(seed + i * 9 + 2), r4 = rnd(seed + i * 13 + 3);
      const a = age - r1 * 0.9;
      if (a < 0) continue;
      const rx = 26 + r4 * 7, ry = rx * 1.2;
      const x = 24 + r2 * (W - 48) + Math.sin(a * 1.6 + r3 * 6) * 12;
      const y = H + ry + 40 - a * (240 + r3 * 130);
      if (y < -ry - 120) continue;
      const col = COLORS[(i * 3) % COLORS.length];
      ctx.globalAlpha = fade;
      ctx.strokeStyle = 'rgba(0,0,0,0.28)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y + ry + 4);
      ctx.bezierCurveTo(x + 10, y + ry + 30, x - 10, y + ry + 55, x + 4, y + ry + 85);
      ctx.stroke();
      const gr = ctx.createRadialGradient(x - rx * 0.35, y - ry * 0.4, 2, x, y, ry * 1.1);
      gr.addColorStop(0, 'rgba(255,255,255,0.85)');
      gr.addColorStop(0.18, col);
      gr.addColorStop(1, col);
      ctx.fillStyle = gr;
      ctx.beginPath();
      ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(x - 4, y + ry + 5); ctx.lineTo(x + 4, y + ry + 5); ctx.lineTo(x, y + ry - 1);
      ctx.fill();
    }
  },

  fireworks({ ctx, W, H, age, fade, seed }) {
    overlay(ctx, W, H, 0.62 * Math.min(1, age / 0.3) * fade);
    ctx.globalCompositeOperation = 'lighter';
    for (let b = 0; b < 5; b++) {
      const a = age - b * 0.45;
      if (a < 0) continue;
      const bx = 60 + rnd(seed + b * 17) * (W - 120), by = 120 + rnd(seed + b * 29) * H * 0.42;
      const col = COLORS[(b * 2 + 1) % COLORS.length];
      if (a < 0.35) {
        const k = a / 0.35;
        const ry = lerp(H + 10, by, ease(k));
        ctx.fillStyle = 'rgba(255,240,200,0.9)';
        ctx.fillRect(bx - 1, ry, 2, 14);
        continue;
      }
      const e = a - 0.35;
      if (e > 1.5) continue;
      const alpha = (1 - e / 1.5) * fade;
      for (let j = 0; j < 46; j++) {
        const ang = (j / 46) * Math.PI * 2 + rnd(seed + b * 101 + j) * 0.2;
        const sp = 90 + rnd(seed + b * 211 + j) * 70;
        const d = sp * e * (1 - e * 0.28);
        const px = bx + Math.cos(ang) * d, py = by + Math.sin(ang) * d + 48 * e * e;
        ctx.globalAlpha = alpha * 0.35;
        circle(ctx, px, py, 5, col);
        ctx.globalAlpha = alpha;
        circle(ctx, px, py, 1.8, '#FFFFFF');
      }
    }
  },

  love({ ctx, W, H, age, dur, fade, rect }) {
    const k = easeBack(clamp(age / 0.65, 0, 1));
    const travel = ease(clamp(age / 0.9, 0, 1));
    const cx = lerp(rect.x + rect.w / 2, W / 2, travel);
    const cy = lerp(rect.y + rect.h / 2, H * 0.44, travel);
    const pulse = age > 0.65 ? 1 + 0.05 * Math.sin((age - 0.65) * 9) : 1;
    const s = 92 * k * pulse * (age > dur - 0.5 ? 1 + (age - (dur - 0.5)) * 0.6 : 1);
    if (s <= 0) return;
    ctx.globalAlpha = fade;
    const gr = ctx.createLinearGradient(cx, cy - s, cx, cy + s);
    gr.addColorStop(0, '#FF6A88');
    gr.addColorStop(1, '#FF1F4B');
    ctx.fillStyle = gr;
    ctx.shadowColor = 'rgba(255,31,75,0.5)';
    ctx.shadowBlur = 30;
    heart(ctx, cx, cy, s);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.globalAlpha = fade * 0.45;
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.ellipse(cx - s * 0.62, cy - s * 0.55, s * 0.22, s * 0.12, -0.6, 0, Math.PI * 2);
    ctx.fill();
  },

  lasers({ ctx, W, H, age, fade }) {
    const a = Math.min(1, age / 0.3) * fade;
    overlay(ctx, W, H, 0.8 * a);
    ctx.globalCompositeOperation = 'lighter';
    const origins = [[W / 2, -10, Math.PI / 2], [-10, H * 0.25, 0.2], [W + 10, H * 0.25, Math.PI - 0.2]];
    origins.forEach(([ox, oy, base], o) => {
      for (let i = 0; i < 6; i++) {
        const ang = base + Math.sin(age * (1.4 + o * 0.3) + i * 0.8 + o) * 0.85;
        const hue = (i * 50 + age * 140 + o * 90) % 360;
        const ex = ox + Math.cos(ang) * 1200, ey = oy + Math.sin(ang) * 1200;
        ctx.globalAlpha = a * 0.22;
        ctx.strokeStyle = `hsl(${hue},100%,60%)`;
        ctx.lineWidth = 10;
        ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(ex, ey); ctx.stroke();
        ctx.globalAlpha = a;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(ex, ey); ctx.stroke();
      }
    });
  },

  celebration({ ctx, W, H, age, fade, seed }) {
    overlay(ctx, W, H, 0.35 * Math.min(1, age / 0.3) * fade);
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 110; i++) {
      const a = age - rnd(seed + i) * 1.4;
      if (a < 0 || a > 1.5) continue;
      const ang = Math.PI * 0.55 + rnd(seed + i * 3) * 0.75;
      const sp = 180 + rnd(seed + i * 5) * 260;
      const x = W + 10 + Math.cos(ang) * sp * a, y = -10 + Math.sin(ang) * sp * a + 40 * a * a;
      const tw = 0.5 + 0.5 * Math.sin(age * 18 + i);
      ctx.globalAlpha = (1 - a / 1.5) * fade * tw;
      ctx.fillStyle = i % 3 ? '#FFD86B' : '#FFF6D5';
      star(ctx, x, y, 3 + rnd(seed + i * 7) * 5);
    }
  },

  spotlight({ ctx, W, H, age, fade, rect }) {
    const a = Math.min(1, age / 0.4) * fade;
    const cx = rect.x + rect.w / 2 + Math.sin(age * 1.4) * 8, cy = rect.y + rect.h / 2 + Math.cos(age * 1.1) * 5;
    const r = Math.max(rect.w, rect.h) * 0.62 + 24;
    const gr = ctx.createRadialGradient(cx, cy, r * 0.7, cx, cy, r * 1.35);
    gr.addColorStop(0, 'rgba(0,0,0,0)');
    gr.addColorStop(1, `rgba(0,0,0,${0.82 * a})`);
    ctx.fillStyle = gr;
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.07 * a;
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.moveTo(cx - 18, -20); ctx.lineTo(cx + 18, -20); ctx.lineTo(cx + r, cy); ctx.lineTo(cx - r, cy);
    ctx.fill();
  },

  echo({ ctx, R, W, H, age, dur, fade, seed, rect, v, t }) {
    if (!v) return;
    for (let i = 0; i < 24; i++) {
      const a = age - i * 0.045;
      if (a < 0) continue;
      const k = ease(clamp(a / 0.9, 0, 1));
      const ex = rnd(seed + i * 3) * W, ey = 60 + rnd(seed + i * 7) * (H - 160);
      const x = lerp(rect.x + rect.w / 2, ex, k), y = lerp(rect.y + rect.h / 2, ey, k);
      const sc = lerp(1, 0.45 + rnd(seed + i * 11) * 0.9, k);
      ctx.save();
      ctx.globalAlpha = fade * clamp(1 - a / dur, 0, 1) * 0.92;
      ctx.translate(x, y);
      ctx.scale(sc, sc);
      drawBubbleCopy(ctx, R, v, -rect.w / 2, -rect.h / 2, t);
      ctx.restore();
    }
  },
};
