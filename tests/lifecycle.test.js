import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  applyStartupOptions,
  beginPageHandling,
  getObserverSnapshot,
  getObservedSurface,
  isDebugEnabled,
  markPage,
  resetMarkPageTasks,
  setMarkPageTasks,
  stopBootstrapObserver,
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

function makeAiSearchSurface({ state = 'Viewed' } = {}) {
  const main = document.createElement('main');
  const root = document.createElement('div');
  root.setAttribute('componentkey', 'SearchResultsMainContent');

  const card = document.createElement('div');
  card.setAttribute('role', 'button');
  card.setAttribute('componentkey', 'ai-card-1');

  const title = document.createElement('p');
  title.textContent = 'Technical Co-Founder / CTO';
  card.appendChild(title);

  const company = document.createElement('p');
  company.textContent = 'Omea.io';
  card.appendChild(company);

  const status = document.createElement('p');
  status.textContent = state;
  card.appendChild(status);

  root.appendChild(card);
  main.appendChild(root);
  document.body.appendChild(main);

  return { main, root, card };
}

async function flushAsyncWork(ms = 25) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

describe('content lifecycle', () => {
  beforeEach(async () => {
    resetMarkPageTasks();
    stopBootstrapObserver();
    stopObservingCards();
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    history.replaceState({}, '', '/');
    await flushAsyncWork();
  });

  afterEach(() => {
    resetMarkPageTasks();
    vi.restoreAllMocks();
    stopBootstrapObserver();
    stopObservingCards();
    document.head.innerHTML = '';
    document.body.innerHTML = '';
  });

  it('starts observing supported pages and marks cards on the first pass', async () => {
    history.replaceState({}, '', '/jobs/search/?currentJobId=123456');
    const card = makeClassicJobsSurface();

    startOnJobsPage();
    await flushAsyncWork(100);

    expect(getObservedSurface()?.adapter.name).toBe('classic-search');
    expect(getObserverSnapshot().cardObserver).toBeTruthy();
    expect(card.classList.contains('ljm-viewed')).toBe(true);
  });

  it('keeps the same observer when only currentJobId changes', async () => {
    history.replaceState({}, '', '/jobs/search/?currentJobId=123456');
    makeClassicJobsSurface();

    startOnJobsPage();
    await flushAsyncWork(100);

    const firstObserver = getObserverSnapshot().cardObserver;
    history.replaceState({}, '', '/jobs/search/?currentJobId=999999');
    await flushAsyncWork();

    expect(getObserverSnapshot().cardObserver).toBe(firstObserver);
    expect(getObservedSurface()?.adapter.name).toBe('classic-search');
  });

  it('waits for the AI-search root instead of falling back to default jobs', async () => {
    history.replaceState({}, '', '/jobs/search-results/?currentJobId=123456');

    beginPageHandling();
    await flushAsyncWork();

    expect(getObservedSurface()).toBeNull();
    expect(getObserverSnapshot().bootstrapObserver).toBeTruthy();
    expect(getObserverSnapshot().cardObserver).toBeNull();

    const { card } = makeAiSearchSurface();
    await flushAsyncWork(50);

    expect(getObservedSurface()?.adapter.name).toBe('ai-search-results');
    expect(getObserverSnapshot().bootstrapObserver).toBeNull();
    expect(getObserverSnapshot().cardObserver).toBeTruthy();
    expect(card.classList.contains('ljm-viewed')).toBe(true);
  });

  it('rebinds when the observed AI surface changes to classic search', async () => {
    history.replaceState({}, '', '/jobs/search-results/?currentJobId=123456');
    const { card: aiCard } = makeAiSearchSurface();

    beginPageHandling();
    await flushAsyncWork(50);

    expect(getObservedSurface()?.adapter.name).toBe('ai-search-results');

    history.replaceState({}, '', '/jobs/search/?currentJobId=999999');
    const classicCard = makeClassicJobsSurface('999999');

    const extraText = document.createElement('p');
    extraText.textContent = 'Viewed';
    aiCard.appendChild(extraText);

    await flushAsyncWork(400);

    expect(getObservedSurface()?.adapter.name).toBe('classic-search');
    expect(classicCard.classList.contains('ljm-viewed')).toBe(true);
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

  it('logs a branch failure without aborting the other markPage tasks', async () => {
    const taskCalls = [];
    const branchError = new Error('storage unavailable');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    async function failingMarkCards() {
      taskCalls.push('markCards');
      throw branchError;
    }

    async function successfulMarkDetailPanelAging() {
      taskCalls.push('markDetailPanelAging');
    }

    async function successfulMarkDetailPanelUnwantedTitle() {
      taskCalls.push('markDetailPanelUnwantedTitle');
    }

    setMarkPageTasks({
      markCards: failingMarkCards,
      markDetailPanelAging: successfulMarkDetailPanelAging,
      markDetailPanelUnwantedTitle: successfulMarkDetailPanelUnwantedTitle
    });

    await expect(markPage()).resolves.toBeUndefined();

    expect(taskCalls).toEqual([
      'markCards',
      'markDetailPanelAging',
      'markDetailPanelUnwantedTitle'
    ]);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('markPage task failed: failingMarkCards'),
      branchError
    );
  });
});
