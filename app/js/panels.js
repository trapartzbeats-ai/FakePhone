// Side panel tabs: the selected event's inspector, Look, People, Voices & keys, Sound, Motion, Export.
import { h, field, row, section, text, area, num, range, select, toggle, seg, color, btn, pickFile, toast, closePopover } from './ui.js';
import { THEMES, DEVICES } from './themes.js';
import { EVENT_TYPES, REACTIONS, SCREENS, CONTACT_COLORS, ensureThemeApp, defaultHome, newHomeApp, BUBBLE_FX, SCREEN_FX, CAMERA_FX, CAMERA_MOVES, CAMERA_TARGETS, nameOf, chatTitle, voiceIdOf } from './model.js';
import { addMediaBlob, mediaURL } from './media.js';
import { getMedia } from './store.js';
import { drawApp } from './render/appicons.js';
import { APP_CHOICES, APP_NAMES, themeApp } from './apps.js';
import { SOUND_SLOTS, FX_SOUNDS, peaksOf } from './audio.js';
import { ELEVEN_MODELS, listVoices, tts, ttsKey, usesStyle, MicRecorder, trimTake } from './voice.js';
import { voiceLines, missingVoices, generateVoices } from './voicegen.js';
import { agentConfig, ensureAgentLoop, stopAgentUi } from './agent.js';
import { MOTION_KEYS, EASE_NAMES, SPRINGS, curve } from './motion.js';
import { exportVideo } from './export.js';
import { uid, IS_MAC, MOD } from './util.js';


export class Panels {
  constructor(ed) {
    this.ed = ed;
    this.tab = 'edit';
    this.body = document.getElementById('tabBody');
  }

  get p() { return this.ed.p; }

  // Shorthand: mutate the project. Typing-style edits pass a key so they coalesce in undo.
  set(fn, key, opts = {}) { this.ed.change(fn, { key, ...opts }); }

  render(tab) {
    if (tab) this.tab = tab;
    document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === this.tab));
    const scroll = this.body.scrollTop;
    this.body.textContent = '';
    const fn = { edit: this.edit, look: this.look, people: this.people, home: this.homeTab, voices: this.voices, sound: this.sound, motion: this.motion, export: this.exportTab }[this.tab];
    this.body.append(fn.call(this));
    if (!tab || tab === this.tab) this.body.scrollTop = scroll;
  }

  // ---- shared pickers ---------------------------------------------------------------
  whoOptions(includeMe = true) {
    return [...(includeMe ? [['me', `Me (${this.p.me.name})`]] : []), ...this.p.contacts.map((c) => [c.id, c.name])];
  }

  voiceSelect(value, onChange) {
    const voices = this.ed.settings.voices || [];
    const opts = [['', 'No voice'], ...voices.map((v) => [v.id, v.name + (v.tags ? ' · ' + v.tags : '')])];
    if (value && !voices.some((v) => v.id === value)) opts.push([value, 'Voice ID ' + value.slice(0, 10) + '…']);
    const wrap = h('div', { class: 'voice-pick' }, select(value || '', opts, onChange));
    wrap.append(h('button', { class: 'icon-btn', title: 'Paste a voice ID', onclick: () => {
      const id = prompt('ElevenLabs voice ID', value || '');
      if (id != null) onChange(id.trim());
    } }, 'ID'));
    return wrap;
  }

  // Voice line for a message / call line / voice-over. owner.voice holds the result.
  voiceWidget(owner, getText, who, onDone) {
    const ed = this.ed;
    const v = owner.voice || null;
    const src = v?.src || 'none';
    const box = h('div', { class: 'voice-box' });
    const status = h('div', { class: 'voice-status' });
    const sayText = () => (owner.voice?.say || getText() || '').trim();
    const speakerVoice = () => owner.voice?.voiceId || voiceIdOf(this.p, who);

    const setVoice = (val) => { this.set(() => { owner.voice = val; }, null, { inspector: true }); onDone?.(); };
    const storeAudio = async (blob, extra, name) => {
      const rec = await addMediaBlob(blob, name, { kind: 'audio' });
      const buf = await ed.engine.loadMedia(rec.id);
      return { mediaId: rec.id, dur: buf ? buf.duration : 0, peaks: buf ? peaksOf(buf) : null, ...extra };
    };

    const tabs = seg(src, [['none', 'None'], ['tts', 'AI voice'], ['mic', 'Record'], ['file', 'File']], (s) => {
      if (s === 'none') setVoice(null);
      else this.set(() => { owner.voice = { ...(owner.voice || {}), src: s }; }, null, { inspector: true });
    });
    box.append(tabs);

    if (src === 'tts') {
      const vid = speakerVoice();
      const st = ed.settings.eleven;
      const fresh = v?.mediaId && v.key === ttsKey(vid, sayText(), st);
      box.append(
        field('Speaker voice', this.voiceSelect(owner.voice?.voiceId || '', (id) => this.set(() => { owner.voice = { ...owner.voice, voiceId: id || undefined }; }, null, { inspector: true })),
          owner.voice?.voiceId ? null : (vid ? `Using ${nameOf(this.p, who) || 'narrator'}'s voice` : 'Pick a voice here or give this person a voice in People')),
        field('Say (optional)', text(owner.voice?.say || '', (s) => { owner.voice = { ...owner.voice, say: s || undefined }; this.ed.save(); }, { placeholder: 'Leave empty to read the text as written' })),
        row(
          btn(v?.mediaId ? 'Regenerate' : 'Generate voice', async (e) => {
            const key = ed.settings.elevenKey;
            if (!key) { toast('Add your ElevenLabs API key in Voices & Keys first', 'error'); this.render('voices'); return; }
            const id = speakerVoice();
            if (!id) { toast('Pick a voice for this line or person first', 'error'); return; }
            const say = sayText();
            if (!say) { toast('Nothing to say: the text is empty', 'error'); return; }
            e.target.disabled = true; e.target.textContent = 'Generating…';
            try {
              const blob = await tts(key, id, say, st);
              const val = await storeAudio(blob, { src: 'tts', key: ttsKey(id, say, st), voiceId: owner.voice?.voiceId, say: owner.voice?.say }, 'tts');
              setVoice(val);
              ed.engine.preview(val.mediaId);
            } catch (err) { toast(err.message, 'error'); e.target.disabled = false; e.target.textContent = 'Generate voice'; }
          }, 'primary small'),
          v?.mediaId ? btn('▶ Play', () => ed.engine.preview(v.mediaId), 'ghost small') : null,
          v?.mediaId ? h('span', { class: 'pill ' + (fresh ? 'ok' : 'warn') }, fresh ? `${v.dur.toFixed(1)}s` : 'text changed') : null));
    } else if (src === 'mic') {
      const rec = new MicRecorder();
      const meter = h('div', { class: 'meter' }, h('i'));
      const timer = h('span', { class: 'pill' }, '0.0s');
      let recording = false;
      const recBtn = btn('● Record', async () => {
        if (!recording) {
          try {
            await ed.engine.resume();
            await rec.start((peak, secs) => { meter.firstChild.style.width = Math.min(100, peak * 140) + '%'; timer.textContent = secs.toFixed(1) + 's'; });
            recording = true; recBtn.textContent = '■ Stop'; recBtn.classList.add('rec');
          } catch (err) { toast('Microphone blocked: ' + err.message, 'error'); }
        } else {
          recording = false;
          const blob = await rec.stop();
          const trimmed = await trimTake(ed.engine, blob, false);
          setVoice(await storeAudio(trimmed.blob, { src: 'mic' }, 'mic take'));
          toast('Take saved (silence trimmed)');
        }
      }, 'rec-btn small');
      box.append(row(recBtn, timer, meter), v?.mediaId ? row(btn('▶ Play take', () => ed.engine.preview(v.mediaId), 'ghost small'), h('span', { class: 'pill ok' }, `${(v.dur || 0).toFixed(1)}s`)) : h('p', { class: 'hint' }, 'Press Record, speak the line, press Stop. Silence at both ends is cut off.'));
    } else if (src === 'file') {
      box.append(row(
        btn('Choose audio file', async () => {
          const [f] = await pickFile('audio/*');
          if (f) setVoice(await storeAudio(f, { src: 'file' }, f.name));
        }, 'small'),
        v?.mediaId ? btn('▶ Play', () => ed.engine.preview(v.mediaId), 'ghost small') : null,
        v?.mediaId ? h('span', { class: 'pill ok' }, `${(v.dur || 0).toFixed(1)}s`) : null));
    }
    box.append(status);
    return box;
  }

  mediaThumb(id, onPick, onClear, label = 'Choose image', accept = 'image/*') {
    const box = h('span', { class: 'thumb-wrap' });
    if (id) getMedia(id).then((rec) => {
      if (!rec) return;
      const u = URL.createObjectURL(rec.blob);
      box.append(rec.kind === 'video' ? h('video', { class: 'thumb-lg', src: u, muted: true, preload: 'metadata' }) : h('img', { class: 'thumb-lg', src: u }));
    });
    return row(id ? box : null, btn(id ? 'Replace' : label, async () => {
      const [f] = await pickFile(accept);
      if (!f) return;
      try { const rec = await addMediaBlob(f, f.name); onPick(rec.id, rec); } catch (err) { toast(err.message, 'error'); }
    }, 'small'), id && onClear ? btn('Remove', onClear, 'ghost small') : null);
  }

  // A small live preview of an app icon (drawn with the same code as the phone screen).
  appThumb(spec, size = 40) {
    const cv = h('canvas', { class: 'app-thumb', width: size * 2, height: size * 2, style: { width: size + 'px', height: size + 'px' } });
    drawApp(cv.getContext('2d'), spec, 0, 0, size * 2, this.p);
    return cv;
  }

  // ---- Edit (selected event) ----------------------------------------------------------
  edit() {
    const e = this.ed.ev(this.ed.sel);
    if (!e) {
      return h('div', { class: 'tab-pad' },
        section('Nothing selected',
          h('p', { class: 'hint' }, 'Click a line in the script to edit it here. Type in the box under the script to add messages: Enter adds, Tab switches who is talking.'),
          h('ul', { class: 'tips' },
            h('li', {}, h('b', {}, 'Space'), ' play / pause'),
            h('li', {}, h('b', {}, '↑ ↓'), ' move through the script'),
            h('li', {}, h('b', {}, 'Del'), ' delete line · ', h('b', {}, MOD + 'D'), ' duplicate'),
            h('li', {}, h('b', {}, MOD + 'Z'), ' undo · ', h('b', {}, MOD + (IS_MAC ? '⇧Z' : 'Shift+Z')), ' redo'),
            h('li', {}, 'Drag lines by ', h('b', {}, '⠿'), ' to reorder'))));
    }
    const k = (s) => e.id + s;
    const wrap = h('div', { class: 'tab-pad' });
    const head = h('div', { class: 'insp-head' }, h('span', { class: 'ic' }, EVENT_TYPES[e.type].icon), h('b', {}, EVENT_TYPES[e.type].label),
      h('span', { class: 'spacer' }),
      btn('▶ Play from here', () => this.ed.playFrom(this.ed.tl.marks[e.id]?.t0 ?? 0), 'ghost small'));
    wrap.append(head);
    const m = this.ed.tl.marks[e.id];
    if (m && !e.pre) wrap.append(h('p', { class: 'hint' }, `Starts at ${m.t0.toFixed(1)}s · takes ${(m.t1 - m.t0).toFixed(1)}s`));

    const S = (title, ...kids) => wrap.append(section(title, ...kids));
    const msgTargets = (side) => [['', side === 'me' ? 'Auto: my last message' : 'Auto: the message before'], ...this.p.events.filter((x) => x.type === 'msg' && (!side || x.from === side || side === 'any')).map((x) => [x.id, `${nameOf(this.p, x.from)}: ${(x.text || 'image').slice(0, 40)}`])];

    switch (e.type) {
      case 'msg': {
        const me = e.from === 'me';
        const re = { inspector: true };
        S(null,
          field('From', seg(e.from, this.whoOptions().map(([v, l]) => [v, v === 'me' ? 'Me' : l]), (v) => this.set(() => { e.from = v; }, null, re))),
          field('Kind', seg(e.vn ? 'vn' : 'text', [['text', 'Text / image'], ['vn', '🎤 Voice note']], (v) => this.set(() => { e.vn = v === 'vn'; }, null, re))),
          field(e.vn ? 'What the voice note says (for the AI voice and captions)' : 'Text', h('div', { class: 'with-emoji' }, area(e.text, (v) => this.set(() => { e.text = v; }, k('text')), { placeholder: e.vn ? 'Say something…' : e.mediaId ? 'Caption (optional)' : 'Message text' }),
            h('button', { class: 'icon-btn', title: 'Emoji', onclick: (x) => this.ed.emojiPicker(x.currentTarget, (em) => this.ed.insertText(em)) }, '😀'))),
          e.vn ? null : field('Image / GIF / video', this.mediaThumb(e.mediaId,
            (id, rec) => this.set(() => { e.mediaId = id; e.mediaKind = rec?.kind === 'video' ? 'video' : 'image'; e.mediaDur = rec?.dur || 0; }, null, re),
            () => this.set(() => { e.mediaId = null; e.mediaKind = 'image'; e.mediaDur = 0; }, null, re), 'Add image or video', 'image/*,video/*')),
          !e.vn && e.mediaId && e.mediaKind === 'video' ? field('How the video plays', seg(e.vmode || 'full', [['full', 'Tap, then full screen'], ['inline', 'Plays in the bubble']], (v) => this.set(() => { e.vmode = v; }, null, re))) : null,
          !e.vn && e.mediaId && e.mediaKind === 'video' ? h('p', { class: 'hint' }, `Video length ${(e.mediaDur || 0).toFixed(1)}s. Its sound plays with it, and background music dips under it. The story waits for it to finish.`) : null,
          field('Already on screen when the video starts', toggle(e.pre, (v) => this.set(() => { e.pre = v; }, null, re))));
        if (!e.pre) {
          if (e.vn) {
            S('Voice note',
              me ? field('How it is sent', seg(e.vnMode || 'record', [['record', 'Recorded live'], ['after', 'Sent, then played']], (v) => this.set(() => { e.vnMode = v; }))) : null,
              h('p', { class: 'hint' }, me
                ? (e.vnMode === 'after' ? 'The bubble lands, then plays with a moving waveform.' : 'The recording bar runs while the voice plays, then it is sent.')
                : 'Shows "…" (WhatsApp: "recording audio…"), lands, then plays with a moving waveform.'),
              e.voice?.mediaId ? null : h('p', { class: 'hint warn' }, 'Give it a voice below (AI, recording or file). Until then it is silent and uses a guessed length.'));
          } else if (me) {
            S('Typing',
              field('How it is sent', select(e.typing, [['auto', 'Auto (type it on the keyboard)'], ['keyboard', 'Type it on the keyboard'], ['instant', 'Just appears']], (v) => this.set(() => { e.typing = v; }))),
              e.typing !== 'instant' ? field('Type this first, then delete it', area(e.draft || '', (v) => this.set(() => { e.draft = v; }, k('draft')), { rows: 2, placeholder: 'e.g. I miss you (typed, then deleted)' }),
                e.text ? 'The hesitation beat: types this, pauses, holds delete, then types the real message.' : 'With no message text it is typed, deleted and never sent.') : null,
              e.draft && e.typing !== 'instant' ? field('Pause before deleting (seconds)', num(e.draftPause, (v) => this.set(() => { e.draftPause = v; }, k('dp')), { min: 0, step: 0.1, placeholder: '0.9' })) : null);
          } else {
            S('Typing',
              field('Typing bubble first', select(e.typing === 'instant' ? 'instant' : 'auto', [['auto', 'Yes, show "…" first'], ['instant', 'No, it just arrives']], (v) => this.set(() => { e.typing = v; }))),
              e.typing !== 'instant' ? field('Typing time (seconds)', num(e.typingDur, (v) => this.set(() => { e.typingDur = v; }, k('td')), { min: 0.2, step: 0.1, placeholder: 'auto' })) : null);
          }
          S('Timing', field('Hold after it appears (seconds)', num(e.hold, (v) => this.set(() => { e.hold = v; }, k('hold')), { min: 0, step: 0.1, placeholder: 'auto (reading time)' })));
          S('Effects',
            row(field('Bubble effect', select(e.effect || '', [['', 'None'], ...Object.entries(BUBBLE_FX).map(([id, x]) => [id, x.label])], (v) => this.set(() => { e.effect = v || null; }))),
              field('Screen effect', select(e.screenFx || '', [['', 'None'], ...Object.entries(SCREEN_FX).map(([id, x]) => [id, x.label])], (v) => this.set(() => { e.screenFx = v || null; })))),
            field('Camera', seg(e.cam || 'none', [['none', 'None'], ...Object.entries(CAMERA_FX)], (v) => this.set(() => { e.cam = v; }, null, re))),
            e.cam === 'zoom' ? field('Zoom', range(e.camZoom || 1.8, (v) => this.set(() => { e.camZoom = v; }, k('cz')), { min: 1.1, max: 3.5, step: 0.05, fmt: (v) => v.toFixed(2) + '×' }),
              me && !e.vn ? 'Zooms onto the typing, follows the bubble when it sends, then eases back out.' : 'Zooms onto the bubble when it lands, then eases back out.') : null,
            h('p', { class: 'hint' }, 'In a script: add tags after the text, e.g. "me: happy birthday!! {confetti} {zoom}".'));
          S(e.vn ? 'Voice (required)' : 'Voice', this.voiceWidget(e, () => e.text, e.from));
        }
        break;
      }
      case 'typing':
        S(null,
          field('Who is typing', select(e.from, this.whoOptions(false), (v) => this.set(() => { e.from = v; }))),
          field('How long (seconds)', num(e.dur, (v) => this.set(() => { e.dur = v ?? 2; }, k('dur')), { min: 0.2 })),
          h('p', { class: 'hint' }, 'The "…" bubble shows, then goes away without a message (a fake-out). Messages already show their own typing bubble.'));
        break;
      case 'pause':
        S(null, field('Seconds', num(e.dur, (v) => this.set(() => { e.dur = v ?? 1; }, k('dur')), { min: 0, step: 0.1 })));
        break;
      case 'stamp':
        S(null,
          field('Text', text(e.text, (v) => this.set(() => { e.text = v; }, k('t')))),
          field('Already on screen at the start', toggle(e.pre, (v) => this.set(() => { e.pre = v; }, null, { inspector: true }))));
        break;
      case 'react':
        S(null,
          field('Reaction', h('div', { class: 'react-row' },
            Object.values(REACTIONS).map((em) => h('button', { class: 'react-btn' + (e.emoji === em ? ' on' : ''), onclick: () => this.set(() => { e.emoji = em; }, null, { inspector: true }) }, em)),
            h('button', { class: 'react-btn', title: 'Any emoji', onclick: (x) => this.ed.emojiPicker(x.currentTarget, (em) => { closePopover(); this.set(() => { e.emoji = em; }, null, { inspector: true }); }) }, '＋'))),
          field('Who reacts', select(e.from, this.whoOptions(), (v) => this.set(() => { e.from = v; }))),
          field('On which message', select(e.target || '', msgTargets('any'), (v) => this.set(() => { e.target = v || null; }))));
        break;
      case 'read':
        S(null, field('Receipt text', text(e.text, (v) => this.set(() => { e.text = v; }, k('t')), { placeholder: `Read ${this.p.status.time}` })),
          h('p', { class: 'hint' }, 'iMessage shows it under your last message, WhatsApp turns the ticks blue, Instagram shows "Seen".'));
        break;
      case 'unsend':
        S(null, field('Which message', select(e.target || '', msgTargets('me'), (v) => this.set(() => { e.target = v || null; }))));
        break;
      case 'notify': {
        const custom = e.app === 'custom';
        const spec = custom ? { app: 'custom', name: e.appName || e.title, color: e.appColor, iconId: e.iconId } : e.app === 'auto' ? themeApp(this.p.theme) : e.app;
        S(null,
          field('From', select(e.from, this.whoOptions(false), (v) => this.set(() => { e.from = v; }))),
          field('App it comes from', row(this.appThumb(spec), select(e.app || 'auto', APP_CHOICES, (v) => this.set(() => { e.app = v; }, null, { inspector: true })))),
          custom ? row(
            field('App name', text(e.appName, (v) => this.set(() => { e.appName = v; }, k('an')), { placeholder: 'Facebook' })),
            field('Colour', color(e.appColor || '#5B5BD6', (v) => this.set(() => { e.appColor = v; }, k('ac'))))) : null,
          custom ? field('App icon', this.mediaThumb(e.iconId, (id) => this.set(() => { e.iconId = id; }, null, { inspector: true }), () => this.set(() => { e.iconId = null; }, null, { inspector: true }), 'Upload icon')) : null,
          field('Title (bold line)', text(e.title, (v) => this.set(() => { e.title = v; }, k('ti')), { placeholder: nameOf(this.p, e.from) })),
          field('Text', area(e.text, (v) => this.set(() => { e.text = v; }, k('t')))),
          field('Show their profile photo', toggle(e.photo, (v) => this.set(() => { e.photo = v; }, null, { inspector: true }))),
          field('Attached picture', this.mediaThumb(e.imageId, (id) => this.set(() => { e.imageId = id; }, null, { inspector: true }), () => this.set(() => { e.imageId = null; }, null, { inspector: true }), 'Add picture')),
          field('Red badge on its home-screen icon', toggle(e.badge !== false, (v) => this.set(() => { e.badge = v; }))),
          field('Banner stays (seconds)', num(e.dur, (v) => this.set(() => { e.dur = v ?? 3.5; }, k('d')), { min: 0.5 })),
          field('Story continues after (seconds)', num(e.wait, (v) => this.set(() => { e.wait = v ?? 1.6; }, k('w')), { min: 0 })),
          h('p', { class: 'hint' }, 'Pick Facebook, Snapchat, Cash App... or upload your own icon for any other app. On the lock screen it lands in the notification list instead. In a script: [notify Jess: tagged you in a photo {facebook}]'));
        break;
      }
      case 'screen':
        S(null, field('Go to', seg(e.to, Object.entries(SCREENS), (v) => this.set(() => { e.to = v; }))));
        break;
      case 'openapp': {
        const apps = [...this.p.home.apps, ...this.p.home.dock];
        S(null,
          field('Tap which app', select(e.app || 'auto', [['auto', `The chat app (${APP_NAMES[themeApp(this.p.theme)]})`], ...apps.map((a) => [a.id, a.name])], (v) => this.set(() => { e.app = v; }))),
          field('It opens to', seg(e.to, [['chat', 'The chat'], ['inbox', 'Messages list']], (v) => this.set(() => { e.to = v; }))),
          h('p', { class: 'hint' }, 'Goes to the home screen first if it is not there, taps the icon, and the app grows out of it. Change the icons in the Home tab. In a script: [home] then [open chat].'));
        break;
      }
      case 'swipe':
        S(null,
          field('Conversation to delete', select(e.row, [['chat', `${chatTitle(this.p)} (this chat)`], ...this.p.inbox.map((r) => [r.id, r.name])], (v) => this.set(() => { e.row = v; }))),
          h('p', { class: 'hint' }, 'Opens the messages list if needed, swipes the row left, taps Delete. Edit the other conversations in People.'));
        break;
      case 'call': {
        S(null,
          field('Direction', seg(e.direction, [['in', 'Incoming'], ['out', 'Outgoing']], (v) => this.set(() => { e.direction = v; }))),
          field('With', select(e.with, this.whoOptions(false), (v) => this.set(() => { e.with = v; }))),
          field('What happens', seg(e.outcome, [['answer', 'Answered'], ['decline', 'Declined'], ['missed', 'Missed']], (v) => this.set(() => { e.outcome = v; }, null, { inspector: true }))),
          field('Rings for (seconds)', num(e.ring, (v) => this.set(() => { e.ring = v ?? 4; }, k('r')), { min: 0.8 })),
          e.outcome === 'answer' ? field('Talk at least (seconds)', num(e.talk, (v) => this.set(() => { e.talk = v ?? 3; }, k('talk')), { min: 0 })) : null);
        if (e.outcome === 'answer') {
          const lines = h('div', { class: 'call-lines' });
          e.lines.forEach((l, i) => {
            lines.append(h('div', { class: 'call-line' },
              row(select(l.from, this.whoOptions(), (v) => this.set(() => { l.from = v; }, null, { inspector: true })),
                h('span', { class: 'spacer' }),
                h('button', { class: 'icon-btn', title: 'Remove line', onclick: () => this.set(() => { e.lines.splice(i, 1); }, null, { inspector: true }) }, '✕')),
              area(l.text, (v) => this.set(() => { l.text = v; }, k('l' + i)), { rows: 2, placeholder: 'What they say' }),
              this.voiceWidget(l, () => l.text, l.from)));
          });
          S('On the call',
            lines,
            btn('+ Add line', () => this.set(() => { e.lines.push({ id: uid('l'), from: e.lines.length % 2 ? e.with : 'me', text: '', voice: null }); }, null, { inspector: true }), 'ghost small'),
            h('p', { class: 'hint' }, 'Lines play as voices while the call timer runs. Turn on captions in Look to show them as subtitles.'));
        }
        break;
      }
      case 'voiceover':
        S(null,
          field('Text', area(e.text, (v) => this.set(() => { e.text = v; }, k('t')))),
          field('Play over the next beat (do not wait for it)', toggle(e.overlap, (v) => this.set(() => { e.overlap = v; })))),
        S('Narrator voice', this.voiceWidget(e, () => e.text, 'narrator'));
        break;
      case 'camera': {
        const zoomy = e.move === 'zoom' || e.move === 'push';
        const targets = [...Object.entries(CAMERA_TARGETS), ...this.p.events.filter((x) => x.type === 'msg').map((x) => [x.id, `Message: ${(x.text || 'image').slice(0, 34)}`])];
        S(null,
          field('Move', seg(e.move, Object.entries(CAMERA_MOVES), (v) => this.set(() => { e.move = v; }, null, { inspector: true }))),
          zoomy ? field('On', select(e.target || (e.move === 'push' ? 'center' : 'last'), targets, (v) => this.set(() => { e.target = v; }))) : null,
          zoomy ? field('Zoom', range(e.zoom ?? (e.move === 'push' ? 1.25 : 1.8), (v) => this.set(() => { e.zoom = v; }, k('z')), { min: 1.05, max: 3.5, step: 0.05, fmt: (v) => v.toFixed(2) + '×' })) : null,
          e.move === 'shake' ? field('Strength', range(e.amount ?? 1, (v) => this.set(() => { e.amount = v; }, k('a')), { min: 0.2, max: 3, step: 0.1, fmt: (v) => v.toFixed(1) })) : null,
          field(e.move === 'push' ? 'Push length (seconds)' : 'Move length (seconds)', num(e.dur, (v) => this.set(() => { e.dur = v; }, k('d')), { min: 0.1, step: 0.1, placeholder: e.move === 'push' ? '5' : e.move === 'shake' ? '0.7' : 'Motion tab' })),
          field('Story continues after (seconds)', num(e.wait, (v) => this.set(() => { e.wait = v ?? 0; }, k('w')), { min: 0, step: 0.1 })),
          h('p', { class: 'hint' }, 'Zoom and push stay until a "Back to full view" move; "Last message" follows the newest bubble as the chat goes on. A message’s own camera effect comes back by itself.'));
        break;
      }
      case 'sound':
        S(null,
          field('Sound', select(e.mediaId ? '__file' : e.sound, [...FX_SOUNDS.map((s) => [s, s]), ['__file', 'Custom file…']], async (v) => {
            if (v === '__file') {
              const [f] = await pickFile('audio/*');
              if (f) { const rec = await addMediaBlob(f, f.name, { kind: 'audio' }); const buf = await this.ed.engine.loadMedia(rec.id); this.set(() => { e.mediaId = rec.id; e.dur = buf?.duration || 0; }, null, { inspector: true }); }
            } else this.set(() => { e.sound = v; e.mediaId = null; }, null, { inspector: true });
          })),
          row(btn('▶ Preview', () => this.ed.engine.preview(e.mediaId || e.sound, this.p), 'ghost small')),
          field('Story continues after (seconds)', num(e.wait, (v) => this.set(() => { e.wait = v ?? 0; }, k('w')), { min: 0 })));
        break;
    }
    wrap.append(row(btn('Duplicate', () => this.ed.duplicateEvent(e.id), 'ghost small'), btn('Delete', () => this.ed.removeEvent(e.id), 'danger small')));
    return wrap;
  }

  // ---- Look --------------------------------------------------------------------------
  look() {
    const p = this.p;
    const w = h('div', { class: 'tab-pad' });
    const re = { inspector: true };
    const themeCards = h('div', { class: 'theme-cards' }, Object.entries(THEMES).map(([id, t]) =>
      h('button', { class: 'theme-card ' + id + (p.theme === id ? ' on' : ''), onclick: () => this.set(() => { p.theme = id; ensureThemeApp(p); }, null, re) },
        h('span', { class: 'sw' }, h('i', { class: 'a' }), h('i', { class: 'b' })), t.label)));
    w.append(section('App', themeCards,
      row(toggle(p.dark, (v) => this.set(() => { p.dark = v; }), 'Dark mode'), toggle(p.receipts, (v) => this.set(() => { p.receipts = v; }), 'Delivered / Read'))));
    w.append(section('Phone',
      field('Device', select(p.device, Object.entries(DEVICES).map(([k, d]) => [k, d.label]), (v) => this.set(() => { p.device = v; }))),
      field('Framing', seg(p.layout, [['phone', 'Phone on a background'], ['screen', 'Full screen (9:16)']], (v) => this.set(() => { p.layout = v; }, null, re))),
      p.layout === 'phone' ? this.backdrop('Background', p.background, true) : null,
      field('Start on', seg(p.startScreen, Object.entries(SCREENS), (v) => this.set(() => { p.startScreen = v; }))),
      this.backdrop('Lock screen wallpaper', p.wallpaper, false)));
    w.append(section('Status bar',
      row(field('Time', text(p.status.time, (v) => this.set(() => { p.status.time = v; }, 'st.time'))), field('Lock screen date', text(p.status.date, (v) => this.set(() => { p.status.date = v; }, 'st.date')))),
      field('Battery', range(p.status.battery, (v) => this.set(() => { p.status.battery = v; }, 'st.bat'), { min: 1, max: 100, step: 1, fmt: (v) => v + '%' })),
      row(field('Signal', select(String(p.status.signal), [['4', '4 bars'], ['3', '3 bars'], ['2', '2 bars'], ['1', '1 bar'], ['0', 'No signal']], (v) => this.set(() => { p.status.signal = Number(v); }))),
        field('Carrier', text(p.status.carrier || '', (v) => this.set(() => { p.status.carrier = v; }, 'st.car'), { placeholder: 'none' }))),
      toggle(p.status.wifi, (v) => this.set(() => { p.status.wifi = v; }), 'Wi-Fi')));
    w.append(section('Typing & pace',
      field('Keyboard', seg(p.keyboard, [['auto', 'Shows when I type'], ['always', 'Always up'], ['never', 'Never']], (v) => this.set(() => { p.keyboard = v; }))),
      field('Typing speed', range(p.typingSpeed, (v) => this.set(() => { p.typingSpeed = v; }, 'cps'), { min: 4, max: 30, step: 1, fmt: (v) => v + ' letters/s' })),
      field('Reading time', range(p.pace, (v) => this.set(() => { p.pace = v; }, 'pace'), { min: 0.4, max: 2.5, step: 0.05, fmt: (v) => (v < 1 ? 'faster ' : v > 1 ? 'slower ' : '') + '×' + v.toFixed(2) })),
      field('Emoji style', seg(p.emojiStyle, [['noto', 'Noto (Google)'], ['system', IS_MAC ? 'Apple' : 'Windows']], (v) => this.set(() => { p.emojiStyle = v; })))));
    w.append(section('Video',
      toggle(p.captions, (v) => this.set(() => { p.captions = v; }), 'Captions for voice lines'),
      toggle(p.showTouches, (v) => this.set(() => { p.showTouches = v; }), 'Show finger taps (calls, swipes)')));
    return w;
  }

  backdrop(label, spec, allowGreen) {
    const re = { inspector: true };
    const types = [['gradient', 'Gradient'], ['color', 'Color'], ...(allowGreen ? [['green', 'Green screen']] : []), ['image', 'Image']];
    return field(label, h('div', { class: 'backdrop' },
      seg(spec.type, types, (v) => this.set(() => { spec.type = v; }, null, re)),
      spec.type === 'gradient' ? row(color(spec.color, (v) => this.set(() => { spec.color = v; }, label + 'c1')), color(spec.color2 || spec.color, (v) => this.set(() => { spec.color2 = v; }, label + 'c2'))) : null,
      spec.type === 'color' ? row(color(spec.color, (v) => this.set(() => { spec.color = v; }, label + 'c1'))) : null,
      spec.type === 'image' ? this.mediaThumb(spec.mediaId, (id) => this.set(() => { spec.mediaId = id; }, null, re)) : null));
  }

  // ---- People ------------------------------------------------------------------------
  people() {
    const p = this.p;
    const re = { inspector: true };
    const w = h('div', { class: 'tab-pad' });
    const tiles = h('div', { class: 'photo-grid' },
      this.photoTile('You', p.me, p.me.name),
      ...p.contacts.map((c) => this.photoTile(c.name, c)),
      p.chat.members.length > 1 ? this.photoTile('Group photo', p.chat, chatTitle(p)) : null,
      ...p.inbox.map((r) => this.photoTile(r.name, r)));
    w.append(section('Profile pictures', tiles,
      h('p', { class: 'hint' }, 'Click a circle to choose a photo for it. They show everywhere: chat, messages list, calls, notifications. The group photo is used in group chats.')));
    w.append(section('You',
      row(this.avatarBtn(p.me), field('Your name', text(p.me.name, (v) => this.set(() => { p.me.name = v; }, 'me.name')))),
      field('Your voice', this.voiceSelect(p.me.voiceId, (v) => this.set(() => { p.me.voiceId = v; }, null, re)))));
    const list = h('div', { class: 'people' });
    p.contacts.forEach((c, i) => {
      const inChat = p.chat.members.includes(c.id);
      list.append(h('div', { class: 'person' },
        row(this.avatarBtn(c),
          h('div', { class: 'grow' },
            text(c.name, (v) => this.set(() => { c.name = v; }, c.id + 'name'), { class: 'name-input' }),
            row(color(c.color, (v) => this.set(() => { c.color = v; }, c.id + 'col')), text(c.label || '', (v) => this.set(() => { c.label = v; }, c.id + 'lab'), { placeholder: 'mobile', class: 'small-input' }))),
          h('button', { class: 'icon-btn', title: 'Delete person', onclick: () => {
            if (p.events.some((e) => e.from === c.id || e.with === c.id) && !confirm(`${c.name} has lines in the script. Delete anyway? Their lines stay but show as Unknown.`)) return;
            this.set(() => { p.contacts.splice(i, 1); p.chat.members = p.chat.members.filter((m) => m !== c.id); }, null, re);
          } }, '✕')),
        field('Voice', this.voiceSelect(c.voiceId, (v) => this.set(() => { c.voiceId = v; }, null, re))),
        toggle(inChat, (v) => this.set(() => {
          if (v) { if (!p.chat.members.includes(c.id)) p.chat.members.push(c.id); }
          else if (p.chat.members.length > 1) p.chat.members = p.chat.members.filter((m) => m !== c.id);
          else toast('A chat needs at least one other person');
        }, null, re), 'In this chat')));
    });
    w.append(section('People', list,
      btn('+ Add person', () => this.set(() => { const c = { id: uid('c'), name: 'New person', color: CONTACT_COLORS[p.contacts.length % CONTACT_COLORS.length], avatar: null, voiceId: '', label: 'mobile' }; p.contacts.push(c); }, null, re), 'ghost small'),
      p.chat.members.length > 1 ? field('Group chat name', text(p.chat.name, (v) => this.set(() => { p.chat.name = v; }, 'gname'), { placeholder: chatTitle({ ...p, chat: { ...p.chat, name: '' } }) })) : h('p', { class: 'hint' }, 'Turn on "In this chat" for more people to make a group chat.')));
    w.append(section('Narrator', field('Voice-over voice', this.voiceSelect(p.narrator.voiceId, (v) => this.set(() => { p.narrator.voiceId = v; }, null, re)))));
    const inbox = h('div', { class: 'inbox-rows' });
    p.inbox.forEach((r, i) => inbox.append(h('div', { class: 'inbox-row' },
      row(this.avatarBtn(r), color(r.color || '#8E8E93', (v) => this.set(() => { r.color = v; }, r.id + 'c')), text(r.name, (v) => this.set(() => { r.name = v; }, r.id + 'n'), { class: 'grow' }), text(r.time, (v) => this.set(() => { r.time = v; }, r.id + 't'), { class: 'small-input' }),
        h('button', { class: 'icon-btn', onclick: () => this.set(() => { p.inbox.splice(i, 1); }, null, re) }, '✕')),
      text(r.preview, (v) => this.set(() => { r.preview = v; }, r.id + 'p'), { placeholder: 'Last message' }),
      toggle(r.unread, (v) => this.set(() => { r.unread = v; }), 'Unread'))));
    w.append(section('Other conversations (messages list)', inbox,
      btn('+ Add conversation', () => this.set(() => { p.inbox.push({ id: uid('r'), name: 'Someone', preview: 'hey', time: 'Yesterday', unread: false, color: CONTACT_COLORS[p.inbox.length % CONTACT_COLORS.length] }); }, null, re), 'ghost small')));
    return w;
  }

  // ---- Home screen ------------------------------------------------------------------
  homeTab() {
    const p = this.p;
    const home = p.home;
    const re = { inspector: true };
    const w = h('div', { class: 'tab-pad' });
    w.append(section('Wallpaper',
      field('Same as the lock screen', toggle(!home.wallpaper, (v) => this.set(() => { home.wallpaper = v ? null : structuredClone(p.wallpaper); }, null, re))),
      home.wallpaper ? this.backdrop('Home wallpaper', home.wallpaper, false) : null,
      field('Show app names', toggle(home.labels !== false, (v) => this.set(() => { home.labels = v; })))));

    const presets = [...Object.entries(APP_NAMES), ['custom', 'Custom icon…']];
    const card = (a, list, i, inDock) => {
      const move = (d) => this.set(() => { const j = i + d; if (j >= 0 && j < list.length) [list[i], list[j]] = [list[j], list[i]]; }, null, re);
      return h('div', { class: 'inbox-row home-app' },
        row(this.appThumb(a, 38), text(a.name, (v) => this.set(() => { a.name = v; }, a.id + 'n'), { class: 'grow' }),
          h('button', { class: 'icon-btn', title: 'Move earlier', onclick: () => move(-1) }, '↑'),
          h('button', { class: 'icon-btn', title: 'Move later', onclick: () => move(1) }, '↓'),
          h('button', { class: 'icon-btn', title: 'Remove', onclick: () => this.set(() => { list.splice(i, 1); }, null, re) }, '✕')),
        row(field('Icon', select(a.app, presets, (v) => this.set(() => {
            if (!a.name || a.name === APP_NAMES[a.app]) a.name = APP_NAMES[v] || a.name;
            a.app = v;
          }, null, re))),
          field('Red badge', num(a.badge || 0, (v) => this.set(() => { a.badge = v ?? 0; }, a.id + 'b'), { min: 0, max: 99 }))),
        a.app === 'custom' ? row(color(a.color || '#5B5BD6', (v) => this.set(() => { a.color = v; }, a.id + 'c')),
          this.mediaThumb(a.iconId, (id) => this.set(() => { a.iconId = id; }, null, re), () => this.set(() => { a.iconId = null; }, null, re), 'Upload icon')) : null,
        field('In the dock', toggle(inDock, (v) => {
          if (v && home.dock.length >= 4) { toast('The dock holds 4 apps'); this.render(); return; }
          this.set(() => { list.splice(i, 1); (v ? home.dock : home.apps).push(a); }, null, re);
        })));
    };
    w.append(section(`Dock (${home.dock.length}/4)`, h('div', { class: 'inbox-rows' }, home.dock.map((a, i) => card(a, home.dock, i, true)))));
    w.append(section(`Apps (${home.apps.length})`, h('div', { class: 'inbox-rows' }, home.apps.map((a, i) => card(a, home.apps, i, false))),
      row(btn('+ Add app', () => this.set(() => {
          const used = new Set([...home.apps, ...home.dock].map((a) => a.app));
          home.apps.push(newHomeApp(Object.keys(APP_NAMES).find((k) => !used.has(k)) || 'custom', {}));
        }, null, re), 'ghost small'),
        btn('Reset home screen', () => { if (confirm('Put the default apps back?')) this.set(() => { p.home = defaultHome(); ensureThemeApp(p); }, null, re); }, 'ghost small')),
      home.apps.length > 24 ? h('p', { class: 'hint' }, 'Only the first 24 apps fit on the screen.') : null,
      h('p', { class: 'hint' }, 'Use "Change screen" > Home screen, or "Open an app", in the script. Notifications add a red badge to the icon of the app they come from (turn it off per notification).')));
    return w;
  }

  avatarBtn(c, initialOf = c.name) {
    const b = h('button', { class: 'avatar-btn', title: 'Click to choose a photo', style: { '--c': c.color || '#8E8E93' } }, (initialOf || '?').slice(0, 1).toUpperCase());
    if (c.avatar) mediaURL(c.avatar).then((u) => { b.style.backgroundImage = `url(${u})`; b.textContent = ''; });
    b.onclick = async () => {
      const [f] = await pickFile('image/*');
      if (f) { const rec = await addMediaBlob(f, f.name); this.set(() => { c.avatar = rec.id; }, null, { inspector: true }); }
    };
    b.oncontextmenu = (e) => { e.preventDefault(); this.set(() => { c.avatar = null; }, null, { inspector: true }); };
    return b;
  }

  // One tile per profile picture: click the circle to choose a photo, the x removes it.
  photoTile(label, holder, initialOf) {
    return h('div', { class: 'photo-tile' },
      this.avatarBtn(holder, initialOf),
      h('span', { class: 'ptl', title: label }, label),
      holder.avatar ? h('button', { class: 'ptx', title: 'Remove this photo', onclick: () => this.set(() => { holder.avatar = null; }, null, { inspector: true }) }, '✕') : null);
  }

  // ---- Voices & keys -------------------------------------------------------------------
  voices() {
    const s = this.ed.settings;
    const w = h('div', { class: 'tab-pad' });
    const keyIn = h('input', { type: 'password', value: s.elevenKey || '', placeholder: 'sk_…', autocomplete: 'off', oninput: (e) => { s.elevenKey = e.target.value.trim(); this.ed.saveSettings(); } });
    const loadBtn = btn(s.voices?.length ? `Reload voices (${s.voices.length})` : 'Load my voices', async (e) => {
      if (!s.elevenKey) { toast('Paste your key first', 'error'); return; }
      e.target.disabled = true; e.target.textContent = 'Loading…';
      try {
        s.voices = await listVoices(s.elevenKey);
        this.ed.saveSettings();
        toast(`${s.voices.length} voices loaded`);
      } catch (err) { toast(err.message, 'error'); }
      this.render();
    }, 'primary small');
    w.append(section('ElevenLabs',
      field('API key', keyIn, 'Stays in this browser (local storage); it only goes to ElevenLabs through your local server.'),
      row(loadBtn, h('a', { href: 'https://elevenlabs.io/app/settings/api-keys', target: '_blank', class: 'link' }, 'Get a key')),
      field('Model', select(s.eleven.model, Object.entries(ELEVEN_MODELS), (v) => { s.eleven.model = v; this.ed.saveSettings(); this.render(); })),
      field('Stability', range(s.eleven.stability, (v) => { s.eleven.stability = v; this.ed.saveSettings(); }, { fmt: (v) => v.toFixed(2) }), 'Lower = more emotional range, higher = steadier'),
      field('Similarity', range(s.eleven.similarity, (v) => { s.eleven.similarity = v; this.ed.saveSettings(); }, { fmt: (v) => v.toFixed(2) })),
      usesStyle(s.eleven.model)
        ? field('Style', range(s.eleven.style, (v) => { s.eleven.style = v; this.ed.saveSettings(); }, { fmt: (v) => v.toFixed(2) }))
        : h('p', { class: 'hint' }, 'v4 steers delivery with tags in the text, e.g. "[whispers] do not tell anyone" or "[laughs] no way". Put them in a line’s "Say" box to keep the bubble text clean.')));
    if (s.voices?.length) {
      const list = h('div', { class: 'voice-list' }, s.voices.map((v) => h('div', { class: 'voice-item' },
        h('button', { class: 'icon-btn', title: 'Preview', onclick: () => { if (v.preview) new Audio(v.preview).play(); } }, '▶'),
        h('span', { class: 'grow' }, h('b', {}, v.name), h('small', {}, v.tags)))));
      w.append(section('Your voices', list));
    }
    const p = this.p;
    const lines = this.voiceLines();
    const assigned = lines.filter((l) => l.voiceId);
    w.append(section('Generate',
      h('p', { class: 'hint' }, `${lines.length} lines in the script, ${assigned.length} have a speaker with a voice, ${lines.filter((l) => l.owner.voice?.mediaId).length} already have audio. Give people voices in People.`),
      btn('Generate all missing AI voices', async (e) => {
        if (!s.elevenKey) { toast('Add your API key first', 'error'); return; }
        const todo = missingVoices(assigned, s.eleven);
        if (!todo.length) { toast('Nothing to generate'); return; }
        e.target.disabled = true;
        try {
          await generateVoices(this.ed.engine, s.elevenKey, s.eleven, todo, (done, total) => { e.target.textContent = `Generating ${Math.min(done + 1, total)} / ${total}…`; });
          toast('Voices generated');
        } catch (err) { toast(err.message, 'error'); }
        this.set(() => {}, null, { inspector: true });
      }, 'primary')));

    // narration over the whole video
    const n = p.narration;
    const rec = new MicRecorder();
    const meter = h('div', { class: 'meter' }, h('i'));
    let on = false;
    const narrBtn = btn('● Record narration', async () => {
      const ed = this.ed;
      if (!on) {
        try {
          await ed.engine.resume();
          await rec.start((peak) => { meter.firstChild.style.width = Math.min(100, peak * 140) + '%'; });
          on = true;
          narrBtn.textContent = '■ Stop';
          narrBtn.classList.add('rec');
          ed.playFrom(0);
          const stopAtEnd = setInterval(() => { if (!ed.playing && on) { clearInterval(stopAtEnd); narrBtn.click(); } }, 200);
        } catch (err) { toast('Microphone blocked: ' + err.message, 'error'); }
      } else {
        on = false;
        ed.pause();
        const blob = await rec.stop();
        const take = await trimTake(ed.engine, blob, true);
        const m = await addMediaBlob(take.blob, 'narration', { kind: 'audio' });
        await ed.engine.loadMedia(m.id);
        this.set((pp) => { pp.narration = { mediaId: m.id, dur: take.dur, offset: 0 }; }, null, { inspector: true });
        toast('Narration saved');
      }
    }, 'rec-btn');
    w.append(section('Narration over the whole video',
      h('p', { class: 'hint' }, 'Plays the video from the start and records your mic while it plays. Use headphones so the phone sounds do not leak into the take.'),
      row(narrBtn, meter),
      n?.mediaId ? row(btn('▶ Play take', () => this.ed.engine.preview(n.mediaId), 'ghost small'), h('span', { class: 'pill ok' }, `${(n.dur || 0).toFixed(1)}s`),
        field('Offset (s)', num(n.offset, (v) => this.set(() => { n.offset = v ?? 0; }, 'narr.off'), { step: 0.05 })),
        btn('Remove', () => this.set((pp) => { pp.narration = null; }, null, { inspector: true }), 'ghost small')) : null));

    w.append(section('GIPHY (GIF search)',
      field('API key', h('input', { type: 'password', value: s.giphyKey || '', placeholder: 'GIPHY key', oninput: (e) => { s.giphyKey = e.target.value.trim(); this.ed.saveSettings(); } }),
        'Optional. Without it you can still upload your own GIFs.'),
      h('a', { href: 'https://developers.giphy.com/dashboard/', target: '_blank', class: 'link' }, 'Get a GIPHY key')));
    w.append(this.aiControl());
    return w;
  }

  // ---- AI control: a local API + MCP server so an AI can drive the app --------------------------------
  aiControl() {
    const box = h('div', { class: 'ai-box' });
    const sec = section('AI control (API + MCP)', box);
    const copy = (txt, what) => { navigator.clipboard?.writeText(txt).then(() => toast(`${what} copied`), () => toast('Could not copy', 'error')); };
    const draw = (c) => {
      box.textContent = '';
      box.append(
        h('p', { class: 'hint' }, 'Lets an AI (Claude, through MCP) write the script, change the look, check frames and export the video in this app. It only listens on this computer and needs the token below. Off by default.'),
        field('Let an AI control Fake Phone', toggle(!!c.enabled, async (v) => { draw(await agentConfig({ enabled: v })); if (v) ensureAgentLoop(); else stopAgentUi(); })));
      if (!c.enabled) return;
      box.append(h('div', { class: 'ai-status' + (c.listening ? ' ok' : ' bad') },
        c.listening ? `Listening on ${c.url} · ${c.pageConnected ? 'this window is connected' : 'waiting for this window'}` : (c.error || 'Not listening')));
      if (!c.listening) return;
      box.append(
        field('Token', row(h('input', { type: 'text', readonly: true, value: c.token, class: 'grow' }), btn('Copy', () => copy(c.token, 'Token'), 'ghost small'),
          btn('New token', async () => { if (confirm('Make a new token? Anything using the old one stops working.')) draw(await agentConfig({ rotate: true })); }, 'ghost small'))));
      if (c.mcp) {
        const json = JSON.stringify({ mcpServers: { 'fake-phone': { command: c.mcp.command, args: c.mcp.args, env: c.mcp.env } } }, null, 2);
        const q = (x) => (/[\s"]/.test(x) ? `"${x.replace(/"/g, '\\"')}"` : x);
        const cli = `claude mcp add fake-phone ${Object.entries(c.mcp.env).map(([k, v]) => `-e ${k}=${q(v)}`).join(' ')} -- ${q(c.mcp.command)} ${c.mcp.args.map(q).join(' ')}`;
        box.append(
          field('Add it to Claude Desktop (claude_desktop_config.json)', h('pre', { class: 'code-box' }, json), null),
          btn('Copy config', () => copy(json, 'Config'), 'ghost small'),
          field('Or for Claude Code, run this', h('pre', { class: 'code-box' }, cli), null),
          btn('Copy command', () => copy(cli, 'Command'), 'ghost small'),
          h('p', { class: 'hint' }, 'The token is in those snippets, so keep them private. An AI can then call tools such as set_script, preview and export_video. Your ElevenLabs key is never sent to it, and it only spends voice credits when it passes confirm.'));
      }
    };
    agentConfig().then(draw).catch(() => { box.textContent = 'AI control is not available here.'; });
    return sec;
  }

  // Every spoken line in the script with who says it and which voice would be used.
  voiceLines() { return voiceLines(this.p); }

  // ---- Sound -----------------------------------------------------------------------------
  sound() {
    const p = this.p;
    const ed = this.ed;
    const w = h('div', { class: 'tab-pad' });
    w.append(section('Mix',
      field('Preview volume', range(ed.settings.volume, (v) => { ed.settings.volume = v; ed.engine.setVolume(v); ed.saveSettings(); }, { fmt: (v) => Math.round(v * 100) + '%' })),
      toggle(p.sounds.keys !== false, (v) => this.set(() => { p.sounds.keys = v; }), 'Keyboard clicks')));
    const list = h('div', { class: 'slots' });
    for (const [slot, label] of Object.entries(SOUND_SLOTS)) {
      const ov = p.sounds.overrides?.[slot];
      list.append(h('div', { class: 'slot' },
        h('button', { class: 'icon-btn', title: 'Play', onclick: () => ed.engine.preview(slot, p) }, '▶'),
        h('span', { class: 'grow' }, label, ov ? h('small', {}, ' · your file') : null),
        btn(ov ? 'Change' : 'Replace', async () => {
          const [f] = await pickFile('audio/*');
          if (!f) return;
          const rec = await addMediaBlob(f, f.name, { kind: 'audio' });
          await ed.engine.loadMedia(rec.id);
          this.set(() => { p.sounds.overrides[slot] = rec.id; }, null, { inspector: true });
        }, 'ghost small'),
        ov ? btn('Reset', () => this.set(() => { delete p.sounds.overrides[slot]; }, null, { inspector: true }), 'ghost small') : null));
    }
    w.append(this.musicSection());
    w.append(section('Phone sounds', h('p', { class: 'hint' }, 'Built-in sounds are synthesized (no copyrighted samples). Replace any of them with your own file.'), list));
    return w;
  }

  musicSection() {
    const p = this.p, ed = this.ed;
    const m = p.music;
    const re = { inspector: true };
    const pick = async () => {
      const [f] = await pickFile('audio/*');
      if (!f) return;
      const rec = await addMediaBlob(f, f.name, { kind: 'audio' });
      const buf = await ed.engine.loadMedia(rec.id);
      if (!buf) { toast('Could not read that audio file', 'error'); return; }
      this.set((pp) => { pp.music = { volume: 0.3, duck: 0.25, fadeIn: 1, fadeOut: 2, loop: true, ...(m || {}), mediaId: rec.id, name: f.name, dur: buf.duration, start: 0 }; }, null, re);
    };
    if (!m?.mediaId) {
      return section('Background music',
        h('p', { class: 'hint' }, 'A track under the whole video. It dips automatically whenever a voice plays (messages, voice notes, call lines, narration).'),
        btn('Choose music file…', pick, 'small'));
    }
    const pct = (v) => Math.round(v * 100) + '%';
    return section('Background music',
      row(h('span', { class: 'grow' }, h('b', {}, m.name || 'Music'), h('small', { class: 'hint' }, ` · ${(m.dur || 0).toFixed(1)}s`)),
        btn('Change', pick, 'ghost small'),
        btn('Remove', () => this.set((pp) => { pp.music = null; }, null, re), 'ghost small')),
      field('Volume', range(m.volume ?? 0.3, (v) => this.set(() => { m.volume = v; }, 'mu.vol'), { min: 0, max: 1, step: 0.01, fmt: pct })),
      field('Under voices it dips to', range(m.duck ?? 0.25, (v) => this.set(() => { m.duck = v; }, 'mu.duck'), { min: 0, max: 1, step: 0.01, fmt: (v) => pct(v) + ' of that' })),
      row(field('Fade in (s)', num(m.fadeIn ?? 1, (v) => this.set(() => { m.fadeIn = v ?? 0; }, 'mu.fi'), { min: 0, step: 0.1 })),
        field('Fade out (s)', num(m.fadeOut ?? 2, (v) => this.set(() => { m.fadeOut = v ?? 0; }, 'mu.fo'), { min: 0, step: 0.1 })),
        field('Start at (s into the track)', num(m.start ?? 0, (v) => this.set(() => { m.start = v ?? 0; }, 'mu.st'), { min: 0, step: 0.5 }))),
      toggle(m.loop !== false, (v) => this.set(() => { m.loop = v; }), 'Loop if the video is longer than the track'),
      h('p', { class: 'hint' }, 'Press play to hear it with the ducking.'));
  }

  // ---- Motion ------------------------------------------------------------------------------
  motion() {
    const p = this.p;
    p.motion ||= {};
    const w = h('div', { class: 'tab-pad' });
    w.append(section('Motion',
      h('p', { class: 'hint' }, 'Every animation runs on a PulseCore curve. Pick the curve and length per animation; springs use PulseCore spring physics.'),
      field('Overall speed', range(p.motionSpeed || 1, (v) => this.set(() => { p.motionSpeed = v; }, 'mspeed'), { min: 0.5, max: 2, step: 0.05, fmt: (v) => '×' + v.toFixed(2) }))));
    const opts = EASE_NAMES.map((n) => [n, SPRINGS[n]?.label || n.replace(/^ease/, '').replace(/([A-Z])/g, ' $1').trim()]);
    const list = h('div', { class: 'motion-list' });
    for (const [key, d] of Object.entries(MOTION_KEYS)) {
      const o = p.motion[key] || {};
      const ease = o.ease || d.ease;
      const cv = h('canvas', { width: 120, height: 64, class: 'curve' });
      drawCurve(cv, ease);
      list.append(h('div', { class: 'motion-item' },
        h('div', { class: 'grow' },
          h('b', {}, d.label),
          select(ease, opts, (v) => { this.set(() => { (p.motion[key] ||= {}).ease = v; }); drawCurve(cv, v); }),
          range(o.dur ?? d.dur, (v) => this.set(() => { (p.motion[key] ||= {}).dur = v; }, 'mo' + key), { min: 0.08, max: key === 'swipe' ? 4 : 1.5, step: 0.01, fmt: (v) => v.toFixed(2) + 's' })),
        cv));
    }
    w.append(section('Animations', list, btn('Reset all to default', () => this.set(() => { p.motion = {}; p.motionSpeed = 1; }, null, { inspector: true }), 'ghost small')));
    return w;
  }

  // ---- Export --------------------------------------------------------------------------------
  exportTab() {
    const ed = this.ed;
    const s = ed.settings;
    const w = h('div', { class: 'tab-pad' });
    const bar = h('div', { class: 'progress' }, h('i'));
    const label = h('div', { class: 'hint' }, `Length ${ed.tl.duration.toFixed(1)}s · 9:16 vertical`);
    const result = h('div', { class: 'export-result' });
    let abort = null;
    const go = btn('Export MP4', async () => {
      if (abort) { abort.abort(); return; }
      abort = new AbortController();
      go.textContent = 'Cancel';
      ed.pause();
      const [wpx, hpx] = s.exportRes === '720' ? [720, 1280] : [1080, 1920];
      const t0 = performance.now();
      try {
        const out = await exportVideo({
          p: ed.p, tl: ed.tl, engine: ed.engine, width: wpx, height: hpx, fps: Number(s.exportFps) || 30,
          name: ed.p.name.replace(/[^\w\- ()]+/g, '').trim() || 'fake-phone', signal: abort.signal,
          onProgress: (f, msg) => { bar.firstChild.style.width = (f * 100).toFixed(1) + '%'; label.textContent = msg; },
        });
        label.textContent = `Done in ${((performance.now() - t0) / 1000).toFixed(1)}s`;
        result.textContent = '';
        result.append(out.url ? h('video', { src: out.url, controls: true, class: 'export-video' }) : null, h('div', { class: 'hint' }, out.file));
        toast('Video exported');
        this.loadExports(listBox);
      } catch (err) {
        label.textContent = err.message;
        toast(err.message, 'error');
      }
      abort = null;
      go.textContent = 'Export MP4';
    }, 'primary big');
    const listBox = h('div', { class: 'exports' });
    w.append(section('Video',
      row(field('Size', select(s.exportRes, [['1080', '1080 × 1920 (Full HD)'], ['720', '720 × 1280 (faster)']], (v) => { s.exportRes = v; ed.saveSettings(); })),
        field('Frame rate', select(String(s.exportFps), [['30', '30 fps'], ['60', '60 fps']], (v) => { s.exportFps = Number(v); ed.saveSettings(); }))),
      go, bar, label, result,
      h('p', { class: 'hint' }, 'Rendered frame by frame (not screen-recorded), so it is exact and can run faster than real time.')));
    const folder = h('p', { class: 'hint' });
    const folderRow = row(btn('Open exports folder', () => fetch('/api/open-exports', { method: 'POST' }), 'ghost small'));
    w.append(section('Your exports', listBox, folderRow, folder));
    this.loadExports(listBox);
    fetch('/api/info').then((r) => r.json()).then((info) => {
      folder.textContent = 'Saved in ' + info.exports;
      // desktop app: the folder can be changed (a picker in the main process)
      if (info.pickFolder) folderRow.append(btn('Change folder…', async () => {
        const r = await (await fetch('/api/exports-folder', { method: 'POST' })).json();
        folder.textContent = 'Saved in ' + r.exports;
        if (r.changed) { toast('Exports folder changed'); this.loadExports(listBox); }
      }, 'ghost small'));
    }).catch(() => {});
    w.append(section('Project file',
      row(btn('Save project file…', () => ed.exportProject(), 'ghost small'), btn('Open project file…', () => ed.importProject(), 'ghost small')),
      h('p', { class: 'hint' }, 'One .json with the script, look, images and voice audio inside.')));
    return w;
  }

  async loadExports(box) {
    try {
      const files = await (await fetch('/api/exports')).json();
      box.textContent = '';
      if (!files.length) box.append(h('p', { class: 'hint' }, 'No exports yet.'));
      for (const f of files.slice(0, 12)) {
        box.append(h('a', { href: f.url, target: '_blank', class: 'export-file' }, f.name, h('small', {}, (f.size / 1e6).toFixed(1) + ' MB')));
      }
    } catch { box.textContent = 'Exports list needs the local server.'; }
  }
}

function drawCurve(cv, ease) {
  const g = cv.getContext('2d');
  const f = curve(ease);
  const W = cv.width, H = cv.height, pad = 8;
  g.clearRect(0, 0, W, H);
  g.strokeStyle = 'rgba(255,255,255,0.12)';
  g.lineWidth = 1;
  g.strokeRect(pad, pad, W - 2 * pad, H - 2 * pad);
  g.beginPath();
  for (let i = 0; i <= 60; i++) {
    const t = i / 60;
    const x = pad + t * (W - 2 * pad);
    const y = H - pad - f(t) * (H - 2 * pad) * 0.8 - (H - 2 * pad) * 0.1;
    if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
  }
  g.strokeStyle = '#C8FF3D';
  g.lineWidth = 2;
  g.stroke();
}

