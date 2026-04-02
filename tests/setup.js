import { readFileSync } from 'fs';
import { resolve } from 'path';

const indexedDbDatabases = new Map();

function cloneValue(value) {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

function createIdbRequest(executor) {
  const request = {
    onsuccess: null,
    onerror: null,
    onupgradeneeded: null,
    result: undefined,
    error: null,
  };

  setTimeout(() => executor(request), 0);
  return request;
}

function createDatabase(name, version) {
  const stores = new Map();

  return {
    name,
    version,
    objectStoreNames: {
      contains(storeName) {
        return stores.has(storeName);
      },
    },
    createObjectStore(storeName, { keyPath } = {}) {
      if (!stores.has(storeName)) {
        stores.set(storeName, { keyPath, records: new Map() });
      }
      return {};
    },
    transaction(storeName) {
      const store = stores.get(storeName);
      if (!store) throw new Error(`Object store "${storeName}" does not exist`);

      return {
        objectStore() {
          return {
            get(key) {
              return createIdbRequest((request) => {
                request.result = cloneValue(store.records.get(key));
                request.onsuccess?.({ target: request });
              });
            },
            put(value) {
              return createIdbRequest((request) => {
                const key = store.keyPath ? value[store.keyPath] : value.id;
                store.records.set(key, cloneValue(value));
                request.result = key;
                request.onsuccess?.({ target: request });
              });
            },
            getAll() {
              return createIdbRequest((request) => {
                request.result = [...store.records.values()].map(cloneValue);
                request.onsuccess?.({ target: request });
              });
            },
          };
        },
      };
    },
  };
}

globalThis.indexedDB = {
  open(name, version) {
    return createIdbRequest((request) => {
      let db = indexedDbDatabases.get(name);
      const isNewDatabase = !db;

      if (!db) {
        db = createDatabase(name, version);
        indexedDbDatabases.set(name, db);
      }

      if (isNewDatabase) {
        request.onupgradeneeded?.({ target: { result: db } });
      }

      request.result = db;
      request.onsuccess?.({ target: request });
    });
  },
  deleteDatabase(name) {
    indexedDbDatabases.delete(name);
    return createIdbRequest((request) => {
      request.result = undefined;
      request.onsuccess?.({ target: request });
    });
  },
};

// Chrome API mock — must be set before any source script is evaluated
globalThis.chrome = {
  runtime: {
    getManifest: () => ({ name: 'LJM Test', version: '0.0.0' }),
    onMessage: { addListener: () => {} },
  },
  storage: {
    sync: {
      get: (key, callback) => {
        const result = typeof key === 'string' ? { [key]: undefined } : {};
        if (typeof callback === 'function') { callback(result); return; }
        return Promise.resolve(result);
      },
      set: (_obj, callback) => {
        if (typeof callback === 'function') { callback(); return; }
        return Promise.resolve();
      },
    },
    onChanged: { addListener: () => {} },
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
  `\nconst __testOriginalMarkPageTasks = {
    markCards,
    markDetailPanelAging,
    markDetailPanelUnwantedTitle,
  };` +
  // Expose const objects that tests need to reference directly
  `\nglobalThis._testExports = {
    defaultJobsAdapter,
    aiSearchAdapter,
    companySearchAdapter,
    jobViewAdapter,
    TYPE_RANK,
    SETTINGS_DEFAULTS,
    PAGE_ADAPTERS,
    getMatchedPageAdapter: () => getMatchedPageAdapter(),
    getObservedSurface: () => getObservedSurface(),
    getObserverSnapshot: () => ({ cardObserver, observedSurface, bootstrapObserver }),
    stopObservingCards: () => stopObservingCards(),
    stopBootstrapObserver: () => stopBootstrapObserver(),
    applyStartupOptions: (options) => applyStartupOptions(options),
    beginPageHandling: () => beginPageHandling(),
    isDebugEnabled: () => debugEnabled,
    markPage: () => markPage(),
    setMarkPageTasks: (tasks = {}) => {
      if (Object.prototype.hasOwnProperty.call(tasks, 'markCards')) {
        markCards = tasks.markCards;
      }
      if (Object.prototype.hasOwnProperty.call(tasks, 'markDetailPanelAging')) {
        markDetailPanelAging = tasks.markDetailPanelAging;
      }
      if (Object.prototype.hasOwnProperty.call(tasks, 'markDetailPanelUnwantedTitle')) {
        markDetailPanelUnwantedTitle = tasks.markDetailPanelUnwantedTitle;
      }
    },
    resetMarkPageTasks: () => {
      markCards = __testOriginalMarkPageTasks.markCards;
      markDetailPanelAging = __testOriginalMarkPageTasks.markDetailPanelAging;
      markDetailPanelUnwantedTitle = __testOriginalMarkPageTasks.markDetailPanelUnwantedTitle;
    },
  };`;

// Indirect eval → runs as a non-strict global Script so that function
// declarations land on globalThis and const/let share one scope.
// eslint-disable-next-line no-eval
(0, eval)(combined);
