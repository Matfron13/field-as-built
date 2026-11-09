// Offline support: an IndexedDB outbox of captures (photo + note + sheet + time) that syncs when back online,
// plus a small cache of project state and drawing PDFs so the sheet picker and viewer work with no signal.
const DB = 'fab-offline', VER = 1;
let dbp;
function db() {
  return (dbp ||= new Promise((res, rej) => {
    const r = indexedDB.open(DB, VER);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('outbox')) d.createObjectStore('outbox', { keyPath: 'clientId' });
      if (!d.objectStoreNames.contains('cache')) d.createObjectStore('cache');
    };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  }));
}
const tx = async (store, mode, fn) => { const d = await db(); return new Promise((res, rej) => { const t = d.transaction(store, mode); const s = t.objectStore(store); const out = fn(s); t.oncomplete = () => res(out?.result ?? out); t.onerror = () => rej(t.error); }); };

export const outbox = {
  add: (item) => tx('outbox', 'readwrite', (s) => s.put(item)),
  all: async () => { const d = await db(); return new Promise((res, rej) => { const r = d.transaction('outbox').objectStore('outbox').getAll(); r.onsuccess = () => res(r.result.sort((a, b) => a.capturedAt.localeCompare(b.capturedAt))); r.onerror = () => rej(r.error); }); },
  remove: (id) => tx('outbox', 'readwrite', (s) => s.delete(id)),
  update: async (id, patch) => { const all = await outbox.all(); const it = all.find((x) => x.clientId === id); if (it) await outbox.add({ ...it, ...patch }); },
};
export const cache = {
  get: async (k) => { const d = await db(); return new Promise((res) => { const r = d.transaction('cache').objectStore('cache').get(k); r.onsuccess = () => res(r.result ?? null); r.onerror = () => res(null); }); },
  set: (k, v) => tx('cache', 'readwrite', (s) => s.put(v, k)).catch(() => {}),
  clear: () => tx('cache', 'readwrite', (s) => s.clear()).catch(() => {}),
};
export const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = (Math.random() * 16) | 0; return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16); }));
