// App icons for notifications and the home screen: drawn presets (simple look-alikes, not the
// official artwork) and custom uploaded images. Everything is drawn in a 100 x 100 box.
import { rr, circle, icon } from './draw.js';
import { visual, frameAt } from '../media.js';
import { font } from '../themes.js';
import { APP_NAMES } from '../apps.js';

const grad = (ctx, c1, c2, diag = false) => {
  const g = ctx.createLinearGradient(0, 0, diag ? 100 : 0, 100);
  g.addColorStop(0, c1); g.addColorStop(1, c2);
  return g;
};
const fillAll = (ctx, fill) => { ctx.fillStyle = fill; ctx.fillRect(0, 0, 100, 100); };
const poly = (ctx, pts, fill) => {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
};
const path = (ctx, d, fill) => { ctx.fillStyle = fill; ctx.fill(new Path2D(d)); };
const line = (ctx, pts, color, w) => {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.strokeStyle = color; ctx.lineWidth = w; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke();
};
const ell = (ctx, x, y, rx, ry, fill, rot = 0) => { ctx.beginPath(); ctx.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill(); };
const word = (ctx, s, x, y, size, weight, color, italic = false) => {
  ctx.font = (italic ? 'italic ' : '') + font(size, weight);
  ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.fillText(s, x, y);
};
const rect = (ctx, x, y, w, h, r, fill) => { rr(ctx, x, y, w, h, r); ctx.fillStyle = fill; ctx.fill(); };

// "Friday, October 31" -> { wd: 'FRI', day: '31' }; "9:41" -> hands
const dateOf = (p) => {
  const s = p?.status?.date || 'Friday, October 31';
  return { wd: (s.match(/[A-Za-z]{3}/) || ['FRI'])[0].toUpperCase(), day: (s.match(/(\d{1,2})\s*$/) || s.match(/(\d{1,2})/) || [0, '31'])[1] };
};
const timeOf = (p) => {
  const m = (p?.status?.time || '9:41').match(/(\d{1,2}):(\d{2})/) || [0, 9, 41];
  return { h: Number(m[1]) % 12, m: Number(m[2]) };
};

const PRESETS = {
  // --- messaging / the chat apps ---
  imessage: (ctx) => {
    fillAll(ctx, grad(ctx, '#67FF72', '#0BBD27'));
    ell(ctx, 50, 47, 33, 27, '#FFFFFF');
    ctx.beginPath(); ctx.moveTo(30, 62); ctx.quadraticCurveTo(28, 76, 20, 80); ctx.quadraticCurveTo(38, 78, 45, 70); ctx.fillStyle = '#FFFFFF'; ctx.fill();
  },
  android: (ctx) => { fillAll(ctx, '#0B57D0'); icon(ctx, 'message', 50, 52, 56, '#FFFFFF'); },
  phone: (ctx) => { fillAll(ctx, grad(ctx, '#67FF72', '#0BBD27')); icon(ctx, 'phone', 50, 50, 58, '#FFFFFF'); },
  whatsapp: (ctx) => {
    fillAll(ctx, '#25D366');
    circle(ctx, 50, 50, 30, '#FFFFFF'); circle(ctx, 50, 50, 24, '#25D366');
    poly(ctx, [[30, 80], [36, 62], [46, 72]], '#FFFFFF');
    icon(ctx, 'phone', 50, 50, 30, '#FFFFFF');
  },
  instagram: (ctx) => {
    const g = ctx.createLinearGradient(0, 100, 100, 0);
    g.addColorStop(0, '#FEDA75'); g.addColorStop(0.35, '#FA7E1E'); g.addColorStop(0.6, '#D62976'); g.addColorStop(1, '#4F5BD5');
    fillAll(ctx, g);
    ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = 7;
    rr(ctx, 22, 22, 56, 56, 16); ctx.stroke();
    ctx.beginPath(); ctx.arc(50, 50, 13, 0, Math.PI * 2); ctx.stroke();
    circle(ctx, 66, 34, 3.5, '#FFFFFF');
  },
  facebook: (ctx) => { fillAll(ctx, '#1877F2'); word(ctx, 'f', 57, 106, 104, 800, '#FFFFFF'); },
  messenger: (ctx) => {
    const g = ctx.createLinearGradient(0, 100, 100, 0);
    g.addColorStop(0, '#A033FF'); g.addColorStop(0.5, '#0A8BFF'); g.addColorStop(1, '#00C6FF');
    fillAll(ctx, g);
    circle(ctx, 50, 47, 31, '#FFFFFF');
    poly(ctx, [[34, 78], [37, 62], [50, 72]], '#FFFFFF');
    poly(ctx, [[22, 57], [44, 33], [55, 46], [78, 33], [56, 58], [45, 45]], '#1480FF');
  },
  snapchat: (ctx) => {
    fillAll(ctx, '#FFFC00');
    path(ctx, 'M50 20C34 20 30 32 30 42V50C26 52 22 54 26 58C28 60 32 60 32 62C30 68 24 70 24 72C28 76 34 74 38 78C42 82 58 82 62 78C66 74 72 76 76 72C76 70 70 68 68 62C68 60 72 60 74 58C78 54 74 52 70 50V42C70 32 66 20 50 20Z', '#FFFFFF');
    ctx.strokeStyle = '#000000'; ctx.lineWidth = 3.2; ctx.stroke(new Path2D('M50 20C34 20 30 32 30 42V50C26 52 22 54 26 58C28 60 32 60 32 62C30 68 24 70 24 72C28 76 34 74 38 78C42 82 58 82 62 78C66 74 72 76 76 72C76 70 70 68 68 62C68 60 72 60 74 58C78 54 74 52 70 50V42C70 32 66 20 50 20Z'));
  },
  tiktok: (ctx) => {
    fillAll(ctx, '#010101');
    const note = (ox, oy, c) => {
      ctx.save(); ctx.translate(ox, oy);
      circle(ctx, 40, 68, 12, c);
      poly(ctx, [[50, 24], [58, 24], [58, 68], [50, 68]], c);
      path(ctx, 'M58 24C60 34 67 40 76 41V51C69 51 63 48 58 44Z', c);
      ctx.restore();
    };
    note(-2.5, -2.5, '#25F4EE'); note(2.5, 2.5, '#FE2C55'); note(0, 0, '#FFFFFF');
  },
  x: (ctx) => { fillAll(ctx, '#000000'); line(ctx, [[28, 25], [72, 75]], '#FFFFFF', 9); line(ctx, [[72, 25], [28, 75]], '#FFFFFF', 5.5); },
  youtube: (ctx) => { fillAll(ctx, '#FFFFFF'); rect(ctx, 10, 28, 80, 46, 15, '#FF0000'); poly(ctx, [[43, 40], [43, 62], [62, 51]], '#FFFFFF'); },
  gmail: (ctx) => {
    fillAll(ctx, '#FFFFFF');
    line(ctx, [[26, 70], [26, 33]], '#4285F4', 9); line(ctx, [[74, 70], [74, 33]], '#34A853', 9);
    line(ctx, [[26, 33], [50, 54], [74, 33]], '#EA4335', 9);
  },
  telegram: (ctx) => {
    fillAll(ctx, grad(ctx, '#37AEE2', '#1E96C8'));
    path(ctx, 'M22 48L78 26C80 25 82 27 81 29L71 75C70 78 67 79 65 77L50 66L42 74C41 75 39 75 39 73V62L72 36L33 56L23 52C20 51 20 49 22 48Z', '#FFFFFF');
  },
  discord: (ctx) => {
    fillAll(ctx, '#5865F2');
    path(ctx, 'M26 36C34 30 42 28 42 28L44 32C48 31 52 31 56 32L58 28C58 28 66 30 74 36C80 46 82 58 80 68C74 72 68 74 64 74L60 69C57 70 54 70 50 70C46 70 43 70 40 69L36 74C32 74 26 72 20 68C18 58 20 46 26 36Z', '#FFFFFF');
    ell(ctx, 38, 52, 6, 7, '#5865F2'); ell(ctx, 62, 52, 6, 7, '#5865F2');
  },
  slack: (ctx) => {
    fillAll(ctx, '#FFFFFF');
    ['#36C5F0', '#2EB67D', '#ECB22E', '#E01E5A'].forEach((c, i) => {
      ctx.save(); ctx.translate(50, 50); ctx.rotate((i * Math.PI) / 2); ctx.translate(-50, -50);
      rect(ctx, 16, 40, 28, 11, 5.5, c); circle(ctx, 36, 26, 6.5, c);
      ctx.restore();
    });
  },
  spotify: (ctx) => {
    fillAll(ctx, '#191414'); circle(ctx, 50, 50, 34, '#1ED760');
    [[[28, 39], [52, 31], [76, 43], 6.5], [[31, 52], [52, 45], [71, 55], 5], [[34, 65], [52, 59], [67, 67], 4]].forEach(([a, c, b, w]) => {
      ctx.beginPath(); ctx.moveTo(...a); ctx.quadraticCurveTo(...c, ...b); ctx.strokeStyle = '#191414'; ctx.lineWidth = w; ctx.lineCap = 'round'; ctx.stroke();
    });
  },
  netflix: (ctx) => {
    fillAll(ctx, '#000000');
    poly(ctx, [[32, 20], [42, 20], [42, 80], [32, 80]], '#B20710'); poly(ctx, [[58, 20], [68, 20], [68, 80], [58, 80]], '#B20710');
    poly(ctx, [[32, 20], [42, 20], [68, 80], [58, 80]], '#E50914');
  },
  uber: (ctx) => { fillAll(ctx, '#000000'); word(ctx, 'Uber', 50, 60, 29, 800, '#FFFFFF'); },
  cashapp: (ctx) => { fillAll(ctx, '#00D632'); word(ctx, '$', 50, 74, 76, 800, '#FFFFFF'); },
  venmo: (ctx) => { fillAll(ctx, '#3D95CE'); word(ctx, 'V', 50, 73, 70, 800, '#FFFFFF', true); },
  // --- system apps ---
  mail: (ctx) => {
    fillAll(ctx, grad(ctx, '#4DB1FF', '#1B6CF0'));
    rect(ctx, 19, 30, 62, 42, 6, '#FFFFFF');
    line(ctx, [[22, 34], [50, 56], [78, 34]], '#1B6CF0', 5);
  },
  safari: (ctx) => {
    fillAll(ctx, grad(ctx, '#FFFFFF', '#D5E4F7'));
    circle(ctx, 50, 50, 38, grad(ctx, '#6BC7FF', '#1D6FE8'));
    for (let i = 0; i < 12; i++) {
      const a = (i * Math.PI) / 6;
      line(ctx, [[50 + Math.sin(a) * 34, 50 - Math.cos(a) * 34], [50 + Math.sin(a) * (i % 3 ? 31 : 29), 50 - Math.cos(a) * (i % 3 ? 31 : 29)]], '#FFFFFF', 1.8);
    }
    ctx.save(); ctx.translate(50, 50); ctx.rotate(Math.PI / 4);
    poly(ctx, [[0, -27], [-7.5, 0], [7.5, 0]], '#FF3B30'); poly(ctx, [[0, 27], [-7.5, 0], [7.5, 0]], '#FFFFFF');
    ctx.restore();
  },
  photos: (ctx) => {
    fillAll(ctx, '#FFFFFF');
    ctx.globalCompositeOperation = 'multiply';
    ['#F7C634', '#F59A2E', '#F0485D', '#C95BC2', '#6C6CE8', '#3DA8F0', '#4CCB6E', '#B6D93F'].forEach((c, i) => {
      ctx.save(); ctx.translate(50, 50); ctx.rotate((i * Math.PI) / 4);
      ell(ctx, 0, -17, 10.5, 18, c);
      ctx.restore();
    });
    ctx.globalCompositeOperation = 'source-over';
  },
  camera: (ctx) => {
    fillAll(ctx, grad(ctx, '#E9E9EC', '#9C9CA3'));
    rect(ctx, 36, 26, 20, 12, 4, '#2A2A2E'); rect(ctx, 20, 33, 60, 42, 10, '#2A2A2E');
    circle(ctx, 50, 54, 15, '#0E0E10'); circle(ctx, 50, 54, 10, '#3B3B42'); circle(ctx, 47, 51, 3, 'rgba(255,255,255,0.7)');
  },
  calendar: (ctx, p) => {
    const d = dateOf(p);
    fillAll(ctx, '#FFFFFF');
    word(ctx, d.wd, 50, 29, 17, 600, '#FF3B30');
    word(ctx, d.day, 50, 81, 56, 300, '#111111');
  },
  clock: (ctx, p) => {
    const t = timeOf(p);
    fillAll(ctx, '#000000');
    circle(ctx, 50, 50, 42, '#FFFFFF');
    for (let i = 0; i < 12; i++) {
      const a = (i * Math.PI) / 6;
      line(ctx, [[50 + Math.sin(a) * 36, 50 - Math.cos(a) * 36], [50 + Math.sin(a) * 31, 50 - Math.cos(a) * 31]], '#1C1C1E', i % 3 ? 2 : 3.4);
    }
    const ha = ((t.h + t.m / 60) * Math.PI) / 6, ma = (t.m * Math.PI) / 30;
    line(ctx, [[50, 50], [50 + Math.sin(ha) * 20, 50 - Math.cos(ha) * 20]], '#1C1C1E', 4.4);
    line(ctx, [[50, 50], [50 + Math.sin(ma) * 29, 50 - Math.cos(ma) * 29]], '#1C1C1E', 3.2);
    circle(ctx, 50, 50, 3, '#FF9500');
  },
  maps: (ctx) => {
    fillAll(ctx, '#EDEBE4');
    rect(ctx, -4, -4, 48, 46, 0, '#BFE3A5');
    line(ctx, [[-10, 86], [110, 28]], '#FFFFFF', 14);
    line(ctx, [[28, 110], [72, -10]], '#FFD24A', 7);
    line(ctx, [[-10, 60], [110, 60]], '#FFFFFF', 5);
    circle(ctx, 62, 44, 12, '#FFFFFF'); circle(ctx, 62, 44, 8.5, '#1E88FF');
  },
  weather: (ctx) => {
    fillAll(ctx, grad(ctx, '#1E6BE0', '#5BBAF8'));
    circle(ctx, 38, 38, 17, '#FFD33D');
    circle(ctx, 40, 68, 13, '#FFFFFF'); circle(ctx, 58, 62, 17, '#FFFFFF'); circle(ctx, 73, 71, 11, '#FFFFFF'); rect(ctx, 38, 62, 40, 20, 8, '#FFFFFF');
  },
  notes: (ctx) => {
    fillAll(ctx, '#FFFFFF');
    rect(ctx, -2, -2, 104, 30, 0, '#FFD43B');
    [47, 61, 75].forEach((y) => line(ctx, [[18, y], [82, y]], '#DADADF', 3));
  },
  settings: (ctx) => {
    fillAll(ctx, grad(ctx, '#AEAEB4', '#6C6C72'));
    ctx.save(); ctx.translate(50, 50);
    for (let i = 0; i < 8; i++) { ctx.save(); ctx.rotate((i * Math.PI) / 4); rect(ctx, -5.5, -37, 11, 16, 2.5, '#E7E7EB'); ctx.restore(); }
    circle(ctx, 0, 0, 28, '#E7E7EB'); circle(ctx, 0, 0, 12, '#7B7B81');
    ctx.restore();
  },
  music: (ctx) => {
    fillAll(ctx, grad(ctx, '#FB5C74', '#FA233B'));
    rect(ctx, 49, 26, 7, 42, 3, '#FFFFFF'); ell(ctx, 43, 69, 12, 9, '#FFFFFF', -0.3);
    path(ctx, 'M54 26L73 32V45L54 40Z', '#FFFFFF');
  },
  appstore: (ctx) => {
    fillAll(ctx, grad(ctx, '#1AC7FB', '#1666F2'));
    line(ctx, [[30, 74], [50, 26]], '#FFFFFF', 7); line(ctx, [[70, 74], [50, 26]], '#FFFFFF', 7); line(ctx, [[36, 60], [64, 60]], '#FFFFFF', 7);
  },
};

// spec = a preset id, or { app, name, color, iconId }; app 'custom' uses the uploaded image (iconId) or a lettered tile.
export function drawApp(ctx, spec, x, y, s, p = null, opts = {}) {
  const a = typeof spec === 'string' ? { app: spec } : spec || { app: 'imessage' };
  const preset = PRESETS[a.app];
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s / 100, s / 100);
  if (opts.round) { ctx.beginPath(); ctx.arc(50, 50, 50, 0, Math.PI * 2); } else rr(ctx, 0, 0, 100, 100, 22.5);
  ctx.clip();
  const v = !preset && a.iconId ? visual(a.iconId) : null;
  if (preset) preset(ctx, p);
  else if (v) {
    const bmp = frameAt(v, 0);
    const k = Math.max(100 / bmp.width, 100 / bmp.height);
    ctx.drawImage(bmp, 50 - (bmp.width * k) / 2, 50 - (bmp.height * k) / 2, bmp.width * k, bmp.height * k);
  } else {
    fillAll(ctx, grad(ctx, a.color || '#5B5BD6', a.color || '#5B5BD6'));
    const g = ctx.createLinearGradient(0, 0, 0, 100);
    g.addColorStop(0, 'rgba(255,255,255,0.22)'); g.addColorStop(1, 'rgba(0,0,0,0.12)');
    fillAll(ctx, g);
    word(ctx, ((a.name || '?').trim()[0] || '?').toUpperCase(), 50, 71, 58, 700, '#FFFFFF');
  }
  ctx.restore();
}

export const appName = (a) => (typeof a === 'string' ? APP_NAMES[a] : APP_NAMES[a?.app] || a?.name) || '';
