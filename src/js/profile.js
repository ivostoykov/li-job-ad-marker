const COMPANY_PROFILE_PATH_RE = /^\/company\/([^/?#]+)/;
const COMPANY_PROFILE_URL_CHANGE_EVENT = "ljm:urlchange";
const COMPANY_PROFILE_SETTINGS_KEY = "ljm-options";
const COMPANY_PROFILE_HEADING_SELECTORS = [
  ".org-top-card-summary__title",
  "main h1",
  "h1",
];
const COMPANY_PROFILE_MARKER_CLASS = "ljm-company-profile-name";
const COMPANY_PROFILE_BLACKLISTED_CLASS = "ljm-blacklisted-company";
const COMPANY_PROFILE_DEBOUNCE_MS = 300;

let companyProfileMatchesCompany = companyProfileMatchesBlacklist;
let companyProfileIsEnabled = () => true;
let companyProfileStarted = false;
let companyProfileObserver = null;
let companyProfileDebounceTimer = null;
let companyProfileRefreshToken = 0;
let companyProfileMarkedHeading = null;
let companyProfileAttachedName = null;
let companyProfileAttachedSlug = null;

function getCompanyProfileSlug(pathname = location.pathname) {
  const match = String(pathname ?? "").match(COMPANY_PROFILE_PATH_RE);
  if (!match) return null;

  try {
    return decodeURIComponent(match[1]);
  } catch (_e) {
    return match[1];
  }
}

function getCompanyProfileHeading() {
  for (const selector of COMPANY_PROFILE_HEADING_SELECTORS) {
    const heading = [...document.querySelectorAll(selector)].find(
      (el) => !!getTextContent(el),
    );
    if (heading) return heading;
  }

  return null;
}

function getCompanyProfileIdentity() {
  const slug = getCompanyProfileSlug();
  if (!slug) return null;

  const heading = getCompanyProfileHeading();
  const name = getTextContent(heading);
  if (!heading || !name) return null;

  return { slug, name, heading };
}

function clearCompanyProfileMark() {
  [
    companyProfileMarkedHeading,
    ...document.querySelectorAll(`.${COMPANY_PROFILE_MARKER_CLASS}`),
  ]
    .filter(Boolean)
    .forEach((heading) => {
      heading.classList.remove(
        COMPANY_PROFILE_MARKER_CLASS,
        COMPANY_PROFILE_BLACKLISTED_CLASS,
      );
    });

  companyProfileMarkedHeading = null;
}

async function companyProfileMatchesBlacklist({ name, slug }) {
  if (!name) return false;

  return !!(await blIncludes(name, slug));
}

function attachCompanyProfileSlug({ name, slug }) {
  if (!name || !slug) return;
  if (
    companyProfileAttachedName === name &&
    companyProfileAttachedSlug === slug
  ) {
    return;
  }

  companyProfileAttachedName = name;
  companyProfileAttachedSlug = slug;

  Promise.resolve()
    .then(() =>
      chrome.runtime.sendMessage({
        action: "companies.attachSlug",
        name,
        slug,
      }),
    )
    .catch((e) => {
      companyProfileAttachedName = null;
      companyProfileAttachedSlug = null;
      console.error(
        `${getLogPrefix(console.error.name)} - ${getLineNumber()} - Company slug attach failed:`,
        e,
      );
    });
}

async function refreshCompanyProfileMark() {
  const token = ++companyProfileRefreshToken;
  clearCompanyProfileMark();
  if (!companyProfileIsEnabled()) return;

  const identity = getCompanyProfileIdentity();
  if (!identity) return;

  attachCompanyProfileSlug(identity);

  let blacklisted = false;
  try {
    blacklisted = await companyProfileMatchesCompany(identity);
  } catch (e) {
    console.error(
      `${getLogPrefix(console.error.name)} - ${getLineNumber()} - Company profile lookup failed:`,
      e,
    );
    return;
  }

  if (token !== companyProfileRefreshToken || !companyProfileIsEnabled()) return;

  const current = getCompanyProfileIdentity();
  if (
    !current ||
    current.heading !== identity.heading ||
    current.slug !== identity.slug ||
    current.name !== identity.name
  ) {
    return;
  }

  if (blacklisted) {
    current.heading.classList.add(
      COMPANY_PROFILE_MARKER_CLASS,
      COMPANY_PROFILE_BLACKLISTED_CLASS,
    );
    companyProfileMarkedHeading = current.heading;
  }
}

function scheduleCompanyProfileMark(delay = COMPANY_PROFILE_DEBOUNCE_MS) {
  clearTimeout(companyProfileDebounceTimer);
  companyProfileDebounceTimer = setTimeout(() => {
    companyProfileDebounceTimer = null;
    refreshCompanyProfileMark().catch((e) =>
      console.error(
        `${getLogPrefix(console.error.name)} - ${getLineNumber()} - Failed to refresh company profile mark:`,
        e,
      ),
    );
  }, delay);
}

function startCompanyProfileObserver() {
  if (companyProfileObserver) return;

  companyProfileObserver = new MutationObserver(() => {
    if (!getCompanyProfileSlug()) {
      stopCompanyProfileObserver();
      clearCompanyProfileMark();
      return;
    }
    scheduleCompanyProfileMark();
  });
  companyProfileObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
}

function stopCompanyProfileObserver() {
  companyProfileObserver?.disconnect();
  companyProfileObserver = null;
}

function onCompanyProfileUrlChange() {
  companyProfileRefreshToken += 1;
  clearCompanyProfileMark();

  if (getCompanyProfileSlug()) {
    startCompanyProfileObserver();
  } else {
    stopCompanyProfileObserver();
  }
  scheduleCompanyProfileMark();
}

function onCompanyProfileStorageChanged(changes, areaName) {
  if (!companyProfileStarted || areaName !== "sync" || !changes) return;

  const settingsKey =
    typeof SETTINGS_KEY === "string"
      ? SETTINGS_KEY
      : COMPANY_PROFILE_SETTINGS_KEY;

  if (!changes[settingsKey]) return;

  scheduleCompanyProfileMark();
}

function initCompanyProfileMarker({
  matchesCompany = companyProfileMatchesBlacklist,
  isEnabled = () => true,
} = {}) {
  companyProfileMatchesCompany = matchesCompany;
  companyProfileIsEnabled = isEnabled;

  if (!companyProfileStarted) {
    companyProfileStarted = true;
    chrome.storage.onChanged.addListener(onCompanyProfileStorageChanged);
    if (typeof blOnChange === "function") {
      blOnChange(() => {
        if (!companyProfileStarted) return;
        companyProfileAttachedName = null;
        companyProfileAttachedSlug = null;
        scheduleCompanyProfileMark();
      });
    }
    document.addEventListener(
      COMPANY_PROFILE_URL_CHANGE_EVENT,
      onCompanyProfileUrlChange,
    );
    window.addEventListener("popstate", onCompanyProfileUrlChange);
    window.addEventListener("hashchange", onCompanyProfileUrlChange);
    if (getCompanyProfileSlug()) startCompanyProfileObserver();
  }

  return refreshCompanyProfileMark();
}

function stopCompanyProfileMarker() {
  companyProfileRefreshToken += 1;
  clearTimeout(companyProfileDebounceTimer);
  companyProfileDebounceTimer = null;
  stopCompanyProfileObserver();

  if (companyProfileStarted) {
    chrome.storage.onChanged.removeListener?.(onCompanyProfileStorageChanged);
    document.removeEventListener(
      COMPANY_PROFILE_URL_CHANGE_EVENT,
      onCompanyProfileUrlChange,
    );
    window.removeEventListener("popstate", onCompanyProfileUrlChange);
    window.removeEventListener("hashchange", onCompanyProfileUrlChange);
  }

  companyProfileStarted = false;
  companyProfileMatchesCompany = companyProfileMatchesBlacklist;
  companyProfileIsEnabled = () => true;
  companyProfileAttachedName = null;
  companyProfileAttachedSlug = null;
  clearCompanyProfileMark();
}

initCompanyProfileMarker({
  matchesCompany: ({ name, slug }) => blIncludes(name, slug),
  isEnabled: () => (typeof enabled === "boolean" ? enabled : true),
});

if (typeof addMessageAction === "function") {
  addMessageAction("marker-toggle", () => refreshCompanyProfileMark());
}
