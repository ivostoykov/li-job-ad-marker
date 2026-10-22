// Local job-card encounter statistics (#19). A card counts once per results
// visit when at least half of it is visible. IntersectionObserver uses the
// implicit root, so scroll containers, frames and hidden preload frames clip it.
// The counted job state is the one known when the card was first seen in the
// visit, before opening it records a view. Counts are buffered per local date
// and sent to the background in batches; no job IDs leave this frame.

const ENCOUNTER_VISIBLE_RATIO = 0.5;
const ENCOUNTER_FLUSH_DELAY_MS = 2000;
const ENCOUNTER_RETRY_DELAY_MS = 5000;
const ENCOUNTER_MAX_ATTEMPTS = 3;
const ENCOUNTER_SETTLE_MS = 1500;
const ENCOUNTER_SETTLE_MAX_MS = 6000;
const ENCOUNTER_RECHECK_MS = 1000;
const ENCOUNTER_RENDER_CHECK = { opacityProperty: true, visibilityProperty: true };
const ENCOUNTER_RESULTS_PATH_RE =
  /^\/(?:jobs\/(?:search|search-results|collections)(?:\/|$)|preload\/?$)/;
// Selecting a job and LinkedIn's tracking parameters do not start a new visit.
const ENCOUNTER_IGNORED_PARAMS = ["currentJobId", "refId", "trackingId", "eBP"];

let encounterVisitKey = null;
let encounterInitialStates = new Map();
let encounterOwnViews = new Set();
let encounterCounted = new Set();
let encounterCardJobIds = new WeakMap();
let encounterStaleCards = new WeakMap();
let encounterObserver = null;
let encounterPending = null;
let encounterFlushTimer = null;
let encounterSettleTimer = null;
let encounterBoundaryAt = 0;
let encounterRecheckTimer = null;
const encounterObservedCards = new Set();
const encounterVisibleCards = new Set();

function getEncounterVisitKey() {
  if (!ENCOUNTER_RESULTS_PATH_RE.test(location.pathname)) return null;
  const params = new URLSearchParams(location.search);
  ENCOUNTER_IGNORED_PARAMS.forEach((key) => params.delete(key));
  params.sort();
  return `${location.pathname}?${params}`;
}

// Pagination, another search, back/forward or any other results URL starts a
// new visit. The URL changes before the list re-renders, so cards still mounted
// from the previous list wait until the list has been quiet for
// ENCOUNTER_SETTLE_MS; replaced cards count straight away. A page restored from
// the back/forward cache starts a new visit like a reload.
function syncEncounterVisit(restored = false) {
  const visitKey = getEncounterVisitKey();
  if (!restored && visitKey === encounterVisitKey) return;

  const keepMountedCards = encounterVisitKey !== null && !restored;
  encounterStaleCards = new WeakMap();
  for (const card of encounterObservedCards) {
    if (!card.isConnected) {
      encounterObserver?.unobserve(card);
      encounterObservedCards.delete(card);
      encounterVisibleCards.delete(card);
    } else if (keepMountedCards) {
      encounterStaleCards.set(card, encounterCardJobIds.get(card));
    }
  }
  encounterVisitKey = visitKey;
  encounterInitialStates = new Map();
  encounterOwnViews = new Set();
  encounterCounted = new Set();
  encounterBoundaryAt = Date.now();
  clearTimeout(encounterSettleTimer);
  encounterSettleTimer = keepMountedCards
    ? setTimeout(settleEncounterVisit, ENCOUNTER_SETTLE_MS)
    : null;
}

// Cards LinkedIn kept for the new results count once the list is quiet.
function settleEncounterVisit() {
  clearTimeout(encounterSettleTimer);
  encounterSettleTimer = null;
  encounterStaleCards = new WeakMap();
  if (!currentPageAdapter || !enabled) return Promise.resolve();
  return markCards().catch((e) =>
    console.error(
      `${getLogPrefix(console.error.name)} - ${getLineNumber()} - Failed to settle statistics visit:`,
      e,
    ),
  );
}

// Called by markCards for every loaded card with a stable job ID, visible or
// not. Cards without an ID are skipped until LinkedIn provides one.
function trackCardEncounter(card, jobId, details) {
  if (DB_IS_INCOGNITO || typeof IntersectionObserver !== "function") return;
  syncEncounterVisit();
  if (!encounterVisitKey) return;
  if (encounterStaleCards.get(card) === jobId) {
    // The list is still changing; wait for it to be quiet, but not indefinitely.
    if (encounterSettleTimer && Date.now() - encounterBoundaryAt < ENCOUNTER_SETTLE_MAX_MS) {
      clearTimeout(encounterSettleTimer);
      encounterSettleTimer = setTimeout(settleEncounterVisit, ENCOUNTER_SETTLE_MS);
    }
    return;
  }

  if (!encounterInitialStates.has(jobId)) {
    const { existingType, linkedInState } = details;
    let state = "new";
    // A view this frame saved on opening the job is not previous history, nor
    // is the Viewed label LinkedIn adds because of it.
    if (encounterOwnViews.has(jobId)) {
      if (linkedInState === "applied") state = "applied";
    } else if (existingType === "applied" || linkedInState === "applied") {
      state = "applied";
    } else if (existingType === "viewed" || linkedInState === "viewed") {
      state = "viewed";
    }
    encounterInitialStates.set(jobId, {
      state,
      blacklisted: !!details.blacklisted,
      unwantedTitle: !!details.unwantedTitle,
      ageing: !!details.ageing,
    });
  }

  encounterCardJobIds.set(card, jobId);
  if (!encounterObservedCards.has(card)) {
    encounterObserver ??= new IntersectionObserver(onEncounterIntersection, {
      threshold: ENCOUNTER_VISIBLE_RATIO,
    });
    encounterObservedCards.add(card);
    encounterObserver.observe(card);
  }
  if (encounterVisibleCards.has(card)) countEncounter(card);
}

// recordCurrentJob calls this before saving a job it has no record of, so a
// card the visit has not classified yet still counts with its earlier state.
function noteOwnViewBeforeSave(jobId) {
  syncEncounterVisit();
  if (!encounterInitialStates.has(jobId)) encounterOwnViews.add(jobId);
}

function onEncounterIntersection(entries) {
  entries.forEach((entry) => {
    // Allow for rounding when the ratio lands exactly on the threshold.
    if (entry.isIntersecting && entry.intersectionRatio >= ENCOUNTER_VISIBLE_RATIO - 0.01) {
      encounterVisibleCards.add(entry.target);
      countEncounter(entry.target);
    } else {
      encounterVisibleCards.delete(entry.target);
      // LinkedIn replaces card nodes while the visit continues.
      if (!entry.target.isConnected) {
        encounterObserver?.unobserve(entry.target);
        encounterObservedCards.delete(entry.target);
      }
    }
  });
}

// IntersectionObserver reports geometry only, so a card hidden by
// visibility/opacity on itself, an ancestor or a same-origin frame element (such
// as a transparent preload frame) is not rendered to the user.
function isEncounterCardRendered(card) {
  if (card.checkVisibility && !card.checkVisibility(ENCOUNTER_RENDER_CHECK)) return false;
  try {
    for (let frame = window.frameElement; frame; frame = frame.ownerDocument.defaultView.frameElement) {
      if (frame.checkVisibility && !frame.checkVisibility(ENCOUNTER_RENDER_CHECK)) return false;
    }
  } catch (_e) {
    // A cross-origin parent hides its frame element; geometry decides.
  }
  return true;
}

// Style changes do not re-notify the observer, so cards that intersect but
// are hidden are checked again until they are counted or leave the viewport.
function recheckVisibleEncounters() {
  encounterRecheckTimer = null;
  encounterVisibleCards.forEach((card) => countEncounter(card));
}

function countEncounter(card) {
  if (!enabled || document.visibilityState !== "visible" || !card.isConnected) return;
  syncEncounterVisit();
  const jobId = encounterCardJobIds.get(card);
  if (!jobId || encounterCounted.has(jobId) || encounterStaleCards.get(card) === jobId) return;
  const initial = encounterInitialStates.get(jobId);
  if (!initial) return;
  if (!isEncounterCardRendered(card)) {
    encounterRecheckTimer ??= setTimeout(recheckVisibleEncounters, ENCOUNTER_RECHECK_MS);
    return;
  }

  encounterCounted.add(jobId);
  const now = Date.now();
  encounterPending ??= { encounteredFrom: now, days: {} };
  const day = (encounterPending.days[localDateKey(new Date(now))] ??= {
    total: 0, new: 0, viewed: 0, applied: 0, blacklisted: 0, unwantedTitle: 0, ageing: 0,
  });
  day.total += 1;
  day[initial.state] += 1;
  if (initial.blacklisted) day.blacklisted += 1;
  if (initial.unwantedTitle) day.unwantedTitle += 1;
  if (initial.ageing) day.ageing += 1;
  encounterFlushTimer ??= setTimeout(() => flushEncounters(), ENCOUNTER_FLUSH_DELAY_MS);
}

// A retry resends the same batch ID; the background applies each ID once. Only
// lost messages are retried: a background refusal (`ok: false`) is final.
function flushEncounters(batch = null, attempt = 1) {
  if (!batch) {
    clearTimeout(encounterFlushTimer);
    encounterFlushTimer = null;
    if (!encounterPending) return Promise.resolve();
    batch = { action: "stats.record", batchId: crypto.randomUUID(), ...encounterPending };
    encounterPending = null;
  }

  return Promise.resolve()
    .then(() => chrome.runtime.sendMessage(batch))
    .then((response) => {
      if (!response) throw new Error("No response");
      if (!response.ok) {
        console.error(
          `${getLogPrefix(console.error.name)} - ${getLineNumber()} - Statistics batch refused: ${response.error}`,
        );
      }
    })
    .catch((e) => {
      if (attempt >= ENCOUNTER_MAX_ATTEMPTS) {
        console.error(
          `${getLogPrefix(console.error.name)} - ${getLineNumber()} - Statistics batch dropped:`,
          e,
        );
        return;
      }
      setTimeout(() => flushEncounters(batch, attempt + 1), ENCOUNTER_RETRY_DELAY_MS);
    });
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    encounterVisibleCards.forEach((card) => countEncounter(card));
  } else {
    flushEncounters();
  }
});

window.addEventListener("pagehide", () => flushEncounters());

window.addEventListener("pageshow", (event) => {
  if (!event.persisted) return;
  syncEncounterVisit(true);
  if (currentPageAdapter) {
    markPage().catch((e) =>
      console.error(
        `${getLogPrefix(console.error.name)} - ${getLineNumber()} - Failed to mark restored page:`,
        e,
      ),
    );
  }
});
