let enabled = true;

const JOB_LINK_RE = /\/jobs\/view\/(\d+)/;
const JOB_CARD_SELECTOR = '.job-card-container';
const JOB_LINK_SELECTOR = 'a[href*="/jobs/view/"]';
const JOB_CARD_WRAPPER_SELECTOR = 'li[data-occludable-job-id]';
const JOB_DETAIL_PANEL_SELECTOR = '.job-details-jobs-unified-top-card__tertiary-description-container';
const AI_SEARCH_ROOT_SELECTOR = 'main div[componentkey="SearchResultsMainContent"]';
const AI_SEARCH_CARD_SELECTOR = 'div[role="button"][componentkey], a[componentkey][href*="currentJobId="]';

function getSearchParam(key) {
  const params = new URLSearchParams(location.search);
  return params.get(key) || null;
}

function isElement(node) {
  return node instanceof Element;
}

function getTextContent(el) {
  return el?.textContent?.trim() || null;
}

function isRelativeAgeText(text) {
  return /^\d+\s+(minute|hour|day|week|month)s?\s+ago$/i.test(text ?? '');
}

function parseRelativeAgeText(text) {
  const match = String(text ?? '').match(/^(\d+)\s+(minute|hour|day|week|month)s?\s+ago$/i);
  if (!match) return null;

  return {
    value: Number.parseInt(match[1], 10),
    unit: match[2].toLowerCase()
  };
}

function parseDateFromDatetime(datetime) {
  const match = String(datetime ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;

  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10) - 1;
  const day = Number.parseInt(match[3], 10);
  const date = new Date(year, month, day);

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month ||
    date.getDate() !== day
  ) {
    return null;
  }

  return date;
}

function getAgeInDays(datetime) {
  const publishedDate = parseDateFromDatetime(datetime);
  if (!publishedDate) return null;

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffMs = today.getTime() - publishedDate.getTime();
  if (diffMs < 0) return null;

  return Math.floor(diffMs / 86400000);
}

function getMeaningfulTextEntries(card, selector = 'p') {
  return [...card.querySelectorAll(selector)]
    .map((el) => ({ el, text: getTextContent(el) }))
    .filter(({ text }) => text && text !== '·');
}

function findRelativeAgeElement(root, selector = 'span') {
  if (!root) return null;

  return [...root.querySelectorAll(selector)]
    .find((el) => isRelativeAgeText(getTextContent(el))) || null;
}

function findClosestAncestorWithRelativeAge(el, stopEl) {
  let current = el?.parentElement || null;

  while (current && current !== stopEl) {
    if (
      current.matches?.('div, section, article') &&
      findRelativeAgeElement(current, 'span, p, strong')
    ) {
      return current;
    }
    current = current.parentElement;
  }

  return stopEl && findRelativeAgeElement(stopEl, 'span, p, strong')
    ? stopEl
    : null;
}

function extractJobId(anchor) {
  const match = anchor?.href?.match(JOB_LINK_RE);
  return match ? match[1] : null;
}

const defaultJobsAdapter = {
  name: 'default-jobs',
  matches() {
    return location.pathname.startsWith('/jobs/');
  },
  getJobCards() {
    return document.querySelectorAll(JOB_CARD_SELECTOR);
  },
  getCardFromElement(el) {
    if (!isElement(el)) return null;
    return el.closest(JOB_CARD_SELECTOR);
  },
  getAnchor(card) {
    return card?.querySelector(JOB_LINK_SELECTOR) || null;
  },
  getJobId(card) {
    return card?.dataset?.jobId || extractJobId(this.getAnchor(card));
  },
  getCompanyName(card) {
    return getTextContent(card?.querySelector('.artdeco-entity-lockup__subtitle'));
  },
  getCompanyElement(card) {
    return card?.querySelector('.artdeco-entity-lockup__subtitle') || null;
  },
  getTitleElement(card) {
    return card?.querySelector('.job-card-container__link') || null;
  },
  getStateElement(card) {
    return card?.querySelector('.job-card-container__footer-job-state') || null;
  },
  getAgeingElement(card) {
    return card?.querySelector('time[datetime]') || null;
  },
  getDetailPanelElement() {
    return document.querySelector(JOB_DETAIL_PANEL_SELECTOR);
  },
  getDetailPanelAgeElement(panel = this.getDetailPanelElement()) {
    return findRelativeAgeElement(panel, 'span, strong');
  },
  getDetailPanelTitleElement() {
    return document.querySelector('.job-details-jobs-unified-top-card__job-title a') || null;
  },
  getLinkedInJobState(card) {
    const text = getTextContent(card?.querySelector('.job-card-container__footer-job-state'));
    if (text === 'Applied') return 'applied';
    if (text === 'Viewed') return 'viewed';
    const footerItems = [...(card?.querySelectorAll('.job-card-container__footer-item') || [])];
    if (footerItems.some((el) => /^(Promoted|Reposted)$/i.test(getTextContent(el)))) return 'promoted';
    return null;
  },
  getCurrentJobId() {
    return getSearchParam('currentJobId');
  },
  hasReadyJobCards() {
    return [...this.getJobCards()].some((card) => !!this.getJobId(card));
  },
  isRelevantElement(el) {
    if (!isElement(el)) return false;
    if (this.getCardFromElement(el)) return true;
    const detailPanel = this.getDetailPanelElement();
    if (detailPanel && (detailPanel === el || detailPanel.contains(el))) return true;

    return (
      el.matches(`${JOB_CARD_SELECTOR}, ${JOB_LINK_SELECTOR}, ${JOB_DETAIL_PANEL_SELECTOR}`) ||
      !!el.querySelector(`${JOB_CARD_SELECTOR}, ${JOB_LINK_SELECTOR}, ${JOB_DETAIL_PANEL_SELECTOR}`)
    );
  }
};

const aiSearchAdapter = {
  ...defaultJobsAdapter,
  name: 'ai-search-results',
  matches() {
    return (
      location.pathname === '/jobs/search-results/' &&
      !!this.getListRoot()
    );
  },
  getListRoot() {
    return document.querySelector(AI_SEARCH_ROOT_SELECTOR);
  },
  getJobCards() {
    const root = this.getListRoot();
    return root ? root.querySelectorAll(AI_SEARCH_CARD_SELECTOR) : [];
  },
  getCardFromElement(el) {
    if (!isElement(el)) return null;

    const root = this.getListRoot();
    if (!root || !root.contains(el)) return null;

    const directCard = el.closest(AI_SEARCH_CARD_SELECTOR);
    if (directCard && root.contains(directCard)) return directCard;

    let current = el;
    while (current && current !== root) {
      if (current.parentElement === root && current.matches('div, a')) {
        return current.matches(AI_SEARCH_CARD_SELECTOR)
          ? current
          : (current.querySelector(AI_SEARCH_CARD_SELECTOR) || null);
      }
      current = current.parentElement;
    }

    return null;
  },
  getJobId(card) {
    if (card?.matches('a[href*="currentJobId="]')) {
      return extractCurrentJobIdFromHref(card.getAttribute('href'));
    }

    const cardLink = card?.querySelector('a[href*="currentJobId="]');
    if (cardLink) {
      return extractCurrentJobIdFromHref(cardLink.getAttribute('href'));
    }

    return null;
  },
  getCompanyElement(card) {
    return getMeaningfulTextEntries(card)[1]?.el || null;
  },
  getTitleElement(card) {
    return getMeaningfulTextEntries(card)[0]?.el || null;
  },
  getStateElement(card) {
    return getMeaningfulTextEntries(card).find(({ text }) => text === 'Applied' || text === 'Viewed')?.el || null;
  },
  getAgeingElement(card) {
    return findRelativeAgeElement(card);
  },
  getDetailPanelElement() {
    return [...document.querySelectorAll('div[role="main"]')]
      .find((panel) => !!panel.querySelector('a[href*="/jobs/view/"]')) || null;
  },
  getDetailPanelAgeElement(panel = this.getDetailPanelElement()) {
    if (!panel) return null;

    const titleLink = panel.querySelector('a[href*="/jobs/view/"]');
    if (!titleLink) return null;

    const topSummaryBlock = findClosestAncestorWithRelativeAge(titleLink, panel);
    if (!topSummaryBlock) return null;

    return findRelativeAgeElement(topSummaryBlock, 'span, p, strong');
  },
  getDetailPanelTitleElement() {
    const panel = this.getDetailPanelElement();
    return panel?.querySelector('a[href*="/jobs/view/"]') || null;
  },
  getCompanyName(card) {
    return getTextContent(this.getCompanyElement(card));
  },
  getLinkedInJobState(card) {
    const texts = getMeaningfulTextEntries(card).map(({ text }) => text);
    if (texts.includes('Applied')) return 'applied';
    if (texts.includes('Viewed')) return 'viewed';
    if (texts.some((t) => /^(Promoted|Reposted)$/i.test(t))) return 'promoted';
    return null;
  },
  hasReadyJobCards() {
    return this.getJobCards().length > 0;
  },
  isRelevantElement(el) {
    if (!isElement(el)) return false;
    const root = this.getListRoot();
    return !!(root && root.contains(el));
  }
};

const companySearchAdapter = {
  ...defaultJobsAdapter,
  name: 'company-search',
  matches() {
    return (
      location.pathname === '/jobs/search/' &&
      getSearchParam('origin') === 'COMPANY_PAGE_JOBS_CLUSTER_EXPANSION'
    );
  },
  getCardFromElement(el) {
    if (!isElement(el)) return null;

    const directCard = el.closest(JOB_CARD_SELECTOR);
    if (directCard) return directCard;

    const wrapper = el.closest(JOB_CARD_WRAPPER_SELECTOR);
    return wrapper?.querySelector(JOB_CARD_SELECTOR) || null;
  },
  getJobId(card) {
    return (
      card?.dataset?.jobId ||
      card?.closest(JOB_CARD_WRAPPER_SELECTOR)?.dataset?.occludableJobId ||
      defaultJobsAdapter.getJobId(card)
    );
  },
  isRelevantElement(el) {
    if (!isElement(el)) return false;
    if (this.getCardFromElement(el)) return true;

    return (
      el.matches(`${JOB_CARD_SELECTOR}, ${JOB_LINK_SELECTOR}, ${JOB_CARD_WRAPPER_SELECTOR}`) ||
      !!el.querySelector(`${JOB_CARD_SELECTOR}, ${JOB_LINK_SELECTOR}, ${JOB_CARD_WRAPPER_SELECTOR}`)
    );
  }
};

const PAGE_ADAPTERS = [aiSearchAdapter, companySearchAdapter, defaultJobsAdapter];

function extractCurrentJobIdFromHref(href) {
  if (!href) {
    console.debug(`${getLogPrefix(console.debug.name)} - ${getLineNumber()} - ${extractCurrentJobIdFromHref.name}'s param "href" is missing or empty`, href);
    return null;
  }

  try {
    return new URL(href, location.origin).searchParams.get('currentJobId');
  } catch (_e) {
    return null;
  }
}

let currentPageAdapter = defaultJobsAdapter;

function getMatchedPageAdapter() {
  return PAGE_ADAPTERS.find((adapter) => adapter.matches()) || null;
}

function selectPageAdapter() {
  return getMatchedPageAdapter() || defaultJobsAdapter;
}

function refreshPageAdapter() {
  const nextAdapter = selectPageAdapter();
  console.debug(`${getLogPrefix(console.debug.name)} - ${getLineNumber()} - refreshing Adapter`, {nextAdapter: nextAdapter?.name, currentPageAdapter: currentPageAdapter.name});

  currentPageAdapter = nextAdapter;
  return currentPageAdapter;
}

function findCardFromNodes(nodes) {
  const adapter = refreshPageAdapter();
  console.debug(`${getLogPrefix(console.debug.name)} - ${getLineNumber()} - Will use this Adapter`, {adapter: currentPageAdapter.name});

  for (const node of nodes) {
    if (!isElement(node)) continue;
    const card = adapter.getCardFromElement(node);
    if (card) return card;
  }

  console.debug(`${getLogPrefix(console.debug.name)} - ${getLineNumber()} - No cards found.`);
  return null;
}

function getContextCard(action) {
  if (lastRightClickedCard) return lastRightClickedCard;
  console.debug(`${getLogPrefix(console.debug.name)} - ${getLineNumber()} - ${action}: no job card captured from context menu`);
  return null;
}

function addMessageAction(action, handler) {
  chrome.runtime.onMessage.addListener((message) => {
    console.debug(`${getLogPrefix(console.debug.name)} - ${getLineNumber()} - Received message`, {action, message});
    if (message.action !== action) return;

    Promise.resolve()
      .then(() => handler(message))
      .catch((e) => console.error(`${getLogPrefix(console.error.name)} - ${getLineNumber()} - ${action} failed:`, e));
  });
}

function addMessageRequest(action, handler) {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    console.debug(`${getLogPrefix(console.debug.name)} - ${getLineNumber()} - Received message`, {action, message});
    if (message.action !== action) return;

    Promise.resolve()
      .then(() => handler(message))
      .then((response) => sendResponse(response))
      .catch((e) => {
        console.error(`${getLogPrefix(console.error.name)} - ${getLineNumber()} - ${action} failed:`, e);
        sendResponse({ ok: false, error: e?.message || String(e) });
      });

    return true;
  });
}

function clearCardMarks(card, adapter = refreshPageAdapter()) {
  card.classList.remove('ljm-viewed', 'ljm-applied', 'ljm-blacklisted');
  const companyElement = adapter.getCompanyElement?.(card);
  const titleElement = adapter.getTitleElement?.(card);
  const stateElement = adapter.getStateElement?.(card);
  const ageingElement = adapter.getAgeingElement?.(card);
  companyElement?.classList.remove('ljm-blacklisted-company');
  titleElement?.classList.remove('ljm-applied-title', 'ljm-unwanted-title');
  stateElement?.classList.remove('ljm-applied-state');
  ageingElement?.classList.remove('ljm-ageing');
}

function applyMark(card, jobState, isBlacklisted, isAgeing, isUnwantedTitle, adapter = refreshPageAdapter()) {
  clearCardMarks(card, adapter);
  const companyElement = adapter.getCompanyElement?.(card);
  const titleElement = adapter.getTitleElement?.(card);
  const stateElement = adapter.getStateElement?.(card);
  const ageingElement = adapter.getAgeingElement?.(card);

  if (isBlacklisted) card.classList.add('ljm-blacklisted');
  if (isBlacklisted && companyElement) companyElement.classList.add('ljm-blacklisted-company');
  if (jobState === 'applied') {
    card.classList.add('ljm-applied');
    titleElement?.classList.add('ljm-applied-title');
    stateElement?.classList.add('ljm-applied-state');
  }
  else if (jobState === 'viewed') card.classList.add('ljm-viewed');

  if (isAgeing && ageingElement) ageingElement.classList.add('ljm-ageing');
  if (isUnwantedTitle && titleElement) titleElement.classList.add('ljm-unwanted-title');
}

function clearAllCardMarks() {
  const adapter = refreshPageAdapter();
  adapter.getJobCards().forEach((card) => clearCardMarks(card, adapter));
}

function shouldPromoteState(currentState, nextState) {
  return (TYPE_RANK[nextState] ?? 0) > (TYPE_RANK[currentState] ?? 0);
}

function applyColourSettings(colours) {
  let el = document.getElementById('ljm-colours');
  if (!el) {
    el = document.createElement('style');
    el.id = 'ljm-colours';
    document.head.appendChild(el);
  }
  el.textContent = `:root {
    --ljm-viewed-opacity: ${colours.viewed};
    --ljm-applied-colour: ${colours.applied};
    --ljm-blacklisted-colour: ${colours.blacklisted};
    --ljm-blacklisted-bg: ${hexToRgba(colours.blacklisted, 0.15)};
  }`;
  console.debug(`${getLogPrefix(console.debug.name)} - ${getLineNumber()} - colours applied`, colours);
}

function applyStartupOptions(options) {
  if (options?.colours) applyColourSettings(options.colours);
  if (typeof setDebugFlag === 'function') {
    setDebugFlag(options?.debug ?? false, { silent: true });
  }
}

function parseUnwantedTitleWords(str) {
  if (!str) return [];
  return str.split(',').map((w) => w.trim()).filter(Boolean);
}

function titleMatchesUnwanted(titleText, words) {
  if (!titleText || !words.length) return false;
  const lower = titleText.toLowerCase();
  return words.some((w) => lower.includes(w.toLowerCase()));
}

function shouldMarkAgeing(card, adapter, ageingLimitDays) {
  if (!card) { console.debug(`${getLogPrefix(console.debug.name)} - ${getLineNumber()} - no card`); return false; }
  if (!adapter) { console.debug(`${getLogPrefix(console.debug.name)} - ${getLineNumber()} - no adapter`); return false; }
  if (ageingLimitDays === null) return false;

  const ageingElement = adapter.getAgeingElement?.(card);
  if (!ageingElement) return false;
  const datetime = ageingElement.getAttribute('datetime');
  if (!datetime) {
    return shouldMarkDetailPanelAgeing(getTextContent(ageingElement), ageingLimitDays);
  }

  const ageInDays = getAgeInDays(datetime);
  return ageInDays !== null && ageInDays > ageingLimitDays;
}

function shouldMarkDetailPanelAgeing(ageText, ageingLimitDays) {
  if (ageingLimitDays === null) return false;

  const age = parseRelativeAgeText(ageText);
  if (!age) return false;

  if (age.unit === 'minute' || age.unit === 'hour') return false;
  if (age.unit === 'day') return age.value > ageingLimitDays;
  return true;
}

function clearDetailPanelAging() {
  document.querySelectorAll('.ljm-detail-ageing').forEach((el) => {
    el.classList.remove('ljm-detail-ageing');
  });
}

async function markDetailPanelAging() {
  clearDetailPanelAging();
  if (!enabled) return;

  const adapter = refreshPageAdapter();
  const panel = adapter.getDetailPanelElement?.();
  if (!panel) return;

  const options = await getOptions();
  const ageingLimitDays = getValidAgeingLimitDays(options);
  if (ageingLimitDays === null) return;

  const ageElement = adapter.getDetailPanelAgeElement?.(panel);
  if (!ageElement) return;

  if (shouldMarkDetailPanelAgeing(getTextContent(ageElement), ageingLimitDays)) {
    ageElement.classList.add('ljm-detail-ageing');
  }
}

function clearDetailPanelUnwantedTitle() {
  document.querySelectorAll('.ljm-detail-unwanted-title').forEach((el) => {
    el.classList.remove('ljm-detail-unwanted-title');
  });
}

async function markDetailPanelUnwantedTitle() {
  clearDetailPanelUnwantedTitle();
  if (!enabled) return;

  const adapter = refreshPageAdapter();
  const titleEl = adapter.getDetailPanelTitleElement?.();
  if (!titleEl) return;

  const options = await getOptions();
  const words = parseUnwantedTitleWords(options.unwantedTitleWords);
  if (!words.length) return;

  if (titleMatchesUnwanted(getTextContent(titleEl), words)) {
    titleEl.classList.add('ljm-detail-unwanted-title');
  }
}

async function markPage() {
  console.debug(`${getLogPrefix(console.debug.name)} - ${getLineNumber()} - ${markPage.name} fired.`);
  await Promise.all([markCards(), markDetailPanelAging(), markDetailPanelUnwantedTitle()]);
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'sync' || !changes[SETTINGS_KEY]) return;
  console.debug(`${getLogPrefix(console.debug.name)} - ${getLineNumber()} - Options changed.`, {changes, areaName});

  Promise.resolve()
    .then(() => {
      const newOptions = changes[SETTINGS_KEY].newValue;
      if (newOptions?.colours) applyColourSettings(newOptions.colours);
      return markPage();
    })
    .catch((e) => console.error(`${getLogPrefix(console.error.name)} - ${getLineNumber()} - Failed to apply updated settings:`, e));
});

async function markCards() {
  if (!enabled) {
    console.debug(`${getLogPrefix(console.debug.name)} - ${getLineNumber()} - Temporarily disabled.`);
    return;
  }

  const adapter = refreshPageAdapter();
  console.debug(`${getLogPrefix(console.debug.name)} - ${getLineNumber()} - markCards() with adapter "${adapter.name}"`);

  const [allJobs, blacklist, options] = await Promise.all([dbGetAllJobs(), blGetList(), getOptions()]);
  const ageingLimitDays = getValidAgeingLimitDays(options);
  const unwantedWords = parseUnwantedTitleWords(options.unwantedTitleWords);
  const jobMap = {};
  allJobs.forEach((j) => { jobMap[j.id] = j; });

  const saves = [];

  adapter.getJobCards().forEach((card) => {
    const jobId = adapter.getJobId(card);
    const company = adapter.getCompanyName(card);
    const existing = jobId ? jobMap[jobId] : null;
    const linkedInState = adapter.getLinkedInJobState(card);
    const effectiveLinkedInState = (options.treatPromotedAsViewed && linkedInState === 'promoted')
      ? 'viewed'
      : linkedInState;
    const isAgeing = shouldMarkAgeing(card, adapter, ageingLimitDays);
    const isUnwantedTitle = titleMatchesUnwanted(getTextContent(adapter.getTitleElement?.(card)), unwantedWords);

    if (jobId && effectiveLinkedInState && shouldPromoteState(existing?.type, effectiveLinkedInState)) {
      saves.push(dbSaveJob(jobId, effectiveLinkedInState).then(() => { jobMap[jobId] = { id: jobId, type: effectiveLinkedInState }; }));
    }

    const isBlacklisted = !!(company && blacklist.includes(company));
    const jobState = shouldPromoteState(existing?.type, effectiveLinkedInState)
      ? effectiveLinkedInState
      : (existing?.type ?? effectiveLinkedInState);

    if (!jobId && !company && !jobState && !isAgeing && !isUnwantedTitle) return;
    applyMark(card, jobState, isBlacklisted, isAgeing, isUnwantedTitle, adapter);
  });

  await Promise.all(saves);
}

async function recordCurrentJob() {
  const jobId = refreshPageAdapter().getCurrentJobId();
  if (!jobId) return;

  const existing = await dbGetJob(jobId);
  if (!existing) {
    console.debug(`${getLogPrefix(console.debug.name)} - ${getLineNumber()} - recording viewed: ${jobId}`);
    await dbSaveJob(jobId, 'viewed');
    await markPage();
  }
}

let lastRightClickedCard = null;

document.addEventListener('contextmenu', (e) => {
  try {
    const path = typeof e.composedPath === 'function' ? e.composedPath() : [e.target];
    lastRightClickedCard = findCardFromNodes(path);
  } catch (err) {
    lastRightClickedCard = null;
    console.error(`${getLogPrefix(console.error.name)} - ${getLineNumber()} - Failed to capture context menu target:`, err);
  }
});

addMessageAction('blacklist-toggle', async () => {
  const adapter = refreshPageAdapter();
  const card = getContextCard('blacklist-toggle');
  if (!card) return;

  const company = adapter.getCompanyName(card);
  if (!company) {
    console.warn(`${getLogPrefix(console.warn.name)} - ${getLineNumber()} - blacklist-toggle: company name not found for selected card`);
    return;
  }

  const listed = await blIncludes(company);
  await (listed ? blRemove(company) : blAdd(company));
  await markPage();
});

addMessageAction('applied-mark', async () => {
  const card = getContextCard('applied-mark');
  if (!card) return;

  const jobId = refreshPageAdapter().getJobId(card);
  if (!jobId) {
    console.warn(`${getLogPrefix(console.warn.name)} - ${getLineNumber()} - applied-mark: job ID not found for selected card`);
    return;
  }

  console.debug(`${getLogPrefix(console.debug.name)} - ${getLineNumber()} - marking applied: ${jobId}`);
  await dbSaveJob(jobId, 'applied');
  await markPage();
});

addMessageAction('marker-toggle', async () => {
  enabled = !enabled;

  if (!enabled) {
    clearAllCardMarks();
    clearDetailPanelAging();
  } else {
    await markPage();
  }
});

addMessageRequest('get-all-jobs', async () => {
  const jobs = await dbGetAllJobs();
  return { jobs };
});

addMessageRequest('import-jobs', async (message) => {
  const jobs = message.jobs ?? [];
  await Promise.all(jobs.map((j) => dbRestoreJob(j.id, j.type, j.timestamp)));
  return { ok: true };
});

let cardObserver = null;
let cardObserverDebounceTimer = null;
let cardObserverFallbackTimer = null;
let observedSurface = null;

function getObservedSurface() {
  const adapter = getMatchedPageAdapter();
  if (!adapter) return null;

  return {
    adapter,
    root: adapter.getListRoot?.() || document.body
  };
}

function clearObserverTimers() {
  clearTimeout(cardObserverDebounceTimer);
  clearTimeout(cardObserverFallbackTimer);
  cardObserverDebounceTimer = null;
  cardObserverFallbackTimer = null;
}

function stopObservingCards() {
  clearObserverTimers();
  if (cardObserver) {
    console.debug(`${getLogPrefix(console.debug.name)} - ${getLineNumber()} - Disconnecting observer.`);
    cardObserver.disconnect();
    cardObserver = null;
  }
  observedSurface = null;
}

function hasReadyJobCards(adapter = refreshPageAdapter()) {
  const res = adapter.hasReadyJobCards();
  console.debug(`${getLogPrefix(console.debug.name)} - ${getLineNumber()} - Has ready cards`, {adapter: adapter?.name, res});

  return res;
}

function nodeIsRelevant(node, adapter = refreshPageAdapter()) {
  const el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  if (!el) return false;
  return adapter.isRelevantElement(el);
}

function isMutationRelevant(mutationList, adapter = refreshPageAdapter()) {
  return mutationList.some((mutation) => {
    if (nodeIsRelevant(mutation.target, adapter)) return true;
    return [...mutation.addedNodes].some((node) => nodeIsRelevant(node, adapter));
  });
}

function observeCards() {
  const surface = getObservedSurface();
  if (!surface) {
    console.debug(`${getLogPrefix(console.debug.name)} - ${getLineNumber()} - Stopping observer. No surface.`, {surface});
    stopObservingCards();
    return false;
  }

  const surfaceChanged = (
    !cardObserver ||
    observedSurface?.adapter.name !== surface.adapter.name ||
    observedSurface?.root !== surface.root
  );

  if (!surfaceChanged) return true;

  stopObservingCards();
  observedSurface = surface;

  cardObserver = new MutationObserver((mutationList) => {
    const activeSurface = getObservedSurface();
    if (
      !activeSurface ||
      activeSurface.adapter.name !== observedSurface?.adapter.name ||
      activeSurface.root !== observedSurface?.root
    ) {
      return;
    }
    if (!isMutationRelevant(mutationList, activeSurface.adapter)) return;

    clearTimeout(cardObserverDebounceTimer);
    cardObserverDebounceTimer = setTimeout(async () => {
      try {
        await markPage();
      } catch (e) {
        console.error(`${getLogPrefix(console.error.name)} - ${getLineNumber()} - Failed to process card mutations:`, e);
      }
    }, 300);
  });

  console.debug(`${getLogPrefix(console.debug.name)} - ${getLineNumber()} - Starting observer.`, {surface});
  cardObserver.observe(surface.root, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['href', 'data-job-id', 'data-occludable-job-id']
  });

  cardObserverFallbackTimer = setTimeout(() => {
    const activeSurface = getObservedSurface();
    if (
      !activeSurface ||
      activeSurface.adapter.name !== observedSurface?.adapter.name ||
      activeSurface.root !== observedSurface?.root
    ) {
      return;
    }

    Promise.resolve()
      .then(() => {
        if (hasReadyJobCards(activeSurface.adapter)) {
          console.debug(`${getLogPrefix(console.debug.name)} - ${getLineNumber()} - fallback: cards present for adapter "${activeSurface.adapter.name}"`);
        }
        return markPage();
      })
      .catch((e) => console.error(`${getLogPrefix(console.error.name)} - ${getLineNumber()} - Failed to run fallback mark pass:`, e));
  }, 2000);

  return true;
}

function startOnJobsPage() {
  if (!observeCards()) return;

  refreshPageAdapter();
  Promise.resolve()
    .then(() => markPage())
    .then(() => recordCurrentJob())
    .catch((e) => console.error(`${getLogPrefix(console.error.name)} - ${getLineNumber()} - Failed to start jobs page handling:`, e));
}

function watchUrlChanges() {
  let lastJobId = getMatchedPageAdapter()?.getCurrentJobId?.() || null;
  let lastPath = location.pathname;
  let lastSearch = location.search;

  wrapHistoryMethod('pushState');
  wrapHistoryMethod('replaceState');

  window.addEventListener('popstate', onUrlChange);

  function wrapHistoryMethod(methodName) {
    const original = history[methodName].bind(history);

    history[methodName] = function (...args) {
      const result = original(...args);
      onUrlChange();
      return result;
    };
  }

  function onUrlChange() {
    try {
      const pathChanged = location.pathname !== lastPath;
      const searchChanged = location.search !== lastSearch;
      console.debug(`${getLogPrefix(console.debug.name)} - ${getLineNumber()} - ${onUrlChange.name} fired`, {location: location.href, pathChanged, searchChanged, lastPath, lastSearch});
      lastPath = location.pathname;
      lastSearch = location.search;

      if (pathChanged || searchChanged) {
        const matchedAdapter = getMatchedPageAdapter();
        console.debug(`${getLogPrefix(console.debug.name)} - ${getLineNumber()} - Matching Adapter: ${matchedAdapter?.name}`);
        const nextRoot = matchedAdapter?.getListRoot?.() || (matchedAdapter ? document.body : null);
        const surfaceChanged = (
          matchedAdapter?.name !== observedSurface?.adapter.name ||
          nextRoot !== observedSurface?.root
        );

        if (matchedAdapter && surfaceChanged) {
          console.debug(`${getLogPrefix(console.debug.name)} - ${getLineNumber()} - matchedAdapter and surface changed`, {matchedAdapter, surfaceChanged});
          refreshPageAdapter();
          startOnJobsPage();
        } else if (!matchedAdapter) {
          console.debug(`${getLogPrefix(console.debug.name)} - ${getLineNumber()} - No Matching Adapter.`);
          stopObservingCards();
        }
      }

      const activeAdapter = getMatchedPageAdapter();
      const jobId = activeAdapter?.getCurrentJobId?.() || null;
      if (jobId && jobId !== lastJobId) {
        lastJobId = jobId;
        recordCurrentJob().catch((e) => console.error(`${getLogPrefix(console.error.name)} - ${getLineNumber()} - Failed to record current job after URL change:`, e));
      } else if (!jobId) {
        lastJobId = null;
      }
    } catch (e) {
      console.error(`${getLogPrefix(console.error.name)} - ${getLineNumber()} - Failed to process URL change:`, e);
    }
  }
}

async function initialiseContentScript() {
  try {
    const options = await getOptions();
    console.debug(`${getLogPrefix(console.debug.name)} - ${getLineNumber()} - options`, options);
    applyStartupOptions(options);
  } catch (e) {
    console.error(`${getLogPrefix(console.error.name)} - ${getLineNumber()} - Failed to load initial options:`, e);
  }

  watchUrlChanges();
  if (getObservedSurface()) startOnJobsPage();
}

initialiseContentScript();
