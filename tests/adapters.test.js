import { describe, it, expect, beforeEach } from 'vitest';

// Helpers to build minimal LinkedIn card DOM structures

function makeClassicCard({ footerState = null, footerItems = [] } = {}) {
  const card = document.createElement('div');
  card.className = 'job-card-container';

  const footer = document.createElement('ul');
  footer.className = 'job-card-container__footer-wrapper';

  if (footerState) {
    const stateLi = document.createElement('li');
    stateLi.className = 'job-card-container__footer-item job-card-container__footer-job-state t-bold';
    stateLi.textContent = footerState;
    footer.appendChild(stateLi);
  }

  for (const text of footerItems) {
    const li = document.createElement('li');
    li.className = 'job-card-container__footer-item inline-flex align-items-center';
    li.textContent = text;
    footer.appendChild(li);
  }

  card.appendChild(footer);
  return card;
}

function makeAiCard(texts = []) {
  const card = document.createElement('div');
  card.setAttribute('role', 'button');
  card.setAttribute('componentkey', 'test-key');

  for (const text of texts) {
    const p = document.createElement('p');
    p.textContent = text;
    card.appendChild(p);
  }

  return card;
}

describe('defaultJobsAdapter — getLinkedInJobState', () => {
  const adapter = globalThis._testExports.defaultJobsAdapter;

  it('returns "applied" when footer state is Applied', () => {
    expect(adapter.getLinkedInJobState(makeClassicCard({ footerState: 'Applied' }))).toBe('applied');
  });

  it('returns "viewed" when footer state is Viewed', () => {
    expect(adapter.getLinkedInJobState(makeClassicCard({ footerState: 'Viewed' }))).toBe('viewed');
  });

  it('returns "promoted" when a footer item contains Promoted', () => {
    expect(adapter.getLinkedInJobState(makeClassicCard({ footerItems: ['Promoted'] }))).toBe('promoted');
  });

  it('returns "promoted" when a footer item contains reposted (lowercase)', () => {
    expect(adapter.getLinkedInJobState(makeClassicCard({ footerItems: ['reposted'] }))).toBe('promoted');
  });

  it('returns "promoted" when a footer item contains Reposted (capitalised)', () => {
    expect(adapter.getLinkedInJobState(makeClassicCard({ footerItems: ['Reposted'] }))).toBe('promoted');
  });

  it('prefers state over promoted when both are present', () => {
    const card = makeClassicCard({ footerState: 'Viewed', footerItems: ['Promoted'] });
    expect(adapter.getLinkedInJobState(card)).toBe('viewed');
  });

  it('returns null when neither state nor promoted label is present', () => {
    expect(adapter.getLinkedInJobState(makeClassicCard({ footerItems: ['Easy Apply'] }))).toBeNull();
  });

  it('returns null for a card with an empty footer', () => {
    expect(adapter.getLinkedInJobState(makeClassicCard())).toBeNull();
  });
});

describe('aiSearchAdapter — getLinkedInJobState', () => {
  const adapter = globalThis._testExports.aiSearchAdapter;

  it('returns "applied" when the card contains Applied text', () => {
    expect(adapter.getLinkedInJobState(makeAiCard(['Acme Corp', 'Applied']))).toBe('applied');
  });

  it('returns "viewed" when the card contains Viewed text', () => {
    expect(adapter.getLinkedInJobState(makeAiCard(['Acme Corp', 'Viewed']))).toBe('viewed');
  });

  it('returns "promoted" when the card contains Promoted text', () => {
    expect(adapter.getLinkedInJobState(makeAiCard(['Acme Corp', 'Promoted']))).toBe('promoted');
  });

  it('returns "promoted" when the card contains reposted (lowercase)', () => {
    expect(adapter.getLinkedInJobState(makeAiCard(['Acme Corp', 'reposted']))).toBe('promoted');
  });

  it('returns null when no known label is present', () => {
    expect(adapter.getLinkedInJobState(makeAiCard(['Acme Corp', 'London']))).toBeNull();
  });
});

describe('defaultJobsAdapter — getTitleElement', () => {
  const adapter = globalThis._testExports.defaultJobsAdapter;

  it('returns the link element with the job-card link class', () => {
    const card = document.createElement('div');
    const link = document.createElement('a');
    link.className = 'job-card-container__link';
    link.href = '/jobs/view/123456';
    card.appendChild(link);
    expect(adapter.getTitleElement(card)).toBe(link);
  });

  it('returns null when no title link is present', () => {
    expect(adapter.getTitleElement(document.createElement('div'))).toBeNull();
  });
});

describe('defaultJobsAdapter — getCompanyElement', () => {
  const adapter = globalThis._testExports.defaultJobsAdapter;

  it('returns the subtitle element', () => {
    const card = document.createElement('div');
    const subtitle = document.createElement('span');
    subtitle.className = 'artdeco-entity-lockup__subtitle';
    subtitle.textContent = 'Acme Corp';
    card.appendChild(subtitle);
    expect(adapter.getCompanyElement(card)).toBe(subtitle);
  });
});

describe('route-based adapter matching', () => {
  beforeEach(() => {
    history.replaceState({}, '', '/');
  });

  it('matches classic search on /jobs/search/', () => {
    history.replaceState({}, '', '/jobs/search/?currentJobId=123456');

    expect(globalThis._testExports.getMatchedPageAdapter()?.name).toBe('classic-search');
  });

  it('matches the job-view adapter on /jobs/view/...', () => {
    history.replaceState({}, '', '/jobs/view/123456/');

    expect(globalThis._testExports.getMatchedPageAdapter()?.name).toBe('job-view');
    expect(globalThis._testExports.jobViewAdapter.getCurrentJobId()).toBe('123456');
  });
});
