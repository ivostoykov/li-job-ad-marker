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
