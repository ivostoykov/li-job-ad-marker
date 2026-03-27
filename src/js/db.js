const DB_NAME = 'li-job-marker';
const DB_VERSION = 1;
const STORE_JOBS = 'jobs';

function dbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_JOBS)) {
        db.createObjectStore(STORE_JOBS, { keyPath: 'id' });
      }
    };

    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

function dbGetJob(id) {
  return dbOpen().then((db) => new Promise((resolve, reject) => {
    const req = db.transaction(STORE_JOBS, 'readonly').objectStore(STORE_JOBS).get(id);
    req.onsuccess = (e) => resolve(e.target.result ?? null);
    req.onerror = (e) => reject(e.target.error);
  }));
}

function dbSaveJob(id, type) {
  return dbOpen().then((db) => new Promise((resolve, reject) => {
    const req = db.transaction(STORE_JOBS, 'readwrite').objectStore(STORE_JOBS).put({ id, type, timestamp: Date.now() });
    req.onsuccess = () => resolve();
    req.onerror = (e) => reject(e.target.error);
  }));
}

function dbGetAllJobs() {
  return dbOpen().then((db) => new Promise((resolve, reject) => {
    const req = db.transaction(STORE_JOBS, 'readonly').objectStore(STORE_JOBS).getAll();
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  }));
}
