// Firefox loads these through manifest background.scripts; importScripts only exists in the Chrome worker.
if (typeof importScripts === 'function') {
  importScripts('js/utils.js');
  importScripts('js/settings.js');
  importScripts('js/log.js');
  importScripts('js/store.js');
  importScripts('js/sync.js');
}

const MENU_BLACKLIST_TOGGLE = 'blacklist-toggle';
const MENU_MARKER_TOGGLE = 'marker-toggle';
const MENU_APPLIED_MARK = 'applied-mark';
const MENU_IGNORE_TITLE = 'ignore-title';
const MENU_IGNORE_SELECTION = 'ignore-selection';
const MENU_ADD_NOTE = 'add-note';
const MENU_SHOW_NOTES = 'show-notes';
const MENU_OPTIONS = 'options';

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_BLACKLIST_TOGGLE,
      title: 'Toggle company blacklist',
      contexts: ['page', 'link'],
      documentUrlPatterns: ['https://www.linkedin.com/*'],
    });

    chrome.contextMenus.create({
      id: MENU_MARKER_TOGGLE,
      title: 'Toggle marker',
      contexts: ['page', 'link'],
      documentUrlPatterns: ['https://www.linkedin.com/*'],
    });

    chrome.contextMenus.create({
      id: MENU_APPLIED_MARK,
      title: 'Mark as applied',
      contexts: ['page', 'link'],
      documentUrlPatterns: ['https://www.linkedin.com/*'],
    });

    chrome.contextMenus.create({
      id: MENU_IGNORE_TITLE,
      title: 'Add title to ignore list',
      contexts: ['page', 'link'],
      documentUrlPatterns: ['https://www.linkedin.com/*'],
    });

    chrome.contextMenus.create({
      id: MENU_IGNORE_SELECTION,
      title: 'Add selection to ignore list',
      contexts: ['selection'],
      documentUrlPatterns: ['https://www.linkedin.com/*'],
    });

    chrome.contextMenus.create({
      id: MENU_ADD_NOTE,
      title: 'Add note',
      contexts: ['page', 'link'],
      documentUrlPatterns: ['https://www.linkedin.com/*'],
    });

    chrome.contextMenus.create({
      id: MENU_SHOW_NOTES,
      title: 'Show notes',
      contexts: ['page', 'link'],
      documentUrlPatterns: ['https://www.linkedin.com/*'],
    });

    chrome.contextMenus.create({
      id: 'separatorBeforeOptions',
      type: 'separator',
      contexts: ['page', 'link'],
      documentUrlPatterns: ['https://www.linkedin.com/*'],
    });

    chrome.contextMenus.create({
      id: MENU_OPTIONS,
      title: 'Options',
      contexts: ['page', 'link'],
      documentUrlPatterns: ['https://www.linkedin.com/*'],
    });
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === MENU_OPTIONS) {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/options.html') });
    return;
  }

  if ([MENU_BLACKLIST_TOGGLE, MENU_MARKER_TOGGLE, MENU_APPLIED_MARK, MENU_IGNORE_TITLE].includes(info.menuItemId)) {
    chrome.tabs.sendMessage(tab.id, { action: info.menuItemId });
  }

  if ([MENU_ADD_NOTE, MENU_SHOW_NOTES].includes(info.menuItemId)) {
    chrome.tabs.sendMessage(tab.id, { action: info.menuItemId }, { frameId: info.frameId });
  }

  if (info.menuItemId === MENU_IGNORE_SELECTION) {
    chrome.tabs.sendMessage(tab.id, { action: MENU_IGNORE_SELECTION, text: info.selectionText });
  }
});

const INCOGNITO_REFUSED_ACTIONS = ['jobs.save', 'jobs.migrateLegacy', 'notes.add', 'notes.update', 'notes.delete'];

function broadcastDataChanged(change) {
  const message = { action: 'data-changed', ...change };
  chrome.runtime.sendMessage(message).catch(() => {});
  chrome.tabs.query({ url: 'https://www.linkedin.com/*' })
    .then((tabs) => tabs.forEach((tab) => chrome.tabs.sendMessage(tab.id, message).catch(() => {})))
    .catch(() => {});
}

async function blacklistSnapshot() {
  return { companies: await companiesGetBlacklist(), revision: nextDataRevision() };
}

async function companiesChanged(changed, result = {}) {
  await syncAfterCompaniesChange(changed);
  const snapshot = await blacklistSnapshot();
  if (changed.length) broadcastDataChanged(snapshot);
  return { ...result, companies: changed, blacklist: snapshot.companies, revision: snapshot.revision };
}

const DATA_ACTIONS = {
  'jobs.getAll': async () => ({ jobs: await jobsGetAll() }),
  'jobs.save': (m) => dataMutate(async () => {
    const jobs = await jobsSave(m.jobs);
    if (jobs.length) broadcastDataChanged({ jobs });
    return { jobs };
  }),
  'jobs.migrateLegacy': (m) => dataMutate(async () => {
    const { migratedIds, changed } = await jobsMigrateLegacy(m.jobs);
    if (changed.length) broadcastDataChanged({ jobs: changed });
    return { migratedIds };
  }),
  'companies.getBlacklist': () => dataMutate(blacklistSnapshot),
  'companies.lookup': (m) => companiesLookup(m.name, m.slug || null),
  'companies.setBlacklisted': (m) => dataMutate(async () =>
    companiesChanged(await companiesSetBlacklisted(m.name, m.slug || null, !!m.blacklisted), { blacklisted: !!m.blacklisted })),
  'companies.toggleBlacklist': (m) => dataMutate(async () => {
    const { blacklisted, changed } = await companiesToggleBlacklist(m.name, m.slug || null);
    return companiesChanged(changed, { blacklisted });
  }),
  'companies.attachSlug': (m) => dataMutate(async () => {
    const company = await companiesAttachSlug(m.name, m.slug);
    if (company) await companiesChanged([company]);
    return { company };
  }),
  'notes.listGroup': async (m) => ({ notes: await notesListGroup(m.title, m.company, m.companySlug || null) }),
  'notes.groupsWithNotes': async (m) => ({ matches: await notesGroupsWithNotes(m.groups) }),
  'notes.add': (m) => dataMutate(async () => {
    const note = await notesAdd(m);
    broadcastDataChanged({ notes: [note] });
    return { note };
  }),
  'notes.update': (m) => dataMutate(async () => {
    const note = await notesUpdate(m.id, m.text);
    broadcastDataChanged({ notes: [note] });
    return { note };
  }),
  'notes.delete': (m) => dataMutate(async () => {
    const note = await notesDelete(m.id);
    broadcastDataChanged({ notes: [note] });
    return { note };
  }),
  'data.export': () => dataMutate(async () => ({ data: await dataExport() })),
  'data.import': (m) => dataMutate(async () => {
    const changed = await dataImport(m.data);
    await syncAfterCompaniesChange(changed.companies);
    broadcastDataChanged({ jobs: changed.jobs, notes: changed.notes, ...await blacklistSnapshot() });
    return { counts: { jobs: changed.jobs.length, companies: changed.companies.length, notes: changed.notes.length } };
  }),
  'sync.status': async () => ({ status: await syncGetStatus() }),
  'settings.set': (m) => dataMutate(async () => {
    await settingsSet(m.options);
    return {};
  }),
};

// Every request waits for start-up recovery. A failed recovery is retried by
// the next request instead of letting reads or writes see a half-imported state.
let dataReady = null;

function ensureDataReady() {
  if (!dataReady) {
    dataReady = dataMutate(async () => {
      await dataRecoverImport();
      try {
        const changed = await syncReconcile();
        if (changed.length) broadcastDataChanged(await blacklistSnapshot());
      } catch (e) {
        console.error(`${getLogPrefix('error')} - [${getLineNumber()}] - Blacklist sync reconcile failed:`, e);
      }
    }).catch((e) => {
      dataReady = null;
      throw new Error(`Data start-up recovery failed; retry later: ${e?.message || e}`);
    });
  }
  return dataReady;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handler = DATA_ACTIONS[message?.action];
  if (!handler) return false;

  if (sender?.tab?.incognito && INCOGNITO_REFUSED_ACTIONS.includes(message.action)) {
    sendResponse({ ok: false, error: 'incognito' });
    return false;
  }

  ensureDataReady()
    .then(() => handler(message, sender))
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((e) => {
      console.error(`${getLogPrefix('error')} - [${getLineNumber()}] - ${message.action} failed:`, e);
      sendResponse({ ok: false, error: e?.message || String(e) });
    });
  return true;
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'sync') return;
  if (!Object.keys(changes).some((key) => key.startsWith(SYNC_MIRROR_PREFIX) || key === SYNC_LEGACY_BLACKLIST_KEY)) return;

  ensureDataReady()
    .then(() => dataMutate(async () => {
      const changed = await syncHandleStorageChanges(changes);
      if (changed.length) broadcastDataChanged(await blacklistSnapshot());
    }))
    .catch((e) => console.error(`${getLogPrefix('error')} - [${getLineNumber()}] - Sync change failed:`, e));
});

ensureDataReady().catch((e) => console.error(`${getLogPrefix('error')} - [${getLineNumber()}] -`, e));
