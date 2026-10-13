'use strict';

/* IndexedDB 封装：meta 存配置与记录，images 存压缩后的商品图 */
const NienieDB = (() => {
  const DB_NAME = 'nienie';
  const DB_VERSION = 1;
  let dbPromise = null;

  function open() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
          if (!db.objectStoreNames.contains('images')) db.createObjectStore('images');
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return dbPromise;
  }

  function op(storeName, mode, fn) {
    return open().then(db => new Promise((resolve, reject) => {
      const t = db.transaction(storeName, mode);
      const req = fn(t.objectStore(storeName));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      t.onabort = () => reject(t.error);
    }));
  }

  return {
    get: (k) => op('meta', 'readonly', s => s.get(k)),
    set: (k, v) => op('meta', 'readwrite', s => s.put(v, k)),
    getImage: (k) => op('images', 'readonly', s => s.get(k)),
    putImage: (k, blob) => op('images', 'readwrite', s => s.put(blob, k)),
    delImage: (k) => op('images', 'readwrite', s => s.delete(k)),
    clearAll: async () => {
      await op('meta', 'readwrite', s => s.clear());
      await op('images', 'readwrite', s => s.clear());
    },
  };
})();
