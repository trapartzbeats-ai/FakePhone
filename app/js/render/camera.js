// Camera over the whole stage: zoom/pan shots that follow their target (a bubble, the typing box,
// the header) as the chat scrolls, blended on PulseCore curves, plus decaying shakes.
import { clamp, lerp } from '../util.js';
import { screenAt } from '../timeline.js';
import { chatGeometry } from './chat.js';

// Returns { Z, cx, cy, dx, dy, rot } in stage pixels, or null when the project has no camera work.
export function cameraAt(ctx, R, t, g, SW, SH) {
  const tl = R.tl;
  if (!tl.shots.length && !tl.shakes.length) return null;
  const full = { Z: 1, cx: SW / 2, cy: SH / 2 };

  const resolve = (shot, at) => {
    const kind = shot.target.kind;
    if (kind === 'full') return full;
    let rect = null;                      // screen coordinates
    if (kind !== 'center' && screenAt(tl, at).to === 'chat') {
      const geo = chatGeometry(ctx, R, at);
      const box = (v) => [v.x, v.by, v.m.w, v.m.h];
      if (kind === 'msg' && geo.byEvent[shot.target.evId]) rect = box(geo.byEvent[shot.target.evId]);
      if (!rect && (kind === 'latest' || kind === 'msg') && geo.latest) rect = box(geo.latest);
      // the typing box: its left part, where the text is
      if (kind === 'composer') rect = [geo.bar.fieldX - 6, geo.barTop, Math.min(geo.bar.fieldR - geo.bar.fieldX, 250) + 12, geo.bar.h];
      if (kind === 'header') rect = [0, 0, R.W, geo.headerBottom];
    }
    if (!rect) rect = [0, 0, R.W, R.H];
    // never zoom so far that the target itself gets cropped
    const fit = SW / (rect[2] * g.s);
    const Z = Math.max(1, kind === 'center' ? shot.Z : Math.min(shot.Z, fit * (kind === 'header' ? 1 : 0.9)));
    const hw = SW / (2 * Z), hh = SH / (2 * Z);
    return {
      Z,
      cx: clamp(g.ox + (rect[0] + rect[2] / 2) * g.s, hw, SW - hw),
      cy: clamp(g.oy + (rect[1] + rect[3] / 2) * g.s, hh, SH - hh),
    };
  };

  // Shot k at time `at`: blend from where the camera was when the shot started to its target.
  const camAt = (k, at, depth = 0) => {
    if (k < 0) return full;
    const s = tl.shots[k];
    const to = resolve(s, at);
    const p = (at - s.t) / s.dur;
    if (p >= 1 || depth > 4) return to;
    const from = camAt(k - 1, s.t, depth + 1);
    const e = s.f(clamp(p, 0, 1));
    return { Z: lerp(from.Z, to.Z, e), cx: lerp(from.cx, to.cx, e), cy: lerp(from.cy, to.cy, e) };
  };

  let k = -1;
  for (let i = 0; i < tl.shots.length; i++) if (tl.shots[i].t <= t) k = i;
  const cam = { ...camAt(k, t), dx: 0, dy: 0, rot: 0 };
  for (const sh of tl.shakes) {
    const p = (t - sh.t0) / sh.dur;
    if (p < 0 || p > 1) continue;
    const d = (1 - p) * (1 - p) * sh.amp;
    cam.dx += d * 16 * (Math.sin(t * 47.3) + 0.6 * Math.sin(t * 83.1 + 1.3));
    cam.dy += d * 16 * (Math.sin(t * 52.7 + 2.1) + 0.6 * Math.sin(t * 91.9));
    cam.rot += d * 0.012 * Math.sin(t * 38.5 + 0.7);
    cam.Z *= 1 + 0.035 * d;               // a touch of zoom keeps the frame edges covered
  }
  return cam;
}
