import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';

let page;
afterEach(() => page?.window.close());

async function openBackupOptions(respond) {
  page = new JSDOM(readFileSync('src/options.html', 'utf8'), {
    url: 'https://extension.test/options.html', runScripts: 'outside-only'
  });
  const { window } = page;
  await new Promise((resolve) => window.addEventListener('DOMContentLoaded', resolve));
  const messages = [];
  const writes = [];
  let stored = {};
  window.chrome = {
    runtime: {
      getManifest: () => ({ name: 'Test', version: '1' }),
      onMessage: { addListener: () => {} },
      sendMessage: async (message) => {
        messages.push(message);
        if (message.action === 'sync.status') return { ok: true, status: { mirror: 'ok' } };
        return respond(message, (value) => { stored = value; });
      }
    },
    storage: { sync: {
      get: async () => ({ 'ljm-options': stored }),
      set: async (value) => { writes.push(value); }
    } }
    // Deliberately no tabs API: backups must work without a LinkedIn tab.
  };
  for (const file of ['src/js/settings.js', 'src/js/options.js']) window.eval(readFileSync(file, 'utf8'));
  window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
  await vi.waitFor(() => expect(window.document.getElementById('colour-viewed').value).toBe('0.45'));
  return { window, messages, writes };
}

function chooseBackup(window, text, unreadable = false) {
  let input;
  const createElement = window.document.createElement.bind(window.document);
  window.document.createElement = (...args) => {
    const el = createElement(...args);
    if (args[0] === 'input') input = el;
    return el;
  };
  window.FileReader = class {
    readAsText() {
      this.result = text;
      if (unreadable) this.onerror();
      else this.onload();
    }
  };
  window.document.getElementById('btn-import').click();
  Object.defineProperty(input, 'files', { value: [{}] });
  input.dispatchEvent(new window.Event('change'));
}

describe('complete backup options interface', () => {
  it('downloads the complete background snapshot unchanged without the tabs API', async () => {
    const data = { format: 'ljm-export', schemaVersion: 2, options: {},
      jobs: [{ id: 'job', deletedAt: 10 }], companies: [],
      notes: [{ id: 'a', linkedInJobId: null }, { id: 'b', linkedInJobId: null, deletedAt: 9 }] };
    const { window, messages } = await openBackupOptions(async () => ({ ok: true, data }));
    let blob;
    window.URL.createObjectURL = (value) => { blob = value; return 'blob:test'; };
    window.URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(window.HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    window.document.getElementById('btn-export').click();
    await vi.waitFor(() => expect(click).toHaveBeenCalledOnce());
    const content = await new Promise((resolve) => {
      const reader = new window.FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsText(blob);
    });
    expect(JSON.parse(content)).toEqual(data);
    expect(messages.some((message) => message.action === 'data.export')).toBe(true);
    expect(window.document.getElementById('message').textContent).toBe('Backup download started.');
    await vi.waitFor(() => expect(window.URL.revokeObjectURL).toHaveBeenCalledWith('blob:test'));
  });

  it('sends the entire import to the background and refreshes committed settings', async () => {
    const data = { format: 'ljm-export', schemaVersion: 2, options: { debug: true }, jobs: [], companies: [], notes: [] };
    const { window, messages, writes } = await openBackupOptions(async (_message, commit) => {
      commit({ debug: true });
      return { ok: true, counts: { jobs: 0, companies: 0, notes: 0 } };
    });
    chooseBackup(window, JSON.stringify(data));
    await vi.waitFor(() => expect(window.document.getElementById('message').textContent).toBe('Imported.'));
    expect(messages.find((message) => message.action === 'data.import').data).toEqual(data);
    expect(writes).toEqual([]);
    expect(window.document.getElementById('debug').checked).toBe(true);
  });

  it('shows validation errors without changing saved settings or writing data from the UI', async () => {
    const { window, writes } = await openBackupOptions(async () => ({ ok: false, error: 'Invalid note timestamp' }));
    chooseBackup(window, JSON.stringify({ options: { debug: true }, notes: [{ updatedAt: 'bad' }] }));
    await vi.waitFor(() => expect(window.document.getElementById('message').textContent).toBe('Import failed: Invalid note timestamp'));
    expect(writes).toEqual([]);
    expect(window.document.getElementById('debug').checked).toBe(false);
    expect(window.document.getElementById('btn-save').disabled).toBe(false);
  });

  it('rejects unreadable or malformed files before messaging the background', async () => {
    const { window, messages } = await openBackupOptions(async () => { throw new Error('Must not be called'); });
    chooseBackup(window, '{');
    expect(window.document.getElementById('message').textContent).toMatch(/^Import failed:/);
    expect(messages.filter((message) => message.action === 'data.import')).toHaveLength(0);
    chooseBackup(window, '', true);
    expect(window.document.getElementById('message').textContent).toBe('Import failed: the file could not be read.');
    expect(window.document.getElementById('btn-import').disabled).toBe(false);
  });

  it('prevents overlapping UI writes while an import is pending and recovers from transport failure', async () => {
    let reject;
    const { window } = await openBackupOptions(() => new Promise((_resolve, fail) => { reject = fail; }));
    chooseBackup(window, '{}');
    for (const id of ['btn-save', 'btn-export', 'btn-import']) expect(window.document.getElementById(id).disabled).toBe(true);
    reject(new Error('Worker unavailable'));
    await vi.waitFor(() => expect(window.document.getElementById('message').textContent).toBe('Import failed: Worker unavailable'));
    for (const id of ['btn-save', 'btn-export', 'btn-import']) expect(window.document.getElementById(id).disabled).toBe(false);
  });

  it('reports export failure without creating a partial download', async () => {
    const { window } = await openBackupOptions(async () => ({ ok: false, error: 'Database unavailable' }));
    window.URL.createObjectURL = vi.fn();
    window.document.getElementById('btn-export').click();
    await vi.waitFor(() => expect(window.document.getElementById('message').textContent).toBe('Export failed: Database unavailable'));
    expect(window.URL.createObjectURL).not.toHaveBeenCalled();
    expect(window.document.getElementById('btn-export').disabled).toBe(false);
  });

  it('shows a persistent sync warning independently of backup messages and clears it on recovery', async () => {
    const { window } = await openBackupOptions(async () => ({ ok: true }));
    window.chrome.runtime.sendMessage = async () => ({ ok: true, status: { mirror: 'full' } });
    await window.refreshSyncStatus();
    expect(window.document.getElementById('sync-status').textContent).toContain('saved on this device');
    window.showMessage('Imported.', 'success');
    expect(window.document.getElementById('sync-status').textContent).toContain('sync is paused');
    window.chrome.runtime.sendMessage = async () => ({ ok: true, status: { mirror: 'ok' } });
    await window.refreshSyncStatus();
    expect(window.document.getElementById('sync-status').textContent).toBe('');
    expect(window.document.getElementById('message').textContent).toBe('Imported.');
  });

  it('prevents import and export during an outstanding Save and reports a failed write', async () => {
    const { window, messages } = await openBackupOptions(async () => ({ ok: true }));
    let reject;
    window.chrome.storage.sync.set = () => new Promise((_resolve, fail) => { reject = fail; });
    window.document.getElementById('debug').checked = true;
    window.document.getElementById('btn-save').click();
    for (const id of ['btn-save', 'btn-export', 'btn-import']) expect(window.document.getElementById(id).disabled).toBe(true);
    window.document.getElementById('btn-export').click();
    expect(messages.some((message) => message.action === 'data.export')).toBe(false);
    reject(new Error('Storage unavailable'));
    await vi.waitFor(() => expect(window.document.getElementById('message').textContent).toBe('Save failed: Storage unavailable'));
    for (const id of ['btn-save', 'btn-export', 'btn-import']) expect(window.document.getElementById(id).disabled).toBe(false);
    expect(window.document.getElementById('debug').checked).toBe(true);
  });
});
