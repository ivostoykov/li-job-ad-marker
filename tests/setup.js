import { readFileSync } from 'fs';
import { resolve } from 'path';
import { IDBFactory } from 'fake-indexeddb';
import { createDevice, StorageArea, SyncArea } from './helpers/background-device.js';

// Content scripts get a real IndexedDB (fake-indexeddb) for the legacy and
// incognito paths, and talk to a real background device for persistent data.
globalThis.__IDBFactory = IDBFactory;
globalThis.indexedDB = new IDBFactory();

globalThis.__runtimeMessageListeners = [];
globalThis.__storageChangeListeners = [];

// Chrome API mock — must be set before any source script is evaluated. The
// storage areas are shared with the background device, as in the extension.
const syncArea = new SyncArea();
const localArea = new StorageArea('local');
syncArea.listeners.push((changes, area) => globalThis.__storageChangeListeners.forEach((l) => l(changes, area)));
localArea.listeners.push((changes, area) => globalThis.__storageChangeListeners.forEach((l) => l(changes, area)));

function deliverToContent(message) {
  globalThis.__runtimeMessageListeners.forEach((listener) => listener(message, {}, () => {}));
}

globalThis.__createBackground = () => {
  syncArea.data.clear();
  localArea.data.clear();
  syncArea.listeners.splice(1);
  localArea.listeners.splice(1);
  globalThis.__background = createDevice({ sync: syncArea, local: localArea, deliverToTab: deliverToContent });
  return globalThis.__background;
};
globalThis.__createBackground();

globalThis.chrome = {
  extension: { inIncognitoContext: false },
  runtime: {
    getManifest: () => ({ name: 'LJM Test', version: '0.0.0' }),
    getURL: (path) => `chrome-extension://test/${path}`,
    onMessage: { addListener: (listener) => globalThis.__runtimeMessageListeners.push(listener) },
    sendMessage: (message) => globalThis.__background.send(message, { tab: { id: 1, incognito: false }, url: location.href }),
  },
  storage: {
    sync: syncArea,
    local: localArea,
    onChanged: { addListener: (listener) => globalThis.__storageChangeListeners.push(listener) },
  },
};

// Load all source scripts concatenated as a single eval so that const/let
// declarations share one lexical scope (TYPE_RANK, SETTINGS_DEFAULTS, adapter
// objects, etc. are all visible to the function bodies that reference them).
const sourceFiles = [
  'src/js/utils.js',
  'src/js/settings.js',
  'src/js/db.js',
  'src/js/blacklist.js',
  'src/js/log.js',
  'src/content.js',
];

const combined =
  sourceFiles
    .map((f) => readFileSync(resolve(process.cwd(), f), 'utf-8'))
    .join('\n') +
  // Expose const objects that tests need to reference directly
  `\nglobalThis._testExports = {
    defaultJobsAdapter,
    aiSearchAdapter,
    companySearchAdapter,
    TYPE_RANK,
    SETTINGS_DEFAULTS,
    getObservedSurface: () => currentPageAdapter ? { adapter: currentPageAdapter } : null,
    getObserverSnapshot: () => ({ cardObserver, currentPageAdapter, bodyObserverAttached }),
    stopObservingCards: () => {
      if (cardObserver) {
        cardObserver.disconnect();
        cardObserver = null;
      }
      if (cardObserverDebounceTimer) {
        clearTimeout(cardObserverDebounceTimer);
        cardObserverDebounceTimer = null;
      }
      bodyObserverAttached = false;
      urlWatcherAttached = false;
      currentPageAdapter = defaultJobsAdapter;
      lastRightClickedCard = null;
      enabled = true;
      dbJobsCache = null;
      dbJobsPending = [];
      blCache = null;
      blCacheRevision = 0;
      globalThis.indexedDB = new globalThis.__IDBFactory();
      globalThis.__createBackground();
    },
    startOnJobsPage: async () => {
      currentPageAdapter = selectPageAdapter();
      await attachBodyObserver();
    },
    applyStartupOptions: (options) => applyStartupOptions(options),
    isDebugEnabled: () => debugEnabled,
  };`;

// Indirect eval → runs as a non-strict global Script so that function
// declarations land on globalThis and const/let share one scope.
// eslint-disable-next-line no-eval
(0, eval)(combined);
