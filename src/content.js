let enabled = true;

const JOB_LINK_RE = /\/jobs\/view\/(\d+)/;
const JOB_CARD_SELECTOR = ".job-card-container";
const JOB_LINK_SELECTOR = 'a[href*="/jobs/view/"]';
const JOB_CARD_WRAPPER_SELECTOR = "li[data-occludable-job-id]";
const JOB_DETAIL_PANEL_SELECTOR =
  ".job-details-jobs-unified-top-card__tertiary-description-container";
const AI_SEARCH_ROOT_SELECTOR =
  'main div[componentkey="SearchResultsMainContent"]';
const AI_SEARCH_CARD_SELECTOR =
  'div[role="button"][componentkey], a[componentkey][href*="currentJobId="]';
const PAGE_URL_CHANGE_EVENT = "ljm:urlchange";
const URL_WATCH_INTERVAL_MS = 250;

if (!document.documentElement.hasAttribute("data-ljm-page-debug")) {
  document.documentElement.setAttribute("data-ljm-page-debug", "1");
  const script = document.createElement("script");
  script.src = chrome.runtime.getURL("src/page-debug.js");
  script.onload = () => script.remove();
  (document.head || document.documentElement).appendChild(script);
}

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
  return /^\d+\s+(minute|hour|day|week|month)s?\s+ago$/i.test(text ?? "");
}

function parseRelativeAgeText(text) {
  const match = String(text ?? "").match(
    /^(\d+)\s+(minute|hour|day|week|month)s?\s+ago$/i,
  );
  if (!match) return null;

  return {
    value: Number.parseInt(match[1], 10),
    unit: match[2].toLowerCase(),
  };
}

function parseDateFromDatetime(datetime) {
  const match = String(datetime ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/);
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

function getMeaningfulTextEntries(card, selector = "p") {
  return [...card.querySelectorAll(selector)]
    .map((el) => ({ el, text: getTextContent(el) }))
    .filter(({ text }) => text && text !== "·");
}

function findRelativeAgeElement(root, selector = "span") {
  if (!root) return null;

  return (
    [...root.querySelectorAll(selector)].find((el) =>
      isRelativeAgeText(getTextContent(el)),
    ) || null
  );
}

function findClosestAncestorWithRelativeAge(el, stopEl) {
  let current = el?.parentElement || null;

  while (current && current !== stopEl) {
    if (
      current.matches?.("div, section, article") &&
      findRelativeAgeElement(current, "span, p, strong")
    ) {
      return current;
    }
    current = current.parentElement;
  }

  return stopEl && findRelativeAgeElement(stopEl, "span, p, strong")
    ? stopEl
    : null;
}

function extractJobId(anchor) {
  const match = anchor?.href?.match(JOB_LINK_RE);
  return match ? match[1] : null;
}

const defaultJobsAdapter = {
  name: "default-jobs",
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
    return getTextContent(
      card?.querySelector(".artdeco-entity-lockup__subtitle"),
    );
  },
  getCompanyElement(card) {
    return card?.querySelector(".artdeco-entity-lockup__subtitle") || null;
  },
  getTitleElement(card) {
    return card?.querySelector(".job-card-container__link") || null;
  },
  getStateElement(card) {
    return card?.querySelector(".job-card-container__footer-job-state") || null;
  },
  getAgeingElement(card) {
    return card?.querySelector("time[datetime]") || null;
  },
  getDetailPanelElement() {
    return document.querySelector(JOB_DETAIL_PANEL_SELECTOR);
  },
  getDetailPanelAgeElement(panel = this.getDetailPanelElement()) {
    return findRelativeAgeElement(panel, "span, strong");
  },
  getDetailPanelTitleElement() {
    return (
      document.querySelector(
        ".job-details-jobs-unified-top-card__job-title a",
      ) || null
    );
  },
  getLinkedInJobState(card) {
    const text = getTextContent(
      card?.querySelector(".job-card-container__footer-job-state"),
    );
    if (text === "Applied") return "applied";
    if (text === "Viewed") return "viewed";
    const footerItems = [
      ...(card?.querySelectorAll(".job-card-container__footer-item") || []),
    ];
    if (
      footerItems.some((el) =>
        /^(Promoted|Reposted)$/i.test(getTextContent(el)),
      )
    )
      return "promoted";
    return null;
  },
  getCurrentJobId() {
    return getSearchParam("currentJobId");
  },
  hasReadyJobCards() {
    return [...this.getJobCards()].some((card) => !!this.getJobId(card));
  },
  isRelevantElement(el) {
    if (!isElement(el)) return false;
    if (this.getCardFromElement(el)) return true;
    const detailPanel = this.getDetailPanelElement();
    if (detailPanel && (detailPanel === el || detailPanel.contains(el)))
      return true;

    return (
      el.matches(
        `${JOB_CARD_SELECTOR}, ${JOB_LINK_SELECTOR}, ${JOB_DETAIL_PANEL_SELECTOR}`,
      ) ||
      !!el.querySelector(
        `${JOB_CARD_SELECTOR}, ${JOB_LINK_SELECTOR}, ${JOB_DETAIL_PANEL_SELECTOR}`,
      )
    );
  },
};

const aiSearchAdapter = {
  ...defaultJobsAdapter,
  name: "ai-search-results",
  getListRoot() {
    return document.querySelector(AI_SEARCH_ROOT_SELECTOR);
  },
  getJobCards() {
    const root = this.getListRoot();
    return root
      ? [...root.querySelectorAll(AI_SEARCH_CARD_SELECTOR)].filter((card) => {
          if (card.getAttribute("data-ljm-job-id")) return true;
          if (card.matches('a[href*="currentJobId="]')) return true;
          if (card.matches(JOB_LINK_SELECTOR)) return true;
          if (card.querySelector('a[href*="currentJobId="]')) return true;
          if (card.querySelector(JOB_LINK_SELECTOR)) return true;
          return false;
        })
      : [];
  },
  getCardFromElement(el) {
    if (!isElement(el)) return null;

    const root = this.getListRoot();
    if (!root || !root.contains(el)) return null;

    const directCard = el.closest(AI_SEARCH_CARD_SELECTOR);
    if (
      directCard &&
      root.contains(directCard) &&
      this.getJobId(directCard)
    ) {
      return directCard;
    }

    let current = el;
    while (current && current !== root) {
      if (current.parentElement === root && current.matches("div, a")) {
        const candidate = current.matches(AI_SEARCH_CARD_SELECTOR)
          ? current
          : current.querySelector(AI_SEARCH_CARD_SELECTOR);
        return candidate && this.getJobId(candidate) ? candidate : null;
      }
      current = current.parentElement;
    }

    return null;
  },
  getJobId(card) {
    const annotatedJobId = card?.getAttribute?.("data-ljm-job-id");
    if (annotatedJobId) {
      return annotatedJobId;
    }
    if (card?.matches('a[href*="currentJobId="]')) {
      return extractCurrentJobIdFromHref(card.getAttribute("href"));
    }
    if (card?.matches(JOB_LINK_SELECTOR)) {
      return extractJobId(card);
    }

    const cardLink = card?.querySelector('a[href*="currentJobId="]');
    if (cardLink) {
      return extractCurrentJobIdFromHref(cardLink.getAttribute("href"));
    }

    const jobViewLink = card?.querySelector(JOB_LINK_SELECTOR);
    if (jobViewLink) {
      return extractJobId(jobViewLink);
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
    return (
      getMeaningfulTextEntries(card).find(
        ({ text }) => text === "Applied" || text === "Viewed",
      )?.el || null
    );
  },
  getAgeingElement(card) {
    return findRelativeAgeElement(card);
  },
  getDetailPanelElement() {
    return (
      [...document.querySelectorAll('div[role="main"]')].find(
        (panel) => !!panel.querySelector('a[href*="/jobs/view/"]'),
      ) || null
    );
  },
  getDetailPanelAgeElement(panel = this.getDetailPanelElement()) {
    if (!panel) return null;

    const titleLink = panel.querySelector('a[href*="/jobs/view/"]');
    if (!titleLink) return null;

    const topSummaryBlock = findClosestAncestorWithRelativeAge(
      titleLink,
      panel,
    );
    if (!topSummaryBlock) return null;

    return findRelativeAgeElement(topSummaryBlock, "span, p, strong");
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
    if (texts.includes("Applied")) return "applied";
    if (texts.includes("Viewed")) return "viewed";
    if (texts.some((t) => /^(Promoted|Reposted)$/i.test(t))) return "promoted";
    return null;
  },
  hasReadyJobCards() {
    return this.getJobCards().length > 0;
  },
  isRelevantElement(el) {
    if (!isElement(el)) return false;
    const root = this.getListRoot();
    return !!(root && root.contains(el));
  },
};

const companySearchAdapter = {
  ...defaultJobsAdapter,
  name: "company-search",
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
      el.matches(
        `${JOB_CARD_SELECTOR}, ${JOB_LINK_SELECTOR}, ${JOB_CARD_WRAPPER_SELECTOR}`,
      ) ||
      !!el.querySelector(
        `${JOB_CARD_SELECTOR}, ${JOB_LINK_SELECTOR}, ${JOB_CARD_WRAPPER_SELECTOR}`,
      )
    );
  },
};

function extractCurrentJobIdFromHref(href) {
  if (!href) {
    console.debug(
      `${getLogPrefix(console.debug.name)} - ${getLineNumber()} - ${extractCurrentJobIdFromHref.name}'s param "href" is missing or empty`,
      href,
    );
    return null;
  }

  try {
    return new URL(href, location.origin).searchParams.get("currentJobId");
  } catch (_e) {
    return null;
  }
}

let currentPageAdapter = defaultJobsAdapter;

function selectPageAdapter() {
  const aiSearchRoot = document.querySelector(AI_SEARCH_ROOT_SELECTOR);
  const classicJobCard = document.querySelector(JOB_CARD_SELECTOR);

  switch (location.pathname) {
    case "/jobs/search-results":
    case "/jobs/search-results/":
      return aiSearchRoot || !classicJobCard
        ? aiSearchAdapter
        : defaultJobsAdapter;
    case "/jobs/search/":
      if (aiSearchRoot) return aiSearchAdapter;
      if (classicJobCard) {
        return getSearchParam("origin") === "COMPANY_PAGE_JOBS_CLUSTER_EXPANSION"
          ? companySearchAdapter
          : defaultJobsAdapter;
      }
      return getSearchParam("origin") === "COMPANY_PAGE_JOBS_CLUSTER_EXPANSION"
        ? companySearchAdapter
        : defaultJobsAdapter;
    case "/preload":
    case "/preload/":
      if (aiSearchRoot) return aiSearchAdapter;
      if (classicJobCard) return defaultJobsAdapter;
      return null;
    default:
      return location.pathname.startsWith("/jobs/") ? defaultJobsAdapter : null;
  }
}

function findCardFromNodes(nodes) {
  const adapter = currentPageAdapter;
  if (!adapter) return null;

  for (const node of nodes) {
    if (!isElement(node)) continue;
    const card = adapter.getCardFromElement(node);
    if (card) return card;
  }

  return null;
}

function getContextCard(action) {
  if (lastRightClickedCard) return lastRightClickedCard;
  console.debug(
    `${getLogPrefix(console.debug.name)} - ${getLineNumber()} - ${action}: no job card captured from context menu`,
  );
  return null;
}

function addMessageAction(action, handler) {
  chrome.runtime.onMessage.addListener((message) => {
    console.debug(
      `${getLogPrefix(console.debug.name)} - ${getLineNumber()} - Received message`,
      { action, message },
    );
    if (message.action !== action) return;

    Promise.resolve()
      .then(() => handler(message))
      .catch((e) =>
        console.error(
          `${getLogPrefix(console.error.name)} - ${getLineNumber()} - ${action} failed:`,
          e,
        ),
      );
  });
}

function addMessageRequest(action, handler) {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    console.debug(
      `${getLogPrefix(console.debug.name)} - ${getLineNumber()} - Received message`,
      { action, message },
    );
    if (message.action !== action) return;

    Promise.resolve()
      .then(() => handler(message))
      .then((response) => sendResponse(response))
      .catch((e) => {
        console.error(
          `${getLogPrefix(console.error.name)} - ${getLineNumber()} - ${action} failed:`,
          e,
        );
        sendResponse({ ok: false, error: e?.message || String(e) });
      });

    return true;
  });
}

function clearCardMarks(card, adapter = currentPageAdapter) {
  card.classList.remove("ljm-viewed", "ljm-applied", "ljm-blacklisted");
  const companyElement = adapter.getCompanyElement?.(card);
  const titleElement = adapter.getTitleElement?.(card);
  const stateElement = adapter.getStateElement?.(card);
  const ageingElement = adapter.getAgeingElement?.(card);
  companyElement?.classList.remove("ljm-blacklisted-company");
  titleElement?.classList.remove("ljm-applied-title", "ljm-unwanted-title");
  stateElement?.classList.remove("ljm-applied-state");
  ageingElement?.classList.remove("ljm-ageing");
}

function applyMark(
  card,
  jobState,
  isBlacklisted,
  isAgeing,
  isUnwantedTitle,
  timestamp,
  adapter = currentPageAdapter,
) {
  clearCardMarks(card, adapter);
  const companyElement = adapter.getCompanyElement?.(card);
  const titleElement = adapter.getTitleElement?.(card);
  const stateElement = adapter.getStateElement?.(card);
  const ageingElement = adapter.getAgeingElement?.(card);

  if (isBlacklisted) card.classList.add("ljm-blacklisted");
  if (isBlacklisted && companyElement)
    companyElement.classList.add("ljm-blacklisted-company");
  if (jobState === "applied") {
    card.classList.add("ljm-applied");
    titleElement?.classList.add("ljm-applied-title");
    stateElement?.classList.add("ljm-applied-state");
  } else if (jobState === "viewed") {
    card.classList.add("ljm-viewed");
    if (timestamp) card.dataset.ljmViewedAt = new Date(timestamp).toLocaleString();
  }

  if (isAgeing && ageingElement) ageingElement.classList.add("ljm-ageing");
  if (isUnwantedTitle && titleElement)
    titleElement.classList.add("ljm-unwanted-title");
}

function clearAllCardMarks() {
  const adapter = currentPageAdapter;
  if (!adapter) return;

  adapter.getJobCards().forEach((card) => clearCardMarks(card, adapter));
}

function shouldPromoteState(currentState, nextState) {
  return (TYPE_RANK[nextState] ?? 0) > (TYPE_RANK[currentState] ?? 0);
}

function applyColourSettings(colours) {
  let el = document.getElementById("ljm-colours");
  if (!el) {
    el = document.createElement("style");
    el.id = "ljm-colours";
    document.head.appendChild(el);
  }
  el.textContent = `:root {
    --ljm-viewed-opacity: ${colours.viewed};
    --ljm-applied-colour: ${colours.applied};
    --ljm-blacklisted-colour: ${colours.blacklisted};
    --ljm-blacklisted-bg: ${hexToRgba(colours.blacklisted, 0.15)};
  }`;
  console.debug(
    `${getLogPrefix(console.debug.name)} - ${getLineNumber()} - colours applied`,
    colours,
  );
}

function applyStartupOptions(options) {
  if (options?.colours) applyColourSettings(options.colours);
  if (typeof setDebugFlag === "function") {
    setDebugFlag(options?.debug ?? false, { silent: true });
  }
}

function parseUnwantedTitleWords(str) {
  if (!str) return [];
  return str
    .split(",")
    .map((w) => w.trim())
    .filter(Boolean);
}

function titleMatchesUnwanted(titleText, words) {
  if (!titleText || !words.length) return false;
  const lower = titleText.toLowerCase().trim();
  return words.some((w) => {
    if (w.startsWith('=')) return lower === w.slice(1).toLowerCase().trim();
    return lower.includes(w.toLowerCase());
  });
}

function shouldMarkAgeing(card, adapter, ageingLimitDays) {
  if (!card) {
    console.debug(
      `${getLogPrefix(console.debug.name)} - ${getLineNumber()} - no card`,
    );
    return false;
  }
  if (!adapter) {
    console.debug(
      `${getLogPrefix(console.debug.name)} - ${getLineNumber()} - no adapter`,
    );
    return false;
  }
  if (ageingLimitDays === null) return false;

  const ageingElement = adapter.getAgeingElement?.(card);
  if (!ageingElement) return false;
  const datetime = ageingElement.getAttribute("datetime");
  if (!datetime) {
    return shouldMarkDetailPanelAgeing(
      getTextContent(ageingElement),
      ageingLimitDays,
    );
  }

  const ageInDays = getAgeInDays(datetime);
  return ageInDays !== null && ageInDays > ageingLimitDays;
}

function shouldMarkDetailPanelAgeing(ageText, ageingLimitDays) {
  if (ageingLimitDays === null) return false;

  const age = parseRelativeAgeText(ageText);
  if (!age) return false;

  if (age.unit === "minute" || age.unit === "hour") return false;
  if (age.unit === "day") return age.value > ageingLimitDays;
  return true;
}

function clearDetailPanelAging() {
  document.querySelectorAll(".ljm-detail-ageing").forEach((el) => {
    el.classList.remove("ljm-detail-ageing");
  });
}

async function markDetailPanelAging() {
  clearDetailPanelAging();
  if (!enabled) return;

  const adapter = currentPageAdapter;
  const panel = adapter.getDetailPanelElement?.();
  if (!panel) return;

  const options = await getOptions();
  const ageingLimitDays = getValidAgeingLimitDays(options);
  if (ageingLimitDays === null) return;

  const ageElement = adapter.getDetailPanelAgeElement?.(panel);
  if (!ageElement) return;

  if (
    shouldMarkDetailPanelAgeing(getTextContent(ageElement), ageingLimitDays)
  ) {
    ageElement.classList.add("ljm-detail-ageing");
  }
}

function clearDetailPanelUnwantedTitle() {
  document.querySelectorAll(".ljm-detail-unwanted-title").forEach((el) => {
    el.classList.remove("ljm-detail-unwanted-title");
  });
}

async function markDetailPanelUnwantedTitle() {
  clearDetailPanelUnwantedTitle();
  if (!enabled) return;

  const adapter = currentPageAdapter;
  const titleEl = adapter.getDetailPanelTitleElement?.();
  if (!titleEl) return;

  const options = await getOptions();
  const words = parseUnwantedTitleWords(options.unwantedTitleWords);
  if (!words.length) return;

  if (titleMatchesUnwanted(getTextContent(titleEl), words)) {
    titleEl.classList.add("ljm-detail-unwanted-title");
  }
}

async function markPage() {
  console.debug(
    `${getLogPrefix(console.debug.name)} - ${getLineNumber()} - ${markPage.name} fired.`,
  );
  if (!currentPageAdapter) return;

  await Promise.all([
    markCards(),
    markDetailPanelAging(),
    markDetailPanelUnwantedTitle(),
  ]);
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "sync" || !changes[SETTINGS_KEY]) return;
  console.debug(
    `${getLogPrefix(console.debug.name)} - ${getLineNumber()} - Options changed.`,
    { changes, areaName },
  );

  Promise.resolve()
    .then(() => {
      const newOptions = changes[SETTINGS_KEY].newValue;
      if (newOptions?.colours) applyColourSettings(newOptions.colours);
      return markPage();
    })
    .catch((e) =>
      console.error(
        `${getLogPrefix(console.error.name)} - ${getLineNumber()} - Failed to apply updated settings:`,
        e,
      ),
    );
});

async function markCards() {
  if (!enabled) {
    console.debug(
      `${getLogPrefix(console.debug.name)} - ${getLineNumber()} - Temporarily disabled.`,
    );
    return;
  }

  const adapter = currentPageAdapter;
  const jobCards = [...adapter.getJobCards()];
  const aiRootPresent = !!document.querySelector(AI_SEARCH_ROOT_SELECTOR);
  const classicCards = document.querySelectorAll(JOB_CARD_SELECTOR).length;
  console.debug(
    `${getLogPrefix(console.debug.name)} - ${getLineNumber()} - markCards() with adapter "${adapter.name}"`,
    {
      href: location.href,
      sequence:
        document.documentElement.getAttribute("data-ljm-url-change-count") ||
        null,
      adapter: adapter.name,
      adapterCards: jobCards.length,
      hasReadyJobCards: adapter.hasReadyJobCards?.() ?? null,
      aiRootPresent,
      classicCards,
      domSurface: aiRootPresent
        ? "ai-search-results"
        : classicCards
          ? "default-jobs"
          : null,
    },
  );

  const [allJobs, blacklist, options] = await Promise.all([
    dbGetAllJobs(),
    blGetList(),
    getOptions(),
  ]);
  const ageingLimitDays = getValidAgeingLimitDays(options);
  const unwantedWords = parseUnwantedTitleWords(options.unwantedTitleWords);
  const jobMap = {};
  allJobs.forEach((j) => {
    jobMap[j.id] = j;
  });

  const saves = [];
  const markStats = {
    totalCards: jobCards.length,
    noJobId: 0,
    noCompany: 0,
    noJobState: 0,
    skippedEmpty: 0,
    viewed: 0,
    applied: 0,
    blacklisted: 0,
    ageing: 0,
    unwantedTitle: 0,
  };

  jobCards.forEach((card) => {
    const jobId = adapter.getJobId(card);
    const company = adapter.getCompanyName(card);
    const existing = jobId ? jobMap[jobId] : null;
    const linkedInState = adapter.getLinkedInJobState(card);
    const effectiveLinkedInState =
      options.treatPromotedAsViewed && linkedInState === "promoted"
        ? "viewed"
        : linkedInState;
    const isAgeing = shouldMarkAgeing(card, adapter, ageingLimitDays);
    const isUnwantedTitle = titleMatchesUnwanted(
      getTextContent(adapter.getTitleElement?.(card)),
      unwantedWords,
    );

    if (
      jobId &&
      effectiveLinkedInState &&
      shouldPromoteState(existing?.type, effectiveLinkedInState)
    ) {
      saves.push(
        dbSaveJob(jobId, effectiveLinkedInState).then(() => {
          jobMap[jobId] = { id: jobId, type: effectiveLinkedInState };
        }),
      );
    }

    const isBlacklisted = !!(company && blacklist.includes(company));
    const jobState = shouldPromoteState(existing?.type, effectiveLinkedInState)
      ? effectiveLinkedInState
      : (existing?.type ?? effectiveLinkedInState);

    if (!jobId) markStats.noJobId += 1;
    if (!company) markStats.noCompany += 1;
    if (!jobState) markStats.noJobState += 1;

    if (!jobId && !company && !jobState && !isAgeing && !isUnwantedTitle) {
      markStats.skippedEmpty += 1;
      return;
    }

    if (jobState === "viewed") markStats.viewed += 1;
    if (jobState === "applied") markStats.applied += 1;
    if (isBlacklisted) markStats.blacklisted += 1;
    if (isAgeing) markStats.ageing += 1;
    if (isUnwantedTitle) markStats.unwantedTitle += 1;
    applyMark(
      card,
      jobState,
      isBlacklisted,
      isAgeing,
      isUnwantedTitle,
      existing?.timestamp ?? null,
      adapter,
    );
  });

  await Promise.all(saves);
  console.debug(
    `${getLogPrefix(console.debug.name)} - ${getLineNumber()} - markCards() summary`,
    {
      href: location.href,
      sequence:
        document.documentElement.getAttribute("data-ljm-url-change-count") ||
        null,
      adapter: adapter.name,
      ...markStats,
      savesQueued: saves.length,
    },
  );
}

async function recordCurrentJob() {
  const jobId = currentPageAdapter.getCurrentJobId();
  if (!jobId) return;

  const existing = await dbGetJob(jobId);
  if (!existing) {
    console.debug(
      `${getLogPrefix(console.debug.name)} - ${getLineNumber()} - recording viewed: ${jobId}`,
    );
    await dbSaveJob(jobId, "viewed");
    await markPage();
  }
}

let lastRightClickedCard = null;

document.addEventListener("contextmenu", (e) => {
  const path = typeof e.composedPath === "function" ? e.composedPath() : [e.target];
  lastRightClickedCard = findCardFromNodes(path);
});

addMessageAction("blacklist-toggle", async () => {
  const adapter = currentPageAdapter;
  const card = getContextCard("blacklist-toggle");
  if (!card) return;

  const company = adapter.getCompanyName(card);
  if (!company) {
    console.warn(
      `${getLogPrefix(console.warn.name)} - ${getLineNumber()} - blacklist-toggle: company name not found for selected card`,
    );
    return;
  }

  const listed = await blIncludes(company);
  await (listed ? blRemove(company) : blAdd(company));
  await markPage();
});

addMessageAction("applied-mark", async () => {
  const card = getContextCard("applied-mark");
  if (!card) return;

  const jobId = currentPageAdapter.getJobId(card);
  if (!jobId) {
    console.warn(
      `${getLogPrefix(console.warn.name)} - ${getLineNumber()} - applied-mark: job ID not found for selected card`,
    );
    return;
  }

  console.debug(
    `${getLogPrefix(console.debug.name)} - ${getLineNumber()} - marking applied: ${jobId}`,
  );
  await dbSaveJob(jobId, "applied");
  await markPage();
});

addMessageAction("ignore-title", async () => {
  const adapter = currentPageAdapter;
  const card = getContextCard("ignore-title");
  if (!card) return;

  const titleText = getTextContent(adapter.getTitleElement?.(card));
  if (!titleText) {
    console.warn(
      `${getLogPrefix(console.warn.name)} - ${getLineNumber()} - ignore-title: title not found for selected card`,
    );
    return;
  }

  const options = await getOptions();
  const current = options.unwantedTitleWords?.trim() || '';
  const entry = `=${titleText.trim()}`;
  await setOptions({ ...options, unwantedTitleWords: current ? `${current}, ${entry}` : entry });
  await markPage();
});

addMessageAction("ignore-selection", async (message) => {
  const text = message.text?.trim();
  if (!text) return;

  const options = await getOptions();
  const current = options.unwantedTitleWords?.trim() || '';
  await setOptions({ ...options, unwantedTitleWords: current ? `${current}, ${text}` : text });
  await markPage();
});

addMessageAction("marker-toggle", async () => {
  enabled = !enabled;

  if (!enabled) {
    clearAllCardMarks();
    clearDetailPanelAging();
  } else {
    await markPage();
  }
});

addMessageRequest("get-all-jobs", async () => {
  const jobs = await dbGetAllJobs();
  return { jobs };
});

addMessageRequest("import-jobs", async (message) => {
  const jobs = message.jobs ?? [];
  await Promise.all(jobs.map((j) => dbRestoreJob(j.id, j.type, j.timestamp)));
  return { ok: true };
});

let cardObserver = null;
let cardObserverDebounceTimer = null;

function nodeIsRelevant(node, adapter = currentPageAdapter) {
  const el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  if (!el) return false;
  return adapter.isRelevantElement(el);
}

function isMutationRelevant(mutationList, adapter = currentPageAdapter) {
  return mutationList.some((mutation) => {
    if (nodeIsRelevant(mutation.target, adapter)) return true;
    return [...mutation.addedNodes].some((node) =>
      nodeIsRelevant(node, adapter),
    );
  });
}

let urlWatcherAttached = false;

function watchUrlChanges() {
  if (urlWatcherAttached) return;
  urlWatcherAttached = true;

  console.debug(
    `${getLogPrefix(console.debug.name)} - ${getLineNumber()} - loadding "${location.pathname}"`,
  );
  let urlChangeCount = 0;
  let lastHref = location.href;
  let lastJobId = currentPageAdapter?.getCurrentJobId?.() || null;
  let lastPath = location.pathname;
  let lastSearch = location.search;
  let lastHash = location.hash;

  document.documentElement.setAttribute("data-ljm-url-change-count", "0");
  document.documentElement.setAttribute("data-ljm-url-change-source", "initial");
  document.documentElement.setAttribute("data-ljm-last-observed-href", lastHref);

  wrapHistoryMethod("pushState");
  wrapHistoryMethod("replaceState");

  document.addEventListener(PAGE_URL_CHANGE_EVENT, (event) => {
    onUrlChange(`page.${event.detail?.source ?? "unknown"}`);
  });
  window.addEventListener("popstate", () => onUrlChange("popstate"));
  window.addEventListener("hashchange", () => onUrlChange("hashchange"));

  setInterval(() => {
    if (location.href !== lastHref) {
      onUrlChange("interval");
    }
  }, URL_WATCH_INTERVAL_MS);

  function wrapHistoryMethod(methodName) {
    const original = history[methodName].bind(history);

    history[methodName] = function (...args) {
      const result = original(...args);
      onUrlChange(`history.${methodName}`);
      return result;
    };
  }

  function onUrlChange(source = "unknown") {
    try {
      const hrefChanged = location.href !== lastHref;
      const pathChanged = location.pathname !== lastPath;
      const searchChanged = location.search !== lastSearch;
      const hashChanged = location.hash !== lastHash;
      if (!hrefChanged && !pathChanged && !searchChanged && !hashChanged)
        return;

      urlChangeCount += 1;
      console.debug(
        `${getLogPrefix(console.debug.name)} - ${getLineNumber()} - ${onUrlChange.name} fired`,
        {
          sequence: urlChangeCount,
          source,
          location: location.href,
          hrefChanged,
          pathChanged,
          searchChanged,
          hashChanged,
          lastHref,
          lastPath,
          lastSearch,
          lastHash,
        },
      );
      document.documentElement.setAttribute(
        "data-ljm-url-change-count",
        String(urlChangeCount),
      );
      document.documentElement.setAttribute("data-ljm-url-change-source", source);
      document.documentElement.setAttribute(
        "data-ljm-last-observed-href",
        location.href,
      );
      lastHref = location.href;
      lastPath = location.pathname;
      lastSearch = location.search;
      lastHash = location.hash;

      if (pathChanged) {
        currentPageAdapter = selectPageAdapter();
        const aiRootPresent = !!document.querySelector(AI_SEARCH_ROOT_SELECTOR);
        const classicCards = document.querySelectorAll(JOB_CARD_SELECTOR).length;
        console.debug(
          `${getLogPrefix(console.debug.name)} - ${getLineNumber()} - Adapter selected after URL path change`,
          {
            sequence: urlChangeCount,
            source,
            href: location.href,
            adapter: currentPageAdapter?.name ?? null,
            aiRootPresent,
            classicCards,
            domSurface: aiRootPresent
              ? "ai-search-results"
              : classicCards
                ? "default-jobs"
                : null,
          },
        );
        if (currentPageAdapter) {
          if (!cardObserver) {
            attachBodyObserver();
          } else {
            markPage().catch((e) =>
              console.error(
                `${getLogPrefix(console.error.name)} - ${getLineNumber()} - Failed to mark page after path change:`,
                e,
              ),
            );
          }
          retry(currentPageAdapter.name);
        }
        lastJobId = null;
        return;
      }

      const activeAdapter = currentPageAdapter;
      const jobId = activeAdapter?.getCurrentJobId?.() || null;
      if (jobId && jobId !== lastJobId) {
        lastJobId = jobId;
        recordCurrentJob().catch((e) =>
          console.error(
            `${getLogPrefix(console.error.name)} - ${getLineNumber()} - Failed to record current job after URL change:`,
            e,
          ),
        );
      } else if (!jobId) {
        lastJobId = null;
      }
    } catch (e) {
      console.error(
        `${getLogPrefix(console.error.name)} - ${getLineNumber()} - Failed to process URL change:`,
        e,
      );
    }
  }
}

let bodyObserverAttached = false;

function attachBodyObserver() {
  console.debug(
    `${getLogPrefix(console.debug.name)} - ${getLineNumber()} - ${location.pathname}`,
  );
  if (!document.body) {
    console.debug(
      `${getLogPrefix(console.debug.name)} - ${getLineNumber()} - document.body not ready, retrying in 250ms`,
    );
    setTimeout(attachBodyObserver, 250);
    return;
  }
  if (bodyObserverAttached) return;
  bodyObserverAttached = true;
  currentPageAdapter = selectPageAdapter();

  let observedPath = location.pathname;

  cardObserver = new MutationObserver((mutationList) => {
    if (location.pathname !== observedPath) {
      observedPath = location.pathname;
      currentPageAdapter = selectPageAdapter();
      if (currentPageAdapter) {
        clearTimeout(cardObserverDebounceTimer);
        cardObserverDebounceTimer = setTimeout(() => {
          markPage().catch((e) =>
            console.error(
              `${getLogPrefix(console.error.name)} - ${getLineNumber()} - Failed to mark page after path change:`,
              e,
            ),
          );
        }, 300);
      }
      return;
    }

    const selectedPageAdapter = selectPageAdapter();
    if (selectedPageAdapter !== currentPageAdapter) {
      const aiRootPresent = !!document.querySelector(AI_SEARCH_ROOT_SELECTOR);
      const classicCards = document.querySelectorAll(JOB_CARD_SELECTOR).length;
      console.debug(
        `${getLogPrefix(console.debug.name)} - ${getLineNumber()} - Adapter changed after DOM mutation`,
        {
          href: location.href,
          previousAdapter: currentPageAdapter?.name ?? null,
          nextAdapter: selectedPageAdapter?.name ?? null,
          aiRootPresent,
          classicCards,
          domSurface: aiRootPresent
            ? "ai-search-results"
            : classicCards
              ? "default-jobs"
              : null,
          sequence:
            document.documentElement.getAttribute("data-ljm-url-change-count") ||
            null,
        },
      );
      currentPageAdapter = selectedPageAdapter;
      if (currentPageAdapter) {
        clearTimeout(cardObserverDebounceTimer);
        cardObserverDebounceTimer = setTimeout(() => {
          markPage().catch((e) =>
            console.error(
              `${getLogPrefix(console.error.name)} - ${getLineNumber()} - Failed to mark page after adapter change:`,
              e,
            ),
          );
        }, 300);
        retry(currentPageAdapter.name);
      }
      return;
    }

    if (!currentPageAdapter) return;
    if (!isMutationRelevant(mutationList, currentPageAdapter)) return;
    clearTimeout(cardObserverDebounceTimer);
    cardObserverDebounceTimer = setTimeout(() => {
      markPage().catch((e) =>
        console.error(
          `${getLogPrefix(console.error.name)} - ${getLineNumber()} - Failed to process mutations:`,
          e,
        ),
      );
    }, 300);
  });

  console.debug(
    `${getLogPrefix(console.debug.name)} - ${getLineNumber()} - Attaching observer to document.documentElement, adapter="${currentPageAdapter?.name ?? 'none'}"`,
  );
  // cardObserver.observe(document.body, { // document.body is replaced on SPA navigation — observer goes silent
  cardObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["href", "data-job-id", "data-occludable-job-id"],
  });

  if (currentPageAdapter) {
    markPage().catch((e) =>
      console.error(
        `${getLogPrefix(console.error.name)} - ${getLineNumber()} - Initial mark pass failed:`,
        e,
      ),
    );
    retry(currentPageAdapter.name);
  }
}

async function initialiseContentScript() {
  try {
    const options = await getOptions();
    console.debug(
      `${getLogPrefix(console.debug.name)} - ${getLineNumber()} - options`,
      options,
    );
    applyStartupOptions(options);
  } catch (e) {
    console.error(
      `${getLogPrefix(console.error.name)} - ${getLineNumber()} - Failed to load initial options:`,
      e,
    );
  }

  watchUrlChanges();
  attachBodyObserver();
}

function retry(adapterName = currentPageAdapter?.name, p = 0) {
  if (!currentPageAdapter) return;
  if (currentPageAdapter.name !== adapterName) return;
  if (p > 5) return;
  markPage().catch((e) =>
    console.error(
      `${getLogPrefix(console.error.name)} - ${getLineNumber()} - Retry mark pass failed:`,
      e,
    ),
  );
  if (currentPageAdapter.hasReadyJobCards?.()) return;
  setTimeout(() => retry(adapterName, p + 1), 1000);
}

window.addEventListener(
  "load",
  () => {
    console.debug(
      `${getLogPrefix(console.debug.name)} - ${getLineNumber()} - loadding "${location.pathname}"`,
    );
    // if (!location.pathname.includes('/jobs/')) return;
    currentPageAdapter = selectPageAdapter();
    console.debug(
      `${getLogPrefix(console.debug.name)} - ${getLineNumber()} - window.load: pathname="${location.pathname}" search="${location.search}" adapter="${currentPageAdapter?.name ?? "None"}"`,
    );
    initialiseContentScript().catch((e) =>
      console.error(
        `${getLogPrefix(console.error.name)} - ${getLineNumber()} - Extension failed to start:`,
        e,
      ),
    );
    if (!currentPageAdapter) return;
    retry(currentPageAdapter.name);
  },
  { once: true },
);

document.addEventListener(
  "click",
  (event) => {
    console.debug(
      `${getLogPrefix(console.debug.name)} - ${getLineNumber()} - loadding "${location.pathname}"`,
    );
    const path =
      typeof event.composedPath === "function" ? event.composedPath() : [];
    const clickedLink =
      path.find((node) => node instanceof HTMLAnchorElement) ||
      event.target?.closest?.("a") ||
      null;

    console.debug(
      `${getLogPrefix(console.debug.name)} - ${getLineNumber()} - click`,
      {
        location: location.pathname,
        targetTag: event.target?.tagName ?? null,
        targetText: event.target?.textContent?.trim()?.slice(0, 160) ?? null,
        clickedLinkHref: clickedLink?.href ?? null,
        clickedLinkText:
          clickedLink?.textContent?.trim()?.slice(0, 160) ?? null,
      },
    );
  },
  true,
);
