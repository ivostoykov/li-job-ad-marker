import vm from 'vm';
import { describe, expect, it } from 'vitest';
import { createDevice, SyncArea, StorageArea } from './helpers/background-device.js';

const incognito = { tab: { id: 9, incognito: true } };

async function readyDevice(options) {
  const device = createDevice(options);
  await device.ready();
  return device;
}

describe('background jobs (#4/#5)', () => {
  it('creates client-ID records and only ever raises the state', async () => {
    const d = await readyDevice();
    const first = await d.send({ action: 'jobs.save', jobs: [{ linkedInJobId: '10', type: 'viewed' }] });
    const [job] = first.jobs;
    expect(job.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(job).toMatchObject({ linkedInJobId: '10', type: 'viewed', deletedAt: null });
    expect(job.createdAt).toBe(job.updatedAt);

    expect((await d.send({ action: 'jobs.save', jobs: [{ linkedInJobId: '10', type: 'viewed' }] })).jobs).toEqual([]);
    const applied = (await d.send({ action: 'jobs.save', jobs: [{ linkedInJobId: '10', type: 'applied' }] })).jobs[0];
    expect(applied).toMatchObject({ id: job.id, type: 'applied', createdAt: job.createdAt });
    expect(applied.updatedAt).toBeGreaterThanOrEqual(job.updatedAt);
    expect((await d.send({ action: 'jobs.save', jobs: [{ linkedInJobId: '10', type: 'viewed' }] })).jobs).toEqual([]);

    const { jobs } = await d.send({ action: 'jobs.getAll' });
    expect(jobs).toHaveLength(1);
    expect(jobs[0].type).toBe('applied');
  });

  it('batches saves, keeping the highest state per job and ignoring invalid types', async () => {
    const d = await readyDevice();
    const { jobs } = await d.send({ action: 'jobs.save', jobs: [
      { linkedInJobId: '1', type: 'viewed' }, { linkedInJobId: '1', type: 'applied' },
      { linkedInJobId: '2', type: 'toString' }, { linkedInJobId: '', type: 'viewed' },
    ] });
    expect(jobs.map((j) => [j.linkedInJobId, j.type])).toEqual([['1', 'applied']]);
  });

  it('refuses backup export and import from content scripts', async () => {
    const d = await readyDevice();
    const content = { tab: { id: 1, incognito: false }, url: 'https://www.linkedin.com/jobs/search/' };
    expect(await d.send({ action: 'data.export' }, content)).toEqual({ ok: false, error: 'forbidden' });
    expect(await d.send({ action: 'data.import', data: {} }, content)).toEqual({ ok: false, error: 'forbidden' });
  });

  it('refuses persistent writes from incognito tabs', async () => {
    const d = await readyDevice();
    for (const action of ['jobs.save', 'jobs.migrateLegacy', 'notes.add']) {
      expect(await d.send({ action, jobs: [] }, incognito)).toEqual({ ok: false, error: 'incognito' });
    }
    expect((await d.send({ action: 'jobs.getAll' })).jobs).toEqual([]);
  });

  it('refuses writes when the stored schema is newer than the code', async () => {
    const indexedDB = (await readyDevice()).indexedDB;
    const db = await new Promise((resolve) => { indexedDB.open('ljm-data', 1).onsuccess = (e) => resolve(e.target.result); });
    await new Promise((resolve) => {
      const tx = db.transaction('meta', 'readwrite');
      tx.objectStore('meta').put({ key: 'schema', schemaVersion: 99 });
      tx.oncomplete = resolve;
    });
    db.close();
    const next = await readyDevice({ indexedDB });
    const response = await next.send({ action: 'jobs.save', jobs: [{ linkedInJobId: '1', type: 'viewed' }] });
    expect(response.ok).toBe(false);
    expect(response.error).toMatch(/schema is newer/);
  });
});

describe('legacy job migration in the background', () => {
  const legacy = [
    { id: '1', type: 'viewed', timestamp: 1000 },
    { id: 2, type: 'applied', timestamp: 2000 },
    { id: '3', type: 'toString', timestamp: 3000 },
    { id: '4', type: 'viewed' },
  ];

  it('preserves timestamps, acknowledges only committed IDs and is idempotent', async () => {
    const d = await readyDevice();
    const result = await d.send({ action: 'jobs.migrateLegacy', jobs: legacy });
    expect(result).toEqual({ ok: true, migratedIds: ['1', 2] });
    const again = await d.send({ action: 'jobs.migrateLegacy', jobs: legacy });
    expect(again.migratedIds).toEqual(['1', 2]);
    const progress = await new Promise((resolve) => {
      d.indexedDB.open('ljm-data', 1).onsuccess = (e) => {
        const req = e.target.result.transaction('meta').objectStore('meta').get('jobsLegacyMigration');
        req.onsuccess = () => resolve(req.result);
      };
    });
    expect(progress).toMatchObject({ lastAcknowledged: 2, totalAcknowledged: 4 });

    const { jobs } = await d.send({ action: 'jobs.getAll' });
    expect(jobs.map((j) => [j.linkedInJobId, j.type, j.stateAt, j.createdAt, j.updatedAt]).sort())
      .toEqual([['1', 'viewed', 1000, 1000, 1000], ['2', 'applied', 2000, 2000, 2000]]);
  });

  it('serialises concurrent migrations from several frames without duplicates', async () => {
    const d = await readyDevice();
    await Promise.all([1, 2, 3].map(() => d.send({ action: 'jobs.migrateLegacy', jobs: legacy })));
    expect((await d.send({ action: 'jobs.getAll' })).jobs).toHaveLength(2);
  });

  it('raises an existing lower state but never lowers one', async () => {
    const d = await readyDevice();
    await d.send({ action: 'jobs.save', jobs: [{ linkedInJobId: '1', type: 'applied' }, { linkedInJobId: '2', type: 'viewed' }] });
    await d.send({ action: 'jobs.migrateLegacy', jobs: [{ id: '1', type: 'viewed', timestamp: 5 }, { id: '2', type: 'applied', timestamp: 6 }] });
    const jobs = Object.fromEntries((await d.send({ action: 'jobs.getAll' })).jobs.map((j) => [j.linkedInJobId, j]));
    expect(jobs['1'].type).toBe('applied');
    expect(jobs['2']).toMatchObject({ type: 'applied', stateAt: 6 });
  });
});

describe('companies (#6)', () => {
  it('matches names by case and whitespace only and toggles by soft delete', async () => {
    const d = await readyDevice();
    expect(await d.send({ action: 'companies.toggleBlacklist', name: ' Foo  Ltd ' })).toMatchObject({ blacklisted: true });
    expect((await d.send({ action: 'companies.lookup', name: 'foo ltd' })).blacklisted).toBe(true);
    expect((await d.send({ action: 'companies.lookup', name: 'Foo' })).blacklisted).toBe(false);

    const off = await d.send({ action: 'companies.toggleBlacklist', name: 'FOO LTD' });
    expect(off).toMatchObject({ blacklisted: false, blacklist: [] });
    expect(off.companies[0].deletedAt).not.toBeNull();

    const on = await d.send({ action: 'companies.toggleBlacklist', name: 'Foo Ltd' });
    expect(on.companies[0].id).toBe(off.companies[0].id);
    expect(on.companies[0].deletedAt).toBeNull();
  });

  it('keeps known distinct slugs separate and falls back to names without a slug', async () => {
    const d = await readyDevice();
    await d.send({ action: 'companies.setBlacklisted', name: 'Acme', slug: 'acme-uk', blacklisted: true });
    expect((await d.send({ action: 'companies.lookup', name: 'Acme', slug: 'acme-us' })).blacklisted).toBe(false);
    expect((await d.send({ action: 'companies.lookup', name: 'Acme' })).blacklisted).toBe(true);

    await d.send({ action: 'companies.setBlacklisted', name: 'Acme', slug: 'acme-us', blacklisted: true });
    const { companies } = await d.send({ action: 'companies.getBlacklist' });
    expect(companies.map((c) => c.slug).sort()).toEqual(['acme-uk', 'acme-us']);

    await d.send({ action: 'companies.setBlacklisted', name: 'Acme', slug: 'acme-us', blacklisted: false });
    expect((await d.send({ action: 'companies.getBlacklist' })).companies.map((c) => c.slug)).toEqual(['acme-uk']);
  });

  it('attaches a slug only to a single slug-less record and merges a slug-less duplicate', async () => {
    const d = await readyDevice();
    await d.send({ action: 'companies.setBlacklisted', name: 'Acme', blacklisted: true });
    expect((await d.send({ action: 'companies.attachSlug', name: 'acme', slug: 'acme-uk' })).company.slug).toBe('acme-uk');
    expect((await d.send({ action: 'companies.attachSlug', name: 'acme', slug: 'acme-us' })).company).toBeNull();

    await d.send({ action: 'companies.setBlacklisted', name: 'Beta', slug: 'beta-1', blacklisted: true });
    vm.runInContext(`companiesSetBlacklisted('Beta', null, true)`, d.context);
    await d.idle();
    await d.send({ action: 'companies.setBlacklisted', name: 'Beta', blacklisted: true });
    const beta = (await d.send({ action: 'companies.getBlacklist' })).companies.filter((c) => c.nameKey === 'beta');
    expect(beta).toHaveLength(1);
    expect(beta[0].slug).toBe('beta-1');
  });

  it('returns a revision with every blacklist snapshot that only increases', async () => {
    const d = await readyDevice();
    const a = await d.send({ action: 'companies.getBlacklist' });
    const b = await d.send({ action: 'companies.setBlacklisted', name: 'X', blacklisted: true });
    const c = await d.send({ action: 'companies.getBlacklist' });
    expect(b.revision).toBeGreaterThan(a.revision);
    expect(c.revision).toBeGreaterThan(b.revision);
    expect(d.tabMessages).toEqual([]);
  });
});

describe('notes (#7 contract)', () => {
  it('keeps independent entries per group, newest first, with provenance', async () => {
    const d = await readyDevice();
    const add = (extra) => d.send({ action: 'notes.add', title: 'Dev', company: 'Acme', linkedInJobId: null, text: 'x', ...extra });
    const first = (await add({ linkedInJobId: '11', companySlug: 'acme-uk', text: 'one' })).note;
    await new Promise((r) => setTimeout(r, 2));
    const second = (await add({ text: 'two' })).note;
    await add({ companySlug: 'acme-us', text: 'other company' });

    const { notes } = await d.send({ action: 'notes.listGroup', title: ' dev ', company: 'ACME', companySlug: 'acme-uk' });
    expect(notes.map((n) => n.text)).toEqual(['two', 'one']);
    expect(notes[1]).toMatchObject({ linkedInJobId: '11', companySlug: 'acme-uk' });
    expect(second.linkedInJobId).toBeNull();

    const updated = (await d.send({ action: 'notes.update', id: first.id, text: 'edited' })).note;
    expect(updated).toMatchObject({ createdAt: first.createdAt, linkedInJobId: '11', groupKey: first.groupKey });
    await d.send({ action: 'notes.delete', id: second.id });
    expect((await d.send({ action: 'notes.listGroup', title: 'Dev', company: 'Acme', companySlug: 'acme-uk' })).notes.map((n) => n.text)).toEqual(['edited']);
    expect((await d.send({ action: 'notes.update', id: second.id, text: 'z' })).ok).toBe(false);

    const { matches } = await d.send({ action: 'notes.groupsWithNotes', groups: [
      { title: 'dev', company: 'acme' }, { title: 'Dev', company: 'Acme', companySlug: 'acme-de' }, { title: 'Other', company: 'Acme' },
    ] });
    // 'acme-de' matches only slug-less notes; the slug-less one was deleted.
    expect(matches).toEqual([true, false, false]);
  });

  it.each([
    [{ title: 'Dev', company: '  ', text: 'x' }],
    [{ title: '', company: 'Acme', text: 'x' }],
    [{ title: 'Dev', company: 'Acme', text: ' ' }],
    [{ title: 'Dev', company: 'Acme', text: 'x', companySlug: {} }],
    [{ title: 'Dev', company: 'Acme', text: 'x', linkedInJobId: 12 }],
  ])('rejects invalid notes %j', async (note) => {
    const d = await readyDevice();
    expect((await d.send({ action: 'notes.add', ...note })).ok).toBe(false);
    expect((await d.send({ action: 'data.export' })).data.notes).toEqual([]);
  });
});

describe('start-up readiness', () => {
  it('fails requests while import recovery fails and recovers on a later request', async () => {
    const sync = new SyncArea();
    const local = new StorageArea('local');
    const first = await readyDevice({ sync, local });
    await first.send({ action: 'jobs.save', jobs: [{ linkedInJobId: '1', type: 'viewed' }] });
    const exported = (await first.send({ action: 'data.export' })).data;
    await first.send({ action: 'settings.set', options: exported.options });

    // Simulate a worker death after the settings write: the journal stays behind.
    first.context.importRecordsIn = async () => { throw new Error('worker died'); };
    first.context.dataRecoverImport = async () => false;
    const imported = { ...exported, options: { ...exported.options, debug: true } };
    expect((await first.send({ action: 'data.import', data: imported })).ok).toBe(false);
    expect((await sync.get('ljm-options'))['ljm-options'].debug).toBe(true);

    let failures = 1;
    const originalSet = sync.set.bind(sync);
    sync.set = async (items) => {
      if ('ljm-options' in items && failures-- > 0) throw new Error('sync write failed');
      return originalSet(items);
    };
    const restarted = createDevice({ sync, local, indexedDB: first.indexedDB });
    const failed = await restarted.send({ action: 'jobs.getAll' });
    expect(failed.ok).toBe(false);
    expect(failed.error).toMatch(/recovery failed/);

    expect((await restarted.send({ action: 'jobs.getAll' })).jobs).toHaveLength(1);
    expect((await sync.get('ljm-options'))['ljm-options'].debug).toBe(false);
  });
});
