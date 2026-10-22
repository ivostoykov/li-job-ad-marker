import { describe, expect, it } from 'vitest';
import { createDevice } from './helpers/background-device.js';

const content = { tab: { id: 1, incognito: false }, url: 'https://www.linkedin.com/jobs/search/' };
const incognito = { tab: { id: 9, incognito: true }, url: 'https://www.linkedin.com/jobs/search/' };

const counts = (overrides = {}) => ({
  total: 3, new: 1, viewed: 1, applied: 1, blacklisted: 1, unwantedTitle: 0, ageing: 2, ...overrides,
});

const pad = (n) => String(n).padStart(2, '0');
const dateKey = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const now = new Date();
const today = dateKey(now);
const yesterday = dateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
const tomorrow = dateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));

let batchSequence = 0;
function record(device, days, { batchId = `batch-${++batchSequence}`, encounteredFrom = Date.now(), sender = content } = {}) {
  return device.send({ action: 'stats.record', batchId, days, encounteredFrom }, sender);
}

async function readyDevice(options) {
  const device = createDevice(options);
  await device.ready();
  return device;
}

async function getStatistics(device) {
  const response = await device.send({ action: 'stats.get' });
  expect(response.ok).toBe(true);
  return response.statistics;
}

describe('background statistics (#19)', () => {
  it('adds batches into local-date buckets and keeps the tracking start', async () => {
    const d = await readyDevice();
    const startedAt = Date.now() - 1000;
    expect(await record(d, { [today]: counts() }, { encounteredFrom: startedAt })).toEqual({ ok: true, recorded: true });
    await record(d, { [today]: counts({ total: 1, new: 1, viewed: 0, applied: 0, ageing: 0, blacklisted: 0 }) });

    const statistics = await getStatistics(d);
    expect(statistics.days).toEqual([{ date: today, total: 4, new: 2, viewed: 1, applied: 1, blacklisted: 1, unwantedTitle: 0, ageing: 2 }]);
    expect(statistics.trackingSince).toBe(startedAt);
  });

  it('accepts a batch spanning local midnight into both days', async () => {
    const d = await readyDevice();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const result = await d.context.statisticsRecord('midnight', { [yesterday]: counts(), [today]: counts() },
      midnight - 5 * 60 * 1000, midnight + 5 * 60 * 1000);
    expect(result).toEqual({ recorded: true });
    expect((await getStatistics(d)).days.map((day) => [day.date, day.total])).toEqual([[yesterday, 3], [today, 3]]);
  });

  it('applies a retried batch ID once but keeps intentional repeat encounters', async () => {
    const d = await readyDevice();
    await record(d, { [today]: counts() }, { batchId: 'same' });
    expect(await record(d, { [today]: counts() }, { batchId: 'same' })).toEqual({ ok: true, recorded: false, reason: 'duplicate' });
    await record(d, { [today]: counts() }, { batchId: 'repeat-visit' });
    expect((await getStatistics(d)).days[0].total).toBe(6);
  });

  it('refuses batches older than the duplicate window, such as a tab resumed hours later', async () => {
    const d = await readyDevice();
    const stale = Date.now() - 31 * 60 * 1000;
    expect(await record(d, { [dateKey(new Date(stale))]: counts() }, { encounteredFrom: stale }))
      .toEqual({ ok: true, recorded: false, reason: 'expired' });
    expect((await getStatistics(d)).days).toEqual([]);
  });

  it('loses no increments when several tabs record concurrently', async () => {
    const d = await readyDevice();
    const one = counts({ total: 1, new: 1, viewed: 0, applied: 0, blacklisted: 0, ageing: 0 });
    await Promise.all(Array.from({ length: 40 }, (_, i) =>
      record(d, { [today]: one }, { batchId: `tab-${i % 4}-${i}`, sender: { ...content, tab: { id: i % 4, incognito: false } } })));
    expect((await getStatistics(d)).days[0]).toMatchObject({ total: 40, new: 40 });
  });

  it('rejects malformed batches without writing', async () => {
    const d = await readyDevice();
    const invalid = [
      { '2026-02-30': counts() },
      { '22/10/2026': counts() },
      { [today]: counts({ new: 2 }) },
      { [today]: counts({ blacklisted: 4 }) },
      { [today]: counts({ total: 0, new: 0, viewed: 0, applied: 0, blacklisted: 0, ageing: 0 }) },
      { [today]: counts({ total: 1.5 }) },
      Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`2026-10-0${i + 1}`, counts()])),
      [],
    ];
    for (const days of invalid) {
      expect((await record(d, days)).ok).toBe(false);
    }
    // Dates outside first encounter..now, and encounter times in the future.
    expect((await record(d, { [tomorrow]: counts() })).ok).toBe(false);
    expect((await record(d, { [yesterday]: counts() }, { encounteredFrom: Date.now() })).ok).toBe(false);
    expect((await record(d, { [today]: counts() }, { encounteredFrom: Date.now() + 10 * 60 * 1000 })).ok).toBe(false);
    expect((await d.send({ action: 'stats.record', batchId: '', days: { [today]: counts() }, encounteredFrom: 1 }, content)).ok).toBe(false);
    expect((await getStatistics(d)).days).toEqual([]);
  });

  it('refuses private-window encounters and keeps reads and reset to extension pages', async () => {
    const d = await readyDevice();
    expect(await record(d, { [today]: counts() }, { sender: incognito })).toEqual({ ok: false, error: 'incognito' });
    expect(await d.send({ action: 'stats.get' }, content)).toEqual({ ok: false, error: 'forbidden' });
    expect(await d.send({ action: 'stats.reset' }, content)).toEqual({ ok: false, error: 'forbidden' });
    expect((await getStatistics(d)).days).toEqual([]);
  });

  it('resets only statistics and drops batches encountered before the reset', async () => {
    const d = await readyDevice();
    await d.send({ action: 'jobs.save', jobs: [{ linkedInJobId: '1', type: 'applied' }] }, content);
    await d.send({ action: 'companies.setBlacklisted', name: 'Acme', blacklisted: true }, content);
    await d.send({ action: 'notes.add', title: 'Engineer', company: 'Acme', text: 'Keep' }, content);
    await record(d, { [today]: counts() }, { batchId: 'before', encounteredFrom: Date.now() - 1000 });

    const reset = await d.send({ action: 'stats.reset' });
    expect(reset.ok).toBe(true);
    const statistics = await getStatistics(d);
    expect(statistics.days).toEqual([]);
    expect(statistics.trackingSince).toBe(reset.trackingSince);

    expect(await record(d, { [today]: counts() }, { batchId: 'late', encounteredFrom: reset.trackingSince - 1 }))
      .toEqual({ ok: true, recorded: false, reason: 'before-reset' });
    expect(await record(d, { [today]: counts() }, { batchId: 'before', encounteredFrom: reset.trackingSince + 1 }))
      .toMatchObject({ recorded: false, reason: 'duplicate' });
    await record(d, { [today]: counts() }, { encounteredFrom: reset.trackingSince + 1 });
    expect((await getStatistics(d)).days[0].total).toBe(3);

    expect((await d.send({ action: 'jobs.getAll' })).jobs).toHaveLength(1);
    expect((await d.send({ action: 'companies.getBlacklist' })).companies).toHaveLength(1);
    expect((await d.send({ action: 'notes.listGroup', title: 'Engineer', company: 'Acme' })).notes).toHaveLength(1);
  });

  it('keeps statistics out of backups and unchanged by repeated imports', async () => {
    const d = await readyDevice();
    await record(d, { [today]: counts() });
    const { data } = await d.send({ action: 'data.export' });
    expect(Object.keys(data)).not.toContain('statistics');
    expect(JSON.stringify(data)).not.toContain('statistics:');

    await d.send({ action: 'data.import', data });
    await d.send({ action: 'data.import', data: { ...data, statistics: [{ date: today, total: 99 }], meta: [{ key: `statistics:${today}`, total: 99 }] } });
    expect((await getStatistics(d)).days).toEqual([expect.objectContaining({ date: today, total: 3 })]);
  });

  it('survives a background restart without changing the database version', async () => {
    const first = await readyDevice();
    const { indexedDB } = first;
    await record(first, { [today]: counts() });
    const restarted = await readyDevice({ indexedDB });
    expect((await getStatistics(restarted)).days).toEqual([expect.objectContaining({ date: today, total: 3 })]);

    // Older builds open version 1; statistics must not lock them out.
    const version = await new Promise((resolve, reject) => {
      const req = indexedDB.open('ljm-data', 1);
      req.onsuccess = (e) => { resolve(e.target.result.version); e.target.result.close(); };
      req.onerror = () => reject(req.error);
    });
    expect(version).toBe(1);
  });

  it('notifies extension pages without re-marking LinkedIn tabs', async () => {
    const d = createDevice({ deliverToTab: () => {} });
    await d.ready();
    await record(d, { [today]: counts() });
    expect(d.pageMessages).toContainEqual({ action: 'statistics-changed' });
    expect(d.tabMessages).toEqual([]);
  });

  it('adds a Statistics menu item that opens the extension page', async () => {
    const d = await readyDevice();
    const opened = [];
    d.context.chrome.tabs.create = (tab) => opened.push(tab.url);
    d.menuListeners.installed();
    expect(d.menuItems).toContainEqual(expect.objectContaining({ id: 'statistics', title: 'Statistics', contexts: ['page', 'link'] }));
    d.menuListeners.clicked({ menuItemId: 'statistics' }, { id: 4 });
    expect(opened).toEqual(['chrome-extension://test/src/statistics.html']);
    expect(d.tabMessages).toEqual([]);
  });
});
