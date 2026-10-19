/**
 * IndexedDB helpers for Sitemap 盯同行 heavy data
 * Stores: baselines | snapshots | newUrls  (keyPath = siteId)
 */
const SitemapIDB = (() => {
  const DB_NAME = "sitemap_monitor";
  const DB_VERSION = 1;
  const STORES = ["baselines", "snapshots", "newUrls"];

  let _dbPromise = null;

  function openDb() {
    if (_dbPromise) return _dbPromise;
    _dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onerror = () => reject(req.error || new Error("IndexedDB open failed"));
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const name of STORES) {
          if (!db.objectStoreNames.contains(name)) {
            db.createObjectStore(name, { keyPath: "siteId" });
          }
        }
      };
      req.onsuccess = () => resolve(req.result);
    });
    return _dbPromise;
  }

  function txDone(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("IndexedDB tx error"));
      tx.onabort = () => reject(tx.error || new Error("IndexedDB tx aborted"));
    });
  }

  async function put(storeName, siteId, value) {
    const db = await openDb();
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).put({ siteId, value });
    await txDone(tx);
  }

  async function get(storeName, siteId) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, "readonly");
      const req = tx.objectStore(storeName).get(siteId);
      req.onsuccess = () => {
        const row = req.result;
        resolve(row ? row.value : undefined);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async function getAllMap(storeName) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, "readonly");
      const req = tx.objectStore(storeName).getAll();
      req.onsuccess = () => {
        const out = {};
        for (const row of req.result || []) {
          if (row && row.siteId != null) out[row.siteId] = row.value;
        }
        resolve(out);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async function remove(storeName, siteId) {
    const db = await openDb();
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).delete(siteId);
    await txDone(tx);
  }

  async function clearStore(storeName) {
    const db = await openDb();
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).clear();
    await txDone(tx);
  }

  async function clearAll() {
    for (const name of STORES) await clearStore(name);
  }

  async function putMap(storeName, mapObj) {
    const db = await openDb();
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    store.clear();
    for (const [siteId, value] of Object.entries(mapObj || {})) {
      store.put({ siteId, value });
    }
    await txDone(tx);
  }

  /** Rough byte estimate of all IDB payloads (JSON length). */
  async function estimateBytes() {
    let total = 0;
    for (const name of STORES) {
      const map = await getAllMap(name);
      try {
        total += new Blob([JSON.stringify(map)]).size;
      } catch {
        total += JSON.stringify(map).length;
      }
    }
    return total;
  }

  return {
    DB_NAME,
    STORES,
    openDb,
    put,
    get,
    getAllMap,
    remove,
    clearStore,
    clearAll,
    putMap,
    estimateBytes,
  };
})();

if (typeof globalThis !== "undefined") {
  globalThis.SitemapIDB = SitemapIDB;
}
