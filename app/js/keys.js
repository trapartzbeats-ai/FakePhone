// Keyboard layouts (iOS + Gboard), key geometry, and which key types a character.
// Row items: [label, units] or a bare label (1 unit). null label = invisible spacer.
const IOS = {
  abc: [
    'qwertyuiop'.split(''),
    [[null, 0.5], ...'asdfghjkl'.split(''), [null, 0.5]],
    [['shift', 1.3], [null, 0.15], ...'zxcvbnm'.split(''), [null, 0.15], ['del', 1.3]],
    [['123', 2.5], ['space', 5], ['return', 2.5]],
  ],
  num: [
    '1234567890'.split(''),
    '-/:;()$&@"'.split(''),
    [['#+=', 1.3], [null, 0.15], ['.', 1.4], [',', 1.4], ['?', 1.4], ['!', 1.4], ["'", 1.4], [null, 0.15], ['del', 1.3]],
    [['ABC', 2.5], ['space', 5], ['return', 2.5]],
  ],
  sym: [
    '[]{}#%^*+='.split(''),
    '_\\|~<>€£¥•'.split(''),
    [['123', 1.3], [null, 0.15], ['.', 1.4], [',', 1.4], ['?', 1.4], ['!', 1.4], ["'", 1.4], [null, 0.15], ['del', 1.3]],
    [['ABC', 2.5], ['space', 5], ['return', 2.5]],
  ],
};

const GBOARD = {
  abc: [
    'qwertyuiop'.split(''),
    [[null, 0.5], ...'asdfghjkl'.split(''), [null, 0.5]],
    [['shift', 1.5], ...'zxcvbnm'.split(''), ['del', 1.5]],
    [['?123', 1.5], ',', ['emoji', 1], ['space', 4], '.', ['return', 1.5]],
  ],
  num: [
    '1234567890'.split(''),
    '@#$_&-+()/'.split(''),
    [['=\\<', 1.5], '*', '"', "'", ':', ';', '!', '?', ['del', 1.5]],
    [['ABC', 1.5], ',', ['emoji', 1], ['space', 4], '.', ['return', 1.5]],
  ],
  sym: [
    '~`|•√π÷×¶∆'.split(''),
    '£¢€¥^°={}\\'.split(''),
    [['?123', 1.5], '%', '©', '®', '™', '✓', '[', ']', ['del', 1.5]],
    [['ABC', 1.5], ',', ['emoji', 1], ['space', 4], '.', ['return', 1.5]],
  ],
};

export const KB_STYLE = {
  ios: { layouts: IOS, pad: 3, gap: 6, keyH: 42, rowGap: 11, top: 8, bottom: 74, radius: 5 },
  gboard: { layouts: GBOARD, pad: 4, gap: 5, keyH: 46, rowGap: 9, top: 46, bottom: 30, radius: 7 },
};

export function kbHeight(style) {
  const s = KB_STYLE[style];
  return s.top + 4 * s.keyH + 3 * s.rowGap + s.bottom;
}

const SPECIAL = new Set(['shift', 'del', '123', 'ABC', '#+=', '?123', '=\\<', 'space', 'return', 'emoji']);

const geomCache = new Map();
// Returns [{label, kind, x, y, w, h}] in keyboard-local coordinates for width W.
export function kbGeometry(style, layout, W) {
  const key = `${style}|${layout}|${W}`;
  if (geomCache.has(key)) return geomCache.get(key);
  const s = KB_STYLE[style];
  const rows = s.layouts[layout];
  const kw = (W - 2 * s.pad - 9 * s.gap) / 10;
  const keys = [];
  rows.forEach((row, ri) => {
    const items = row.map((it) => (Array.isArray(it) ? { label: it[0], units: it[1] } : { label: it, units: 1 }));
    const fixed = items.filter((it) => it.label !== null && !SPECIAL.has(it.label) && it.units === 1);
    const flex = items.filter((it) => !fixed.includes(it));
    const flexUnits = flex.reduce((a, it) => a + it.units, 0);
    const room = W - 2 * s.pad - fixed.length * kw - (items.length - 1) * s.gap;
    let x = s.pad;
    const y = s.top + ri * (s.keyH + s.rowGap);
    for (const it of items) {
      const w = fixed.includes(it) ? kw : (room * it.units) / flexUnits;
      if (it.label !== null) {
        const kind = it.label === 'shift' ? 'shift' : it.label === 'del' ? 'del' : it.label === 'space' ? 'space'
          : it.label === 'return' ? 'return' : it.label === 'emoji' ? 'emoji' : SPECIAL.has(it.label) ? 'mode' : 'char';
        keys.push({ label: it.label, kind, x, y, w, h: s.keyH });
      }
      x += w + s.gap;
    }
  });
  geomCache.set(key, keys);
  return keys;
}

// Which layout + key types grapheme g. layout null = stays on the current layout (space, return, emoji).
export function keyFor(g, style) {
  const L = KB_STYLE[style].layouts;
  if (g === ' ') return { layout: null, key: 'space' };
  if (g === '\n') return { layout: null, key: 'return' };
  const lower = g.toLowerCase();
  if (/^\p{L}$/u.test(g) && L.abc.some((r) => r.includes(lower))) return { layout: 'abc', key: lower, shift: g !== lower };
  for (const layout of ['abc', 'num', 'sym']) {
    for (const row of L[layout]) {
      for (const it of row) {
        const label = Array.isArray(it) ? it[0] : it;
        if (label === g && !SPECIAL.has(label)) return { layout, key: g };
      }
    }
  }
  return { layout: null, key: null, emoji: true };
}
