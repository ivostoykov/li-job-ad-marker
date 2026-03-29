import { readFileSync } from 'fs';
import { resolve } from 'path';

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
  // Expose const objects that tests need to reference directly
  `\nglobalThis._testExports = {
    defaultJobsAdapter,
    aiSearchAdapter,
    companySearchAdapter,
    TYPE_RANK,
    SETTINGS_DEFAULTS,
    PAGE_ADAPTERS,
  };`;

// Indirect eval → runs as a non-strict global Script so that function
// declarations land on globalThis and const/let share one scope.
// eslint-disable-next-line no-eval
(0, eval)(combined);
