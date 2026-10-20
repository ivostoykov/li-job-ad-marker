import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const listeners = {};
const backgroundChrome = {
  runtime: {
    getURL: (path) => `chrome-extension://test/${path}`,
    onInstalled: { addListener: (listener) => { listeners.installed = listener; } },
  },
  contextMenus: {
    removeAll: (callback) => callback(),
    create: vi.fn(),
    onClicked: { addListener: (listener) => { listeners.clicked = listener; } },
  },
  tabs: { create: vi.fn(), sendMessage: vi.fn() },
};

describe('background note menus', () => {
  beforeAll(() => {
    // eslint-disable-next-line no-eval
    (0, eval)(
      `((chrome, importScripts) => {\n${readFileSync(resolve(process.cwd(), 'src/background.js'), 'utf-8')}\n})`,
    )(backgroundChrome, () => {});
  });

  beforeEach(() => {
    backgroundChrome.tabs.sendMessage.mockClear();
  });

  it('registers Add note and Show notes for LinkedIn pages and links', () => {
    listeners.installed();

    const created = backgroundChrome.contextMenus.create.mock.calls.map(([item]) => item);
    expect(created).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'add-note', title: 'Add note', contexts: ['page', 'link'] }),
      expect.objectContaining({ id: 'show-notes', title: 'Show notes', contexts: ['page', 'link'] }),
    ]));
  });

  it.each(['add-note', 'show-notes'])('sends %s only to the clicked frame', (menuItemId) => {
    listeners.clicked({ menuItemId, frameId: 7 }, { id: 42 });

    expect(backgroundChrome.tabs.sendMessage).toHaveBeenCalledTimes(1);
    expect(backgroundChrome.tabs.sendMessage).toHaveBeenCalledWith(42, { action: menuItemId }, { frameId: 7 });
  });

  it('targets the top frame when the click came from it', () => {
    listeners.clicked({ menuItemId: 'add-note', frameId: 0 }, { id: 42 });

    expect(backgroundChrome.tabs.sendMessage).toHaveBeenCalledWith(42, { action: 'add-note' }, { frameId: 0 });
  });
});
