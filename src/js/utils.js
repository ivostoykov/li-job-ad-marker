const manifest = chrome.runtime.getManifest();

function getLineNumber(skipNames = []) {
  const e = new Error();
  const stackLines = e.stack?.split('\n').map((line) => line.trim()).slice(1) ?? [];
  const skipSet = new Set([getLineNumber.name, ...skipNames]);
  const targetLine = stackLines.find((line) => {
    return ![...skipSet].some((name) => line.includes(name));
  });

  return targetLine
    ?.replace(/\s{0,}at\s+/, '')
    ?.replace(/^.*?\/([^/]+\/[^/]+:\d+:\d+)$/, '$1')
    ?.split('/')?.pop().replace(/\)$/, '')
    || 'Unknown';
}

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const TYPE_RANK = { viewed: 1, applied: 2 };

function normaliseNameKey(text) {
  return String(text ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function noteGroupKey(title, company) {
  return `${normaliseNameKey(title)}\u001f${normaliseNameKey(company)}`;
}

// Local calendar date `YYYY-MM-DD`; statistics buckets use the user's local day.
function localDateKey(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
