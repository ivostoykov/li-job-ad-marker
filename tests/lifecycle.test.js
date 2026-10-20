import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const {
  applyStartupOptions,
  getObserverSnapshot,
  getObservedSurface,
  isDebugEnabled,
  startOnJobsPage,
  stopObservingCards
} = globalThis._testExports;

function makeClassicJobsSurface(jobId = '123456') {
  const card = document.createElement('div');
  card.className = 'job-card-container';
  card.dataset.jobId = jobId;

  const link = document.createElement('a');
  link.className = 'job-card-container__link';
  link.href = `/jobs/view/${jobId}`;
  link.textContent = 'Head of Engineering';
  card.appendChild(link);

  const company = document.createElement('span');
  company.className = 'artdeco-entity-lockup__subtitle';
  company.textContent = 'Acme Corp';
  card.appendChild(company);

  const state = document.createElement('li');
  state.className = 'job-card-container__footer-item job-card-container__footer-job-state t-bold';
  state.textContent = 'Viewed';
  card.appendChild(state);

  document.body.appendChild(card);
  return card;
}

async function flushAsyncWork() {
  await new Promise((resolve) => setTimeout(resolve, 25));
}

describe('content lifecycle', () => {
  beforeEach(async () => {
    stopObservingCards();
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    history.replaceState({}, '', '/');
    await flushAsyncWork();
  });

  afterEach(() => {
    stopObservingCards();
    document.head.innerHTML = '';
    document.body.innerHTML = '';
  });

  it('starts observing supported pages and marks cards on the first pass', async () => {
    history.replaceState({}, '', '/jobs/search/?currentJobId=123456');
    const card = makeClassicJobsSurface();

    startOnJobsPage();
    await flushAsyncWork();

    expect(getObservedSurface()?.adapter.name).toBe('default-jobs');
    expect(getObserverSnapshot().cardObserver).toBeTruthy();
    expect(card.classList.contains('ljm-viewed')).toBe(true);
  });

  it('keeps the same observer when only currentJobId changes', async () => {
    history.replaceState({}, '', '/jobs/search/?currentJobId=123456');
    makeClassicJobsSurface();

    startOnJobsPage();
    await flushAsyncWork();

    const firstObserver = getObserverSnapshot().cardObserver;
    history.replaceState({}, '', '/jobs/search/?currentJobId=999999');
    await flushAsyncWork();

    expect(getObserverSnapshot().cardObserver).toBe(firstObserver);
    expect(getObservedSurface()?.adapter.name).toBe('default-jobs');
  });

  it('applies startup debug and colour settings before page handling', () => {
    applyStartupOptions({
      debug: true,
      colours: {
        viewed: 0.33,
        applied: '#123456',
        blacklisted: '#654321'
      }
    });

    const style = document.getElementById('ljm-colours');
    expect(isDebugEnabled()).toBe(true);
    expect(style?.textContent).toContain('--ljm-viewed-opacity: 0.33;');
    expect(style?.textContent).toContain('--ljm-applied-colour: #123456;');
    expect(style?.textContent).toContain('--ljm-blacklisted-colour: #654321;');
  });
});


describe('settings and marker messages', () => {
  beforeEach(() => {
    stopObservingCards();
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    history.replaceState({}, '', '/');
  });
  afterEach(() => stopObservingCards());

  it('normalises live settings and resets removed settings, including debug', async () => {
    const dispatch = async (newValue) => {
      for (const listener of globalThis.__storageChangeListeners) {
        listener({ 'ljm-options': { newValue } }, 'sync');
      }
      await flushAsyncWork();
    };
    await dispatch({ debug: true, colours: { viewed: 0, applied: '#123456', blacklisted: '#654321' } });
    expect(isDebugEnabled()).toBe(true);
    expect(document.getElementById('ljm-colours').textContent).toContain('--ljm-viewed-opacity: 0;');
    await dispatch({ debug: 'false', colours: { viewed: Infinity, applied: 'red; } body { color: red', blacklisted: null } });
    expect(isDebugEnabled()).toBe(false);
    expect(document.getElementById('ljm-colours').textContent).toContain('--ljm-applied-colour: #32cd32;');
    expect(document.getElementById('ljm-colours').textContent).not.toContain('body');
    await dispatch(undefined);
    expect(document.getElementById('ljm-colours').textContent).toContain('--ljm-viewed-opacity: 0.45;');
  });

  it('clears detail title, ageing and card badges through the actual marker-toggle message', async () => {
    history.replaceState({}, '', '/jobs/search/');
    const card = makeClassicJobsSurface();
    const title = document.createElement('h1');
    title.className = 'ljm-detail-unwanted-title ljm-detail-ageing';
    document.body.appendChild(title);
    applyMark(card, 'viewed', false, false, '=Engineer', undefined, globalThis._testExports.defaultJobsAdapter);
    for (const listener of globalThis.__runtimeMessageListeners) {
      listener({ action: 'marker-toggle' }, {}, () => {});
    }
    await flushAsyncWork();
    expect(title.classList.contains('ljm-detail-unwanted-title')).toBe(false);
    expect(title.classList.contains('ljm-detail-ageing')).toBe(false);
    expect(card.hasAttribute('data-ljm-ignored-rule')).toBe(false);
    expect(card.classList.contains('ljm-viewed')).toBe(false);
  });
});
