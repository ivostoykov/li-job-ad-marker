// Content-side job access. Persistent jobs live in the background data module
// (src/js/store.js); this file keeps a per-frame cache refreshed by `data-changed`.
// The LinkedIn-origin database below is the legacy store: it is migrated once,
// and in incognito it remains the only, ephemeral, job store.

const DB_NAME = 'li-job-marker';
const DB_VERSION = 1;
const STORE_JOBS = 'jobs';
const DB_IS_INCOGNITO = !!chrome.extension?.inIncognitoContext;

let dbJobsCache = null;
let dbJobsCachePromise = null;
let dbJobsPending = [];

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

// Closes the connection after each request so deleting the legacy database is never blocked.
function dbLocalRequest(mode, work) {
  return dbOpen().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_JOBS, mode);
    const req = work(tx.objectStore(STORE_JOBS));
    let result;
    req.onsuccess = (e) => { result = e.target.result; };
    req.onerror = (e) => reject(e.target.error);
    tx.oncomplete = () => { db.close?.(); resolve(result); };
    tx.onabort = () => { db.close?.(); reject(tx.error); };
  }));
}

function dbFromLegacy(record) {
  return record ? { linkedInJobId: String(record.id), type: record.type, stateAt: record.timestamp } : null;
}

async function dbSendData(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw new Error(response?.error || `${message.action} failed`);
  return response;
}

// Keeps the newest version per job, tombstones included, so an older snapshot
// or a late broadcast can never overwrite a newer change. Changes that arrive
// while the first snapshot is loading are buffered and merged afterwards.
function dbCacheJobs(jobs) {
  if (!dbJobsCache) {
    dbJobsPending.push(...(jobs ?? []));
    return;
  }
  for (const job of jobs ?? []) {
    const cached = dbJobsCache.get(job.linkedInJobId);
    if (!cached || job.updatedAt >= cached.updatedAt) dbJobsCache.set(job.linkedInJobId, job);
  }
}

function dbActiveJobs() {
  return [...dbJobsCache.values()].filter((job) => job.deletedAt == null);
}

function dbGetAllJobs() {
  if (DB_IS_INCOGNITO) {
    return dbLocalRequest('readonly', (store) => store.getAll()).then((all) => all.map(dbFromLegacy));
  }
  if (dbJobsCache) return Promise.resolve(dbActiveJobs());
  if (!dbJobsCachePromise) {
    dbJobsCachePromise = dbSendData({ action: 'jobs.getAll' })
      .then(({ jobs }) => {
        dbJobsCache = new Map();
        dbCacheJobs(jobs);
        dbCacheJobs(dbJobsPending.splice(0));
        return dbActiveJobs();
      })
      .finally(() => { dbJobsCachePromise = null; });
  }
  return dbJobsCachePromise;
}

function dbGetJob(id) {
  if (DB_IS_INCOGNITO) return dbLocalRequest('readonly', (store) => store.get(id)).then(dbFromLegacy);
  return dbGetAllJobs().then(() => {
    const job = dbJobsCache?.get(String(id));
    return job && job.deletedAt == null ? job : null;
  });
}

async function dbSaveJobs(entries) {
  if (!entries.length) return;
  if (DB_IS_INCOGNITO) {
    for (const { linkedInJobId, type } of entries) {
      const existing = await dbLocalRequest('readonly', (store) => store.get(linkedInJobId));
      if (existing && (TYPE_RANK[existing.type] ?? 0) >= (TYPE_RANK[type] ?? 0)) continue;
      await dbLocalRequest('readwrite', (store) => store.put({ id: linkedInJobId, type, timestamp: Date.now() }));
    }
    return;
  }
  const { jobs } = await dbSendData({ action: 'jobs.save', jobs: entries });
  dbCacheJobs(jobs);
}

function dbSaveJob(id, type) {
  return dbSaveJobs([{ linkedInJobId: String(id), type }]);
}

// Retry-safe: only records the background acknowledged as committed are removed,
// and only if unchanged since they were read, so writes from old-version tabs
// that are still open survive for the next pass. The (possibly empty) legacy
// database itself is kept; deleting it could block on those tabs' connections.
async function dbMigrateLegacyJobs() {
  if (DB_IS_INCOGNITO) return 0;
  if (typeof indexedDB.databases === 'function') {
    const databases = await indexedDB.databases();
    if (!databases.some((d) => d.name === DB_NAME)) return 0;
  }

  const legacy = await dbLocalRequest('readonly', (store) => store.getAll());
  if (!legacy.length) return 0;

  const { migratedIds } = await dbSendData({ action: 'jobs.migrateLegacy', jobs: legacy });
  const acknowledged = new Set((migratedIds ?? []).map(String));
  const committed = legacy.filter((job) => acknowledged.has(String(job.id)));

  await dbOpen().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_JOBS, 'readwrite');
    const store = tx.objectStore(STORE_JOBS);
    committed.forEach((job) => {
      const req = store.get(job.id);
      req.onsuccess = () => {
        const current = req.result;
        if (current && current.type === job.type && current.timestamp === job.timestamp) store.delete(job.id);
      };
    });
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onabort = () => { db.close(); reject(tx.error); };
  }));
  return committed.length;
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.action !== 'data-changed' || DB_IS_INCOGNITO) return;
  dbCacheJobs(message.jobs);
});
