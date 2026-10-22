import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDevice } from './helpers/background-device.js';

let page;
afterEach(() => page?.window.close());

async function openStatistics({ seed = [], confirm = true } = {}) {
  page = new JSDOM(readFileSync('src/statistics.html', 'utf8'), {
    url: 'https://extension.test/statistics.html', runScripts: 'outside-only',
  });
  const { window } = page;
  const background = createDevice();
  await background.ready();
  for (const message of seed) {
    await background.send(message, { tab: { id: 1, incognito: false }, url: 'https://www.linkedin.com/jobs/search/' });
  }
  const listeners = [];
  window.chrome = {
    runtime: {
      getManifest: () => ({ name: 'Job Ad Marker', version: '1.2.0' }),
      onMessage: { addListener: (listener) => listeners.push(listener) },
      sendMessage: (message) => background.send(message),
    },
  };
  window.confirm = vi.fn(() => confirm);
  for (const file of ['src/js/utils.js', 'src/js/statistics.js']) {
    window.eval(readFileSync(file, 'utf8'));
  }
  window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
  await vi.waitFor(() => expect(window.document.getElementById('tracking-since').textContent).not.toBe(''));
  return { window, background, listeners };
}

const pad = (n) => String(n).padStart(2, '0');
const dateKey = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

describe('statistics page periods', () => {
  it('uses Monday-to-Sunday weeks, calendar months and inclusive since ranges', async () => {
    const { window } = await openStatistics();
    const range = window.statisticsPeriodRange;
    const sunday = new Date(2026, 10, 1);
    expect(range('today', sunday)).toEqual({ from: '2026-11-01', to: '2026-11-01' });
    expect(range('week', sunday)).toEqual({ from: '2026-10-26', to: '2026-11-01' });
    expect(range('week', new Date(2026, 9, 26))).toEqual({ from: '2026-10-26', to: '2026-11-01' });
    expect(range('month', new Date(2026, 1, 15))).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(range('all', sunday)).toEqual({ from: null, to: null });
    expect(range('since', sunday, '2026-10-30')).toEqual({ from: '2026-10-30', to: '2026-11-01' });

    const days = [
      { date: '2026-10-25', total: 5, new: 5, viewed: 0, applied: 0, blacklisted: 1, unwantedTitle: 0, ageing: 0 },
      { date: '2026-10-26', total: 2, new: 1, viewed: 1, applied: 0, blacklisted: 0, unwantedTitle: 2, ageing: 0 },
      { date: '2026-11-01', total: 3, new: 0, viewed: 2, applied: 1, blacklisted: 0, unwantedTitle: 0, ageing: 3 },
    ];
    expect(window.statisticsSum(days, range('week', sunday))).toMatchObject({ total: 5, new: 1, viewed: 3, applied: 1, unwantedTitle: 2, ageing: 3 });
    expect(window.statisticsSum(days, range('all', sunday)).total).toBe(10);
  });
});

describe('statistics page', () => {
  it('is linked from the Options page', () => {
    const doc = new JSDOM(readFileSync('src/options.html', 'utf8')).window.document;
    const link = doc.querySelector('.page-links a');
    expect(link.getAttribute('href')).toBe('statistics.html');
    expect(link.textContent).toBe('Statistics');
  });

  it('shows the manifest name, today by default and an empty state', async () => {
    const { window } = await openStatistics();
    const doc = window.document;
    expect(doc.getElementById('ext-title').textContent).toBe('Job Ad Marker v1.2.0');
    expect(doc.title).toBe('Job Ad Marker — Statistics');
    expect(doc.querySelector('input[name="period"]:checked').value).toBe('today');
    expect(doc.getElementById('stat-total').textContent).toBe('0');
    expect(doc.getElementById('tracking-since').textContent).toMatch(/^Nothing counted yet/);
    expect(doc.getElementById('since-date').disabled).toBe(true);
    expect(doc.querySelector('.privacy').textContent).toContain('Zero API queries • 100% client-side statistics');
  });

  it('sums the selected period and explains a partial period', async () => {
    const now = new Date();
    const today = dateKey(now);
    const { window } = await openStatistics({
      seed: [{
        action: 'stats.record', batchId: 'b1', encounteredFrom: Date.now(),
        days: { [today]: { total: 4, new: 2, viewed: 1, applied: 1, blacklisted: 1, unwantedTitle: 2, ageing: 0 } },
      }],
    });
    const doc = window.document;
    expect(doc.getElementById('stat-total').textContent).toBe('4');
    expect(doc.getElementById('stat-new').textContent).toBe('2');
    expect(doc.getElementById('share-new').textContent).toBe('50%');
    expect(doc.getElementById('stat-unwantedTitle').textContent).toBe('2');
    expect(doc.getElementById('tracking-since').textContent).toMatch(/^Tracking since /);

    doc.querySelector('input[value="month"]').click();
    expect(doc.getElementById('stat-total').textContent).toBe('4');
    const partial = doc.getElementById('partial-note');
    expect(partial.hidden).toBe(now.getDate() === 1);
    if (now.getDate() !== 1) expect(partial.textContent).toMatch(/^Partial period: tracking started on /);

    doc.querySelector('input[value="since"]').click();
    const since = doc.getElementById('since-date');
    expect(since.disabled).toBe(false);
    since.value = dateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
    since.dispatchEvent(new window.Event('change'));
    expect(doc.getElementById('stat-total').textContent).toBe('0');
    expect(partial.textContent).toBe('Choose a date on or before today.');
  });

  it('resets only after confirmation and refreshes on statistics changes', async () => {
    const today = dateKey(new Date());
    const seed = [
      { action: 'jobs.save', jobs: [{ linkedInJobId: '1', type: 'viewed' }] },
      { action: 'stats.record', batchId: 'b1', encounteredFrom: Date.now(), days: { [today]: { total: 1, new: 1 } } },
    ];
    const cancelled = await openStatistics({ seed, confirm: false });
    cancelled.window.document.getElementById('btn-reset').click();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(cancelled.window.document.getElementById('stat-total').textContent).toBe('1');
    page.window.close();

    const { window, background, listeners } = await openStatistics({ seed });
    const doc = window.document;
    doc.getElementById('btn-reset').click();
    await vi.waitFor(() => expect(doc.getElementById('reset-message').textContent).toBe('Statistics reset.'));
    expect(window.confirm).toHaveBeenCalledOnce();
    expect(doc.getElementById('stat-total').textContent).toBe('0');
    expect((await background.send({ action: 'jobs.getAll' })).jobs).toHaveLength(1);

    await background.send({ action: 'stats.record', batchId: 'b2', encounteredFrom: Date.now(), days: { [today]: { total: 2, viewed: 2 } } },
      { tab: { id: 1, incognito: false }, url: 'https://www.linkedin.com/jobs/search/' });
    listeners.forEach((listener) => listener({ action: 'statistics-changed' }));
    await vi.waitFor(() => expect(doc.getElementById('stat-total').textContent).toBe('2'));
  });
});
