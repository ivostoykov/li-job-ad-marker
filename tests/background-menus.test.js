import { beforeEach, describe, expect, it } from 'vitest';
import { createDevice } from './helpers/background-device.js';

let device;
describe('background note menus', () => {
  beforeEach(async () => {
    device = createDevice();
    await device.ready();
  });

  it('registers Add note and Show notes for LinkedIn pages and links', () => {
    device.menuListeners.installed();
    expect(device.menuItems).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'add-note', title: 'Add note', contexts: ['page', 'link'] }),
      expect.objectContaining({ id: 'show-notes', title: 'Show notes', contexts: ['page', 'link'] }),
    ]));
  });

  it.each(['add-note', 'show-notes'])('sends %s only to the clicked frame', (menuItemId) => {
    device.menuListeners.clicked({ menuItemId, frameId: 7 }, { id: 42 });
    expect(device.tabMessages).toEqual([{ tabId: 42, message: { action: menuItemId }, options: { frameId: 7 } }]);
  });

  it('targets the top frame when the click came from it', () => {
    device.menuListeners.clicked({ menuItemId: 'add-note', frameId: 0 }, { id: 42 });
    expect(device.tabMessages).toEqual([{ tabId: 42, message: { action: 'add-note' }, options: { frameId: 0 } }]);
  });
});
