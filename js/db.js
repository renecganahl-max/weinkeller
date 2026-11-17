// Local storage on the device (IndexedDB). Later this file can be swapped for a
// synced database (for example Supabase) without touching the rest of the app.

const DB_NAME = 'weinkeller';
const DB_VERSION = 1;
const STORES = ['wines', 'events', 'meta'];
let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) { reject(new Error('IndexedDB fehlt')); return; }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('wines')) db.createObjectStore('wines', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('events')) db.createObjectStore('events', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Datenbank blockiert'));
  });
  return dbPromise;
}

function run(store, mode, fn) {
  return open().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    let result;
    const req = fn(tx.objectStore(store));
    if (req) req.onsuccess = () => { result = req.result; };
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }));
}

export const getAll = store => run(store, 'readonly', s => s.getAll());
export const put = (store, value) => run(store, 'readwrite', s => s.put(value));
export const del = (store, key) => run(store, 'readwrite', s => s.delete(key));

export async function getMeta(key, fallback) {
  const row = await run('meta', 'readonly', s => s.get(key));
  return row ? row.value : fallback;
}
export const setMeta = (key, value) => put('meta', { key, value });

export async function putMany(store, values) {
  const db = await open();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    values.forEach(v => tx.objectStore(store).put(v));
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

export async function delMany(store, keys) {
  const db = await open();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    keys.forEach(k => tx.objectStore(store).delete(k));
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearAll() {
  const db = await open();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORES, 'readwrite');
    STORES.forEach(s => tx.objectStore(s).clear());
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

export async function exportAll() {
  const [wines, events, meta] = await Promise.all(STORES.map(getAll));
  return { app: 'weinkeller', version: 1, exportedAt: new Date().toISOString(), wines, events, meta };
}

// Replaces everything with the content of a backup (already checked by the caller).
export async function importAll(data) {
  const db = await open();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORES, 'readwrite');
    STORES.forEach(s => tx.objectStore(s).clear());
    data.wines.forEach(w => tx.objectStore('wines').put(w));
    data.events.forEach(e => tx.objectStore('events').put(e));
    data.meta.forEach(m => tx.objectStore('meta').put(m));
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}
