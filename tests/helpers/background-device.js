// Loads the real background scripts into an isolated vm context per simulated
// device: own IndexedDB (fake-indexeddb) and storage.local, with a storage.sync
// area that can be shared between devices.
import { readFileSync } from 'fs';
import { resolve } from 'path';
import vm from 'vm';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';

const BACKGROUND_FILES = [
  'src/js/utils.js',
  'src/js/settings.js',
  'src/js/log.js',
  'src/js/store.js',
  'src/js/sync.js',
  'src/background.js',
];

const backgroundSource = BACKGROUND_FILES
  .map((f) => readFileSync(resolve(process.cwd(), f), 'utf-8'))
  .join('\n');

const clone = (value) => (value === undefined ? undefined : structuredClone(value));

function pick(data, keys) {
  if (keys === null || keys === undefined) return Object.fromEntries([...data].map(([k, v]) => [k, clone(v)]));
  const list = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
  return Object.fromEntries(list.filter((k) => data.has(k)).map((k) => [k, clone(data.get(k))]));
}

export class StorageArea {
  constructor(name) {
    this.name = name;
    this.data = new Map();
    this.listeners = [];
  }

  async get(keys) {
    return pick(this.data, keys);
  }

  async set(items) {
    this.write(Object.entries(items).map(([k, v]) => [k, clone(v)]));
  }

  async remove(keys) {
    this.write((Array.isArray(keys) ? keys : [keys]).map((k) => [k, undefined]));
  }

  write(entries) {
    const changes = {};
    for (const [key, value] of entries) {
      const oldValue = clone(this.data.get(key));
      if (value === undefined) {
        if (!this.data.has(key)) continue;
        this.data.delete(key);
      } else {
        this.data.set(key, value);
      }
      changes[key] = { oldValue, newValue: clone(value) };
    }
    if (Object.keys(changes).length) this.emit(changes);
  }

  emit(changes) {
    if (this.paused) {
      this.queued.push(changes);
      return;
    }
    this.listeners.forEach((listener) => setTimeout(() => listener(clone(changes), this.name), 0));
  }

  // Holds change events (devices offline from each other) until resume().
  pause() {
    this.paused = true;
    this.queued = [];
  }

  resume() {
    this.paused = false;
    this.queued.splice(0).forEach((changes) => this.emit(changes));
  }
}

// storage.sync shared by several devices. `paused` holds outgoing change events
// per device (offline peer); quota limits mimic Chrome's storage.sync errors.
export class SyncArea extends StorageArea {
  constructor({ maxItems = 512, quotaBytesPerItem = 8192 } = {}) {
    super('sync');
    this.maxItems = maxItems;
    this.quotaBytesPerItem = quotaBytesPerItem;
    this.writes = 0;
  }

  async set(items) {
    for (const [key, value] of Object.entries(items)) {
      if (JSON.stringify(value).length + key.length > this.quotaBytesPerItem) throw new Error('QUOTA_BYTES_PER_ITEM quota exceeded');
    }
    const added = Object.keys(items).filter((k) => !this.data.has(k)).length;
    if (this.data.size + added > this.maxItems) throw new Error('MAX_ITEMS quota exceeded');
    this.writes += 1;
    return super.set(items);
  }
}

export function createDevice({ sync = new SyncArea(), local = new StorageArea('local'), indexedDB = new IDBFactory(), deliverToTab = null } = {}) {
  const runtimeListeners = [];
  const pageMessages = [];
  const tabMessages = [];

  const context = vm.createContext({
    console: { log() {}, debug() {}, info() {}, warn() {}, error() {} },
    setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask, structuredClone,
    crypto: globalThis.crypto,
    indexedDB,
    IDBKeyRange,
    Error, Date, JSON, Math, Promise,
    chrome: {
      runtime: {
        getManifest: () => ({ name: 'LJM Test', version: '9.9.9' }),
        getURL: (path) => `chrome-extension://test/${path}`,
        onMessage: { addListener: (listener) => runtimeListeners.push(listener) },
        onInstalled: { addListener() {} },
        sendMessage: async (message) => { pageMessages.push(clone(message)); },
      },
      contextMenus: { onClicked: { addListener() {} }, removeAll() {}, create() {} },
      tabs: {
        create() {},
        query: async () => (deliverToTab ? [{ id: 1, incognito: false }] : []),
        sendMessage: async (tabId, message) => {
          tabMessages.push({ tabId, message: clone(message) });
          deliverToTab?.(clone(message));
        },
      },
      storage: {
        sync,
        local,
        onChanged: {
          addListener: (listener) => {
            sync.listeners.push(listener);
            local.listeners.push(listener);
          },
        },
      },
    },
  });
  context.globalThis = context;
  vm.runInContext(backgroundSource, context, { filename: 'background-bundle.js' });

  return {
    context,
    sync,
    local,
    indexedDB,
    pageMessages,
    tabMessages,
    ready: () => vm.runInContext('ensureDataReady()', context),
    send(message, sender = { tab: { id: 1, incognito: false } }) {
      return new Promise((resolvePromise) => {
        const handled = runtimeListeners.some((listener) => listener(clone(message), sender, (r) => resolvePromise(clone(r))) === true);
        if (!handled) resolvePromise(undefined);
      });
    },
    idle: () => vm.runInContext('dataMutationQueue', context),
  };
}

// Waits until queued storage events and serialised mutations settle.
export async function settle(...devices) {
  for (let i = 0; i < 5; i += 1) {
    await new Promise((r) => setTimeout(r, 5));
    for (const device of devices) await device.idle();
  }
}
