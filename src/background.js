const MENU_BLACKLIST_TOGGLE = 'blacklist-toggle';
const MENU_MARKER_TOGGLE = 'marker-toggle';

chrome.runtime.onInstalled.addListener(() => {
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
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === MENU_BLACKLIST_TOGGLE || info.menuItemId === MENU_MARKER_TOGGLE) {
    chrome.tabs.sendMessage(tab.id, { action: info.menuItemId });
  }
});
