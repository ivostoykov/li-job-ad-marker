import { describe, it, expect, beforeEach } from 'vitest';

const { defaultJobsAdapter } = globalThis._testExports;

function makeCard({ titleClass = 'job-card-container__link', hasState = false, hasAgeing = false } = {}) {
  const card = document.createElement('div');
  card.className = 'job-card-container';

  const title = document.createElement('a');
  title.className = titleClass;
  title.href = '/jobs/view/123';
  card.appendChild(title);

  const company = document.createElement('span');
  company.className = 'artdeco-entity-lockup__subtitle';
  company.textContent = 'Acme Corp';
  card.appendChild(company);

  if (hasState) {
    const state = document.createElement('li');
    state.className = 'job-card-container__footer-item job-card-container__footer-job-state t-bold';
    state.textContent = 'Viewed';
    card.appendChild(state);
  }

  if (hasAgeing) {
    const time = document.createElement('time');
    time.setAttribute('datetime', '2026-01-01');
    card.appendChild(time);
  }

  return card;
}

describe('applyMark', () => {
  it('adds ljm-viewed class for viewed state', () => {
    const card = makeCard();
    applyMark(card, 'viewed', false, false, false, defaultJobsAdapter);
    expect(card.classList.contains('ljm-viewed')).toBe(true);
    expect(card.classList.contains('ljm-applied')).toBe(false);
  });

  it('adds ljm-applied and title/state classes for applied state', () => {
    const card = makeCard({ hasState: true });
    applyMark(card, 'applied', false, false, false, defaultJobsAdapter);
    expect(card.classList.contains('ljm-applied')).toBe(true);
    const titleEl = defaultJobsAdapter.getTitleElement(card);
    expect(titleEl.classList.contains('ljm-applied-title')).toBe(true);
  });

  it('adds ljm-blacklisted and company class when blacklisted', () => {
    const card = makeCard();
    applyMark(card, null, true, false, false, defaultJobsAdapter);
    expect(card.classList.contains('ljm-blacklisted')).toBe(true);
    const company = card.querySelector('.artdeco-entity-lockup__subtitle');
    expect(company.classList.contains('ljm-blacklisted-company')).toBe(true);
  });

  it('adds ljm-ageing to the time element when ageing', () => {
    const card = makeCard({ hasAgeing: true });
    applyMark(card, null, false, true, false, defaultJobsAdapter);
    const time = card.querySelector('time');
    expect(time.classList.contains('ljm-ageing')).toBe(true);
  });

  it('adds ljm-unwanted-title to the title element', () => {
    const card = makeCard();
    applyMark(card, null, false, false, true, defaultJobsAdapter);
    const titleEl = defaultJobsAdapter.getTitleElement(card);
    expect(titleEl.classList.contains('ljm-unwanted-title')).toBe(true);
  });

  it('stacks viewed and unwanted-title independently', () => {
    const card = makeCard();
    applyMark(card, 'viewed', false, false, true, defaultJobsAdapter);
    expect(card.classList.contains('ljm-viewed')).toBe(true);
    const titleEl = defaultJobsAdapter.getTitleElement(card);
    expect(titleEl.classList.contains('ljm-unwanted-title')).toBe(true);
  });

  it('stacks applied and unwanted-title independently', () => {
    const card = makeCard();
    applyMark(card, 'applied', false, false, true, defaultJobsAdapter);
    expect(card.classList.contains('ljm-applied')).toBe(true);
    const titleEl = defaultJobsAdapter.getTitleElement(card);
    expect(titleEl.classList.contains('ljm-unwanted-title')).toBe(true);
    expect(titleEl.classList.contains('ljm-applied-title')).toBe(true);
  });

  it('stacks blacklisted and unwanted-title independently', () => {
    const card = makeCard();
    applyMark(card, null, true, false, true, defaultJobsAdapter);
    expect(card.classList.contains('ljm-blacklisted')).toBe(true);
    const titleEl = defaultJobsAdapter.getTitleElement(card);
    expect(titleEl.classList.contains('ljm-unwanted-title')).toBe(true);
  });
});

describe('clearCardMarks', () => {
  it('removes all mark classes from the card and its elements', () => {
    const card = makeCard({ hasAgeing: true });
    applyMark(card, 'applied', true, true, true, defaultJobsAdapter);

    clearCardMarks(card, defaultJobsAdapter);

    expect(card.classList.contains('ljm-applied')).toBe(false);
    expect(card.classList.contains('ljm-viewed')).toBe(false);
    expect(card.classList.contains('ljm-blacklisted')).toBe(false);

    const titleEl = defaultJobsAdapter.getTitleElement(card);
    expect(titleEl.classList.contains('ljm-applied-title')).toBe(false);
    expect(titleEl.classList.contains('ljm-unwanted-title')).toBe(false);

    const company = card.querySelector('.artdeco-entity-lockup__subtitle');
    expect(company.classList.contains('ljm-blacklisted-company')).toBe(false);

    const time = card.querySelector('time');
    expect(time.classList.contains('ljm-ageing')).toBe(false);
  });

  it('is idempotent on a card with no marks', () => {
    const card = makeCard();
    expect(() => clearCardMarks(card, defaultJobsAdapter)).not.toThrow();
  });
});
