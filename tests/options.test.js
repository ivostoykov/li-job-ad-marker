import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDevice, SyncArea } from './helpers/background-device.js';

let page;
afterEach(() => page?.window.close());

async function openOptions(stored) {
  page = new JSDOM(readFileSync('src/options.html', 'utf8'), {
    url: 'https://extension.test/options.html', runScripts: 'outside-only'
  });
  const { window } = page;
  await new Promise((resolve) => window.addEventListener('DOMContentLoaded', resolve));
  const writes = [];
  // Settings saves go through the real background `settings.set` route.
  const sync = new SyncArea();
  if (stored !== undefined) sync.data.set('ljm-options', stored);
  const write = sync.set.bind(sync);
  sync.set = async (value) => {
    if ('ljm-options' in value) writes.push(value);
    return write(value);
  };
  const background = createDevice({ sync });
  window.chrome = {
    runtime: { getManifest: () => ({ name: 'Test', version: '1' }), sendMessage: (message) => background.send(message) },
    storage: { sync }
  };
  for (const file of ['src/js/settings.js', 'src/js/options.js']) {
    window.eval(readFileSync(file, 'utf8'));
  }
  window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
  await vi.waitFor(() => expect(window.document.getElementById('colour-viewed').value).toBe('0.45'));
  return { window, writes };
}

describe('options page settings paths', () => {
  it('loads malformed stored settings safely and saves form values through shared validation', async () => {
    const { window, writes } = await openOptions({ debug: 'false', colours: { viewed: -1, applied: 'red' } });
    const doc = window.document;
    expect(doc.getElementById('debug').checked).toBe(false);
    expect(doc.getElementById('colour-viewed').value).toBe('0.45');
    expect(doc.getElementById('colour-applied').value).toBe('#32cd32');
    doc.getElementById('debug').checked = true;
    doc.getElementById('colour-viewed').value = '0';
    doc.getElementById('btn-save').click();
    await vi.waitFor(() => expect(doc.getElementById('message').textContent).toBe('Saved.'));
    expect(writes).toHaveLength(1);
    expect(writes[0]['ljm-options'].debug).toBe(true);
    expect(writes[0]['ljm-options'].colours.viewed).toBe(0);
    expect(doc.getElementById('message').textContent).toBe('Saved.');
  });

  it('imports malformed colours and booleans using defaults before storing or populating the form', async () => {
    const { window, writes } = await openOptions({});
    const doc = window.document;
    let fileInput;
    const createElement = doc.createElement.bind(doc);
    doc.createElement = (...args) => {
      const el = createElement(...args);
      if (args[0] === 'input') fileInput = el;
      return el;
    };
    window.FileReader = class {
      readAsText() {
        this.result = JSON.stringify({ options: { debug: 'false', treatPromotedAsViewed: [],
          unwantedTitleWords: ['bad'], colours: { viewed: '0.1', applied: '#abc', blacklisted: '#123456; } body { color:red' } } });
        this.onloadend();
      }
    };
    doc.getElementById('btn-import').click();
    Object.defineProperty(fileInput, 'files', { value: [{}] });
    fileInput.dispatchEvent(new window.Event('change'));
    await vi.waitFor(() => expect(doc.getElementById('message').textContent).toBe('Imported.'));
    expect(writes).toHaveLength(1);
    expect(writes[0]['ljm-options']).toEqual(globalThis._testExports.SETTINGS_DEFAULTS);
    expect(doc.getElementById('debug').checked).toBe(false);
    expect(doc.getElementById('treat-promoted-as-viewed').checked).toBe(false);
    expect(doc.getElementById('colour-blacklisted').value).toBe('#b41e1e');
  });
});
