// Background-only data module. The only code that opens the extension-origin
// IndexedDB; every other context goes through runtime messages (docs/data-api.md).

const DATA_DB_NAME = 'ljm-data';
const DATA_DB_VERSION = 1;
const DATA_SCHEMA_VERSION = 2;
const EXPORT_FORMAT = 'ljm-export';
const COMPANY_STATUSES = ['blacklisted'];
const IMPORT_JOURNAL_KEY = 'importJournal';
const LEGACY_MIGRATION_KEY = 'jobsLegacyMigration';

let dataDbPromise = null;
let dataDbReadOnly = false;
let dataMutationQueue = Promise.resolve();
let dataRevision = 0;

function idbRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function dataDbOpen() {
  if (dataDbPromise) return dataDbPromise;

  dataDbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DATA_DB_NAME, DATA_DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('jobs')) {
        const jobs = db.createObjectStore('jobs', { keyPath: 'id' });
        jobs.createIndex('linkedInJobId', 'linkedInJobId', { unique: true });
      }
      if (!db.objectStoreNames.contains('companies')) {
        const companies = db.createObjectStore('companies', { keyPath: 'id' });
        companies.createIndex('nameKey', 'nameKey');
        companies.createIndex('slug', 'slug');
      }
      if (!db.objectStoreNames.contains('notes')) {
        const notes = db.createObjectStore('notes', { keyPath: 'id' });
        notes.createIndex('groupKey', 'groupKey');
        notes.createIndex('linkedInJobId', 'linkedInJobId');
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' });
      }
    };

    req.onsuccess = (e) => {
      const db = e.target.result;
      db.onversionchange = () => {
        db.close();
        dataDbPromise = null;
      };
      const tx = db.transaction('meta', 'readwrite');
      const meta = tx.objectStore('meta');
      const getReq = meta.get('schema');
      getReq.onsuccess = () => {
        const stored = getReq.result?.schemaVersion;
        if (stored === undefined) {
          meta.put({ key: 'schema', schemaVersion: DATA_SCHEMA_VERSION });
        }
        dataDbReadOnly = stored !== undefined && stored > DATA_SCHEMA_VERSION;
      };
      tx.oncomplete = () => resolve(db);
      tx.onabort = () => reject(tx.error);
    };
    req.onerror = (e) => reject(e.target.error);
  }).catch((e) => {
    dataDbPromise = null;
    throw e;
  });

  return dataDbPromise;
}

// `work` must only await IDB requests of this transaction, otherwise the
// transaction auto-commits before the work finishes.
async function dataTransaction(storeNames, mode, work) {
  const db = await dataDbOpen();
  if (mode === 'readwrite' && dataDbReadOnly) {
    throw new Error(`Database schema is newer than ${DATA_SCHEMA_VERSION}; writes refused`);
  }

  const tx = db.transaction(storeNames, mode);
  const done = new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error('Transaction aborted'));
  });
  const stores = Object.fromEntries(storeNames.map((name) => [name, tx.objectStore(name)]));

  let result;
  try {
    result = await work(stores, tx);
  } catch (e) {
    try { tx.abort(); } catch { /* already finished */ }
    await done.catch(() => {});
    throw e;
  }
  await done;
  return result;
}

// Monotonic per worker; clients keep the newest blacklist snapshot by revision.
function nextDataRevision() {
  dataRevision = Math.max(Date.now(), dataRevision + 1);
  return dataRevision;
}

// Serialises every mutation (saves, sync, migration, import, recovery).
function dataMutate(work) {
  const run = dataMutationQueue.then(() => work());
  dataMutationQueue = run.catch(() => {});
  return run;
}

function isActive(record) {
  return !!record && (record.deletedAt ?? null) === null;
}

function canonicalRecord(record) {
  return JSON.stringify(Object.keys(record).sort().map((key) => [key, record[key] ?? null]));
}

// Last write wins on updatedAt; equal times fall back to a deterministic
// comparison so every device picks the same record.
function recordWins(incoming, local) {
  if (!local) return true;
  if (incoming.updatedAt !== local.updatedAt) return incoming.updatedAt > local.updatedAt;
  return canonicalRecord(incoming) > canonicalRecord(local);
}

function isJobType(type) {
  return typeof type === 'string' && Object.hasOwn(TYPE_RANK, type);
}

function isOlderIdentity(a, b) {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt;
  return a.id < b.id;
}

// ---- Jobs ----------------------------------------------------------------

function jobsGetAll() {
  return dataTransaction(['jobs'], 'readonly', async ({ jobs }) => {
    const all = await idbRequest(jobs.getAll());
    return all.filter(isActive);
  });
}

function jobsSave(entries, now = Date.now()) {
  const wanted = new Map();
  for (const entry of entries ?? []) {
    const linkedInJobId = entry?.linkedInJobId == null ? '' : String(entry.linkedInJobId);
    if (!linkedInJobId || !isJobType(entry.type)) continue;
    const previous = wanted.get(linkedInJobId);
    if (!previous || TYPE_RANK[entry.type] > TYPE_RANK[previous]) wanted.set(linkedInJobId, entry.type);
  }

  return dataTransaction(['jobs'], 'readwrite', async ({ jobs }) => {
    const changed = [];
    for (const [linkedInJobId, type] of wanted) {
      const existing = await idbRequest(jobs.index('linkedInJobId').get(linkedInJobId));
      if (isActive(existing) && TYPE_RANK[existing.type] >= TYPE_RANK[type]) continue;

      const record = existing
        ? { ...existing, type, stateAt: now, updatedAt: now, deletedAt: null }
        : { id: crypto.randomUUID(), linkedInJobId, type, stateAt: now, createdAt: now, updatedAt: now, deletedAt: null };
      await idbRequest(jobs.put(record));
      changed.push(record);
    }
    return changed;
  });
}

// Legacy LinkedIn-origin records `{ id, type, timestamp }`. Idempotent: re-running
// the same records changes nothing, so a retry after a lost acknowledgement is safe.
function jobsMigrateLegacy(legacyJobs, now = Date.now()) {
  const valid = (legacyJobs ?? []).filter((j) =>
    (typeof j?.id === 'string' || typeof j?.id === 'number') && String(j.id) &&
    isJobType(j.type) && Number.isFinite(j.timestamp));

  return dataTransaction(['jobs', 'meta'], 'readwrite', async ({ jobs, meta }) => {
    const changed = [];
    for (const legacy of valid) {
      const linkedInJobId = String(legacy.id);
      const existing = await idbRequest(jobs.index('linkedInJobId').get(linkedInJobId));
      let record = null;

      if (!existing) {
        record = {
          id: crypto.randomUUID(), linkedInJobId, type: legacy.type, stateAt: legacy.timestamp,
          createdAt: legacy.timestamp, updatedAt: legacy.timestamp, deletedAt: null,
        };
      } else if (!isActive(existing)) {
        if (existing.updatedAt < legacy.timestamp) {
          record = { ...existing, type: legacy.type, stateAt: legacy.timestamp, updatedAt: Math.max(now, existing.updatedAt + 1), deletedAt: null };
        }
      } else if (TYPE_RANK[legacy.type] > TYPE_RANK[existing.type]) {
        record = { ...existing, type: legacy.type, stateAt: legacy.timestamp, updatedAt: Math.max(now, existing.updatedAt + 1) };
      }

      if (record) {
        await idbRequest(jobs.put(record));
        changed.push(record);
      }
    }
    // Per-device record of migration progress, committed with the records. It is
    // informational: later writes from old-version tabs are still migrated.
    const previous = await idbRequest(meta.get(LEGACY_MIGRATION_KEY));
    await idbRequest(meta.put({
      key: LEGACY_MIGRATION_KEY,
      firstMigratedAt: previous?.firstMigratedAt ?? now,
      lastMigratedAt: now,
      lastAcknowledged: valid.length,
      totalAcknowledged: (previous?.totalAcknowledged ?? 0) + valid.length,
    }));
    return { migratedIds: valid.map((j) => j.id), changed };
  });
}

// ---- Companies -------------------------------------------------------------

function companyMatches(record, nameKey, slug) {
  return isActive(record) && record.nameKey === nameKey &&
    (!slug || !record.slug || record.slug === slug);
}

function companiesGetBlacklist() {
  return dataTransaction(['companies'], 'readonly', async ({ companies }) => {
    const all = await idbRequest(companies.getAll());
    return all.filter((c) => isActive(c) && c.status === 'blacklisted');
  });
}

function companiesLookup(name, slug = null) {
  const nameKey = normaliseNameKey(name);
  return dataTransaction(['companies'], 'readonly', async ({ companies }) => {
    const sameName = await idbRequest(companies.index('nameKey').getAll(nameKey));
    const matches = sameName.filter((c) => companyMatches(c, nameKey, slug));
    return { companies: matches, blacklisted: matches.some((c) => c.status === 'blacklisted') };
  });
}

async function companiesSetBlacklistedIn(companies, name, slug, blacklisted, now) {
  const nameKey = normaliseNameKey(name);
  const sameName = await idbRequest(companies.index('nameKey').getAll(nameKey));
  const matches = sameName.filter((c) => companyMatches(c, nameKey, slug) && c.status === 'blacklisted');
  const changed = [];

  if (!blacklisted) {
    for (const record of matches) {
      const updated = { ...record, deletedAt: now, updatedAt: Math.max(now, record.updatedAt + 1) };
      await idbRequest(companies.put(updated));
      changed.push(updated);
    }
    return changed;
  }

  if (matches.length) return changed;

  const revivable = sameName
    .filter((c) => !isActive(c) && !c.mergedInto && (c.slug ?? null) === (slug || null))
    .sort((a, b) => b.updatedAt - a.updatedAt)[0];
  const record = revivable
    ? { ...revivable, name: String(name).trim(), status: 'blacklisted', deletedAt: null, updatedAt: Math.max(now, revivable.updatedAt + 1) }
    : {
      id: crypto.randomUUID(), name: String(name).trim(), nameKey, slug: slug || null, status: 'blacklisted',
      mergedInto: null, createdAt: now, updatedAt: now, deletedAt: null,
    };
  await idbRequest(companies.put(record));
  changed.push(record);
  return changed;
}

// Merges active duplicates: same nameKey with equal slugs, or slug-less records
// when exactly one distinct slug exists for that name. The oldest identity wins;
// losers become tombstones pointing at the winner.
async function companiesMergeDuplicatesIn(companies, nameKeys, now) {
  const changed = [];
  for (const nameKey of new Set(nameKeys)) {
    const active = (await idbRequest(companies.index('nameKey').getAll(nameKey))).filter(isActive);
    if (active.length < 2) continue;

    const slugs = [...new Set(active.map((c) => c.slug).filter(Boolean))];
    const groups = new Map();
    for (const record of active) {
      const groupSlug = record.slug || (slugs.length === 1 ? slugs[0] : null);
      const group = groups.get(groupSlug) ?? [];
      group.push(record);
      groups.set(groupSlug, group);
    }

    for (const [groupSlug, group] of groups) {
      if (group.length < 2) continue;
      const winner = group.reduce((a, b) => (isOlderIdentity(a, b) ? a : b));
      for (const loser of group) {
        if (loser === winner) continue;
        const tombstone = { ...loser, mergedInto: winner.id, deletedAt: now, updatedAt: Math.max(now, loser.updatedAt + 1) };
        await idbRequest(companies.put(tombstone));
        changed.push(tombstone);
      }
      if (groupSlug && winner.slug !== groupSlug) {
        const updated = { ...winner, slug: groupSlug, updatedAt: Math.max(now, winner.updatedAt + 1) };
        await idbRequest(companies.put(updated));
        changed.push(updated);
      }
    }
  }
  return changed;
}

function companiesSetBlacklisted(name, slug, blacklisted, now = Date.now()) {
  if (!normaliseNameKey(name)) return Promise.reject(new Error('Company name is required'));
  return dataTransaction(['companies'], 'readwrite', async ({ companies }) => {
    const changed = await companiesSetBlacklistedIn(companies, name, slug, blacklisted, now);
    const merged = await companiesMergeDuplicatesIn(companies, changed.map((c) => c.nameKey), now);
    return [...changed, ...merged];
  });
}

function companiesToggleBlacklist(name, slug, now = Date.now()) {
  if (!normaliseNameKey(name)) return Promise.reject(new Error('Company name is required'));
  return dataTransaction(['companies'], 'readwrite', async ({ companies }) => {
    const nameKey = normaliseNameKey(name);
    const sameName = await idbRequest(companies.index('nameKey').getAll(nameKey));
    const blacklisted = !sameName.some((c) => companyMatches(c, nameKey, slug) && c.status === 'blacklisted');
    const changed = await companiesSetBlacklistedIn(companies, name, slug, blacklisted, now);
    const merged = await companiesMergeDuplicatesIn(companies, changed.map((c) => c.nameKey), now);
    return { blacklisted, changed: [...changed, ...merged] };
  });
}

function companiesAttachSlug(name, slug, now = Date.now()) {
  const nameKey = normaliseNameKey(name);
  if (!nameKey || typeof slug !== 'string' || !slug) return Promise.resolve(null);

  return dataTransaction(['companies'], 'readwrite', async ({ companies }) => {
    const active = (await idbRequest(companies.index('nameKey').getAll(nameKey))).filter(isActive);
    if (active.some((c) => c.slug === slug)) return null;
    const slugless = active.filter((c) => !c.slug);
    if (slugless.length !== 1) return null;

    const updated = { ...slugless[0], slug, updatedAt: Math.max(now, slugless[0].updatedAt + 1) };
    await idbRequest(companies.put(updated));
    return updated;
  });
}

// Applies remote company records (sync mirror) by last write wins, then merges.
function companiesApplyRemote(records, now = Date.now()) {
  return dataTransaction(['companies'], 'readwrite', async ({ companies }) => {
    const applied = [];
    const newerLocal = [];
    for (const incoming of records) {
      const local = await idbRequest(companies.get(incoming.id));
      if (!recordWins(incoming, local)) {
        if (canonicalRecord(incoming) !== canonicalRecord(local)) newerLocal.push(local);
        continue;
      }
      // A newer user deletion of an identity that was merged away here applies to
      // the merge winner, so the deletion is not lost behind the merge.
      if (local?.mergedInto && !incoming.mergedInto && incoming.deletedAt !== null) {
        const tombstone = { ...incoming, mergedInto: local.mergedInto, updatedAt: Math.max(now, incoming.updatedAt + 1) };
        await idbRequest(companies.put(tombstone));
        applied.push(incoming);
        newerLocal.push(tombstone);
        const target = await idbRequest(companies.get(local.mergedInto));
        if (isActive(target) && target.updatedAt < incoming.updatedAt) {
          const deleted = { ...target, deletedAt: incoming.deletedAt, updatedAt: Math.max(now, target.updatedAt + 1) };
          await idbRequest(companies.put(deleted));
          newerLocal.push(deleted);
        }
        continue;
      }
      await idbRequest(companies.put(incoming));
      applied.push(incoming);
    }
    const merged = await companiesMergeDuplicatesIn(companies, applied.map((c) => c.nameKey), now);
    return { applied, merged, newerLocal };
  });
}

function companiesGetAll() {
  return dataTransaction(['companies'], 'readonly', ({ companies }) => idbRequest(companies.getAll()));
}

// ---- Notes -----------------------------------------------------------------

function noteMatchesSlug(note, companySlug) {
  return !companySlug || !note.companySlug || note.companySlug === companySlug;
}

function notesListGroup(title, company, companySlug = null) {
  const groupKey = noteGroupKey(title, company);
  return dataTransaction(['notes'], 'readonly', async ({ notes }) => {
    const group = await idbRequest(notes.index('groupKey').getAll(groupKey));
    return group
      .filter((n) => isActive(n) && noteMatchesSlug(n, companySlug))
      .sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1));
  });
}

function notesGroupsWithNotes(groups) {
  return dataTransaction(['notes'], 'readonly', async ({ notes }) => {
    const matches = [];
    for (const group of groups ?? []) {
      const found = await idbRequest(notes.index('groupKey').getAll(noteGroupKey(group?.title, group?.company)));
      matches.push(found.some((n) => isActive(n) && noteMatchesSlug(n, group?.companySlug || null)));
    }
    return matches;
  });
}

function notesAdd({ linkedInJobId = null, title, company, companySlug = null, text }, now = Date.now()) {
  if (typeof title !== 'string' || typeof company !== 'string' || !normaliseNameKey(title) || !normaliseNameKey(company)) {
    return Promise.reject(new Error('Note title and company are required'));
  }
  if (companySlug !== null && !isNonEmptyString(companySlug)) {
    return Promise.reject(new Error('companySlug must be a string or null'));
  }
  if (typeof text !== 'string' || !text.trim()) return Promise.reject(new Error('Note text is required'));
  if (linkedInJobId !== null && (typeof linkedInJobId !== 'string' || !linkedInJobId)) {
    return Promise.reject(new Error('linkedInJobId must be a string or null'));
  }

  const note = {
    id: crypto.randomUUID(), groupKey: noteGroupKey(title, company), title: title.trim(), company: company.trim(),
    companySlug: companySlug || null, linkedInJobId, text, createdAt: now, updatedAt: now, deletedAt: null,
  };
  return dataTransaction(['notes'], 'readwrite', async ({ notes }) => {
    await idbRequest(notes.add(note));
    return note;
  });
}

function notesChange(id, change, now = Date.now()) {
  return dataTransaction(['notes'], 'readwrite', async ({ notes }) => {
    const existing = await idbRequest(notes.get(id));
    if (!isActive(existing)) throw new Error('Note not found');
    const note = { ...existing, ...change, updatedAt: Math.max(now, existing.updatedAt + 1) };
    await idbRequest(notes.put(note));
    return note;
  });
}

function notesUpdate(id, text, now = Date.now()) {
  if (typeof text !== 'string' || !text.trim()) return Promise.reject(new Error('Note text is required'));
  return notesChange(id, { text }, now);
}

function notesDelete(id, now = Date.now()) {
  return notesChange(id, { deletedAt: now }, now);
}

// ---- Export / import ---------------------------------------------------------

async function dataExport() {
  await dataRecoverImport();
  const [stores, options] = await Promise.all([
    dataTransaction(['jobs', 'companies', 'notes'], 'readonly', async ({ jobs, companies, notes }) => ({
      jobs: await idbRequest(jobs.getAll()),
      companies: await idbRequest(companies.getAll()),
      notes: await idbRequest(notes.getAll()),
    })),
    getOptions(),
  ]);

  return {
    format: EXPORT_FORMAT,
    schemaVersion: DATA_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    appVersion: chrome.runtime.getManifest().version,
    options,
    ...stores,
  };
}

function isTimestamp(value) {
  return Number.isFinite(value) && value >= 0;
}

function isOptionalTimestamp(value) {
  return value === null || isTimestamp(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function isNullableString(value) {
  return value === null || isNonEmptyString(value);
}

function assertImport(condition, message) {
  if (!condition) throw new Error(`Invalid backup: ${message}`);
}

function validateBackupOptions(options) {
  const colour = (value) => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
  assertImport(options && typeof options === 'object' && !Array.isArray(options), 'options must be an object');
  assertImport(typeof options.debug === 'boolean', 'options.debug must be a boolean');
  assertImport(typeof options.ageingLimitDays === 'string' ||
    (typeof options.ageingLimitDays === 'number' && Number.isFinite(options.ageingLimitDays)), 'options.ageingLimitDays is invalid');
  assertImport(typeof options.treatPromotedAsViewed === 'boolean', 'options.treatPromotedAsViewed must be a boolean');
  assertImport(typeof options.unwantedTitleWords === 'string', 'options.unwantedTitleWords must be a string');
  const colours = options.colours;
  assertImport(colours && typeof colours === 'object', 'options.colours must be an object');
  assertImport(typeof colours.viewed === 'number' && colours.viewed >= 0 && colours.viewed <= 1, 'options.colours.viewed is invalid');
  assertImport(colour(colours.applied) && colour(colours.blacklisted), 'options.colours must be #rrggbb values');
  return normaliseOptions(options);
}

function validateBackupRecords(list, label, validate) {
  assertImport(Array.isArray(list), `${label} must be an array`);
  const ids = new Set();
  return list.map((record, index) => {
    assertImport(record && typeof record === 'object', `${label}[${index}] must be an object`);
    assertImport(isNonEmptyString(record.id) && !ids.has(record.id), `${label}[${index}].id is missing or duplicated`);
    assertImport(isTimestamp(record.createdAt) && isTimestamp(record.updatedAt) && isOptionalTimestamp(record.deletedAt ?? null),
      `${label}[${index}] timestamps are invalid`);
    ids.add(record.id);
    return validate(record, `${label}[${index}]`);
  });
}

// Validates the whole file before anything is written. Returns normalised
// records; throws on the first invalid value.
function validateImport(data) {
  assertImport(data && typeof data === 'object' && !Array.isArray(data), 'file must contain a JSON object');

  if (data.format === EXPORT_FORMAT) {
    assertImport(data.schemaVersion === DATA_SCHEMA_VERSION, `unsupported schemaVersion ${data.schemaVersion}`);
    const jobIds = new Set();
    const jobs = validateBackupRecords(data.jobs, 'jobs', (j, at) => {
      assertImport(isNonEmptyString(j.linkedInJobId) && !jobIds.has(j.linkedInJobId), `${at}.linkedInJobId is missing or duplicated`);
      assertImport(isJobType(j.type), `${at}.type is invalid`);
      assertImport(isTimestamp(j.stateAt), `${at}.stateAt is invalid`);
      jobIds.add(j.linkedInJobId);
      return {
        id: j.id, linkedInJobId: j.linkedInJobId, type: j.type, stateAt: j.stateAt,
        createdAt: j.createdAt, updatedAt: j.updatedAt, deletedAt: j.deletedAt ?? null,
      };
    });
    const companies = validateBackupRecords(data.companies, 'companies', (c, at) => {
      assertImport(isNonEmptyString(c.name) && normaliseNameKey(c.name), `${at}.name is required`);
      assertImport(isNullableString(c.slug ?? null), `${at}.slug is invalid`);
      assertImport(COMPANY_STATUSES.includes(c.status), `${at}.status is invalid`);
      assertImport(isNullableString(c.mergedInto ?? null), `${at}.mergedInto is invalid`);
      return {
        id: c.id, name: c.name, nameKey: normaliseNameKey(c.name), slug: c.slug ?? null, status: c.status,
        mergedInto: c.mergedInto ?? null, createdAt: c.createdAt, updatedAt: c.updatedAt, deletedAt: c.deletedAt ?? null,
      };
    });
    const notes = validateBackupRecords(data.notes, 'notes', (n, at) => {
      assertImport(typeof n.title === 'string' && typeof n.company === 'string', `${at}.title/company are invalid`);
      assertImport(typeof n.text === 'string', `${at}.text is invalid`);
      assertImport(isNullableString(n.companySlug ?? null) && isNullableString(n.linkedInJobId ?? null), `${at} slug/job ID are invalid`);
      return {
        id: n.id, groupKey: noteGroupKey(n.title, n.company), title: n.title, company: n.company,
        companySlug: n.companySlug ?? null, linkedInJobId: n.linkedInJobId ?? null, text: n.text,
        createdAt: n.createdAt, updatedAt: n.updatedAt, deletedAt: n.deletedAt ?? null,
      };
    });
    return { kind: 'v2', options: validateBackupOptions(data.options), jobs, companies, notes };
  }

  assertImport(data.format === undefined, `unknown format ${data.format}`);
  // v1 (pre-backup export): options use the shared normaliser fallback, as before.
  const blacklist = data.blacklist ?? [];
  assertImport(Array.isArray(blacklist) && blacklist.every((n) => typeof n === 'string'), 'blacklist must be an array of names');
  const jobs = data.jobs ?? [];
  assertImport(Array.isArray(jobs), 'jobs must be an array');
  jobs.forEach((j, i) => assertImport(
    j && (typeof j.id === 'string' || typeof j.id === 'number') && String(j.id) && isJobType(j.type) && isTimestamp(j.timestamp),
    `jobs[${i}] is invalid`,
  ));
  assertImport(data.options === undefined || (data.options && typeof data.options === 'object'), 'options must be an object');
  return {
    kind: 'v1',
    options: data.options === undefined ? undefined : normaliseOptions(data.options),
    blacklist: blacklist.filter((n) => normaliseNameKey(n)),
    jobs,
  };
}

async function readStoredSettings() {
  const result = await chrome.storage.sync.get(SETTINGS_KEY);
  return result[SETTINGS_KEY] ?? null;
}

function restoreStoredSettings(previous) {
  return previous === null
    ? chrome.storage.sync.remove(SETTINGS_KEY)
    : chrome.storage.sync.set({ [SETTINGS_KEY]: previous });
}

// Settings arrive from every context through `settings.set` and are serialised
// with imports. Written directly: setOptions() itself messages the background.
async function settingsSet(options) {
  await dataRecoverImport();
  await chrome.storage.sync.set({ [SETTINGS_KEY]: normaliseOptions(options) });
}

async function importRecordsIn({ jobs, companies, notes }, parsed, now) {
  const changed = { jobs: [], companies: [], notes: [] };

  if (parsed.kind === 'v1') {
    for (const name of parsed.blacklist) {
      changed.companies.push(...await companiesSetBlacklistedIn(companies, name, null, true, now));
    }
    for (const legacy of parsed.jobs) {
      const linkedInJobId = String(legacy.id);
      const existing = await idbRequest(jobs.index('linkedInJobId').get(linkedInJobId));
      if (isActive(existing) && TYPE_RANK[existing.type] >= TYPE_RANK[legacy.type]) continue;
      const record = existing
        ? { ...existing, type: legacy.type, stateAt: legacy.timestamp, updatedAt: Math.max(now, existing.updatedAt + 1), deletedAt: null }
        : {
          id: crypto.randomUUID(), linkedInJobId, type: legacy.type, stateAt: legacy.timestamp,
          createdAt: legacy.timestamp, updatedAt: legacy.timestamp, deletedAt: null,
        };
      await idbRequest(jobs.put(record));
      changed.jobs.push(record);
    }
  } else {
    for (const incoming of parsed.jobs) {
      const byId = await idbRequest(jobs.get(incoming.id));
      const byJob = await idbRequest(jobs.index('linkedInJobId').get(incoming.linkedInJobId));
      const locals = [byId, byJob].filter(Boolean);
      if (!locals.every((local) => recordWins(incoming, local))) continue;
      for (const local of locals) {
        if (local.id !== incoming.id) await idbRequest(jobs.delete(local.id));
      }
      await idbRequest(jobs.put(incoming));
      changed.jobs.push(incoming);
    }
    for (const incoming of parsed.companies) {
      const local = await idbRequest(companies.get(incoming.id));
      if (!recordWins(incoming, local)) continue;
      await idbRequest(companies.put(incoming));
      changed.companies.push(incoming);
    }
    for (const incoming of parsed.notes) {
      const local = await idbRequest(notes.get(incoming.id));
      if (!recordWins(incoming, local)) continue;
      await idbRequest(notes.put(incoming));
      changed.notes.push(incoming);
    }
  }

  changed.companies.push(...await companiesMergeDuplicatesIn(companies, changed.companies.map((c) => c.nameKey), now));
  return changed;
}

// Crash-safe import: the journal (with the previous settings) is committed before
// settings change and removed in the same transaction as the records, so a
// journal left behind means the records never committed and settings are rolled back.
// storage.sync cannot be locked against other devices: recovery restores the
// previous settings only while the imported value is still the stored one, so a
// later, unrelated settings change (local or synced) is never rolled back.
async function dataImport(data, now = Date.now()) {
  // A journal left by an earlier failed rollback must be resolved first, never overwritten.
  await dataRecoverImport();
  const parsed = validateImport(data);
  const previousSettings = await readStoredSettings();
  const importedSettings = parsed.options === undefined ? undefined : normaliseOptions(parsed.options);

  await dataTransaction(['meta'], 'readwrite', ({ meta }) =>
    idbRequest(meta.put({ key: IMPORT_JOURNAL_KEY, previousSettings, importedSettings: importedSettings ?? null, startedAt: now })));

  try {
    if (importedSettings !== undefined) await chrome.storage.sync.set({ [SETTINGS_KEY]: importedSettings });
    return await dataTransaction(['jobs', 'companies', 'notes', 'meta'], 'readwrite', async (stores) => {
      const changed = await importRecordsIn(stores, parsed, now);
      await idbRequest(stores.meta.delete(IMPORT_JOURNAL_KEY));
      return changed;
    });
  } catch (e) {
    await dataRecoverImport();
    throw e;
  }
}

async function dataRecoverImport() {
  const journal = await dataTransaction(['meta'], 'readonly', ({ meta }) => idbRequest(meta.get(IMPORT_JOURNAL_KEY)));
  if (!journal) return false;
  if (journal.importedSettings !== null &&
    JSON.stringify(await readStoredSettings()) === JSON.stringify(journal.importedSettings)) {
    await restoreStoredSettings(journal.previousSettings ?? null);
  }
  await dataTransaction(['meta'], 'readwrite', ({ meta }) => idbRequest(meta.delete(IMPORT_JOURNAL_KEY)));
  return true;
}
