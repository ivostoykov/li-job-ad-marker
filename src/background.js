importScripts('js/utils.js');
importScripts('js/settings.js');
importScripts('js/log.js');

const MENU_BLACKLIST_TOGGLE = 'blacklist-toggle';
const MENU_MARKER_TOGGLE = 'marker-toggle';
const MENU_APPLIED_MARK = 'applied-mark';
const MENU_IGNORE_TITLE = 'ignore-title';
const MENU_IGNORE_SELECTION = 'ignore-selection';
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

  if (info.menuItemId === MENU_IGNORE_SELECTION) {
    chrome.tabs.sendMessage(tab.id, { action: MENU_IGNORE_SELECTION, text: info.selectionText });
  }
});
