import { readFileSync } from 'fs';
import { resolve } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const profileSource = readFileSync(
  resolve(process.cwd(), 'src/js/profile.js'),
  'utf-8',
);

const blacklistListeners = [];

globalThis.blOnChange = (listener) => {
  if (!blacklistListeners.includes(listener)) blacklistListeners.push(listener);
};

if (typeof getCompanyProfileSlug !== 'function') {
  // eslint-disable-next-line no-eval
  (0, eval)(profileSource);
}

const storageData = {};
const storageListeners = [];
const sentMessages = [];

function installChromeStorage() {
  sentMessages.length = 0;
  storageData.blacklistedCompanies = [];
  storageData['ljm-options'] = undefined;

  chrome.storage.sync.get = (key, callback) => {
    const result = typeof key === 'string' ? { [key]: storageData[key] } : {};
    if (typeof callback === 'function') {
      callback(result);
      return;
    }
    return Promise.resolve(result);
  };

  chrome.storage.sync.set = (value, callback) => {
    Object.assign(storageData, value);
    if (typeof callback === 'function') {
      callback();
      return;
    }
    return Promise.resolve();
  };

  chrome.storage.onChanged = {
    addListener: (listener) => {
      if (!storageListeners.includes(listener)) storageListeners.push(listener);
    },
    removeListener: (listener) => {
      const index = storageListeners.indexOf(listener);
      if (index >= 0) storageListeners.splice(index, 1);
    },
  };

  chrome.runtime.sendMessage = async (message) => {
    sentMessages.push(message);
    return { ok: true, company: null };
  };
}

function emitStorageChange(changes, areaName = 'sync') {
  [...storageListeners].forEach((listener) => listener(changes, areaName));
}

function emitBlacklistChange(companies = []) {
  [...blacklistListeners].forEach((listener) => listener(companies));
}

function wait(ms) {
  return new Promise((resolveTimeout) => setTimeout(resolveTimeout, ms));
}

function makeProfileHeading(name = 'Acme Corp') {
  const heading = document.createElement('h1');
  heading.className = 'org-top-card-summary__title';
  heading.textContent = name;
  document.body.appendChild(heading);
  return heading;
}

describe('company profile identity', () => {
  beforeEach(() => {
    stopCompanyProfileMarker();
    installChromeStorage();
    blacklistListeners.length = 0;
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    history.replaceState({}, '', '/');
  });

  afterEach(() => {
    stopCompanyProfileMarker();
    document.head.innerHTML = '';
    document.body.innerHTML = '';
  });

  it('extracts the company slug from profile paths only', () => {
    expect(getCompanyProfileSlug('/company/acme/')).toBe('acme');
    expect(getCompanyProfileSlug('/company/acme')).toBe('acme');
    expect(getCompanyProfileSlug('/company/acme/about/')).toBe('acme');
    expect(getCompanyProfileSlug('/company/acme%20ltd/')).toBe('acme ltd');
    expect(getCompanyProfileSlug('/company/')).toBeNull();
    expect(getCompanyProfileSlug('/jobs/search/')).toBeNull();
  });

  it('uses the actual profile heading rather than an earlier h1', () => {
    history.replaceState({}, '', '/company/acme/');
    const unrelated = document.createElement('h1');
    unrelated.textContent = 'LinkedIn';
    document.body.appendChild(unrelated);
    const heading = makeProfileHeading('Acme Corp');

    const identity = getCompanyProfileIdentity();

    expect(identity.slug).toBe('acme');
    expect(identity.name).toBe('Acme Corp');
    expect(identity.heading).toBe(heading);
  });

  it('falls back to a main heading when the profile title class is absent', () => {
    history.replaceState({}, '', '/company/acme/');
    const main = document.createElement('main');
    const heading = document.createElement('h1');
    heading.textContent = 'Acme Corp';
    main.appendChild(heading);
    document.body.appendChild(main);

    expect(getCompanyProfileIdentity()?.heading).toBe(heading);
  });

  it('returns no identity outside a company profile', () => {
    history.replaceState({}, '', '/jobs/search/');
    makeProfileHeading('Acme Corp');

    expect(getCompanyProfileIdentity()).toBeNull();
  });
});

describe('company profile marking', () => {
  beforeEach(() => {
    stopCompanyProfileMarker();
    installChromeStorage();
    blacklistListeners.length = 0;
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    history.replaceState({}, '', '/company/acme/');
  });

  afterEach(() => {
    stopCompanyProfileMarker();
    document.head.innerHTML = '';
    document.body.innerHTML = '';
  });

  it('marks a blacklisted company heading with the shared style classes', async () => {
    const heading = makeProfileHeading('Acme Corp');
    const calls = [];

    await initCompanyProfileMarker({
      matchesCompany: async (identity) => {
        calls.push(identity);
        return true;
      },
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe('Acme Corp');
    expect(calls[0].slug).toBe('acme');
    expect(heading.classList.contains('ljm-company-profile-name')).toBe(true);
    expect(heading.classList.contains('ljm-blacklisted-company')).toBe(true);
  });

  it('matches by name fallback against the stored blacklist', async () => {
    storageData.blacklistedCompanies = ['Acme Corp'];
    const heading = makeProfileHeading('Acme Corp');

    await initCompanyProfileMarker();

    expect(heading.classList.contains('ljm-blacklisted-company')).toBe(true);
  });

  it('passes both name and slug to the contract lookup', async () => {
    const originalIncludes = globalThis.blIncludes;
    const calls = [];
    globalThis.blIncludes = async (name, slug) => {
      calls.push({ name, slug });
      return slug === 'acme';
    };

    try {
      const heading = makeProfileHeading('Acme Corp');
      await initCompanyProfileMarker();

      expect(calls).toEqual([{ name: 'Acme Corp', slug: 'acme' }]);
      expect(heading.classList.contains('ljm-blacklisted-company')).toBe(true);
    } finally {
      globalThis.blIncludes = originalIncludes;
    }
  });

  it('removes the stale classes when the company is unblacklisted', async () => {
    storageData.blacklistedCompanies = ['Acme Corp'];
    const heading = makeProfileHeading('Acme Corp');
    await initCompanyProfileMarker();
    expect(heading.classList.contains('ljm-blacklisted-company')).toBe(true);

    storageData.blacklistedCompanies = [];
    emitBlacklistChange([]);
    await wait(350);

    expect(heading.classList.contains('ljm-blacklisted-company')).toBe(false);
    expect(heading.classList.contains('ljm-company-profile-name')).toBe(false);
  });

  it('keeps same-name companies separate when their slugs differ', async () => {
    const heading = makeProfileHeading('Acme Corp');
    const matcher = ({ slug }) => slug === 'acme-ltd';

    await initCompanyProfileMarker({ matchesCompany: matcher });
    expect(heading.classList.contains('ljm-blacklisted-company')).toBe(false);

    history.replaceState({}, '', '/company/acme-ltd/');
    await refreshCompanyProfileMark();

    expect(heading.classList.contains('ljm-blacklisted-company')).toBe(true);
  });

  it('clears the mark when the marker is disabled and restores it when enabled', async () => {
    let enabled = true;
    const heading = makeProfileHeading('Acme Corp');

    await initCompanyProfileMarker({
      matchesCompany: async () => true,
      isEnabled: () => enabled,
    });
    expect(heading.classList.contains('ljm-blacklisted-company')).toBe(true);

    enabled = false;
    await refreshCompanyProfileMark();
    expect(heading.classList.contains('ljm-blacklisted-company')).toBe(false);

    enabled = true;
    await refreshCompanyProfileMark();
    expect(heading.classList.contains('ljm-blacklisted-company')).toBe(true);
  });

  it('clears the mark when navigating away from the profile', async () => {
    const heading = makeProfileHeading('Acme Corp');
    await initCompanyProfileMarker({ matchesCompany: async () => true });
    expect(heading.classList.contains('ljm-blacklisted-company')).toBe(true);

    history.replaceState({}, '', '/jobs/search/');
    document.dispatchEvent(new CustomEvent('ljm:urlchange'));
    await wait(20);

    expect(heading.classList.contains('ljm-blacklisted-company')).toBe(false);
    expect(heading.classList.contains('ljm-company-profile-name')).toBe(false);
  });

  it('marks a delayed heading once it appears', async () => {
    await initCompanyProfileMarker({ matchesCompany: async () => true });

    const heading = makeProfileHeading('Acme Corp');
    await wait(400);

    expect(heading.classList.contains('ljm-blacklisted-company')).toBe(true);
  });

  it('moves the mark when the profile heading is replaced', async () => {
    const firstHeading = makeProfileHeading('Acme Corp');
    await initCompanyProfileMarker({ matchesCompany: async () => true });
    expect(firstHeading.classList.contains('ljm-blacklisted-company')).toBe(
      true,
    );

    document.body.innerHTML = '';
    const replacement = makeProfileHeading('Acme Corp');
    await wait(400);

    expect(firstHeading.classList.contains('ljm-blacklisted-company')).toBe(
      false,
    );
    expect(replacement.classList.contains('ljm-blacklisted-company')).toBe(
      true,
    );
  });

  it('attaches the profile slug once per identity', async () => {
    makeProfileHeading('Acme Corp');
    await initCompanyProfileMarker({ matchesCompany: async () => true });
    await wait(10);

    await refreshCompanyProfileMark();
    await wait(10);

    const attachMessages = sentMessages.filter(
      (message) => message.action === 'companies.attachSlug',
    );
    expect(attachMessages).toEqual([
      {
        action: 'companies.attachSlug',
        name: 'Acme Corp',
        slug: 'acme',
      },
    ]);
  });

  it('refreshes when settings change', async () => {
    const heading = makeProfileHeading('Acme Corp');
    await initCompanyProfileMarker({ matchesCompany: async () => true });

    emitStorageChange({
      'ljm-options': {
        oldValue: undefined,
        newValue: { colours: { blacklisted: '#000000' } },
      },
    });
    await wait(350);

    expect(heading.classList.contains('ljm-blacklisted-company')).toBe(true);
  });
});
