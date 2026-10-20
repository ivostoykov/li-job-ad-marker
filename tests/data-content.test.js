import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const { stopObservingCards, defaultJobsAdapter, aiSearchAdapter } = globalThis._testExports;
const background = () => globalThis.__background;

function writeLegacy(records) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('li-job-marker', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('jobs', { keyPath: 'id' });
    req.onsuccess = () => {
      const tx = req.result.transaction('jobs', 'readwrite');
      records.forEach((r) => tx.objectStore('jobs').put(r));
      tx.oncomplete = () => { req.result.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
  });
}

function readLegacy() {
  return new Promise((resolve) => {
    const req = indexedDB.open('li-job-marker', 1);
    req.onsuccess = () => {
      const get = req.result.transaction('jobs').objectStore('jobs').getAll();
      get.onsuccess = () => { req.result.close(); resolve(get.result.sort((a, b) => (a.id < b.id ? -1 : 1))); };
    };
  });
}

function makeClassicCard(jobId, companyName, companyHref = null) {
  const card = document.createElement('div');
  card.className = 'job-card-container';
  card.dataset.jobId = jobId;
  card.innerHTML = `<a class="job-card-container__link" href="/jobs/view/${jobId}">Engineer</a>
    <span class="artdeco-entity-lockup__subtitle">${companyName}</span>
    ${companyHref ? `<a href="${companyHref}">logo</a>` : ''}`;
  document.body.appendChild(card);
  return card;
}

function makeClassicDetail(jobId, companyName, slug) {
  document.body.insertAdjacentHTML('beforeend', `
    <div class="job-details-jobs-unified-top-card__job-title"><a href="/jobs/view/${jobId}/">Engineer</a></div>
    <div class="job-details-jobs-unified-top-card__company-name"><a href="/company/${slug}/life/">${companyName}</a></div>`);
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 25));

beforeEach(() => {
  stopObservingCards();
  document.body.innerHTML = '';
  history.replaceState({}, '', '/jobs/search/');
});
afterEach(() => stopObservingCards());

describe('legacy job migration from the content script', () => {
  it('moves acknowledged records to the background and keeps the rest', async () => {
    await writeLegacy([
      { id: '1', type: 'viewed', timestamp: 100 },
      { id: '2', type: 'applied', timestamp: 200 },
      { id: '3', type: 'toString', timestamp: 300 },
    ]);
    expect(await dbMigrateLegacyJobs()).toBe(2);
    expect(await readLegacy()).toEqual([{ id: '3', type: 'toString', timestamp: 300 }]);
    const { jobs } = await background().send({ action: 'jobs.getAll' });
    expect(jobs.map((j) => [j.linkedInJobId, j.type, j.stateAt]).sort()).toEqual([['1', 'viewed', 100], ['2', 'applied', 200]]);
  });

  it('keeps every legacy record when the background does not commit', async () => {
    await writeLegacy([{ id: '1', type: 'viewed', timestamp: 100 }]);
    background().context.jobsMigrateLegacy = async () => { throw new Error('transaction aborted'); };
    await expect(dbMigrateLegacyJobs()).rejects.toThrow('transaction aborted');
    expect(await readLegacy()).toHaveLength(1);
  });

  it('keeps a record an old-version tab changed after it was read', async () => {
    await writeLegacy([{ id: '1', type: 'viewed', timestamp: 100 }]);
    const realSend = chrome.runtime.sendMessage;
    chrome.runtime.sendMessage = async (message) => {
      const response = await realSend(message);
      if (message.action === 'jobs.migrateLegacy') await writeLegacy([{ id: '1', type: 'applied', timestamp: 150 }]);
      return response;
    };
    try {
      await dbMigrateLegacyJobs();
    } finally {
      chrome.runtime.sendMessage = realSend;
    }
    expect(await readLegacy()).toEqual([{ id: '1', type: 'applied', timestamp: 150 }]);
    await dbMigrateLegacyJobs();
    expect(await readLegacy()).toEqual([]);
    expect((await background().send({ action: 'jobs.getAll' })).jobs[0].type).toBe('applied');
  });

  it('survives concurrent migrations from several frames', async () => {
    await writeLegacy([{ id: '1', type: 'viewed', timestamp: 100 }, { id: '2', type: 'viewed', timestamp: 100 }]);
    await Promise.all([dbMigrateLegacyJobs(), dbMigrateLegacyJobs(), dbMigrateLegacyJobs()]);
    expect(await readLegacy()).toEqual([]);
    expect((await background().send({ action: 'jobs.getAll' })).jobs).toHaveLength(2);
  });

  it('does nothing and creates no database when there is no legacy store', async () => {
    expect(await dbMigrateLegacyJobs()).toBe(0);
    expect((await indexedDB.databases()).map((d) => d.name)).not.toContain('li-job-marker');
  });
});

describe('content job cache', () => {
  it('merges changes broadcast while the first snapshot is loading', async () => {
    await background().send({ action: 'jobs.save', jobs: [{ linkedInJobId: '1', type: 'viewed' }] });
    const loading = dbGetAllJobs();
    const newer = { id: 'x', linkedInJobId: '1', type: 'applied', stateAt: 1, createdAt: 1, updatedAt: Date.now() + 1000, deletedAt: null };
    globalThis.__runtimeMessageListeners.forEach((l) => l({ action: 'data-changed', jobs: [newer] }, {}, () => {}));
    expect((await loading).map((j) => j.type)).toEqual(['applied']);
  });

  it('never lets an older broadcast replace a newer cached job and honours epoch-0 tombstones', async () => {
    const saved = (await background().send({ action: 'jobs.save', jobs: [{ linkedInJobId: '1', type: 'applied' }] })).jobs[0];
    await dbGetAllJobs();
    dbCacheJobs([{ ...saved, type: 'viewed', updatedAt: saved.updatedAt - 1 }]);
    expect((await dbGetJob('1')).type).toBe('applied');
    dbCacheJobs([{ ...saved, deletedAt: 0, updatedAt: saved.updatedAt + 1 }]);
    expect(await dbGetJob('1')).toBeNull();
    expect(await dbGetAllJobs()).toEqual([]);
  });

  it('batches state saves from a marking pass into one request', async () => {
    const sent = [];
    const realSend = chrome.runtime.sendMessage;
    chrome.runtime.sendMessage = (message) => { sent.push(message.action); return realSend(message); };
    try {
      ['1', '2', '3'].forEach((id) => {
        const card = makeClassicCard(id, 'Acme');
        card.insertAdjacentHTML('beforeend', '<li class="job-card-container__footer-job-state">Viewed</li>');
      });
      await markCards();
    } finally {
      chrome.runtime.sendMessage = realSend;
    }
    expect(sent.filter((a) => a === 'jobs.save')).toHaveLength(1);
    expect((await background().send({ action: 'jobs.getAll' })).jobs).toHaveLength(3);
  });
});

describe('blacklist cache and identity', () => {
  it('ignores a snapshot older than the cached revision', async () => {
    await background().send({ action: 'companies.setBlacklisted', name: 'Acme', blacklisted: true });
    const current = await blGetCompanies();
    blSetCache([], 1);
    expect(await blGetCompanies()).toBe(current);
  });

  it('marks cards by normalised name and respects a different known slug', async () => {
    await background().send({ action: 'companies.setBlacklisted', name: 'Acme Corp', slug: 'acme-uk', blacklisted: true });
    const plain = makeClassicCard('1', '  ACME   corp ');
    const same = makeClassicCard('2', 'Acme Corp', '/company/acme-uk/');
    const other = makeClassicCard('3', 'Acme Corp', 'https://www.example.com/company/acme-uk/');
    const different = makeClassicCard('4', 'Acme Corp', '/company/acme-us/');
    await markCards();
    expect([plain, same, other, different].map((c) => c.classList.contains('ljm-blacklisted'))).toEqual([true, true, true, false]);
  });

  it('reads slugs from LinkedIn company paths only, never from companyUrn links', () => {
    const anchor = (href) => Object.assign(document.createElement('a'), { href });
    expect(extractCompanySlug(anchor('/company/Acme-UK/jobs/'))).toBe('acme-uk');
    expect(extractCompanySlug(anchor('/premium/products/?companyUrn=urn%3Ali%3Afsd_company%3A1'))).toBeNull();
    expect(extractCompanySlug(anchor('https://www.example.com/company/acme/'))).toBeNull();
    expect(aiSearchAdapter.getCompanySlug).toBe(defaultJobsAdapter.getCompanySlug);
  });

  it('borrows the panel slug only when URL, rendered panel and company name all match', () => {
    const card = makeClassicCard('42', 'Acme');
    makeClassicDetail('42', 'acme', 'acme-uk');
    history.replaceState({}, '', '/jobs/search/?currentJobId=42');
    expect(getCardCompanyIdentity(card, defaultJobsAdapter)).toEqual({ name: 'Acme', slug: 'acme-uk' });

    history.replaceState({}, '', '/jobs/search/?currentJobId=43');
    expect(getCardCompanyIdentity(card, defaultJobsAdapter).slug).toBeNull();

    document.body.innerHTML = '';
    const stale = makeClassicCard('42', 'Acme');
    makeClassicDetail('41', 'Acme', 'acme-other');
    history.replaceState({}, '', '/jobs/search/?currentJobId=42');
    expect(getCardCompanyIdentity(stale, defaultJobsAdapter).slug).toBeNull();
  });

  it('toggles the blacklist from the context menu with the card identity and re-marks', async () => {
    const card = makeClassicCard('42', 'Acme', '/company/acme-uk/');
    card.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    globalThis.__runtimeMessageListeners.forEach((l) => l({ action: 'blacklist-toggle' }, {}, () => {}));
    await flush();
    const { companies } = await background().send({ action: 'companies.getBlacklist' });
    expect(companies.map((c) => [c.name, c.slug])).toEqual([['Acme', 'acme-uk']]);
    expect(card.classList.contains('ljm-blacklisted')).toBe(true);
  });

  it('notifies blOnChange listeners when another context changes the blacklist', async () => {
    const seen = [];
    blOnChange((companies) => seen.push(companies.map((c) => c.nameKey)));
    await blGetCompanies();
    await background().send({ action: 'companies.setBlacklisted', name: 'Beta', blacklisted: true });
    await flush();
    expect(seen.at(-1)).toEqual(['beta']);
  });

  it('captures a slug for a slug-less blacklisted company from the detail panel', async () => {
    await background().send({ action: 'companies.setBlacklisted', name: 'Acme', blacklisted: true });
    makeClassicDetail('42', 'Acme', 'acme-uk');
    await captureDetailPanelCompanySlug();
    await flush();
    expect((await background().send({ action: 'companies.getBlacklist' })).companies[0].slug).toBe('acme-uk');
  });
});
