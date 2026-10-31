// Stage compositor: background, phone body, the active screen (with transitions), call overlay,
// banners, status bar, hardware cutout and captions. One call draws one frame at time t.
import { palette, DEVICES, THEMES, setFonts, font } from '../themes.js';
import { screenAt, callAt } from '../timeline.js';
import { lin, val } from '../motion.js';
import { STYLE, drawChat } from './chat.js';
import { drawInbox, drawLock, drawBanners, drawCall } from './screens.js';
import { drawScreenFx } from './effects.js';
import { cameraAt } from './camera.js';
import { statusBar, homeIndicator, fillBackdrop, rr, wrap, fillRR } from './draw.js';
import { clamp, lerp } from '../util.js';

export function geometry(p, SW, SH) {
  const W = 390;
  if (p.layout === 'screen') {
    const s = SW / W;
    return { W, H: SH / s, s, ox: 0, oy: 0, framed: false };
  }
  const dev = DEVICES[p.device];
  const H = 844;
  const bez = dev.os === 'android' ? 10 : 13;
  const bodyH = SH * 0.9;
  const s = bodyH / (H + bez * 2);
  const bodyW = (W + bez * 2) * s;
  const bx = (SW - bodyW) / 2, by = (SH - bodyH) / 2;
  return { W, H, s, ox: bx + bez * s, oy: by + bez * s, framed: true, bez, bx, by, bodyW, bodyH };
}

export function renderFrame(ctx, p, tl, t) {
  const SW = ctx.canvas.width, SH = ctx.canvas.height;
  setFonts(p);
  const g = geometry(p, SW, SH);
  const pal = palette(p);
  const dev = DEVICES[p.device];
  const R = {
    p, tl, pal, dev, theme: THEMES[p.theme] || THEMES.imessage, fam: pal.family, S: STYLE[pal.family],
    W: g.W, H: g.H, group: p.chat.members.length > 1,
    sig: `${p.theme}|${p.device}|${g.W}|${p.chat.members.length > 1}|${p.emojiStyle}`,
  };
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, SW, SH);
  const cam = cameraAt(ctx, R, t, g, SW, SH);
  // unzoomed backdrop first so a shake never shows empty edges
  if (g.framed) fillBackdrop(ctx, p.background, 0, 0, SW, SH, t);
  else { ctx.fillStyle = pal.bg; ctx.fillRect(0, 0, SW, SH); }
  if (cam) {
    ctx.translate(SW / 2 + cam.dx, SH / 2 + cam.dy);
    ctx.rotate(cam.rot);
    ctx.scale(cam.Z, cam.Z);
    ctx.translate(-cam.cx, -cam.cy);
    if (g.framed) fillBackdrop(ctx, p.background, 0, 0, SW, SH, t);
  }
  if (g.framed) drawBody(ctx, g, dev);
  ctx.save();
  ctx.translate(g.ox, g.oy);
  ctx.scale(g.s, g.s);
  ctx.beginPath();
  ctx.roundRect(0, 0, g.W, g.H, g.framed ? dev.radius : 0);
  ctx.clip();
  drawScreen(ctx, R, t);
  drawCutout(ctx, R);
  ctx.restore();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (p.captions) drawCaptions(ctx, tl, t, SW, SH, g);
  ctx.restore();
}

function drawOne(ctx, R, name, t) {
  if (name === 'inbox') drawInbox(ctx, R, t);
  else if (name === 'lock') drawLock(ctx, R, t);
  else drawChat(ctx, R, t);
}

function drawScreen(ctx, R, t) {
  const { W, H, pal, tl, dev } = R;
  const sc = screenAt(tl, t);
  let top = sc.to;
  if (sc.t < 0 || sc.k >= 1) drawOne(ctx, R, sc.to, t);
  else {
    const e = tl.mo.screen.f(sc.k);
    const { from, to } = sc;
    if (to === 'lock') {
      if (sc.k < 0.45) { drawOne(ctx, R, from, t); shadeRect(ctx, W, H, sc.k / 0.45); top = from; }
      else { drawOne(ctx, R, to, t); shadeRect(ctx, W, H, 1 - (sc.k - 0.45) / 0.55); }
    } else if (from === 'lock') {
      drawOne(ctx, R, to, t);
      ctx.save();
      ctx.translate(0, -H * e);
      ctx.globalAlpha = 1 - e * 0.4;
      drawOne(ctx, R, 'lock', t);
      ctx.restore();
      top = e < 0.5 ? 'lock' : to;
    } else {
      const push = to === 'chat';
      const under = push ? from : to, over = push ? to : from;
      const k = push ? e : 1 - e;           // how far "over" has slid in
      ctx.save();
      ctx.translate(-W * 0.3 * k, 0);
      drawOne(ctx, R, under, t);
      shadeRect(ctx, W, H, 0.12 * k);
      ctx.restore();
      ctx.save();
      ctx.translate(W * (1 - k), 0);
      ctx.shadowColor = 'rgba(0,0,0,0.18)';
      ctx.shadowBlur = 20;
      ctx.fillStyle = pal.bg;
      ctx.fillRect(0, 0, W, H);
      ctx.shadowColor = 'transparent';
      drawOne(ctx, R, over, t);
      ctx.restore();
      top = k > 0.5 ? over : under;
    }
  }

  if (sc.to === 'chat') drawScreenFx(ctx, R, t);

  // call overlay
  const c = callAt(tl, t);
  let callA = 0;
  if (c) {
    callA = clamp(val(tl.mo.call, t, c.t0), 0, 1);
    if (t > c.tBack) callA *= 1 - lin(tl.mo.call, t, c.tBack);
    if (callA > 0) {
      ctx.save();
      ctx.globalAlpha = callA;
      const s = lerp(1.06, 1, callA);
      ctx.translate(W / 2, H / 2); ctx.scale(s, s); ctx.translate(-W / 2, -H / 2);
      drawCall(ctx, R, c, t);
      ctx.restore();
    }
  }

  drawBanners(ctx, R, t);

  // status bar + home indicator
  let light;
  if (callA > 0.5 || top === 'lock') light = true;
  else if (top === 'chat') light = pal.dark || (R.fam === 'whatsapp' && pal.os === 'android');
  else light = pal.dark || (R.fam === 'whatsapp' && pal.os === 'android');
  statusBar(ctx, R.p, W, light ? '#FFFFFF' : '#000000', dev);
  const homeLight = callA > 0.5 || top === 'lock' || pal.dark;
  homeIndicator(ctx, W, H, homeLight ? '#FFFFFF' : '#000000', dev.os);
}

function shadeRect(ctx, W, H, a) {
  if (a <= 0) return;
  ctx.fillStyle = `rgba(0,0,0,${clamp(a, 0, 1)})`;
  ctx.fillRect(0, 0, W, H);
}

function drawCutout(ctx, R) {
  const { W, p } = R;
  ctx.fillStyle = '#000000';
  if (p.device === 'island') fillRR(ctx, W / 2 - 62, 11, 124, 36, 18, '#000000');
  else if (p.device === 'notch') {
    ctx.beginPath();
    const w = 160, h = 32, x = W / 2 - w / 2;
    ctx.moveTo(x - 8, 0);
    ctx.quadraticCurveTo(x, 0, x, 8);
    ctx.lineTo(x, h - 18);
    ctx.quadraticCurveTo(x, h, x + 18, h);
    ctx.lineTo(x + w - 18, h);
    ctx.quadraticCurveTo(x + w, h, x + w, h - 18);
    ctx.lineTo(x + w, 8);
    ctx.quadraticCurveTo(x + w, 0, x + w + 8, 0);
    ctx.closePath();
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.arc(W / 2, 19, 6.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

// Phone body: drop shadow, metal band, black bezel, side buttons.
function drawBody(ctx, g, dev) {
  const { bx, by, bodyW, bodyH, s } = g;
  const outerR = (dev.radius + g.bez) * s;
  const android = dev.os === 'android';
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = 60;
  ctx.shadowOffsetY = 24;
  rr(ctx, bx, by, bodyW, bodyH, outerR);
  ctx.fillStyle = '#1a1a1d';
  ctx.fill();
  ctx.restore();
  // side buttons
  const btn = (x, y, w, h) => {
    const gr = ctx.createLinearGradient(x, 0, x + w, 0);
    gr.addColorStop(0, '#3a3a40'); gr.addColorStop(0.5, '#6d6d75'); gr.addColorStop(1, '#2c2c31');
    rr(ctx, x, y, w, h, Math.min(w, h) / 2);
    ctx.fillStyle = gr;
    ctx.fill();
  };
  const bw = 4.5 * s;
  if (android) {
    btn(bx + bodyW - bw * 0.4, by + bodyH * 0.2, bw, 70 * s);
    btn(bx + bodyW - bw * 0.4, by + bodyH * 0.34, bw, 42 * s);
  } else {
    btn(bx - bw * 0.6, by + bodyH * 0.16, bw, 28 * s);
    btn(bx - bw * 0.6, by + bodyH * 0.24, bw, 52 * s);
    btn(bx - bw * 0.6, by + bodyH * 0.32, bw, 52 * s);
    btn(bx + bodyW - bw * 0.4, by + bodyH * 0.26, bw, 84 * s);
  }
  // metal band
  const band = ctx.createLinearGradient(bx, by, bx + bodyW, by + bodyH);
  const metal = android ? ['#2b2d31', '#55585f', '#1e2023', '#4a4d54'] : ['#5b5a5f', '#a9a8ad', '#3e3d42', '#8f8e94'];
  metal.forEach((c, i) => band.addColorStop(i / (metal.length - 1), c));
  rr(ctx, bx, by, bodyW, bodyH, outerR);
  ctx.fillStyle = band;
  ctx.fill();
  const inset = 2.2 * s;
  rr(ctx, bx + inset, by + inset, bodyW - inset * 2, bodyH - inset * 2, outerR - inset);
  ctx.fillStyle = '#050506';
  ctx.fill();
}

function drawCaptions(ctx, tl, t, SW, SH, g) {
  const cap = tl.captions.find((c) => t >= c.t0 && t < c.t1 + 0.15);
  if (!cap) return;
  const a = clamp((t - cap.t0) / 0.12, 0, 1) * clamp((cap.t1 + 0.15 - t) / 0.15, 0, 1);
  ctx.save();
  ctx.globalAlpha = a;
  ctx.font = font(62, 800);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const lines = wrap(ctx, cap.text, SW - 180).slice(0, 3);
  const lh = 74;
  const y0 = (g.framed ? SH * 0.74 : SH * 0.7) - ((lines.length - 1) * lh) / 2;
  ctx.lineJoin = 'round';
  ctx.lineWidth = 12;
  ctx.strokeStyle = 'rgba(0,0,0,0.92)';
  ctx.fillStyle = '#FFFFFF';
  lines.forEach((l, i) => { ctx.strokeText(l, SW / 2, y0 + i * lh); ctx.fillText(l, SW / 2, y0 + i * lh); });
  ctx.restore();
}
