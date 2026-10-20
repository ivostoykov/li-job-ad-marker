import { describe, expect, it } from 'vitest';
import { createDevice, settle, SyncArea } from './helpers/background-device.js';

async function devices(count, syncOptions) {
  const sync = new SyncArea(syncOptions);
  const list = Array.from({ length: count }, () => createDevice({ sync }));
  await Promise.all(list.map((d) => d.ready()));
  return { sync, list };
}

const blacklist = async (d) => (await d.send({ action: 'companies.getBlacklist' })).companies
  .map((c) => `${c.id}:${c.nameKey}:${c.slug ?? ''}`).sort();
const mirrorKeys = (sync) => [...sync.data.keys()].filter((k) => k.startsWith('co:')).sort();

describe('blacklist mirror across devices (#10)', () => {
  it('propagates additions and deletions through per-company keys without echo writes', async () => {
    const { sync, list: [a, b] } = await devices(2);
    const { companies: [acme] } = await a.send({ action: 'companies.setBlacklisted', name: 'Acme', blacklisted: true });
    await settle(a, b);
    expect(mirrorKeys(sync)).toEqual([`co:${acme.id}`]);
    expect(sync.data.get(`co:${acme.id}`)).not.toHaveProperty('notes');
    expect(await blacklist(b)).toEqual([`${acme.id}:acme:`]);
    expect(b.tabMessages).toEqual([]);

    const writes = sync.writes;
    await settle(a, b);
    expect(sync.writes).toBe(writes);

    await b.send({ action: 'companies.toggleBlacklist', name: 'ACME' });
    await settle(a, b);
    expect(await blacklist(a)).toEqual([]);
    expect(sync.data.get(`co:${acme.id}`).deletedAt).not.toBeNull();
  });

  it('converges independent blacklisting of the same name to the oldest identity on both devices', async () => {
    const { sync, list: [a, b] } = await devices(2);
    sync.pause();
    const first = (await a.send({ action: 'companies.setBlacklisted', name: 'Acme', blacklisted: true })).companies[0];
    await new Promise((r) => setTimeout(r, 2));
    const second = (await b.send({ action: 'companies.setBlacklisted', name: ' acme ', blacklisted: true })).companies[0];
    sync.resume();
    await settle(a, b);

    expect(await blacklist(a)).toEqual([`${first.id}:acme:`]);
    expect(await blacklist(b)).toEqual([`${first.id}:acme:`]);
    expect(sync.data.get(`co:${second.id}`)).toMatchObject({ mergedInto: first.id });
    expect(sync.data.get(`co:${second.id}`).deletedAt).not.toBeNull();
  });

  it('keeps same-name companies with different slugs separate across devices', async () => {
    const { sync, list: [a, b] } = await devices(2);
    sync.pause();
    await a.send({ action: 'companies.setBlacklisted', name: 'Acme', slug: 'acme-uk', blacklisted: true });
    await b.send({ action: 'companies.setBlacklisted', name: 'Acme', slug: 'acme-us', blacklisted: true });
    sync.resume();
    await settle(a, b);
    expect((await blacklist(a)).map((s) => s.split(':')[2])).toEqual(expect.arrayContaining(['acme-uk', 'acme-us']));
    expect(await blacklist(a)).toEqual(await blacklist(b));
  });

  it('applies the newer change to the same company, deletions included', async () => {
    const { sync, list: [a, b] } = await devices(2);
    const { companies: [acme] } = await a.send({ action: 'companies.setBlacklisted', name: 'Acme', blacklisted: true });
    await settle(a, b);
    sync.pause();
    await a.send({ action: 'companies.toggleBlacklist', name: 'Acme' });
    await new Promise((r) => setTimeout(r, 2));
    await b.send({ action: 'companies.setBlacklisted', name: 'Acme', blacklisted: false });
    await new Promise((r) => setTimeout(r, 2));
    await b.send({ action: 'companies.setBlacklisted', name: 'Acme', blacklisted: true });
    sync.resume();
    await settle(a, b);
    expect(await blacklist(a)).toEqual([`${acme.id}:acme:`]);
    expect(await blacklist(b)).toEqual([`${acme.id}:acme:`]);
  });

  it('converges after devices receive the same mirror events in different orders', async () => {
    const t = Date.now() - 1000;
    const record = (over) => ({ name: 'Acme', slug: null, status: 'blacklisted', mergedInto: null, createdAt: t, deletedAt: null, ...over });
    const events = [
      { 'co:x': { newValue: record({ updatedAt: t }) } },
      { 'co:x': { newValue: record({ updatedAt: t + 2, deletedAt: t + 2 }) } },
      { 'co:y': { newValue: record({ createdAt: t + 1, updatedAt: t + 1 }) } },
      { 'co:x': { newValue: record({ updatedAt: t + 1, name: 'ACME' }) } },
    ];
    const { sync, list } = await devices(3);
    sync.pause();
    const orders = [[0, 1, 2, 3], [3, 2, 1, 0], [2, 0, 3, 1]];
    for (const [i, d] of list.entries()) {
      for (const e of orders[i]) await d.context.syncHandleStorageChanges(events[e]);
    }
    sync.resume();
    await settle(...list);
    const states = await Promise.all(list.map(async (d) => (await d.send({ action: 'data.export' })).data.companies
      .map((c) => [c.id, c.deletedAt !== null, c.mergedInto, c.updatedAt]).sort()));
    expect(states[1]).toEqual(states[0]);
    expect(states[2]).toEqual(states[0]);
    expect(states[0].find(([id]) => id === 'x')[1]).toBe(true);
  });

  it('carries a newer user deletion of a merged-away identity to the merge winner', async () => {
    const { list: [d] } = await devices(1);
    const base = { name: 'Acme', slug: null, status: 'blacklisted', mergedInto: null, deletedAt: null };
    await d.context.companiesApplyRemote([
      { id: 'a', nameKey: 'acme', ...base, createdAt: 1, updatedAt: 1 },
      { id: 'b', nameKey: 'acme', ...base, createdAt: 2, updatedAt: 2 },
    ], 10);
    expect(await blacklist(d)).toEqual(['a:acme:']);

    const { newerLocal } = await d.context.companiesApplyRemote([
      { id: 'b', nameKey: 'acme', ...base, createdAt: 2, updatedAt: 100, deletedAt: 100 },
    ], 200);
    expect(await blacklist(d)).toEqual([]);
    expect(newerLocal.map((c) => c.id).sort()).toEqual(['a', 'b']);
  });

  it('lets local tombstones overwrite a stale record pushed back by a returning offline peer', async () => {
    const { sync, list: [a, b] } = await devices(2);
    const { companies: [acme] } = await a.send({ action: 'companies.setBlacklisted', name: 'Acme', blacklisted: true });
    await settle(a, b);
    const staleActive = structuredClone(sync.data.get(`co:${acme.id}`));
    await a.send({ action: 'companies.toggleBlacklist', name: 'Acme' });
    await settle(a, b);
    // Tombstone purged after 30 days, then an offline peer re-pushes its old active copy.
    await sync.remove(`co:${acme.id}`);
    await sync.set({ [`co:${acme.id}`]: staleActive });
    await settle(a, b);
    expect(await blacklist(a)).toEqual([]);
    expect(await blacklist(b)).toEqual([]);
    expect(sync.data.get(`co:${acme.id}`).deletedAt).not.toBeNull();
  });

  it('purges mirror tombstones older than 30 days on start-up and never re-adds them', async () => {
    const { sync, list: [a] } = await devices(1);
    const old = Date.now() - 31 * 24 * 60 * 60 * 1000;
    await sync.set({ 'co:old': { name: 'Old', slug: null, status: 'blacklisted', mergedInto: null, createdAt: old, updatedAt: old, deletedAt: old } });
    await a.context.syncReconcile();
    expect(sync.data.has('co:old')).toBe(false);
    await a.context.syncReconcile();
    expect(sync.data.has('co:old')).toBe(false);
  });

  it('keeps working locally when the mirror is full, reports it and still updates existing keys', async () => {
    // Two items are used by the legacy array and its writer marker.
    const { sync, list: [a, b] } = await devices(2, { maxItems: 4 });
    const { companies: [first] } = await a.send({ action: 'companies.setBlacklisted', name: 'One', blacklisted: true });
    await a.send({ action: 'companies.setBlacklisted', name: 'Two', blacklisted: true });
    const full = await a.send({ action: 'companies.setBlacklisted', name: 'Three', blacklisted: true });
    expect(full.ok).toBe(true);
    expect((await a.send({ action: 'sync.status' })).status.mirror).toBe('full');
    expect(a.pageMessages.some((m) => m.action === 'sync-status-changed' && m.status.mirror === 'full')).toBe(true);
    expect((await blacklist(a)).map((s) => s.split(':')[1]).sort()).toEqual(['one', 'three', 'two']);

    await a.send({ action: 'companies.toggleBlacklist', name: 'One' });
    await settle(a, b);
    expect(sync.data.get(`co:${first.id}`).deletedAt).not.toBeNull();
    expect((await blacklist(b)).map((s) => s.split(':')[1])).toEqual(['two']);
  });
});

describe('legacy blacklistedCompanies array during the version transition', () => {
  it('migrates the old array once, keeps it and dual-writes the active names', async () => {
    const sync = new SyncArea();
    await sync.set({ blacklistedCompanies: ['Acme', 'Beta'] });
    const a = createDevice({ sync });
    await a.ready();
    expect((await blacklist(a)).map((s) => s.split(':')[1]).sort()).toEqual(['acme', 'beta']);
    expect(mirrorKeys(sync)).toHaveLength(2);

    await a.send({ action: 'companies.setBlacklisted', name: 'Gamma', blacklisted: true });
    await a.send({ action: 'companies.toggleBlacklist', name: 'Acme' });
    expect(sync.data.get('blacklistedCompanies')).toEqual(['Beta', 'Gamma']);
  });

  it('second upgraded device merges with the existing mirror instead of duplicating', async () => {
    const sync = new SyncArea();
    await sync.set({ blacklistedCompanies: ['Acme'] });
    const a = createDevice({ sync });
    await a.ready();
    const b = createDevice({ sync });
    await b.ready();
    await settle(a, b);
    expect(await blacklist(b)).toEqual(await blacklist(a));
    expect(mirrorKeys(sync)).toHaveLength(1);
  });

  it('applies additions and removals made by an old-version device', async () => {
    const { sync, list: [a, b] } = await devices(2);
    await a.send({ action: 'companies.setBlacklisted', name: 'Acme', blacklisted: true });
    await a.send({ action: 'companies.setBlacklisted', name: 'Beta', blacklisted: true });
    await settle(a, b);
    expect(sync.data.get('blacklistedCompanies')).toEqual(['Acme', 'Beta']);

    // Old version: read array, change it, write it back.
    const oldDevice = [...sync.data.get('blacklistedCompanies')].filter((n) => n !== 'Acme').concat('Delta');
    await sync.set({ blacklistedCompanies: oldDevice });
    await settle(a, b);
    for (const d of [a, b]) {
      expect((await blacklist(d)).map((s) => s.split(':')[1]).sort()).toEqual(['beta', 'delta']);
    }
    expect(await blacklist(a)).toEqual(await blacklist(b));
    expect(sync.data.get('blacklistedCompanies')).toEqual(['Beta', 'Delta']);
  });

  it('does not revive a known tombstone from a stale array on a first run without a baseline', async () => {
    const sync = new SyncArea();
    const t = Date.now() - 1000;
    await sync.set({
      'co:a': { name: 'Acme', slug: null, status: 'blacklisted', mergedInto: null, createdAt: t, updatedAt: t, deletedAt: t },
      blacklistedCompanies: ['Acme'],
    });
    const fresh = createDevice({ sync });
    await fresh.ready();
    expect(await blacklist(fresh)).toEqual([]);
    expect(sync.data.get('co:a').deletedAt).toBe(t);
  });

  it('known limitation: a stale array written by an offline old-version device re-adds a removed name', async () => {
    const { sync, list: [a] } = await devices(1);
    await a.send({ action: 'companies.setBlacklisted', name: 'Acme', blacklisted: true });
    const staleCopy = [...sync.data.get('blacklistedCompanies')];
    await a.send({ action: 'companies.toggleBlacklist', name: 'Acme' });
    await settle(a);
    expect(sync.data.get('blacklistedCompanies')).toEqual([]);

    // The old format has no timestamps, so this write is indistinguishable from a re-add.
    await sync.set({ blacklistedCompanies: [...staleCopy, 'Other'] });
    await settle(a);
    expect((await blacklist(a)).map((s) => s.split(':')[1]).sort()).toEqual(['acme', 'other']);
  });

  it('ignores its own legacy writes (no diff, no extra writes)', async () => {
    const { sync, list: [a] } = await devices(1);
    await a.send({ action: 'companies.setBlacklisted', name: 'Acme', blacklisted: true });
    await settle(a);
    const writes = sync.writes;
    await settle(a);
    expect(sync.writes).toBe(writes);
    expect(await blacklist(a)).toHaveLength(1);
  });
});
