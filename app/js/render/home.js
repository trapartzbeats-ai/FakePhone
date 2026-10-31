// Home screen: wallpaper, app icons with labels and red badges, dock, and the finger tap that opens an app.
// iPhone looks like the iOS home screen (4 columns + dock + search pill), Android like a Pixel launcher
// (5 columns, round icons, date widget, search bar).
import { font } from '../themes.js';
import { clamp, lerp, ease, easeBack } from '../util.js';
import { fillRR, circle, icon, fillBackdrop, touchDot, ellipsize } from './draw.js';
import { drawApp } from './appicons.js';

const MAX_ICONS = 24;

// Where every icon sits (screen coordinates), shared by the drawing and the open-app animation.
export function homeLayout(R) {
  const { W, H, dev, p } = R;
  const android = dev.os === 'android';
  const grid = (p.home?.apps || []).slice(0, MAX_ICONS);
  const dockApps = (p.home?.dock || []).slice(0, 4);
  const L = { android, icons: [], dock: [], dockRect: null, search: null };
  if (!android) {
    const S = 60, mx = 27, pitch = (W - 2 * mx - S) / 3, top = dev.safeTop + 22, rowH = 97;
    grid.forEach((a, i) => L.icons.push({ a, x: mx + (i % 4) * pitch, y: top + Math.floor(i / 4) * rowH, s: S }));
    const dockH = 92, dockY = H - dockH - 12;
    L.dockRect = [10, dockY, W - 20, dockH, 35];
    dockApps.forEach((a, i) => L.dock.push({ a, x: mx + i * pitch, y: dockY + 16, s: S }));
    L.search = [W / 2 - 42, dockY - 50, 84, 34];
  } else {
    const S = 52, mx = 16, pitch = (W - 2 * mx - S) / 4, top = dev.safeTop + 118, rowH = 88;
    grid.forEach((a, i) => L.icons.push({ a, x: mx + (i % 5) * pitch, y: top + Math.floor(i / 5) * rowH, s: S }));
    const dp = 84, dy = H - 168;
    dockApps.forEach((a, i) => L.dock.push({ a, x: W / 2 + (i - (dockApps.length - 1) / 2) * dp - S / 2, y: dy, s: S }));
    L.search = [14, H - 96, W - 28, 52];
  }
  return L;
}

// The icon an app opens from / closes into (or the middle of the screen if it is not on the home screen).
export function homeIconRect(R, appId) {
  const L = homeLayout(R);
  const it = [...L.icons, ...L.dock].find((i) => i.a.id === appId);
  return it ? { x: it.x, y: it.y, s: it.s, round: L.android, found: true } : { x: R.W / 2 - 30, y: R.H * 0.5, s: 60, round: L.android, found: false };
}

// Red badge count for an icon at time t: the number set on the icon, raised by notifications that arrive.
function badgeAt(tl, a, t) {
  let n = a.badge || 0, since = -9;
  for (const b of tl.badges) if (b.key === a.app && b.t <= t) { n = b.n; since = b.t; }
  return { n, age: t - since };
}

export function drawHome(ctx, R, t) {
  const { W, H, p, dev, tl } = R;
  const L = homeLayout(R);
  const android = L.android;
  fillBackdrop(ctx, p.home?.wallpaper || p.wallpaper, 0, 0, W, H, t);
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, 'rgba(0,0,0,0.16)'); g.addColorStop(0.5, 'rgba(0,0,0,0.04)'); g.addColorStop(1, 'rgba(0,0,0,0.22)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  if (android) {
    // at-a-glance widget: short date + weather
    const m = (p.status.date || 'Friday, October 31').match(/([A-Za-z]{3})[a-z]*,?\s+([A-Za-z]{3})[a-z]*\s+(\d{1,2})/);
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#FFFFFF';
    ctx.font = font(34, 400);
    ctx.fillText(m ? `${m[1]}, ${m[2]} ${m[3]}` : (p.status.date || ''), 26, dev.safeTop + 62);
    ctx.font = font(15, 400);
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fillText('☀︎  72°F  •  Sunny', 28, dev.safeTop + 88);
  }

  // the finger tapping an icon (opens an app)
  const tap = tl.taps.find((x) => t >= x.t0 && t <= x.t0 + 0.75);
  const tapU = tap ? (t - tap.t0) / 0.7 : -1;
  const pressed = tap ? clamp((tapU - 0.38) / 0.08, 0, 1) * (1 - clamp((tapU - 0.78) / 0.1, 0, 1)) : 0;

  const drawIcon = (it) => {
    const down = tap && tap.app === it.a.id ? pressed : 0;
    const sc = 1 - 0.1 * down;
    const cx = it.x + it.s / 2, cy = it.y + it.s / 2;
    ctx.save();
    ctx.translate(cx, cy); ctx.scale(sc, sc); ctx.translate(-cx, -cy);
    if (down) { ctx.shadowColor = 'rgba(0,0,0,0.25)'; ctx.shadowBlur = 6; }
    drawApp(ctx, it.a, it.x, it.y, it.s, p, { round: android });
    ctx.restore();
    if (down) { ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.beginPath(); if (android) ctx.arc(cx, cy, it.s / 2 * sc, 0, Math.PI * 2); else ctx.roundRect(cx - it.s * sc / 2, cy - it.s * sc / 2, it.s * sc, it.s * sc, it.s * sc * 0.225); ctx.fill(); }
    return { cx, cy };
  };
  const label = (it, shadow) => {
    if (p.home?.labels === false || !it.a.name) return;
    ctx.save();
    ctx.font = font(android ? 11.5 : 12, android ? 400 : 500);
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#FFFFFF';
    if (shadow) { ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 3; ctx.shadowOffsetY = 1; }
    ctx.fillText(ellipsize(ctx, it.a.name, (android ? 72 : 82)), it.x + it.s / 2, it.y + it.s + (android ? 17 : 17));
    ctx.restore();
  };
  const badge = (it) => {
    const { n, age } = badgeAt(tl, it.a, t);
    if (!n) return;
    const k = age < 0.4 ? easeBack(age / 0.4) : 1;
    const txt = n > 99 ? '99+' : String(n);
    ctx.save();
    ctx.font = font(14, 600);
    const w = Math.max(24, ctx.measureText(txt).width + 12);
    const bx = it.x + it.s - (android ? 8 : 6), by = it.y + (android ? 8 : 6);
    ctx.translate(bx, by); ctx.scale(k, k);
    fillRR(ctx, -w / 2, -12, w, 24, 12, '#FF3B30');
    ctx.fillStyle = '#FFFFFF'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(txt, 0, 0.5);
    ctx.restore();
  };

  let tapAt = null;
  for (const it of L.icons) { const c = drawIcon(it); if (tap && tap.app === it.a.id) tapAt = c; label(it, true); badge(it); }

  // dock
  if (!android) {
    const [dx, dy, dw, dh, dr] = L.dockRect;
    fillRR(ctx, dx, dy, dw, dh, dr, 'rgba(255,255,255,0.27)');
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 0.7;
    ctx.beginPath(); ctx.roundRect(dx + 0.35, dy + 0.35, dw - 0.7, dh - 0.7, dr); ctx.stroke();
    // search pill
    const [sx, sy, sw, sh] = L.search;
    fillRR(ctx, sx, sy, sw, sh, sh / 2, 'rgba(255,255,255,0.22)');
    icon(ctx, 'search', sx + 20, sy + sh / 2, 15, 'rgba(255,255,255,0.92)');
    ctx.font = font(13.5, 500); ctx.fillStyle = 'rgba(255,255,255,0.95)'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText('Search', sx + 31, sy + sh / 2 + 0.5);
  } else {
    const [sx, sy, sw, sh] = L.search;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.25)'; ctx.shadowBlur = 10; ctx.shadowOffsetY = 2;
    fillRR(ctx, sx, sy, sw, sh, sh / 2, 'rgba(244,246,250,0.96)');
    ctx.restore();
    ctx.font = font(24, 600); ctx.fillStyle = '#4285F4'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('G', sx + 30, sy + sh / 2 + 1);
    icon(ctx, 'mic', sx + sw - 62, sy + sh / 2, 22, '#5F6368');
    icon(ctx, 'camera', sx + sw - 28, sy + sh / 2, 22, '#5F6368');
  }
  for (const it of L.dock) { const c = drawIcon(it); if (tap && tap.app === it.a.id) tapAt = c; if (android) label(it, true); badge(it); }

  if (tap && p.showTouches !== false && tapAt) {
    const e = ease(clamp(tapU / 0.4, 0, 1));
    const a = clamp(tapU * 5, 0, 1) * (1 - clamp((tapU - 0.86) / 0.14, 0, 1));
    touchDot(ctx, tapAt.cx, tapAt.cy + lerp(46, 0, e), a, pressed);
  }
}
