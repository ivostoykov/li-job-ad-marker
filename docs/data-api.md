# Background data API (branch feat/background-data)

Single owner: the background (`src/js/store.js` + `src/js/sync.js`, routed in `src/background.js`) is the only code that touches the extension-origin IndexedDB (`ljm-data`) and the blacklist `storage.sync` mirror. Every other context uses `chrome.runtime.sendMessage({ action, ...payload })`.

Responses: `{ ok: true, ...result }` or `{ ok: false, error: string }`. Never throws across the boundary.

Every request first waits for start-up recovery (interrupted import roll-back, then a non-blocking blacklist reconcile). If recovery fails, requests return `{ ok: false, error: 'Data start-up recovery failed; retry later: …' }` and the next request retries it. All writes, `companies.getBlacklist`, `data.export` and `settings.set` are serialised in one queue with imports.

## Records (#5 / #6)

All records: `id` (client `crypto.randomUUID()`), `createdAt`, `updatedAt` (epoch ms, set by the store only), `deletedAt` (`null` | epoch ms). Default reads exclude `deletedAt !== null`. Deletes are soft.

```
Job      { id, linkedInJobId: string, type: 'viewed'|'applied', stateAt: number,
           createdAt, updatedAt, deletedAt }
           // stateAt = time the current type was reached (legacy `timestamp`); ordinary saves only raise type (TYPE_RANK)
           // index linkedInJobId (unique)
Company  { id, name, nameKey, slug: string|null, status: 'blacklisted',
           mergedInto: string|null, createdAt, updatedAt, deletedAt }
           // nameKey = normaliseNameKey(name): trim, collapse whitespace, lower case. No suffix/alias logic.
           // un-blacklist = soft delete; re-blacklist revives the same record
           // indexes nameKey, slug (both non-unique)
Note     { id, groupKey, title, company, companySlug: string|null, linkedInJobId: string|null, text,
           createdAt, updatedAt, deletedAt }
           // groupKey = noteGroupKey(title, company); non-unique
           // indexes groupKey, linkedInJobId (non-unique)
meta     { key: 'schema', schemaVersion: 2 }        // a stored higher schemaVersion refuses writes
         { key: 'importJournal', previousSettings, importedSettings, startedAt }   // only while an import is in flight
         { key: 'jobsLegacyMigration', firstMigratedAt, lastMigratedAt, lastAcknowledged, totalAcknowledged }
```

Shared helpers in `src/js/utils.js` (background, content, options): `TYPE_RANK`, `normaliseNameKey(text)`, `noteGroupKey(title, company)`.

### Company identity

- Match by `nameKey`. A slug, when known on both sides, decides: different slugs = different companies.
- Card without slug: blacklisted if any active blacklisted record has that `nameKey` (name fallback, no UI blocking).
- With slug: matches records with the same slug or a slug-less record of the same `nameKey`; records with a different slug do not match.
- Un-blacklist without slug removes every active same-name record; with slug removes the matching ones only.
- Slugs come only from same-origin `/company/<slug>/` link paths (lower-cased); `companyUrn` query links are ignored.

## Messages

| action | payload | result |
|---|---|---|
| `jobs.getAll` | – | `{ jobs: Job[] }` (active) |
| `jobs.save` | `{ jobs: [{ linkedInJobId, type }] }` | `{ jobs: Job[] }` changed only; rank-monotonic, batched |
| `jobs.migrateLegacy` | `{ jobs: [{ id, type, timestamp }] }` (legacy LinkedIn-origin records) | `{ migratedIds }` legacy IDs committed; invalid records are not acknowledged; idempotent |
| `companies.getBlacklist` | – | `{ companies: Company[], revision }` active blacklisted |
| `companies.lookup` | `{ name, slug? }` | `{ companies: Company[], blacklisted: boolean }` |
| `companies.setBlacklisted` | `{ name, slug?, blacklisted: boolean }` | `{ blacklisted, companies: Company[] /* changed */, blacklist: Company[], revision }` |
| `companies.toggleBlacklist` | `{ name, slug? }` | same as `setBlacklisted` |
| `companies.attachSlug` | `{ name, slug }` | `{ company: Company|null }` attaches only to a single slug-less active record of that name; never creates |
| `notes.listGroup` | `{ title, company, companySlug? }` | `{ notes: Note[] }` active, newest `createdAt` first; notes with a different non-null `companySlug` are excluded |
| `notes.add` | `{ linkedInJobId: string|null, title, company, companySlug?: string|null, text }` | `{ note }`; title, company and text must be non-blank |
| `notes.update` | `{ id, text }` | `{ note }` keeps createdAt, group, companySlug, linkedInJobId |
| `notes.delete` | `{ id }` | `{ note }` soft delete |
| `notes.groupsWithNotes` | `{ groups: [{ title, company, companySlug? }] }` | `{ matches: boolean[] }` aligned with `groups` |
| `data.export` | – | `{ data: Snapshot }` |
| `data.import` | `{ data: Snapshot | LegacyV1Export }` | `{ counts: { jobs, companies, notes } }` changed records |
| `settings.set` | `{ options }` | `{}`; normalised with `normaliseOptions`. `setOptions()` sends this from every context |
| `sync.status` | – | `{ status: { mirror: 'ok'|'full'|'error', error: string|null, at: number|null } }` |

`data.export` and `data.import` are accepted only from extension pages (`sender.url` under `chrome.runtime.getURL('')`); content scripts get `error: 'forbidden'`.

Incognito senders (`sender.tab.incognito`): `jobs.save`, `jobs.migrateLegacy`, `notes.add|update|delete` are refused with `error: 'incognito'`. Content in incognito keeps jobs in its ephemeral LinkedIn-origin DB as before. Blacklist and settings writes stay allowed (they were already synced).

### Snapshot (`data.export` / `data.import`)

```
{ format: 'ljm-export', schemaVersion: 2, exportedAt: ISO string, appVersion,
  options, jobs: Job[], companies: Company[], notes: Note[] }   // includes tombstones
```

Import:
- A pending journal from an earlier failed roll-back is resolved first; the import fails rather than overwrite it.
- Whole file validated before any write; any invalid record or any v2 option with a wrong type rejects the import.
- v1 must look like the previous exporter's file: non-empty `version`, `options` object, `blacklist: string[]`, optional `jobs: [{id,type,timestamp}]`, and no v2 fields (`format`, `schemaVersion`, `companies`, `notes`, `exportedAt`). Anything else is rejected. It is converted: options use the shared `normaliseOptions` fallback (invalid fields become defaults, as before); blacklist names reuse same-`nameKey` records; jobs merge by `linkedInJobId` (rank-monotonic).
- v2 merge: by `id`, newer `updatedAt` wins, including lower states and deletions; equal times use a deterministic tie. A job whose `linkedInJobId` exists under another ID is replaced only if the incoming record is newer than every local match. Companies are merged by name/slug afterwards. Notes by `id` only.
- Crash safety: the journal (previous and imported settings) commits before settings change and is deleted in the same transaction as the records. A journal found later means the records never committed; previous settings are restored only while the stored value still equals the imported one, so a later unrelated change (local or synced) is not rolled back. storage.sync cannot be locked against other devices.

### Broadcasts

- `{ action: 'data-changed', jobs?: Job[] /* changed, tombstones included */, companies?: Company[] /* full active blacklist */, revision?, notes?: Note[] }` to every LinkedIn tab (all frames) and to extension pages.
- `{ action: 'sync-status-changed', status }` to extension pages when the mirror status changes.

## Content-side hooks (load order utils → settings → db → blacklist → log → content → feature modules)

- `src/js/db.js`: `dbGetJob(linkedInJobId)`, `dbSaveJob(linkedInJobId, type)`, `dbGetAllJobs()` keep their names; new `dbSaveJobs(entries)`. The per-frame cache keeps the newest `updatedAt` per job and buffers broadcasts that arrive while the first snapshot loads. Incognito uses the ephemeral local DB.
- `dbMigrateLegacyJobs()` (top frame, every load while the legacy DB exists): sends all legacy records, then deletes only acknowledged records that are unchanged since they were read. The legacy database itself is kept (deleting it can block on old-version tabs' connections); old-version tabs' later writes migrate on the next load.
- `src/js/blacklist.js`: `blGetList()` (names), `blGetCompanies()`, `blIncludes(name, slug?)`, `blAdd(name, slug?)`, `blRemove(name, slug?)`, `blOnChange(listener)`; snapshots older than the cached `revision` are ignored.
- Adapters: `getCompanySlug(card)` (card's own company link; shared by all three adapters) and `getDetailPanelCompany()` → `{ name, slug }|null`. `getCardCompanyIdentity(card, adapter)` borrows the panel slug only when the URL `currentJobId`, the rendered panel job ID and the normalised company names all match.
- Marker state: read the content global `enabled`; react to toggles with `addMessageAction('marker-toggle', ...)` registered after content.js.

## Sync mirror (#10)

- Keys `co:<id>` → `{ name, slug, status, mergedInto, createdAt, updatedAt, deletedAt }`; no notes. IndexedDB is the source of truth.
- Last write wins on `updatedAt`; equal time: deterministic comparison of the canonical record. Own echoes cause no writes. A local record newer than an incoming one is pushed back.
- Duplicate merge: active records with equal `nameKey` and compatible slugs merge into the oldest (`createdAt`, then `id`); the loser becomes a tombstone with `mergedInto`. A newer user deletion of a merged-away identity also deletes the merge winner.
- Tombstones older than 30 days are purged from the mirror on start-up and never re-added; devices keep their IndexedDB tombstones, which overwrite a stale record an offline peer pushes back.
- Quota/rate errors: local data unaffected; updates of existing keys are written separately so deletions still propagate; `sync.status` reports `full`/`error`; start-up reconcile retries.

### Legacy `blacklistedCompanies` array (version transition)

- Kept and dual-written (active names) together with `ljmLegacyBlacklistWriter`, an identical copy written only by current versions. An array equal to the writer copy came from a current device and is not diffed.
- Other arrays come from old versions and are applied as a diff (additions and removals) against this device's last seen array (`storage.local` `ljmLegacyBlacklistSeen`, which is also the per-device blacklist migration marker).
- Conservative policy (the old format has no timestamps): additions only create companies unknown locally and in the mirror; a known tombstone is never revived, so a stale array cannot undo a newer deletion. Removals still propagate.
- Start-up rewrites the legacy array only if something changed locally or it is missing; a device with no blacklist never publishes an empty array.
- Known limitations (tested): an old-version re-add of a deleted company is not applied (re-blacklist with a current version); an old-version change written back to exactly the current writer copy is not detected. Remove the legacy array in a later release.
