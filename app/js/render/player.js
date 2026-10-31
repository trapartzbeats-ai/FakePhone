// Full-screen video player: a finger taps a video bubble, the bubble grows into a black player with the video
// centred, a progress bar and Done / back control, the video plays, and the player shrinks back into the bubble.
import { font } from '../themes.js';
import { clamp, lerp, ease } from '../util.js';
import { nameOf } from '../model.js';
import { videoOf, syncVideo } from '../media.js';
import { fillRR, circle, icon, touchDot, ellipsize } from './draw.js';
import { chatGeometry } from './chat.js';

export const playerAt = (tl, t) => tl.players.find((pl) => t >= pl.tTap - 0.15 && t < pl.tClose + pl.closeDur + 0.02) || null;

// 0 = closed (still the bubble), 1 = fully open
function openness(pl, t) {
  if (t < pl.tOpen) return 0;
  if (t < pl.tOpen + pl.openDur) return ease((t - pl.tOpen) / pl.openDur);
  if (t < pl.tClose) return 1;
  return 1 - ease(clamp((t - pl.tClose) / pl.closeDur, 0, 1));
}

const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const mmssLeft = (s) => mmss(Math.ceil(s - 1e-6));      // time left rounds up, like a real player

// Draws the tap and the player; returns how open it is (0..1) so the status bar can switch to white.
export function drawVideoPlayer(ctx, R, t) {
  const pl = playerAt(R.tl, t);
  if (!pl) return 0;
  const { W, H, dev, p, fam } = R;
  const k = openness(pl, t);
  const geo = chatGeometry(ctx, R, t);
  // the video bubble itself (a message with a caption also has a text bubble under it)
  const row = geo.rows.find((v) => v.it.evId === pl.evId && v.it.kind === 'video') || geo.byEvent[pl.evId];
  const bub = row ? { x: row.x, y: row.by, w: row.m.w, h: row.m.h } : { x: W * 0.28, y: H * 0.4, w: 170, h: 280 };

  // the finger on the play button
  if (t < pl.tOpen + 0.12 && p.showTouches !== false) {
    const u = clamp((t - (pl.tTap - 0.15)) / 0.5, 0, 1);
    const pressed = clamp((t - pl.tTap) / 0.08, 0, 1) * (1 - clamp((t - (pl.tOpen - 0.05)) / 0.12, 0, 1));
    touchDot(ctx, bub.x + bub.w / 2, bub.y + bub.h / 2 + lerp(36, 0, ease(u)), clamp(u * 4, 0, 1) * (1 - clamp((t - pl.tOpen) / 0.12, 0, 1)), pressed);
  }
  if (k <= 0) return 0;

  const v = videoOf(pl.mediaId, pl.evId);
  // where the video sits when the player is open (contained between the top bar and the controls)
  const top = dev.safeTop + 36, bottom = H - 128;
  const ar = v ? v.w / v.h : bub.w / bub.h;
  const fh = Math.min(bottom - top, W / ar), fw = fh * ar;
  const full = { x: (W - fw) / 2, y: top + (bottom - top - fh) / 2, w: fw, h: fh };
  const X = lerp(bub.x, 0, k), Y = lerp(bub.y, 0, k), Wd = lerp(bub.w, W, k), Hd = lerp(bub.h, H, k);
  const rad = lerp(18, dev.radius, k);
  ctx.save();
  ctx.beginPath(); ctx.roundRect(X, Y, Wd, Hd, rad); ctx.clip();
  ctx.fillStyle = '#000000';
  ctx.fillRect(X, Y, Wd, Hd);
  const lt = clamp(t - pl.tPlay, 0, pl.dur);
  if (v) {
    syncVideo(v, lt, t >= pl.tPlay && t < pl.tEnd);
    ctx.drawImage(v.el, lerp(bub.x, full.x, k), lerp(bub.y, full.y, k), lerp(bub.w, full.w, k), lerp(bub.h, full.h, k));
  }

  // controls fade in once it is mostly open
  const a = clamp((k - 0.6) / 0.4, 0, 1);
  if (a > 0) {
    ctx.globalAlpha = a;
    const ios = fam === 'ios';
    const white = '#FFFFFF';
    ctx.textBaseline = 'middle';
    if (ios) {
      ctx.font = font(17, 400); ctx.fillStyle = white; ctx.textAlign = 'left';
      ctx.fillText('Done', 18, dev.safeTop + 18);
    } else {
      icon(ctx, 'back', 26, dev.safeTop + 18, 24, white);
      ctx.font = font(17, 500); ctx.fillStyle = white; ctx.textAlign = 'left';
      ctx.fillText(ellipsize(ctx, pl.side === 'me' ? 'You' : nameOf(p, pl.from), W - 150), 58, dev.safeTop + 18);
    }
    // progress bar
    const bx = 22, bw = W - 44, by = H - 104;
    fillRR(ctx, bx, by - 2, bw, 4, 2, 'rgba(255,255,255,0.3)');
    const f = clamp(lt / pl.dur, 0, 1);
    fillRR(ctx, bx, by - 2, Math.max(4, bw * f), 4, 2, white);
    circle(ctx, bx + bw * f, by, 6, white);
    ctx.font = font(12, 500); ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.textAlign = 'left'; ctx.fillText(mmss(lt), bx, by + 22);
    ctx.textAlign = 'right'; ctx.fillText('-' + mmssLeft(Math.max(0, pl.dur - lt)), bx + bw, by + 22);
    // play / pause
    const playing = t >= pl.tPlay && t < pl.tEnd;
    const cx = W / 2, cy = H - 56;
    if (playing) { fillRR(ctx, cx - 9, cy - 12, 6, 24, 2, white); fillRR(ctx, cx + 3, cy - 12, 6, 24, 2, white); }
    else { ctx.beginPath(); ctx.moveTo(cx - 8, cy - 13); ctx.lineTo(cx - 8, cy + 13); ctx.lineTo(cx + 14, cy); ctx.closePath(); ctx.fillStyle = white; ctx.fill(); }
  }
  ctx.restore();
  return k;
}
