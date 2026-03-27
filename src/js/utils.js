const manifest = chrome.runtime.getManifest();

function getLineNumber() {
  const e = new Error();
  const stackLines = e.stack.split('\n').map((line) => line.trim());
  const index = stackLines.findIndex((line) => line.includes(getLineNumber.name));
  return stackLines[index + 1]
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
