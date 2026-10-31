// Model checks without a browser: an old project (no home screen, old notify events) still opens and compiles, and the
// script commands for notifications, the home screen and opening an app round-trip.  node tools/model-check.mjs
import { newProject, migrate, newEvent, parseScript, toScript } from '../app/js/model.js';
import { compile } from '../app/js/timeline.js';

const old = newProject('old');
delete old.home; delete old.chat.avatar;
old.theme = 'whatsapp';
old.events = [
  { id: 'e1', type: 'msg', from: 'c1', text: 'hi', pre: false },
  { id: 'e2', type: 'notify', from: 'c1', text: 'hello', dur: 3.5, wait: 1.6 },
  { id: 'e3', type: 'screen', to: 'inbox' },
];
const p = migrate(old);
const ok = [];
const check = (n, v) => { ok.push(v); console.log((v ? 'PASS ' : 'FAIL ') + n); };
check('home was added', p.home.apps.length > 10 && p.home.dock.length === 4);
check('the whatsapp look has its app on the home screen', [...p.home.apps, ...p.home.dock].some((a) => a.app === 'whatsapp'));
check('group photo field exists', p.chat.avatar === null);
check('old notify got the new fields', p.events[1].app === 'auto' && p.events[1].badge === true);
const tl = compile(p);
check('it compiles', tl.duration > 0 && tl.banners.length === 1 && tl.banners[0].app === 'auto');

// scripts round-trip, including the new commands and the {app} tag
const q = migrate(newProject('script'));
q.events = parseScript('[notify Jess: tagged you {facebook}]\n[home]\n[open inbox]\nAnthony: yo\n[open chat]', q);
check('script parses notify app + home + open', q.events[0].app === 'facebook' && q.events[1].to === 'home' && q.events[2].type === 'openapp' && q.events[2].to === 'inbox' && q.events[4].to === 'chat');
const text = toScript(q);
check('script writes them back', text.includes('{facebook}') && text.includes('[home]') && text.includes('[open inbox]') && text.includes('[open chat]'));
const t2 = compile(q);
check('the home -> open flow compiles with taps and app transitions', t2.taps.length === 2 && t2.screens.filter((s) => s.kind === 'app').length >= 2 && t2.badges.some((b) => b.key === 'facebook' && b.n === 1));
process.exit(ok.every(Boolean) ? 0 : 1);
