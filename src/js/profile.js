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
let companyProfileRoutePath = null;
let companyProfileLastIdentity = null;
let companyProfileHeadingAtRouteChange = null;
let companyProfileRouteChangePending = false;
let companyProfileBlOnChangeListener = null;
let companyProfileBlOnChangeUnsubscribe = null;

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

function hasCompanyProfileLinkEvidence(slug, heading) {
  if (!slug || !heading) return false;

  const container = heading.closest(".org-top-card, .org-top-card-summary");
  if (!container) return false;

  return [...container.querySelectorAll('a[href*="/company/"]')].some((a) => {
    try {
      return (
        getCompanyProfileSlug(
          new URL(a.getAttribute("href"), location.origin).pathname,
        ) === slug
      );
    } catch (_e) {
      return false;
    }
  });
}

function isCompanyProfileIdentityCurrent({ slug, name, heading }) {
  if (!companyProfileRouteChangePending) return true;

  if (hasCompanyProfileLinkEvidence(slug, heading)) {
    companyProfileRouteChangePending = false;
    companyProfileHeadingAtRouteChange = null;
    return true;
  }

  const previous = companyProfileHeadingAtRouteChange;
  if (!previous?.heading) {
    companyProfileRouteChangePending = false;
    companyProfileHeadingAtRouteChange = null;
    return true;
  }

  const headingChanged =
    heading !== previous.heading ||
    name !== previous.name ||
    (companyProfileLastIdentity &&
      (heading !== companyProfileLastIdentity.heading ||
        name !== companyProfileLastIdentity.name));

  if (headingChanged) {
    companyProfileRouteChangePending = false;
    companyProfileHeadingAtRouteChange = null;
    return true;
  }

  return false;
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

  const resetAttachment = () => {
    if (
      companyProfileAttachedName !== name ||
      companyProfileAttachedSlug !== slug
    ) {
      return;
    }
    companyProfileAttachedName = null;
    companyProfileAttachedSlug = null;
  };

  Promise.resolve()
    .then(() =>
      chrome.runtime.sendMessage({
        action: "companies.attachSlug",
        name,
        slug,
      }),
    )
    .then((response) => {
      if (response?.ok !== true) resetAttachment();
    })
    .catch((e) => {
      resetAttachment();
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
  if (!identity || !isCompanyProfileIdentityCurrent(identity)) return;

  companyProfileLastIdentity = {
    slug: identity.slug,
    name: identity.name,
    heading: identity.heading,
  };
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
    characterData: true,
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

  const previousSlug = getCompanyProfileSlug(companyProfileRoutePath);
  const nextSlug = getCompanyProfileSlug();
  const pathChanged = location.pathname !== companyProfileRoutePath;
  companyProfileRoutePath = location.pathname;

  if (nextSlug) {
    if (pathChanged && previousSlug !== nextSlug) {
      const heading = getCompanyProfileHeading();
      companyProfileHeadingAtRouteChange = heading
        ? { heading, name: getTextContent(heading) }
        : null;
      companyProfileRouteChangePending = true;
    } else if (pathChanged) {
      companyProfileHeadingAtRouteChange = null;
      companyProfileRouteChangePending = false;
    }
    startCompanyProfileObserver();
  } else {
    companyProfileLastIdentity = null;
    companyProfileHeadingAtRouteChange = null;
    companyProfileRouteChangePending = false;
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
    companyProfileRoutePath = location.pathname;
    companyProfileLastIdentity = null;
    companyProfileHeadingAtRouteChange = null;
    companyProfileRouteChangePending = false;
    chrome.storage.onChanged.addListener(onCompanyProfileStorageChanged);
    if (!companyProfileBlOnChangeListener && typeof blOnChange === "function") {
      companyProfileBlOnChangeListener = () => {
        if (!companyProfileStarted) return;
        companyProfileAttachedName = null;
        companyProfileAttachedSlug = null;
        scheduleCompanyProfileMark();
      };
      const unsubscribe = blOnChange(companyProfileBlOnChangeListener);
      companyProfileBlOnChangeUnsubscribe =
        typeof unsubscribe === "function" ? unsubscribe : null;
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

  if (companyProfileBlOnChangeUnsubscribe) {
    companyProfileBlOnChangeUnsubscribe();
    companyProfileBlOnChangeUnsubscribe = null;
    companyProfileBlOnChangeListener = null;
  }

  companyProfileStarted = false;
  companyProfileRoutePath = null;
  companyProfileLastIdentity = null;
  companyProfileHeadingAtRouteChange = null;
  companyProfileRouteChangePending = false;
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
