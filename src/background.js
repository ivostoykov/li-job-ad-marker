importScripts('src/js/constants.js');

const MENU_BLACKLIST_TOGGLE = 'blacklist-toggle';
const MENU_MARKER_TOGGLE = 'marker-toggle';
const MENU_APPLIED_MARK = 'applied-mark';
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

  if ([MENU_BLACKLIST_TOGGLE, MENU_MARKER_TOGGLE, MENU_APPLIED_MARK].includes(info.menuItemId)) {
    chrome.tabs.sendMessage(tab.id, { action: info.menuItemId });
  }
});
