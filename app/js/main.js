// Boot: audio engine + editor. The AudioContext resumes on the first click (browser rule).
import { AudioEngine } from './audio.js';
import { Editor } from './editor.js';

const engine = new AudioEngine();
const editor = new Editor(engine);
window.fakePhone = editor;
document.addEventListener('pointerdown', () => engine.resume(), { once: true });
document.addEventListener('keydown', () => engine.resume(), { once: true });
editor.init().catch((e) => {
  console.error(e);
  document.body.insertAdjacentHTML('beforeend', `<pre class="boot-error">Fake Phone failed to start:\n${e.stack || e}</pre>`);
});
