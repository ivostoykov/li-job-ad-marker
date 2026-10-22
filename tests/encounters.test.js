import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { stopObservingCards, setMarkerEnabled } = globalThis._testExports;

// Stands in for the browser's IntersectionObserver; tests decide what is visible.
class FakeIntersectionObserver {
  static instances = [];

  constructor(callback, options) {
    this.callback = callback;
    this.options = options;
    this.targets = new Set();
    FakeIntersectionObserver.instances.push(this);
  }

  observe(target) { this.targets.add(target); }
  unobserve(target) { this.targets.delete(target); }
  disconnect() { this.targets.clear(); }
}

function setVisible(cards, ratio = 1) {
  for (const card of [].concat(cards)) {
    for (const observer of FakeIntersectionObserver.instances) {
      if (observer.targets.has(card)) {
        observer.callback([{ target: card, isIntersecting: ratio > 0, intersectionRatio: ratio }]);
      }
    }
  }
}

function makeCard(jobId, { title = 'Engineer', company = 'Acme', state = null, footer = null, datetime = null } = {}) {
  const card = document.createElement('div');
  card.className = 'job-card-container';
  if (jobId) card.dataset.jobId = jobId;
  card.innerHTML = `
    <a class="job-card-container__link" href="/jobs/view/${jobId ?? ''}">${title}</a>
    <span class="artdeco-entity-lockup__subtitle">${company}</span>
    ${state ? `<li class="job-card-container__footer-item job-card-container__footer-job-state">${state}</li>` : ''}
    ${footer ? `<li class="job-card-container__footer-item">${footer}</li>` : ''}
    ${datetime ? `<time datetime="${datetime}">old</time>` : ''}`;
  document.body.appendChild(card);
  return card;
}

async function settleWork() {
  await new Promise((resolve) => setTimeout(resolve, 20));
}

async function readTotals() {
  await flushEncounters();
  const response = await globalThis.__background.send({ action: 'stats.get' });
  const totals = { total: 0, new: 0, viewed: 0, applied: 0, blacklisted: 0, unwantedTitle: 0, ageing: 0 };
  for (const day of response.statistics.days) {
    Object.keys(totals).forEach((field) => { totals[field] += day[field]; });
  }
  return totals;
}

describe('job-card encounter statistics (#19)', () => {
  beforeAll(() => {
    globalThis.IntersectionObserver = FakeIntersectionObserver;
  });

  beforeEach(async () => {
    stopObservingCards();
    FakeIntersectionObserver.instances = [];
    document.body.innerHTML = '';
    history.replaceState({}, '', '/jobs/search/?keywords=engineer');
    await settleWork();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    stopObservingCards();
    document.body.innerHTML = '';
  });

  it('counts visible cards and off-screen cards only once they scroll into view', async () => {
    const [first, second, third] = ['1', '2', '3'].map((id) => makeCard(id));
    await markCards();
    expect(FakeIntersectionObserver.instances[0].options.threshold).toBe(0.5);
    setVisible([first, second]);
    setVisible(third, 0.2);
    expect((await readTotals()).total).toBe(2);

    setVisible(third, 0.5);
    expect(await readTotals()).toMatchObject({ total: 3, new: 3 });
  });

  it('records one exclusive job state per card and overlapping marks separately', async () => {
    await globalThis.__background.send({ action: 'jobs.save', jobs: [{ linkedInJobId: '3', type: 'applied' }] });
    await blAdd('Blocked Ltd');
    await setOptions({ ...await getOptions(), unwantedTitleWords: 'Intern', ageingLimitDays: 3 });
    const cards = [
      makeCard('1'),
      makeCard('2', { state: 'Viewed' }),
      makeCard('3', { state: 'Viewed' }),
      makeCard('4', { company: 'Blocked Ltd', title: 'Intern' }),
      makeCard('5', { datetime: '2020-01-01' }),
    ];
    await settleWork();
    await markCards();
    setVisible(cards);

    expect(await readTotals()).toEqual({ total: 5, new: 3, viewed: 1, applied: 1, blacklisted: 1, unwantedTitle: 1, ageing: 1 });
  });

  it('ignores re-rendered nodes, repeated passes and scrolling back within a visit', async () => {
    const card = makeCard('1');
    await markCards();
    setVisible(card);

    card.remove();
    setVisible(card, 0);
    const replacement = makeCard('1');
    await markCards();
    await markCards();
    setVisible(replacement);
    setVisible(replacement, 0);
    setVisible(replacement);

    expect((await readTotals()).total).toBe(1);
    expect(FakeIntersectionObserver.instances[0].targets.has(card)).toBe(false);
  });

  it('keeps the visit when a job is selected and keeps its first New state', async () => {
    const opened = makeCard('1');
    const below = makeCard('2');
    await markCards();
    setVisible(opened);

    history.replaceState({}, '', '/jobs/search/?keywords=engineer&currentJobId=2&refId=abc&trackingId=xyz');
    await recordCurrentJob();
    below.insertAdjacentHTML('beforeend', '<li class="job-card-container__footer-item job-card-container__footer-job-state">Viewed</li>');
    await markCards();
    setVisible([opened, below]);

    expect(await readTotals()).toMatchObject({ total: 2, new: 2, viewed: 0 });
  });

  it('counts replaced cards on pagination straight away and ignores the old list', async () => {
    const card = makeCard('1');
    await markCards();
    setVisible(card);

    const timeout = vi.spyOn(globalThis, 'setTimeout');
    history.replaceState({}, '', '/jobs/search/?keywords=engineer&start=25');
    syncEncounterVisit();
    expect(timeout).toHaveBeenCalledWith(settleEncounterVisit, 1500);
    await markCards();
    setVisible(card, 0);
    setVisible(card);
    expect((await readTotals()).total).toBe(1);

    card.remove();
    setVisible(card, 0);
    const nextPage = [makeCard('1', { state: 'Viewed' }), makeCard('26')];
    await markCards();
    setVisible(nextPage);
    expect(await readTotals()).toMatchObject({ total: 3, new: 2, viewed: 1 });
  });

  it('does not count an old list that is replaced late, after the boundary', async () => {
    const old = [makeCard('1'), makeCard('2')];
    await markCards();
    setVisible(old);

    history.replaceState({}, '', '/jobs/search/?keywords=designer');
    syncEncounterVisit();
    await markCards();
    expect((await readTotals()).total).toBe(2);

    old.forEach((card) => { card.remove(); setVisible(card, 0); });
    const replacement = makeCard('30');
    await markCards();
    setVisible(replacement);
    await settleEncounterVisit();
    expect((await readTotals()).total).toBe(3);
  });

  it('counts cards LinkedIn keeps for a new search once the list is quiet', async () => {
    const kept = [makeCard('1'), makeCard('2')];
    await markCards();
    setVisible(kept);

    history.replaceState({}, '', '/jobs/search/?keywords=second&start=0');
    syncEncounterVisit();
    await markCards();
    expect((await readTotals()).total).toBe(2);

    await settleEncounterVisit();
    expect((await readTotals()).total).toBe(4);
    await markCards();
    expect((await readTotals()).total).toBe(4);
  });

  it('counts again when the user returns to earlier results with back/forward', async () => {
    const card = makeCard('1');
    await markCards();
    setVisible(card);
    history.pushState({}, '', '/jobs/search/?keywords=engineer&start=25');
    syncEncounterVisit();
    history.back();
    await new Promise((resolve) => window.addEventListener('popstate', resolve, { once: true }));
    syncEncounterVisit();
    await settleEncounterVisit();
    expect((await readTotals()).total).toBe(2);
  });

  it('counts a job this frame opened before first sight with its earlier state', async () => {
    history.replaceState({}, '', '/jobs/search/?keywords=designer&currentJobId=9');
    await recordCurrentJob();
    expect((await globalThis.__background.send({ action: 'jobs.getAll' })).jobs.map((j) => j.linkedInJobId)).toEqual(['9']);

    const card = makeCard('9', { state: 'Viewed' });
    await markCards();
    setVisible(card);
    expect(await readTotals()).toMatchObject({ total: 1, new: 1, viewed: 0 });
  });

  it('styles promotion-only cards as viewed without saving or counting a view', async () => {
    await setOptions({ ...await getOptions(), treatPromotedAsViewed: true });
    await settleWork();
    const card = makeCard('1', { footer: 'Promoted' });
    await markCards();
    setVisible(card);

    expect(card.classList.contains('ljm-viewed')).toBe(true);
    expect((await globalThis.__background.send({ action: 'jobs.getAll' })).jobs).toEqual([]);
    expect(await readTotals()).toMatchObject({ total: 1, new: 1, viewed: 0 });
  });

  it('skips cards without a job ID until LinkedIn provides one', async () => {
    const card = makeCard(null);
    await markCards();
    setVisible(card);
    expect((await readTotals()).total).toBe(0);

    card.dataset.jobId = '5';
    await markCards();
    setVisible(card);
    expect((await readTotals()).total).toBe(1);
  });

  it('counts nothing while marking is disabled and does not recount after re-enabling', async () => {
    const counted = makeCard('1');
    await markCards();
    setVisible(counted);

    setMarkerEnabled(false);
    const unseen = makeCard('2');
    await markCards();
    setVisible([counted, unseen]);
    expect((await readTotals()).total).toBe(1);

    setMarkerEnabled(true);
    await markCards();
    setVisible(unseen);
    expect((await readTotals()).total).toBe(2);
  });

  it('waits until a background tab is shown', async () => {
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    const card = makeCard('1');
    await markCards();
    setVisible(card);
    expect((await readTotals()).total).toBe(0);

    visibility.mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect((await readTotals()).total).toBe(1);
  });

  it('files encounters under the local date when they happen, across midnight', async () => {
    const sent = [];
    const forward = chrome.runtime.sendMessage;
    vi.spyOn(chrome.runtime, 'sendMessage').mockImplementation(async (message) => {
      if (message.action !== 'stats.record') return forward(message);
      sent.push(message);
      return { ok: true, recorded: true };
    });
    const before = makeCard('1');
    const after = makeCard('2');
    await markCards();

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 25, 23, 59, 50));
    setVisible(before);
    vi.setSystemTime(new Date(2026, 9, 26, 0, 0, 5));
    setVisible(after);
    await flushEncounters();

    const batch = sent.find((m) => m.action === 'stats.record');
    expect(batch.encounteredFrom).toBe(new Date(2026, 9, 25, 23, 59, 50).getTime());
    expect(Object.keys(batch.days).sort()).toEqual(['2026-10-25', '2026-10-26']);
    expect(batch.days['2026-10-25']).toMatchObject({ total: 1, new: 1 });
    expect(JSON.stringify(batch)).not.toMatch(/"1"|"2"/);
  });

  it('retries a lost acknowledgement with the same batch ID so it applies once', async () => {
    const forward = chrome.runtime.sendMessage;
    const batches = [];
    vi.spyOn(chrome.runtime, 'sendMessage').mockImplementation(async (message) => {
      if (message.action !== 'stats.record') return forward(message);
      batches.push(message);
      await forward(message);
      if (batches.length === 1) throw new Error('Receiving end does not exist');
      return { ok: true };
    });
    const timeout = vi.spyOn(globalThis, 'setTimeout');
    const card = makeCard('1');
    await markCards();
    setVisible(card);
    await flushEncounters();
    expect(timeout).toHaveBeenCalledWith(expect.any(Function), 5000);

    await flushEncounters(batches[0], 2);
    expect(batches[1].batchId).toBe(batches[0].batchId);
    vi.restoreAllMocks();
    expect((await readTotals()).total).toBe(1);
  });

  it('counts again after a back/forward cache restore', async () => {
    const card = makeCard('1');
    await markCards();
    setVisible(card);

    const restored = new Event('pageshow');
    restored.persisted = true;
    window.dispatchEvent(restored);
    await settleWork();
    setVisible(card);
    expect((await readTotals()).total).toBe(2);
  });

  it('waits while a geometrically visible card is hidden by visibility or opacity', async () => {
    const card = makeCard('1');
    let rendered = false;
    card.checkVisibility = (options) => {
      expect(options).toEqual({ opacityProperty: true, visibilityProperty: true });
      return rendered;
    };
    await markCards();
    setVisible(card);
    expect((await readTotals()).total).toBe(0);

    rendered = true;
    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect((await readTotals()).total).toBe(1);
  });

  it('does not count cards inside a hidden same-origin frame', async () => {
    const frameElement = { checkVisibility: () => false, ownerDocument: { defaultView: { frameElement: null } } };
    vi.spyOn(window, 'frameElement', 'get').mockReturnValue(frameElement);
    const card = makeCard('1');
    await markCards();
    setVisible(card);
    expect((await readTotals()).total).toBe(0);

    frameElement.checkVisibility = () => true;
    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect((await readTotals()).total).toBe(1);
  });

  it('does not count job cards outside results pages', async () => {
    history.replaceState({}, '', '/jobs/view/42/');
    const card = makeCard('1');
    await markCards();
    setVisible(card);
    expect((await readTotals()).total).toBe(0);
  });
});
