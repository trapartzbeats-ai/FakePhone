// IndexedDB: projects (JSON) and media blobs (images, gifs, audio) referenced by id.
const DB_NAME = 'fakephone';
let dbp = null;

function db() {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('media')) d.createObjectStore('media', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('projects')) d.createObjectStore('projects', { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbp;
}

async function tx(store, mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => resolve(req && 'result' in req ? req.result : undefined);
    t.onerror = () => reject(t.error);
  });
}

export const putMedia = (rec) => tx('media', 'readwrite', (s) => s.put(rec));
export const getMedia = (id) => tx('media', 'readonly', (s) => s.get(id));
export const deleteMedia = (id) => tx('media', 'readwrite', (s) => s.delete(id));

export const putProject = (p) => tx('projects', 'readwrite', (s) => s.put(p));
export const getProject = (id) => tx('projects', 'readonly', (s) => s.get(id));
export const deleteProject = (id) => tx('projects', 'readwrite', (s) => s.delete(id));
export async function listProjects() {
  const all = (await tx('projects', 'readonly', (s) => s.getAll())) || [];
  return all.map((p) => ({ id: p.id, name: p.name, updated: p.updated || 0 })).sort((a, b) => b.updated - a.updated);
}

// Settings that belong to the person, not the project (API keys, volume).
const SETTINGS_KEY = 'fakephone.settings';
export function loadSettings() {
  try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; } catch { return {}; }
}
export function saveSettings(s) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* private mode */ }
}
