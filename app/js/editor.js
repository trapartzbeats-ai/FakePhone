// The editor: project state, undo/redo, autosave, script list, composer, preview transport.
import { h, popover, closePopover, modal, toast, pickFile, btn } from './ui.js';
import { newProject, demoProject, migrate, newEvent, parseScript, toScript, EVENT_TYPES, SCRIPT_HELP, BUBBLE_FX, SCREEN_FX, CAMERA_FX, CAMERA_MOVES, CAMERA_TARGETS, nameOf, contact, chatTitle } from './model.js';
import { compile } from './timeline.js';
import { renderFrame } from './render/renderer.js';
import { addMediaBlob, onMediaChange, mediaURL, setVideoPlaying } from './media.js';
import { putProject, getProject, listProjects, deleteProject, loadSettings, saveSettings, getMedia, putMedia } from './store.js';
import { EMOJI } from './emoji.js';
import { fmtTime, debounce, clone, uid, download, blobToDataURL, dataURLToBlob, MEDIA_KEYS } from './util.js';
import { Panels } from './panels.js';

export class Editor {
  constructor(engine) {
    this.engine = engine;
    this.settings = Object.assign({ volume: 0.7, eleven: { model: 'eleven_v4', stability: 0.5, similarity: 0.75, style: 0.2 }, exportRes: '1080', exportFps: 30 }, loadSettings());
    this.undoStack = [];
    this.redoStack = [];
    this.sel = null;
    this.t = 0;
    this.playing = false;
    this.dirty = true;
    this.sender = 'me';
    this.lastField = null;
    this.save = debounce(() => this.persist(), 400);
  }

  async init() {
    this.canvas = document.getElementById('stage');
    this.ctx = this.canvas.getContext('2d');
    this.panels = new Panels(this);
    this.bindChrome();
    this.bindComposer();
    this.bindTransport();
    this.bindKeys();
    onMediaChange(() => { this.dirty = true; });
    document.fonts.ready.then(() => { this.dirty = true; });
    ['17px Inter', '600 17px Inter', '700 17px Inter', '17px Roboto'].forEach((f) => document.fonts.load(f).then(() => { this.dirty = true; }));
    document.fonts.load('17px "Noto Color Emoji"', '😀🎉❤️').then(() => { this.dirty = true; });
    this.engine.setVolume(this.settings.muted ? 0 : this.settings.volume);

    let p = null;
    if (this.settings.lastProject) p = await getProject(this.settings.lastProject).catch(() => null);
    if (!p) { p = demoProject(); await putProject(p); }
    this.load(p);
    this.loop();
  }

  // ---- project state -------------------------------------------------------------
  load(p) {
    this.p = migrate(p);
    this.undoStack = [];
    this.redoStack = [];
    this.sel = null;
    this.t = 0;
    this.pause();
    this.settings.lastProject = this.p.id;
    saveSettings(this.settings);
    document.getElementById('projName').value = this.p.name;
    this.recompile();
    this.renderList();
    this.panels.render();
    this.setSender('me');
    this.prepareAudio();
  }

  recompile() {
    this.tl = compile(this.p);
    if (this.t > this.tl.duration) this.t = this.tl.duration;
    this.renderTicks();
    this.dirty = true;
  }

  // Apply a change. `key` coalesces rapid edits (typing) into one undo step.
  // opts.inspector re-renders the side panel; opts.list:false skips the script list.
  change(fn, opts = {}) {
    const now = performance.now();
    if (!(opts.key && opts.key === this.lastKey && now - this.lastKeyAt < 1200)) {
      this.undoStack.push(JSON.stringify(this.p));
      if (this.undoStack.length > 150) this.undoStack.shift();
      this.redoStack = [];
    }
    this.lastKey = opts.key || null;
    this.lastKeyAt = now;
    fn(this.p);
    this.p.updated = Date.now();
    this.recompile();
    if (opts.list !== false) this.renderList();
    if (opts.inspector) this.panels.render();
    this.markSaving();
    this.save();
  }

  undo() { this.history(this.undoStack, this.redoStack, 'Undo'); }
  redo() { this.history(this.redoStack, this.undoStack, 'Redo'); }
  history(from, to, label) {
    if (!from.length) return;
    to.push(JSON.stringify(this.p));
    this.p = JSON.parse(from.pop());
    this.lastKey = null;
    this.recompile();
    this.renderList();
    this.panels.render();
    this.markSaving();
    this.save();
    toast(label);
  }

  markSaving() { document.getElementById('saveState').textContent = 'Saving…'; }
  async persist() {
    await putProject(this.p);
    document.getElementById('saveState').textContent = 'Saved';
  }

  saveSettings() { saveSettings(this.settings); }

  async prepareAudio() {
    try { await this.engine.prepare(this.tl, this.p); } catch (e) { console.warn(e); }
  }

  ev(id) { return this.p.events.find((e) => e.id === id); }

  select(id, { seek = true } = {}) {
    this.sel = id;
    for (const el of document.querySelectorAll('.ev.sel')) el.classList.remove('sel');
    if (id) document.querySelector(`.ev[data-id="${id}"]`)?.classList.add('sel');
    if (seek && id && this.tl.marks[id]) {
      if (this.playing) this.pause();
      this.seek(Math.max(this.tl.marks[id].t0, this.tl.marks[id].t1 - 0.05));
    }
    this.panels.render('edit');
  }

  // Insert events after the selection (or at the end) and select the last one.
  insert(events, { select = true } = {}) {
    if (!events.length) return;
    this.change((p) => {
      const i = this.sel ? p.events.findIndex((e) => e.id === this.sel) : -1;
      if (i >= 0) p.events.splice(i + 1, 0, ...events);
      else p.events.push(...events);
    });
    if (select) {
      this.sel = events[events.length - 1].id;
      this.renderList();
      this.panels.render('edit');
      const m = this.tl.marks[this.sel];
      if (m && !this.playing) this.seek(Math.max(m.t0, m.t1 - 0.05));
      document.querySelector(`.ev[data-id="${this.sel}"]`)?.scrollIntoView({ block: 'nearest' });
    }
  }

  addEvent(type, init = {}) {
    const p = this.p;
    if (type === 'call' && !init.lines) init.lines = [];
    if (type === 'swipe' && !init.row) init.row = p.inbox[0]?.id || 'chat';
    this.insert([newEvent(type, init, p)]);
  }

  removeEvent(id) {
    const i = this.p.events.findIndex((e) => e.id === id);
    if (i < 0) return;
    this.change((p) => p.events.splice(i, 1));
    const next = this.p.events[Math.min(i, this.p.events.length - 1)];
    this.sel = next ? next.id : null;
    this.renderList();
    this.panels.render('edit');
  }

  duplicateEvent(id) {
    const e = this.ev(id);
    if (!e) return;
    const copy = clone(e);
    copy.id = uid('e');
    this.sel = id;
    this.insert([copy]);
  }

  moveEvent(id, toIndex) {
    this.change((p) => {
      const i = p.events.findIndex((e) => e.id === id);
      const [e] = p.events.splice(i, 1);
      p.events.splice(toIndex > i ? toIndex - 1 : toIndex, 0, e);
    });
  }

  // ---- script list ---------------------------------------------------------------
  renderList() {
    const list = document.getElementById('eventList');
    const scroll = list.scrollTop;
    list.textContent = '';
    if (!this.p.events.length) {
      list.append(h('div', { class: 'empty' },
        h('b', {}, 'Start the conversation'),
        h('p', {}, 'Type below and press Enter. Tab switches who is talking. Or paste a whole script.'),
        btn('Paste a script', () => this.pasteScript(), 'ghost')));
    }
    let preDone = false;
    this.p.events.forEach((e, i) => {
      if (!e.pre && !preDone && this.p.events.some((x) => x.pre)) {
        preDone = true;
        if (i > 0) list.append(h('div', { class: 'pre-line' }, 'video starts here'));
      }
      list.append(this.eventRow(e, i));
    });
    list.scrollTop = scroll;
  }

  eventRow(e, index) {
    const p = this.p;
    const cls = ['ev', e.type, e.id === this.sel ? 'sel' : '', e.pre ? 'pre' : ''];
    let body;
    if (e.type === 'msg') {
      const me = e.from === 'me';
      cls.push(me ? 'me' : 'them');
      const c = contact(p, e.from);
      body = h('div', { class: 'bub-wrap' },
        !me ? h('span', { class: 'who', style: { color: c?.color } }, nameOf(p, e.from)) : null,
        h('div', { class: 'bub' + (e.vn ? ' vn' : '') + (e.draft && !e.text ? ' draft-only' : '') },
          e.vn ? h('span', { class: 'vn-chip' }, '🎤 ', e.voice?.dur ? `0:${String(Math.round(e.voice.dur)).padStart(2, '0')}` : 'voice note') : null,
          !e.vn && e.mediaId ? (e.mediaKind === 'video' ? h('span', { class: 'tag fx', title: 'A video' }, `🎬 ${(e.mediaDur || 0).toFixed(1)}s`) : h('img', { class: 'thumb', 'data-media': e.mediaId })) : null,
          !e.vn && e.draft ? h('del', { title: 'Typed, then deleted' }, e.draft) : null,
          e.text ? h('span', {}, e.text) : null,
          !e.text && !e.mediaId && !e.vn && !e.draft ? h('i', {}, 'empty message') : null),
        h('span', { class: 'meta' },
          e.pre ? 'on screen at start' : '',
          e.voice?.mediaId ? h('span', { class: 'tag voice', title: 'Has a voice line' }, e.voice.src === 'mic' ? '● mic' : '♪ voice') : null,
          e.typing === 'instant' ? h('span', { class: 'tag' }, 'no typing') : null,
          e.effect ? h('span', { class: 'tag fx' }, '✨ ' + BUBBLE_FX[e.effect]?.label) : null,
          e.screenFx ? h('span', { class: 'tag fx' }, '🎉 ' + SCREEN_FX[e.screenFx]?.label) : null,
          e.cam && e.cam !== 'none' ? h('span', { class: 'tag cam' }, '🎥 ' + CAMERA_FX[e.cam]) : null));
    } else {
      body = h('div', { class: 'chip' }, h('span', { class: 'ic' }, EVENT_TYPES[e.type]?.icon || '•'), this.describe(e));
    }
    const el = h('div', {
      class: cls.join(' '), 'data-id': e.id, draggable: 'true',
      onclick: () => this.select(e.id),
      ondragstart: (ev) => { ev.dataTransfer.setData('text/plain', e.id); el.classList.add('dragging'); },
      ondragend: () => el.classList.remove('dragging'),
      ondragover: (ev) => { ev.preventDefault(); const r = el.getBoundingClientRect(); el.classList.toggle('drop-after', ev.clientY > r.top + r.height / 2); el.classList.toggle('drop-before', ev.clientY <= r.top + r.height / 2); },
      ondragleave: () => el.classList.remove('drop-before', 'drop-after'),
      ondrop: (ev) => {
        ev.preventDefault();
        const id = ev.dataTransfer.getData('text/plain');
        const after = el.classList.contains('drop-after');
        el.classList.remove('drop-before', 'drop-after');
        if (id && id !== e.id) this.moveEvent(id, index + (after ? 1 : 0));
      },
    },
    h('span', { class: 'grip', title: 'Drag to reorder' }, '⠿'),
    body,
    h('div', { class: 'ev-actions' },
      h('button', { title: 'Play from here', onclick: (x) => { x.stopPropagation(); this.playFrom(this.tl.marks[e.id]?.t0 ?? 0); } }, '▶'),
      h('button', { title: 'Duplicate', onclick: (x) => { x.stopPropagation(); this.duplicateEvent(e.id); } }, '⧉'),
      h('button', { title: 'Delete', onclick: (x) => { x.stopPropagation(); this.removeEvent(e.id); } }, '✕')));
    const img = el.querySelector('img[data-media]');
    if (img) mediaURL(img.dataset.media).then((u) => { img.src = u; });
    return el;
  }

  describe(e) {
    const p = this.p;
    const n = (id) => nameOf(p, id);
    switch (e.type) {
      case 'typing': return `${n(e.from)} is typing… ${e.dur}s`;
      case 'pause': return `Pause ${e.dur}s`;
      case 'stamp': return `Timestamp · ${e.text}${e.pre ? ' (at start)' : ''}`;
      case 'react': return `${e.from === 'me' ? 'You react' : n(e.from) + ' reacts'} ${e.emoji}`;
      case 'read': return e.text ? `Receipt · ${e.text}` : 'Marked as Read';
      case 'unsend': return 'Unsend message';
      case 'notify': return `Notification · ${n(e.from)}: ${e.text || '…'}`;
      case 'screen': return `Go to ${({ chat: 'the chat', inbox: 'the messages list', lock: 'the lock screen', home: 'the home screen' })[e.to] || e.to}`;
      case 'openapp': return `Tap the ${e.app && e.app !== 'auto' ? [...p.home.apps, ...p.home.dock].find((a) => a.id === e.app)?.name || 'app' : 'chat app'} · opens ${e.to === 'inbox' ? 'the messages list' : 'the chat'}`;
      case 'swipe': return `Swipe to delete · ${e.row === 'chat' ? chatTitle(p) : p.inbox.find((r) => r.id === e.row)?.name || '?'}`;
      case 'call': return `${e.direction === 'out' ? 'Call' : 'Incoming call from'} ${n(e.with)} · ${({ answer: 'answered', decline: 'declined', missed: 'missed' })[e.outcome]}${e.lines.length ? ` · ${e.lines.length} line${e.lines.length > 1 ? 's' : ''}` : ''}`;
      case 'voiceover': return `Voice-over · ${e.text || '…'}`;
      case 'sound': return `Sound · ${e.mediaId ? 'custom file' : e.sound}`;
      case 'camera': {
        const on = e.move === 'zoom' || e.move === 'push' ? ` · ${CAMERA_TARGETS[e.target] || 'a message'} ${e.zoom ?? ''}×` : e.move === 'shake' ? ` · ${e.amount ?? 1}` : '';
        return `Camera · ${CAMERA_MOVES[e.move] || e.move}${on}`;
      }
      default: return e.type;
    }
  }

  highlightPlaying() {
    let cur = null;
    for (const e of this.p.events) { const m = this.tl.marks[e.id]; if (m && this.t >= m.t0) cur = e.id; }
    if (cur === this.playingId) return;
    this.playingId = cur;
    document.querySelectorAll('.ev.playing').forEach((el) => el.classList.remove('playing'));
    const el = cur && document.querySelector(`.ev[data-id="${cur}"]`);
    if (el) { el.classList.add('playing'); if (this.playing) el.scrollIntoView({ block: 'nearest' }); }
  }

  // ---- composer ------------------------------------------------------------------
  senders() { return ['me', ...this.p.chat.members]; }
  setSender(id) {
    if (!this.senders().includes(id)) id = 'me';
    this.sender = id;
    const chip = document.getElementById('senderChip');
    const c = contact(this.p, id);
    chip.textContent = id === 'me' ? 'Me' : c?.name || '?';
    chip.className = 'sender-chip ' + (id === 'me' ? 'me' : 'them');
    chip.style.setProperty('--c', id === 'me' ? '' : c?.color || '#888');
  }
  cycleSender(dir = 1) {
    const s = this.senders();
    this.setSender(s[(s.indexOf(this.sender) + dir + s.length) % s.length]);
  }

  bindComposer() {
    const ta = document.getElementById('composerText');
    const chip = document.getElementById('senderChip');
    chip.onclick = (e) => {
      const opts = h('div', { class: 'menu' },
        this.senders().map((id) => h('button', { onclick: () => { this.setSender(id); closePopover(); ta.focus(); } }, id === 'me' ? 'Me' : nameOf(this.p, id))),
        h('hr'),
        h('button', { onclick: () => { closePopover(); this.panels.render('people'); } }, 'People & group chat…'));
      popover(e.currentTarget, opts, { width: 220 });
    };
    const send = () => {
      const text = ta.value.trim();
      if (!text) return;
      if (/^\[.*\]$/.test(text) || text.includes('\n[')) {
        const evs = parseScript(text, this.p);
        if (evs.length) this.insert(evs);
      } else this.insert([newEvent('msg', { from: this.sender, text: ta.value.replace(/^\s+|\s+$/g, '') }, this.p)]);
      ta.value = '';
      ta.style.height = '';
      if (this.settings.autoSwitch !== false) this.cycleSender(1);
    };
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
      else if (e.key === 'Tab') { e.preventDefault(); this.cycleSender(e.shiftKey ? -1 : 1); }
    });
    ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = Math.min(140, ta.scrollHeight) + 'px'; });
    ta.addEventListener('focus', () => { this.lastField = ta; });
    document.getElementById('btnSend').onclick = send;

    document.querySelector('[data-tool="emoji"]').onclick = (e) => this.emojiPicker(e.currentTarget, (em) => this.insertText(em));
    document.querySelector('[data-tool="image"]').onclick = () => this.addImages();
    document.querySelector('[data-tool="gif"]').onclick = (e) => this.gifPicker(e.currentTarget);
    document.querySelector('[data-tool="typing"]').onclick = () => this.addEvent('typing', { from: this.sender === 'me' ? this.p.chat.members[0] : this.sender });
    document.querySelector('[data-tool="pause"]').onclick = () => this.addEvent('pause', { dur: 1 });
    document.querySelector('[data-tool="voice"]').onclick = () => {
      this.insert([newEvent('msg', { from: this.sender, vn: true, text: ta.value.trim() }, this.p)]);
      ta.value = '';
      this.panels.render('edit');
    };
    document.querySelector('[data-tool="more"]').onclick = (e) => this.addMenu(e.currentTarget);
    document.getElementById('btnAddMenu').onclick = (e) => this.addMenu(e.currentTarget, 'below');
    document.getElementById('btnPaste').onclick = () => this.pasteScript();
    document.addEventListener('focusin', (e) => { if (e.target.matches('textarea, input[type=text]')) this.lastField = e.target; });
  }

  insertText(s) {
    const el = this.lastField && document.body.contains(this.lastField) ? this.lastField : document.getElementById('composerText');
    const a = el.selectionStart ?? el.value.length, b = el.selectionEnd ?? el.value.length;
    el.value = el.value.slice(0, a) + s + el.value.slice(b);
    el.selectionStart = el.selectionEnd = a + s.length;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.focus();
  }

  addMenu(anchor, place = 'above') {
    const items = Object.entries(EVENT_TYPES).filter(([k]) => k !== 'msg');
    popover(anchor, h('div', { class: 'menu' },
      items.map(([k, v]) => h('button', { onclick: () => { closePopover(); this.addEvent(k, this.defaultsFor(k)); } }, h('span', { class: 'ic' }, v.icon), v.label)),
      h('hr'),
      h('button', { onclick: () => { closePopover(); this.pasteScript(); } }, h('span', { class: 'ic' }, '📋'), 'Paste a script…')), { width: 240, place });
  }

  defaultsFor(type) {
    const them = this.sender !== 'me' ? this.sender : this.p.chat.members[0];
    switch (type) {
      case 'typing': return { from: them };
      case 'notify': return { from: them, text: 'hey are you there?' };
      case 'call': return { with: them, lines: [] };
      case 'react': return { from: this.sender === 'me' ? 'me' : them };
      case 'screen': return { to: 'inbox' };
      default: return {};
    }
  }

  async addImages(files) {
    files = files || await pickFile('image/*,video/*', true);
    const evs = [];
    for (const f of files) {
      try {
        const rec = await addMediaBlob(f, f.name);
        const video = rec.kind === 'video';
        evs.push(newEvent('msg', { from: this.sender, mediaId: rec.id, text: '', ...(video ? { mediaKind: 'video', mediaDur: rec.dur } : {}) }, this.p));
      } catch (err) { toast(`${f.name}: ${err.message}`, 'error'); }
    }
    if (evs.length) this.insert(evs);
  }

  emojiPicker(anchor, onPick) {
    let cat = 0;
    const grid = h('div', { class: 'emoji-grid' });
    const tabs = h('div', { class: 'emoji-tabs' });
    const fill = () => {
      grid.textContent = '';
      EMOJI[cat][1].forEach((em) => grid.append(h('button', { onclick: () => onPick(em) }, em)));
      tabs.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', i === cat));
    };
    EMOJI.forEach(([name, list], i) => tabs.append(h('button', { title: name, onclick: () => { cat = i; fill(); } }, list[0])));
    fill();
    popover(anchor, h('div', { class: 'emoji-pop' }, tabs, grid), { width: 340 });
  }

  gifPicker(anchor) {
    const key = this.settings.giphyKey;
    const results = h('div', { class: 'gif-grid' });
    const q = h('input', { type: 'text', placeholder: key ? 'Search GIPHY' : 'Add a GIPHY key in Voices & Keys to search' });
    const search = async () => {
      if (!key) return;
      results.textContent = 'Loading…';
      try {
        const r = await fetch(`/api/giphy?key=${encodeURIComponent(key)}&q=${encodeURIComponent(q.value)}`);
        const j = await r.json();
        if (!r.ok) throw new Error(j.message || j.meta?.msg || 'GIPHY error');
        results.textContent = '';
        for (const g of j.data || []) {
          const prev = g.images?.fixed_width_small?.url || g.images?.fixed_width?.url;
          const full = g.images?.fixed_width?.url || g.images?.downsized?.url;
          results.append(h('button', { onclick: async () => {
            closePopover();
            toast('Adding GIF…');
            const blob = await (await fetch('/api/fetch?url=' + encodeURIComponent(full))).blob();
            const rec = await addMediaBlob(new Blob([blob], { type: 'image/gif' }), g.title || 'gif');
            this.insert([newEvent('msg', { from: this.sender, mediaId: rec.id, text: '' }, this.p)]);
          } }, h('img', { src: prev, loading: 'lazy' })));
        }
        if (!j.data?.length) results.textContent = 'No GIFs found';
      } catch (e) { results.textContent = e.message; }
    };
    q.addEventListener('keydown', (e) => { if (e.key === 'Enter') search(); });
    popover(anchor, h('div', { class: 'gif-pop' },
      h('div', { class: 'row' }, q, btn('Upload GIF', async () => { closePopover(); await this.addImages(await pickFile('image/gif,image/webp,image/*', true)); }, 'ghost')),
      results), { width: 420 });
    q.focus();
    if (key) search();
  }

  pasteScript() {
    const ta = h('textarea', { class: 'script-ta', placeholder: SCRIPT_HELP, rows: 16 });
    let mode = 'append';
    const modeSeg = h('div', { class: 'seg' },
      h('button', { class: 'on', onclick: (e) => { mode = 'append'; e.target.parentNode.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === e.target)); } }, 'Add to the end'),
      h('button', { onclick: (e) => { mode = 'replace'; e.target.parentNode.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === e.target)); } }, 'Replace everything'));
    const body = h('div', { class: 'paste' },
      h('p', { class: 'hint' }, 'One line per beat. "Name: text" is a message ("me:" is you). Lines above "---" are already on screen when the video starts. [brackets] are actions, "> Name: text" lines after a [call] are what is said on the call.'),
      ta,
      h('div', { class: 'row' }, modeSeg, btn('Load current script', () => { ta.value = toScript(this.p); }, 'ghost')));
    modal('Paste a script', body, [
      ['Cancel', () => true, 'ghost'],
      ['Add to chat', () => {
        if (!ta.value.trim()) return false;
        this.change((p) => {
          const evs = parseScript(ta.value, p);
          if (mode === 'replace') p.events = evs; else p.events.push(...evs);
          // whoever sends messages in the script is in the chat
          const speakers = [...new Set(evs.filter((e) => e.type === 'msg' && e.from !== 'me').map((e) => e.from))];
          if (mode === 'replace' && speakers.length) p.chat.members = speakers;
          else for (const s of speakers) if (!p.chat.members.includes(s)) p.chat.members.push(s);
        }, { inspector: true });
        this.setSender(this.sender);
        toast('Script added');
      }, 'primary'],
    ]);
    setTimeout(() => ta.focus(), 50);
  }

  // ---- projects ------------------------------------------------------------------
  async projectsMenu(anchor) {
    const list = await listProjects();
    popover(anchor, h('div', { class: 'menu' },
      h('button', { onclick: () => { closePopover(); this.newProjectDialog(); } }, h('span', { class: 'ic' }, '＋'), 'New chat'),
      h('button', { onclick: async () => { closePopover(); const p = demoProject(); await putProject(p); this.load(p); } }, h('span', { class: 'ic' }, '★'), 'New from demo'),
      h('button', { onclick: async () => { closePopover(); const p = clone(this.p); p.id = uid('p'); p.name += ' copy'; p.created = p.updated = Date.now(); await putProject(p); this.load(p); toast('Duplicated'); } }, h('span', { class: 'ic' }, '⧉'), 'Duplicate this'),
      h('button', { onclick: () => { closePopover(); this.importProject(); } }, h('span', { class: 'ic' }, '⤓'), 'Open project file…'),
      h('button', { onclick: () => { closePopover(); this.exportProject(); } }, h('span', { class: 'ic' }, '⤒'), 'Save project file…'),
      h('hr'),
      h('div', { class: 'menu-label' }, 'Recent'),
      list.map((x) => h('div', { class: 'menu-proj' + (x.id === this.p.id ? ' cur' : '') },
        h('button', { onclick: async () => { closePopover(); this.load(await getProject(x.id)); } }, x.name),
        x.id !== this.p.id ? h('button', { class: 'x', title: 'Delete', onclick: async (e) => { e.stopPropagation(); if (confirm(`Delete "${x.name}"?`)) { await deleteProject(x.id); closePopover(); toast('Deleted'); } } }, '✕') : null))), { width: 280, place: 'below' });
  }

  newProjectDialog() {
    const p = newProject('New chat');
    p.events = [];
    putProject(p).then(() => this.load(p));
  }

  async exportProject() {
    const ids = new Set();
    const walk = (o) => { if (!o || typeof o !== 'object') return; for (const [k, v] of Object.entries(o)) { if (MEDIA_KEYS.includes(k) && typeof v === 'string') ids.add(v); else if (k === 'overrides') Object.values(v || {}).forEach((x) => x && ids.add(x)); else walk(v); } };
    walk(this.p);
    const media = {};
    for (const id of ids) {
      const rec = await getMedia(id);
      if (rec) { const { blob, ...rest } = rec; media[id] = { ...rest, data: await blobToDataURL(blob) }; }
    }
    download(new Blob([JSON.stringify({ app: 'fake-phone', version: 1, project: this.p, media })], { type: 'application/json' }), `${this.p.name.replace(/[^\w\- ]+/g, '') || 'chat'}.fakephone.json`);
  }

  async importProject() {
    const [f] = await pickFile('.json,application/json');
    if (!f) return;
    try {
      const j = JSON.parse(await f.text());
      const p = j.project || j;
      for (const [id, m] of Object.entries(j.media || {})) {
        const { data, ...rest } = m;
        await putMedia({ ...rest, id, blob: await dataURLToBlob(data) });
      }
      if (await getProject(p.id)) p.id = uid('p');
      await putProject(migrate(p));
      this.load(p);
      toast('Project opened');
    } catch (e) { toast('Could not open that file: ' + e.message, 'error'); }
  }

  // ---- transport -----------------------------------------------------------------
  bindChrome() {
    document.getElementById('projName').addEventListener('input', (e) => this.change((p) => { p.name = e.target.value || 'Untitled'; }, { key: 'name', list: false }));
    document.getElementById('btnProjects').onclick = (e) => this.projectsMenu(e.currentTarget);
    document.getElementById('btnUndo').onclick = () => this.undo();
    document.getElementById('btnRedo').onclick = () => this.redo();
    document.getElementById('btnExport').onclick = () => this.panels.render('export');
    document.querySelectorAll('.tabs button').forEach((b) => { b.onclick = () => this.panels.render(b.dataset.tab); });
    const wrap = document.querySelector('.stage-wrap');
    const fit = () => {
      const r = wrap.getBoundingClientRect();
      const s = Math.min(r.width / 1080, r.height / 1920);
      this.canvas.style.width = Math.floor(1080 * s) + 'px';
      this.canvas.style.height = Math.floor(1920 * s) + 'px';
    };
    new ResizeObserver(fit).observe(wrap);
    fit();
  }

  bindTransport() {
    document.getElementById('btnPlay').onclick = () => (this.playing ? this.pause() : this.playFrom(this.t >= this.tl.duration - 0.05 ? 0 : this.t));
    document.getElementById('btnStart').onclick = () => { this.pause(); this.seek(0); };
    const scrub = document.getElementById('scrub');
    const at = (e) => {
      const r = scrub.getBoundingClientRect();
      return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * this.tl.duration;
    };
    scrub.addEventListener('pointerdown', (e) => {
      scrub.setPointerCapture(e.pointerId);
      const was = this.playing;
      this.pause();
      this.seek(at(e));
      const move = (m) => this.seek(at(m));
      const up = () => { scrub.removeEventListener('pointermove', move); scrub.removeEventListener('pointerup', up); if (was) this.playFrom(this.t); };
      scrub.addEventListener('pointermove', move);
      scrub.addEventListener('pointerup', up);
    });
    const vol = document.getElementById('vol');
    vol.value = this.settings.volume;
    vol.oninput = () => { this.settings.volume = Number(vol.value); this.settings.muted = false; this.engine.setVolume(this.settings.volume); this.saveSettings(); this.syncMute(); };
    document.getElementById('btnMute').onclick = () => { this.settings.muted = !this.settings.muted; this.engine.setVolume(this.settings.muted ? 0 : this.settings.volume); this.saveSettings(); this.syncMute(); };
    this.syncMute();
  }

  syncMute() { document.getElementById('btnMute').textContent = this.settings.muted ? '🔇' : '🔊'; }

  renderTicks() {
    const box = document.querySelector('.scrub-ticks');
    if (!box || !this.tl) return;
    box.textContent = '';
    const d = this.tl.duration || 1;
    for (const e of this.p.events) {
      const m = this.tl.marks[e.id];
      if (!m || e.pre) continue;
      box.append(h('i', { class: 'tick ' + e.type + (e.from === 'me' ? ' me' : ''), style: { left: (m.t0 / d) * 100 + '%', width: Math.max(0.15, ((m.t1 - m.t0) / d) * 100) + '%' }, title: this.describe(e) }));
    }
  }

  seek(t) {
    this.t = Math.max(0, Math.min(this.tl.duration, t));
    this.dirty = true;
  }

  async playFrom(t) {
    await this.engine.ready;
    await this.prepareAudio();
    this.seek(t);
    this.engine.play(this.tl, this.p, this.t);
    setVideoPlaying(true);
    this.playing = true;
    document.getElementById('btnPlay').textContent = '❚❚';
  }

  pause() {
    if (this.playing) this.t = Math.min(this.engine.now(), this.tl.duration);
    this.engine.stop();
    setVideoPlaying(false);
    this.playing = false;
    const b = document.getElementById('btnPlay');
    if (b) b.textContent = '▶';
    this.dirty = true;
  }

  loop() {
    const frame = () => {
      if (this.playing) {
        this.t = this.engine.now();
        this.engine.tick();
        if (this.t >= this.tl.duration) { this.t = this.tl.duration; this.pause(); }
        this.dirty = true;
      }
      if (this.dirty) {
        this.dirty = false;
        try { renderFrame(this.ctx, this.p, this.tl, this.t); } catch (e) { console.error(e); }
        document.getElementById('timeLabel').textContent = `${fmtTime(this.t)} / ${fmtTime(this.tl.duration)}`;
        document.querySelector('.scrub-head').style.left = (this.t / (this.tl.duration || 1)) * 100 + '%';
        this.highlightPlaying();
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  bindKeys() {
    document.addEventListener('keydown', (e) => {
      const typing = e.target.matches('input, textarea, select, [contenteditable]');
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z' && !typing) { e.preventDefault(); e.shiftKey ? this.redo() : this.undo(); return; }
      if (mod && e.key.toLowerCase() === 'y' && !typing) { e.preventDefault(); this.redo(); return; }
      if (typing) return;
      if (e.key === ' ') { e.preventDefault(); document.getElementById('btnPlay').click(); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && this.sel) { e.preventDefault(); this.removeEvent(this.sel); }
      else if (mod && e.key.toLowerCase() === 'd' && this.sel) { e.preventDefault(); this.duplicateEvent(this.sel); }
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const i = this.p.events.findIndex((x) => x.id === this.sel);
        const n = this.p.events[Math.max(0, Math.min(this.p.events.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
        if (n) { this.select(n.id); document.querySelector(`.ev[data-id="${n.id}"]`)?.scrollIntoView({ block: 'nearest' }); }
      } else if (e.key === 'Home') { this.pause(); this.seek(0); }
      else if (e.key === 'Escape') closePopover();
    });
  }
}
