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

async function markCards() {
  if (!enabled) return;
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
    await dbSaveJob(jobId, 'viewed');
    await markCards();
  }
}

function watchUrlChanges() {
  let lastJobId = getCurrentJobId();

  const original = history.pushState.bind(history);
  history.pushState = function (...args) {
    original(...args);
    onUrlChange();
  };

  window.addEventListener('popstate', onUrlChange);

  function onUrlChange() {
    const jobId = getCurrentJobId();
    if (jobId && jobId !== lastJobId) {
      lastJobId = jobId;
      recordCurrentJob();
    }
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

let cardObserver = null;

function observeCards(onReady) {
  if (cardObserver) cardObserver.disconnect();

  let knownCount = getJobCards().length;
  let debounceTimer = null;
  let ready = knownCount > 0;

  if (ready) onReady();

  cardObserver = new MutationObserver(() => {
    const current = getJobCards().length;
    if (current < knownCount) { knownCount = current; return; }
    if (current === knownCount) return;
    knownCount = current;

    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => markCards(), 300);

    if (!ready) {
      ready = true;
      onReady();
    }
  });

  cardObserver.observe(document.body, { childList: true, subtree: true });
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

watchUrlChanges();
if (location.pathname.startsWith('/jobs/')) startOnJobsPage();
