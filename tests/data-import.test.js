import { describe, expect, it } from 'vitest';
import { createDevice, SyncArea, StorageArea } from './helpers/background-device.js';

async function readyDevice(options) {
  const device = createDevice(options);
  await device.ready();
  return device;
}

async function seeded() {
  const d = await readyDevice();
  await d.send({ action: 'settings.set', options: { debug: true, ageingLimitDays: '3', treatPromotedAsViewed: true,
    unwantedTitleWords: 'Senior', colours: { viewed: 0.3, applied: '#112233', blacklisted: '#445566' } } });
  await d.send({ action: 'jobs.save', jobs: [{ linkedInJobId: '1', type: 'applied' }, { linkedInJobId: '2', type: 'viewed' }] });
  await d.send({ action: 'companies.setBlacklisted', name: 'Acme', slug: 'acme', blacklisted: true });
  await d.send({ action: 'companies.toggleBlacklist', name: 'Gone' });
  await d.send({ action: 'companies.toggleBlacklist', name: 'Gone' });
  const { note } = await d.send({ action: 'notes.add', title: 'Dev', company: 'Acme', companySlug: 'acme', linkedInJobId: null, text: 'n' });
  await d.send({ action: 'notes.delete', id: note.id });
  return d;
}

const storedSettings = async (d) => (await d.sync.get('ljm-options'))['ljm-options'];

describe('data.export', () => {
  it('produces an ljm-export v2 snapshot including tombstones and note provenance', async () => {
    const { data } = await (await seeded()).send({ action: 'data.export' });
    expect(data).toMatchObject({ format: 'ljm-export', schemaVersion: 2, appVersion: '9.9.9' });
    expect(new Date(data.exportedAt).toISOString()).toBe(data.exportedAt);
    expect(data.options.debug).toBe(true);
    expect(data.jobs).toHaveLength(2);
    expect(data.companies.find((c) => c.name === 'Gone').deletedAt).not.toBeNull();
    expect(data.notes[0]).toMatchObject({ companySlug: 'acme', linkedInJobId: null });
    expect(data.notes[0].deletedAt).not.toBeNull();
  });
});

describe('data.import v2', () => {
  it('restores a snapshot into an empty device, and re-importing changes nothing', async () => {
    const { data } = await (await seeded()).send({ action: 'data.export' });
    const target = await readyDevice();
    const result = await target.send({ action: 'data.import', data });
    expect(result).toEqual({ ok: true, counts: { jobs: 2, companies: 2, notes: 1 } });
    expect(await storedSettings(target)).toEqual(data.options);

    const again = await target.send({ action: 'data.import', data });
    expect(again.counts).toEqual({ jobs: 0, companies: 0, notes: 0 });
    const roundTrip = (await target.send({ action: 'data.export' })).data;
    for (const store of ['jobs', 'companies', 'notes']) {
      expect(roundTrip[store].sort((a, b) => (a.id < b.id ? -1 : 1))).toEqual(data[store].sort((a, b) => (a.id < b.id ? -1 : 1)));
    }
  });

  it('applies newer records even when they lower a state or delete, and ignores older ones', async () => {
    const source = await seeded();
    const { data } = await source.send({ action: 'data.export' });
    const target = await readyDevice();
    await target.send({ action: 'data.import', data });

    const job = data.jobs.find((j) => j.linkedInJobId === '1');
    const newer = { ...data, jobs: [{ ...job, type: 'viewed', updatedAt: job.updatedAt + 10 }],
      companies: [{ ...data.companies.find((c) => c.name === 'Acme'), deletedAt: 5, updatedAt: Date.now() + 10 }], notes: [] };
    await target.send({ action: 'data.import', data: newer });
    expect((await target.send({ action: 'jobs.getAll' })).jobs.find((j) => j.linkedInJobId === '1').type).toBe('viewed');
    expect((await target.send({ action: 'companies.getBlacklist' })).companies).toEqual([]);

    const older = { ...data, jobs: [{ ...job, type: 'applied', updatedAt: job.updatedAt - 10 }], companies: [], notes: [] };
    expect((await target.send({ action: 'data.import', data: older })).counts.jobs).toBe(0);
  });

  it('unifies a natural job ID under the newer record and stays idempotent', async () => {
    const target = await readyDevice();
    const local = (await target.send({ action: 'jobs.save', jobs: [{ linkedInJobId: '7', type: 'applied' }] })).jobs[0];
    const { data } = await target.send({ action: 'data.export' });
    const foreign = { ...local, id: 'foreign-id', type: 'viewed', updatedAt: local.updatedAt + 1 };
    const file = { ...data, jobs: [foreign], companies: [], notes: [] };
    await target.send({ action: 'data.import', data: file });
    const after = (await target.send({ action: 'data.export' })).data.jobs;
    expect(after).toEqual([foreign]);
    expect((await target.send({ action: 'data.import', data: file })).counts.jobs).toBe(0);
  });

  it.each([
    ['unknown format', (d) => ({ ...d, format: 'other' })],
    ['newer schema', (d) => ({ ...d, schemaVersion: 3 })],
    ['invalid option type', (d) => ({ ...d, options: { ...d.options, debug: 'yes' } })],
    ['invalid colour', (d) => ({ ...d, options: { ...d.options, colours: { ...d.options.colours, applied: 'red' } } })],
    ['prototype job type', (d) => ({ ...d, jobs: [{ ...d.jobs[0], type: 'toString' }] })],
    ['duplicate job id', (d) => ({ ...d, jobs: [d.jobs[0], { ...d.jobs[1], id: d.jobs[0].id }] })],
    ['object slug', (d) => ({ ...d, companies: [{ ...d.companies[0], slug: {} }] })],
    ['bad note job id', (d) => ({ ...d, notes: [{ ...d.notes[0], linkedInJobId: 5 }] })],
    ['missing timestamps', (d) => ({ ...d, notes: [{ ...d.notes[0], createdAt: undefined }] })],
    ['invalid final record', (d) => ({ ...d, notes: [...d.notes, { ...d.notes[0], id: 'last', text: 7 }] })],
    ['colour with trailing newline', (d) => ({ ...d, options: { ...d.options, colours: { ...d.options.colours, blacklisted: '#123456\n' } } })],
    ['array options', (d) => ({ ...d, options: [] })],
    ['empty object', () => ({})],
    ['missing format', (d) => ({ ...d, format: undefined })],
    ['missing schemaVersion', (d) => ({ ...d, schemaVersion: undefined })],
    ['v1 without version', () => ({ options: {}, blacklist: ['Acme'] })],
    ['v1 without blacklist', () => ({ version: '1.1.72', options: {} })],
    ['v1 with array options', () => ({ version: '1.1.72', options: [], blacklist: [] })],
  ])('rejects the whole file before any write: %s', async (_label, mutate) => {
    const { data } = await (await seeded()).send({ action: 'data.export' });
    const target = await readyDevice();
    const before = (await target.send({ action: 'data.export' })).data;
    const result = await target.send({ action: 'data.import', data: mutate(data) });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Invalid backup/);
    const after = (await target.send({ action: 'data.export' })).data;
    expect({ ...after, exportedAt: null }).toEqual({ ...before, exportedAt: null });
    expect(await storedSettings(target)).toBeUndefined();
  });
});

describe('data.import v1 (previous export format)', () => {
  const v1 = {
    version: '1.1.72',
    options: { debug: 'nope', colours: { applied: '#abcdef' } },
    blacklist: ['Acme', ' acme ', 'Beta'],
    jobs: [{ id: '5', type: 'viewed', timestamp: 100 }, { id: 6, type: 'applied', timestamp: 200 }],
  };

  it('converts with the shared settings fallback and reuses identities on re-import', async () => {
    const d = await readyDevice();
    const existing = (await d.send({ action: 'companies.setBlacklisted', name: 'ACME', blacklisted: true })).companies[0];
    const result = await d.send({ action: 'data.import', data: v1 });
    expect(result.ok).toBe(true);
    expect(await storedSettings(d)).toMatchObject({ debug: false, colours: { applied: '#abcdef' } });

    const blacklist = (await d.send({ action: 'companies.getBlacklist' })).companies;
    expect(blacklist.map((c) => c.nameKey).sort()).toEqual(['acme', 'beta']);
    expect(blacklist.find((c) => c.nameKey === 'acme').id).toBe(existing.id);

    expect((await d.send({ action: 'data.import', data: v1 })).counts).toEqual({ jobs: 0, companies: 0, notes: 0 });
    const jobs = (await d.send({ action: 'jobs.getAll' })).jobs;
    expect(jobs.map((j) => [j.linkedInJobId, j.type, j.stateAt]).sort()).toEqual([['5', 'viewed', 100], ['6', 'applied', 200]]);
  });

  it('rejects an invalid v1 file without writing', async () => {
    const d = await readyDevice();
    const result = await d.send({ action: 'data.import', data: { ...v1, jobs: [...v1.jobs, { id: '1', type: 'constructor', timestamp: 1 }] } });
    expect(result.ok).toBe(false);
    expect(await storedSettings(d)).toBeUndefined();
    expect((await d.send({ action: 'companies.getBlacklist' })).companies).toEqual([]);
  });
});

describe('import failure recovery', () => {
  it('rolls settings back when the record transaction aborts', async () => {
    const { data } = await (await seeded()).send({ action: 'data.export' });
    const d = await readyDevice();
    await d.send({ action: 'settings.set', options: { debug: false } });
    const before = await storedSettings(d);
    d.context.importRecordsIn = async ({ jobs }) => {
      await new Promise((resolve) => { jobs.put({ ...data.jobs[0] }).onsuccess = resolve; });
      throw new Error('abort mid-transaction');
    };
    const result = await d.send({ action: 'data.import', data });
    expect(result).toMatchObject({ ok: false, error: 'abort mid-transaction' });
    expect(await storedSettings(d)).toEqual(before);
    expect((await d.send({ action: 'jobs.getAll' })).jobs).toEqual([]);
  });

  it('restores settings on the next worker start after dying mid-import', async () => {
    const sync = new SyncArea();
    const local = new StorageArea('local');
    const { data } = await (await seeded()).send({ action: 'data.export' });
    const d = await readyDevice({ sync, local });
    await d.send({ action: 'settings.set', options: { debug: false } });
    const before = await storedSettings(d);
    d.context.importRecordsIn = async () => { throw new Error('worker died'); };
    d.context.dataRecoverImport = async () => false;
    await d.send({ action: 'data.import', data });
    expect((await storedSettings(d)).debug).toBe(true);

    const restarted = await readyDevice({ sync, local, indexedDB: d.indexedDB });
    expect(await storedSettings(restarted)).toEqual(before);
    expect((await restarted.send({ action: 'jobs.getAll' })).jobs).toEqual([]);
  });

  it('does not roll back a later unrelated settings change', async () => {
    const sync = new SyncArea();
    const local = new StorageArea('local');
    const { data } = await (await seeded()).send({ action: 'data.export' });
    const d = await readyDevice({ sync, local });
    d.context.importRecordsIn = async () => { throw new Error('worker died'); };
    d.context.dataRecoverImport = async () => false;
    await d.send({ action: 'data.import', data });
    const later = { ...data.options, unwantedTitleWords: 'changed on another device' };
    await sync.set({ 'ljm-options': later });

    await readyDevice({ sync, local, indexedDB: d.indexedDB });
    expect((await sync.get('ljm-options'))['ljm-options']).toEqual(later);
  });

  it('resolves a journal left by a failed rollback before the next import, without a restart', async () => {
    const { data } = await (await seeded()).send({ action: 'data.export' });
    const d = await readyDevice();
    await d.send({ action: 'settings.set', options: { debug: false } });
    const before = await storedSettings(d);
    const realImportRecords = d.context.importRecordsIn;
    d.context.importRecordsIn = async () => { throw new Error('abort'); };
    const realSet = d.sync.set.bind(d.sync);
    let failRestore = true;
    d.sync.set = async (items) => {
      if (failRestore && items['ljm-options']?.debug === false) { failRestore = false; throw new Error('restore failed'); }
      return realSet(items);
    };
    expect((await d.send({ action: 'data.import', data })).ok).toBe(false);
    expect((await storedSettings(d)).debug).toBe(true);

    d.context.importRecordsIn = realImportRecords;
    const invalid = await d.send({ action: 'data.import', data: { ...data, options: { ...data.options, debug: 1 } } });
    expect(invalid.ok).toBe(false);
    expect(await storedSettings(d)).toEqual(before);
    expect((await d.send({ action: 'data.import', data })).ok).toBe(true);
  });
});

describe('settings.set', () => {
  it('normalises and serialises settings writes behind imports', async () => {
    const { data } = await (await seeded()).send({ action: 'data.export' });
    const d = await readyDevice();
    const [imported, saved] = await Promise.all([
      d.send({ action: 'data.import', data }),
      d.send({ action: 'settings.set', options: { debug: 'x', unwantedTitleWords: 'Later' } }),
    ]);
    expect(imported.ok && saved.ok).toBe(true);
    expect(await storedSettings(d)).toMatchObject({ debug: false, unwantedTitleWords: 'Later' });
  });
});
