// Background-only blacklist mirror in storage.sync (#10). IndexedDB stays the
// source of truth; this module mirrors companies and keeps the legacy array in
// step for devices still running an older version.

const SYNC_MIRROR_PREFIX = 'co:';
const SYNC_LEGACY_BLACKLIST_KEY = 'blacklistedCompanies';
const SYNC_LEGACY_SEEN_KEY = 'ljmLegacyBlacklistSeen';
// Written with the legacy array by current versions only. An array equal to it
// came from a current device and carries no old-version change to apply.
const SYNC_LEGACY_WRITER_KEY = 'ljmLegacyBlacklistWriter';
const SYNC_STATUS_KEY = 'ljmSyncStatus';
const SYNC_TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function syncMirrorValue(record) {
  return {
    name: record.name,
    slug: record.slug ?? null,
    status: record.status,
    mergedInto: record.mergedInto ?? null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    deletedAt: record.deletedAt ?? null,
  };
}

function syncRecordFromMirror(key, value) {
  const id = key.slice(SYNC_MIRROR_PREFIX.length);
  if (!id || !value || typeof value !== 'object') return null;
  if (typeof value.name !== 'string' || !normaliseNameKey(value.name)) return null;
  if (!COMPANY_STATUSES.includes(value.status)) return null;
  if (!isTimestamp(value.createdAt) || !isTimestamp(value.updatedAt) || !isOptionalTimestamp(value.deletedAt ?? null)) return null;
  if (!isNullableString(value.slug ?? null) || !isNullableString(value.mergedInto ?? null)) return null;

  return {
    id,
    name: value.name,
    nameKey: normaliseNameKey(value.name),
    slug: value.slug ?? null,
    status: value.status,
    mergedInto: value.mergedInto ?? null,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    deletedAt: value.deletedAt ?? null,
  };
}

function isExpiredTombstone(record, now) {
  return record.deletedAt !== null && now - record.deletedAt > SYNC_TOMBSTONE_TTL_MS;
}

async function syncGetStatus() {
  const result = await chrome.storage.local.get(SYNC_STATUS_KEY);
  return result[SYNC_STATUS_KEY] ?? { mirror: 'ok', error: null, at: null };
}

async function syncSetStatus(mirror, error = null, now = Date.now()) {
  const previous = await syncGetStatus();
  if (previous.mirror === mirror && previous.error === error) return;
  const status = { mirror, error, at: error ? now : null };
  await chrome.storage.local.set({ [SYNC_STATUS_KEY]: status });
  chrome.runtime.sendMessage({ action: 'sync-status-changed', status }).catch(() => {});
}

// Updates of existing mirror keys are written separately from new keys, so a
// full mirror still propagates deletions and edits of companies already mirrored.
async function syncPushCompanies(records, now = Date.now()) {
  const items = {};
  for (const record of records) {
    const key = SYNC_MIRROR_PREFIX + record.id;
    if (!items[key] || record.updatedAt >= items[key].updatedAt) items[key] = syncMirrorValue(record);
  }
  const keys = Object.keys(items);
  if (!keys.length) return;

  const existing = await chrome.storage.sync.get(keys);
  const updates = Object.fromEntries(keys.filter((k) => k in existing).map((k) => [k, items[k]]));
  // Expired tombstones are never re-added once purged; local tombstones still
  // overwrite a stale record that an offline peer pushes back.
  const additions = Object.fromEntries(keys
    .filter((k) => !(k in existing) && !isExpiredTombstone(items[k], now))
    .map((k) => [k, items[k]]));

  try {
    if (Object.keys(updates).length) await chrome.storage.sync.set(updates);
    if (Object.keys(additions).length) await chrome.storage.sync.set(additions);
    await syncSetStatus('ok');
  } catch (e) {
    const message = e?.message || String(e);
    await syncSetStatus(/QUOTA|MAX_ITEMS/i.test(message) ? 'full' : 'error', message, now);
  }
}

function sameNames(list, names) {
  return Array.isArray(list) && list.length === names.length && list.every((n, i) => n === names[i]);
}

function uniqueBlacklistNames(companies) {
  const seen = new Set();
  return [...companies]
    .sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1))
    .filter((c) => !seen.has(c.nameKey) && seen.add(c.nameKey))
    .map((c) => c.name);
}

// The sync write comes before the snapshot: if the worker dies in between, the
// next diff only reports changes that are already applied locally.
async function syncWriteLegacy() {
  const names = uniqueBlacklistNames(await companiesGetBlacklist());
  const [legacy, seen] = await Promise.all([
    chrome.storage.sync.get([SYNC_LEGACY_BLACKLIST_KEY, SYNC_LEGACY_WRITER_KEY]),
    chrome.storage.local.get(SYNC_LEGACY_SEEN_KEY),
  ]);
  // A fresh device must not publish an empty array before synced data arrives.
  if (!names.length && !Array.isArray(legacy[SYNC_LEGACY_BLACKLIST_KEY])) return;
  if (sameNames(legacy[SYNC_LEGACY_BLACKLIST_KEY], names) && sameNames(legacy[SYNC_LEGACY_WRITER_KEY], names) &&
    sameNames(seen[SYNC_LEGACY_SEEN_KEY], names)) return;

  try {
    await chrome.storage.sync.set({ [SYNC_LEGACY_BLACKLIST_KEY]: names, [SYNC_LEGACY_WRITER_KEY]: names });
  } catch (e) {
    await syncSetStatus('error', e?.message || String(e));
    return;
  }
  await chrome.storage.local.set({ [SYNC_LEGACY_SEEN_KEY]: names });
}

// Applies additions and removals made by older versions as a diff against the
// last array this device saw. An absent snapshot means first run (migration).
// Conservative policy, as the old format has no timestamps: an addition only
// creates companies unknown here; a known tombstone is never revived, so a stale
// array cannot undo a newer deletion. Re-blacklisting a deleted company needs a
// current version (an old-version re-add of it is not applied).
async function syncApplyLegacy(now = Date.now()) {
  const [legacyResult, seenResult] = await Promise.all([
    chrome.storage.sync.get([SYNC_LEGACY_BLACKLIST_KEY, SYNC_LEGACY_WRITER_KEY]),
    chrome.storage.local.get(SYNC_LEGACY_SEEN_KEY),
  ]);
  const legacy = legacyResult[SYNC_LEGACY_BLACKLIST_KEY];
  if (!Array.isArray(legacy)) return [];

  const names = legacy.filter((n) => typeof n === 'string' && normaliseNameKey(n));
  if (sameNames(legacyResult[SYNC_LEGACY_WRITER_KEY], legacy)) {
    await chrome.storage.local.set({ [SYNC_LEGACY_SEEN_KEY]: names });
    return [];
  }
  const seen = seenResult[SYNC_LEGACY_SEEN_KEY] ?? [];
  const legacyKeys = new Set(names.map(normaliseNameKey));
  const seenKeys = new Set(seen.map(normaliseNameKey));
  const knownKeys = new Set((await companiesGetAll()).map((c) => c.nameKey));
  const changed = [];

  for (const name of names.filter((n) => !seenKeys.has(normaliseNameKey(n)) && !knownKeys.has(normaliseNameKey(n)))) {
    changed.push(...await companiesSetBlacklisted(name, null, true, now));
  }
  for (const name of seen.filter((n) => !legacyKeys.has(normaliseNameKey(n)))) {
    changed.push(...await companiesSetBlacklisted(name, null, false, now));
  }

  await chrome.storage.local.set({ [SYNC_LEGACY_SEEN_KEY]: names });
  return changed;
}

async function syncAfterCompaniesChange(changed) {
  if (changed.length) await syncPushCompanies(changed);
  await syncWriteLegacy();
}

// Handles storage.onChanged for the sync area; returns the local changes.
async function syncHandleStorageChanges(changes, now = Date.now()) {
  const remote = Object.entries(changes)
    .filter(([key, change]) => key.startsWith(SYNC_MIRROR_PREFIX) && change.newValue !== undefined)
    .map(([key, change]) => syncRecordFromMirror(key, change.newValue))
    .filter(Boolean);
  const changed = [];

  if (remote.length) {
    const { applied, merged, newerLocal } = await companiesApplyRemote(remote, now);
    changed.push(...applied);
    if (merged.length || newerLocal.length) await syncPushCompanies([...merged, ...newerLocal], now);
    changed.push(...merged);
  }

  if (SYNC_LEGACY_BLACKLIST_KEY in changes || SYNC_LEGACY_WRITER_KEY in changes) {
    const legacyChanged = await syncApplyLegacy(now);
    if (legacyChanged.length) await syncPushCompanies(legacyChanged, now);
    changed.push(...legacyChanged);
  }

  if (changed.length) await syncWriteLegacy();
  return changed;
}

// Full pull/push on startup: covers changes missed while the worker or browser
// was not running, the first run after migration, and retries after quota errors.
async function syncReconcile(now = Date.now()) {
  const all = await chrome.storage.sync.get(null);
  const mirrored = new Map();
  const expiredKeys = [];
  for (const [key, value] of Object.entries(all)) {
    if (!key.startsWith(SYNC_MIRROR_PREFIX)) continue;
    const record = syncRecordFromMirror(key, value);
    if (!record) continue;
    if (isExpiredTombstone(record, now)) expiredKeys.push(key);
    mirrored.set(record.id, record);
  }

  const { applied, merged } = await companiesApplyRemote([...mirrored.values()], now);
  const legacyChanged = await syncApplyLegacy(now);

  const local = await companiesGetAll();
  const toPush = local.filter((record) => {
    const remote = mirrored.get(record.id);
    if (!remote) return !isExpiredTombstone(record, now);
    return recordWins(syncRecordFromMirror(SYNC_MIRROR_PREFIX + record.id, syncMirrorValue(record)), remote);
  });

  if (expiredKeys.length) await chrome.storage.sync.remove(expiredKeys);
  await syncPushCompanies(toPush, now);
  // Start-up only rewrites the legacy array when something changed here or it
  // is missing, so a device with stale state does not overwrite newer arrays.
  const changed = [...applied, ...merged, ...legacyChanged];
  if (changed.length || !Array.isArray(all[SYNC_LEGACY_BLACKLIST_KEY])) await syncWriteLegacy();
  return changed;
}
