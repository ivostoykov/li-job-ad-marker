// Content-side blacklist access through the background data module. The active
// blacklist is cached per frame and replaced by every `data-changed` broadcast.

let blCache = null;
let blCacheRevision = 0;
let blCachePromise = null;
const blListeners = [];

// Snapshots carry a background revision; an older snapshot never replaces a newer one.
function blSetCache(companies, revision) {
  if (!Array.isArray(companies) || revision < blCacheRevision) return;
  blCache = companies;
  blCacheRevision = revision;
  blListeners.forEach((listener) => {
    try {
      listener(companies);
    } catch (e) {
      console.error(`${getLogPrefix('error')} - [${getLineNumber()}] - Blacklist listener failed:`, e);
    }
  });
}

function blGetCompanies() {
  if (blCache) return Promise.resolve(blCache);
  if (!blCachePromise) {
    blCachePromise = chrome.runtime.sendMessage({ action: 'companies.getBlacklist' })
      .then((response) => {
        if (!response?.ok) throw new Error(response?.error || 'companies.getBlacklist failed');
        blSetCache(response.companies, response.revision);
        return blCache;
      })
      .finally(() => { blCachePromise = null; });
  }
  return blCachePromise;
}

function blGetList() {
  return blGetCompanies().then((companies) => companies.map((c) => c.name));
}

function blIncludes(companyName, slug = null) {
  const nameKey = normaliseNameKey(companyName);
  return blGetCompanies().then((companies) =>
    companies.some((c) => c.nameKey === nameKey && (!slug || !c.slug || c.slug === slug)));
}

async function blSetBlacklisted(companyName, slug, blacklisted) {
  const response = await chrome.runtime.sendMessage({ action: 'companies.setBlacklisted', name: companyName, slug, blacklisted });
  if (!response?.ok) throw new Error(response?.error || 'companies.setBlacklisted failed');
  blSetCache(response.blacklist, response.revision);
}

function blAdd(companyName, slug = null) {
  return blSetBlacklisted(companyName, slug, true);
}

function blRemove(companyName, slug = null) {
  return blSetBlacklisted(companyName, slug, false);
}

function blOnChange(listener) {
  blListeners.push(listener);
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.action === 'data-changed' && Array.isArray(message.companies)) blSetCache(message.companies, message.revision);
});
