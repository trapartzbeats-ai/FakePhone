// AI voices for every spoken line of a project: which lines there are, which still need audio, and generating them.
// Used by the Voices & Keys button and by the AI control API.
import { voiceIdOf } from './model.js';
import { tts, ttsKey } from './voice.js';
import { addMediaBlob } from './media.js';
import { peaksOf } from './audio.js';

// Every line that can be spoken: messages, voice-overs, call lines. owner = the object that holds .voice
export function voiceLines(p) {
  const out = [];
  const add = (owner, who, txt) => {
    const say = (owner.voice?.say || txt || '').trim();
    if (!say) return;
    out.push({ owner, who, say, voiceId: owner.voice?.voiceId || voiceIdOf(p, who) });
  };
  for (const e of p.events) {
    if (e.type === 'msg' && !e.pre && e.text) add(e, e.from, e.text);
    if (e.type === 'voiceover') add(e, 'narrator', e.text);
    if (e.type === 'call' && e.outcome === 'answer') for (const l of e.lines) add(l, l.from, l.text);
  }
  return out;
}

// Lines whose speaker has a voice but that have no audio yet (or whose text/voice changed since).
export const missingVoices = (lines, eleven) => lines.filter((l) => l.voiceId && (!l.owner.voice?.mediaId || (l.owner.voice.src === 'tts' && l.owner.voice.key !== ttsKey(l.voiceId, l.say, eleven))));

// Generates audio for `todo` (from missingVoices), one line at a time. onProgress(done, total). Returns how many were made.
export async function generateVoices(engine, key, eleven, todo, onProgress = () => {}, signal) {
  let done = 0;
  for (const l of todo) {
    if (signal?.aborted) throw new Error('Cancelled');
    onProgress(done, todo.length);
    const blob = await tts(key, l.voiceId, l.say, eleven);
    const rec = await addMediaBlob(blob, 'tts', { kind: 'audio' });
    const buf = await engine.loadMedia(rec.id);
    l.owner.voice = { ...(l.owner.voice || {}), src: 'tts', mediaId: rec.id, dur: buf?.duration || 0, peaks: buf ? peaksOf(buf) : null, key: ttsKey(l.voiceId, l.say, eleven) };
    done++;
  }
  onProgress(done, todo.length);
  return done;
}
