// Voices: ElevenLabs text-to-speech (through the local proxy, with the user's own key) and
// microphone takes with silence trimming.
import { encodeWav } from './audio.js';
import { hash } from './util.js';

export const ELEVEN_MODELS = {
  eleven_v4: 'Eleven v4 (newest, [tags] for delivery)',
  eleven_multilingual_v2: 'Multilingual v2 (best quality)',
  eleven_v3: 'Eleven v3 (most expressive, [tags])',
  eleven_turbo_v2_5: 'Turbo v2.5 (fast)',
  eleven_flash_v2_5: 'Flash v2.5 (fastest, cheapest)',
};

async function elevenError(r) {
  let msg = `${r.status} ${r.statusText}`;
  try {
    const j = await r.json();
    const d = j.detail;
    msg = typeof d === 'string' ? d : d?.message || d?.status || JSON.stringify(j).slice(0, 200);
  } catch { /* not json */ }
  if (r.status === 401) msg = 'ElevenLabs rejected the key (401). Check the key in Voices.';
  return new Error(msg);
}

export async function listVoices(key) {
  const r = await fetch('/api/eleven/v1/voices', { headers: { 'xi-api-key': key } });
  if (!r.ok) throw await elevenError(r);
  const j = await r.json();
  return (j.voices || []).map((v) => ({
    id: v.voice_id, name: v.name, preview: v.preview_url,
    tags: [v.labels?.gender, v.labels?.age, v.labels?.accent, v.labels?.description || v.labels?.descriptive].filter(Boolean).join(' · '),
  })).sort((a, b) => a.name.localeCompare(b.name));
}

export function ttsKey(voiceId, text, settings) {
  return hash(`${voiceId}|${settings.model}|${settings.stability}|${settings.similarity}|${usesStyle(settings.model) ? settings.style : ''}|${text}`);
}

// v4 only takes stability + similarity; delivery is steered with [tags] in the text.
export const usesStyle = (model) => model !== 'eleven_v4';

export async function tts(key, voiceId, text, settings) {
  const model = settings.model || 'eleven_v4';
  const voice_settings = { stability: settings.stability ?? 0.5, similarity_boost: settings.similarity ?? 0.75 };
  if (usesStyle(model)) Object.assign(voice_settings, { style: settings.style ?? 0.2, use_speaker_boost: true });
  const r = await fetch(`/api/eleven/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': key, 'content-type': 'application/json', accept: 'audio/mpeg' },
    body: JSON.stringify({ text, model_id: model, voice_settings }),
  });
  if (!r.ok) throw await elevenError(r);
  return new Blob([await r.arrayBuffer()], { type: 'audio/mpeg' });
}

// ---- microphone ---------------------------------------------------------------
export class MicRecorder {
  async start(onLevel) {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
    });
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((m) => MediaRecorder.isTypeSupported(m)) || '';
    this.rec = new MediaRecorder(this.stream, mime ? { mimeType: mime } : {});
    this.chunks = [];
    this.rec.ondataavailable = (e) => { if (e.data.size) this.chunks.push(e.data); };
    this.rec.start(100);
    this.started = performance.now();
    if (onLevel) {
      const ac = new AudioContext();
      const an = ac.createAnalyser();
      an.fftSize = 512;
      ac.createMediaStreamSource(this.stream).connect(an);
      const data = new Float32Array(an.fftSize);
      const loop = () => {
        if (!this.rec || this.rec.state === 'inactive') { ac.close(); return; }
        an.getFloatTimeDomainData(data);
        let peak = 0;
        for (const v of data) peak = Math.max(peak, Math.abs(v));
        onLevel(peak, (performance.now() - this.started) / 1000);
        requestAnimationFrame(loop);
      };
      loop();
    }
  }

  stop() {
    return new Promise((resolve) => {
      if (!this.rec) return resolve(null);
      this.rec.onstop = () => {
        this.stream.getTracks().forEach((t) => t.stop());
        resolve(new Blob(this.chunks, { type: this.rec.mimeType || 'audio/webm' }));
        this.rec = null;
      };
      this.rec.stop();
    });
  }
}

// Cut silence off both ends (keeps a little air) and return a WAV blob + duration.
export async function trimTake(engine, blob, keepLead = true) {
  const buf = await engine.decodeBlob(blob);
  const d = buf.getChannelData(0);
  const thr = 0.012;
  let a = 0, b = d.length - 1;
  while (a < d.length && Math.abs(d[a]) < thr) a++;
  while (b > a && Math.abs(d[b]) < thr) b--;
  const pad = Math.round(buf.sampleRate * 0.08);
  a = keepLead ? 0 : Math.max(0, a - pad);
  b = Math.min(d.length, b + pad * 2);
  if (b - a < buf.sampleRate * 0.1) { a = 0; b = d.length; }
  const out = new AudioBuffer({ length: b - a, numberOfChannels: buf.numberOfChannels, sampleRate: buf.sampleRate });
  for (let c = 0; c < buf.numberOfChannels; c++) out.copyToChannel(buf.getChannelData(c).subarray(a, b), c);
  return { blob: encodeWav(out), dur: out.duration };
}
