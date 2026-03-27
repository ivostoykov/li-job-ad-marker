let enabled = true;

const JOB_LINK_RE = /\/jobs\/view\/(\d+)/;

function extractJobId(anchor) {
  const match = anchor.href.match(JOB_LINK_RE);
  return match ? match[1] : null;
}

function getCardCompanyName(card) {
  const el = card.querySelector('.artdeco-entity-lockup__subtitle');
  return el ? el.textContent.trim() : null;
}

function applyMark(card, jobState, isBlacklisted) {
  card.classList.remove('ljm-viewed', 'ljm-applied', 'ljm-blacklisted');
  if (isBlacklisted) card.classList.add('ljm-blacklisted');
  if (jobState === 'applied') card.classList.add('ljm-applied');
  else if (jobState === 'viewed') card.classList.add('ljm-viewed');
}

function getJobCards() {
  return document.querySelectorAll('.job-card-container');
}

function getCurrentJobId() {
  const params = new URLSearchParams(location.search);
  return params.get('currentJobId') || null;
}

function isLinkedInViewed(card) {
  const el = card.querySelector('.job-card-container__footer-job-state');
  return el?.textContent?.trim() === 'Viewed';
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
  console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - colours applied`, colours);
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'sync' && changes[SETTINGS_KEY]) {
    const newOptions = changes[SETTINGS_KEY].newValue;
    if (newOptions?.colours) applyColourSettings(newOptions.colours);
  }
});

async function markCards() {
  if (!enabled) return;
  console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - markCards()`);
  const [allJobs, blacklist] = await Promise.all([dbGetAllJobs(), blGetList()]);
  const jobMap = {};
  allJobs.forEach((j) => { jobMap[j.id] = j; });

  const saves = [];

  getJobCards().forEach((card) => {
    const anchor = card.querySelector('a[href*="/jobs/view/"]');
    if (!anchor) return;

    const jobId = extractJobId(anchor);
    const company = getCardCompanyName(card);
    const existing = jobMap[jobId];

    if (!existing && isLinkedInViewed(card)) {
      saves.push(dbSaveJob(jobId, 'viewed').then(() => { jobMap[jobId] = { id: jobId, type: 'viewed' }; }));
    }

    const isBlacklisted = !!(company && blacklist.includes(company));
    const jobState = existing ? existing.type : (isLinkedInViewed(card) ? 'viewed' : null);
    applyMark(card, jobState, isBlacklisted);
  });

  await Promise.all(saves);
}

async function recordCurrentJob() {
  const jobId = getCurrentJobId();
  if (!jobId) return;

  const existing = await dbGetJob(jobId);
  if (!existing) {
    console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - recording viewed: ${jobId}`);
    await dbSaveJob(jobId, 'viewed');
    await markCards();
  }
}

let lastRightClickedCard = null;

document.addEventListener('contextmenu', (e) => {
  lastRightClickedCard = e.target.closest('.job-card-container');
});

chrome.runtime.onMessage.addListener((message) => {
  if (message.action !== 'blacklist-toggle') return;

  const card = lastRightClickedCard;
  if (!card) return;

  const company = getCardCompanyName(card);
  if (!company) return;

  blIncludes(company).then((listed) => {
    return listed ? blRemove(company) : blAdd(company);
  }).then(() => markCards());
});

chrome.runtime.onMessage.addListener((message) => {
  if (message.action !== 'applied-mark') return;

  const card = lastRightClickedCard;
  if (!card) return;

  const anchor = card.querySelector('a[href*="/jobs/view/"]');
  if (!anchor) return;
  const jobId = extractJobId(anchor);
  if (!jobId) return;

  console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - marking applied: ${jobId}`);
  dbSaveJob(jobId, 'applied').then(() => markCards());
});

chrome.runtime.onMessage.addListener((message) => {
  if (message.action !== 'marker-toggle') return;

  enabled = !enabled;

  if (!enabled) {
    getJobCards().forEach((card) => {
      card.classList.remove('ljm-viewed', 'ljm-applied', 'ljm-blacklisted');
    });
  } else {
    markCards();
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action !== 'get-all-jobs') return;
  dbGetAllJobs().then((jobs) => sendResponse({ jobs }));
  return true;
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action !== 'import-jobs') return;
  const jobs = message.jobs ?? [];
  Promise.all(jobs.map((j) => dbRestoreJob(j.id, j.type, j.timestamp)))
    .then(() => sendResponse({ ok: true }))
    .catch((e) => sendResponse({ ok: false, error: e.message }));
  return true;
});

let cardObserver = null;

function hasReadyJobCards() {
  return !!document.querySelector('.job-card-container a[href*="/jobs/view/"]');
}

function nodeIsRelevant(node) {
  const el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  if (!el) return false;

  if (el.closest('.job-card-container')) return true;

  return (
    el.matches('.job-card-container, a[href*="/jobs/view/"]') ||
    !!el.querySelector('.job-card-container, a[href*="/jobs/view/"]')
  );
}

function isMutationRelevant(mutationList) {
  return mutationList.some((mutation) => {
    if (nodeIsRelevant(mutation.target)) return true;
    return [...mutation.addedNodes].some(nodeIsRelevant);
  });
}

function observeCards(onReady) {
  if (cardObserver) cardObserver.disconnect();

  let debounceTimer = null;
  let ready = hasReadyJobCards();

  if (ready) onReady();

  cardObserver = new MutationObserver((mutationList) => {
    if (!isMutationRelevant(mutationList)) return;

    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      markCards();

      if (!ready && hasReadyJobCards()) {
        ready = true;
        console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - cards ready`);
        onReady();
      }
    }, 300);
  });

  cardObserver.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['href']
  });
}

function startOnJobsPage() {
  new Promise((resolve) => observeCards(resolve))
    .then(() => markCards())
    .then(() => recordCurrentJob());
}

function watchUrlChanges() {
  let lastJobId = getCurrentJobId();
  let lastPath = location.pathname;

  const original = history.pushState.bind(history);
  history.pushState = function (...args) {
    original(...args);
    onUrlChange();
  };

  window.addEventListener('popstate', onUrlChange);

  function onUrlChange() {
    const isJobs = location.pathname.startsWith('/jobs/');
    const pathChanged = location.pathname !== lastPath;
    lastPath = location.pathname;

    if (isJobs && pathChanged) {
      startOnJobsPage();
    }

    const jobId = getCurrentJobId();
    if (isJobs && jobId && jobId !== lastJobId) {
      lastJobId = jobId;
      recordCurrentJob();
    }
  }
}

getOptions().then((opts) => applyColourSettings(opts.colours));

watchUrlChanges();
if (location.pathname.startsWith('/jobs/')) startOnJobsPage();
