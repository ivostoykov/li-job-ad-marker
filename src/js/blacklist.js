const BLACKLIST_KEY = 'blacklistedCompanies';

function blGetList() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(BLACKLIST_KEY, (result) => {
      resolve(result[BLACKLIST_KEY] ?? []);
    });
  });
}

function blSaveList(list) {
  return new Promise((resolve) => {
    chrome.storage.sync.set({ [BLACKLIST_KEY]: list }, resolve);
  });
}

function blAdd(companyName) {
  return blGetList().then((list) => {
    if (!list.includes(companyName)) {
      return blSaveList([...list, companyName]);
    }
  });
}

function blRemove(companyName) {
  return blGetList().then((list) => blSaveList(list.filter((n) => n !== companyName)));
}

function blIncludes(companyName) {
  return blGetList().then((list) => list.includes(companyName));
}
