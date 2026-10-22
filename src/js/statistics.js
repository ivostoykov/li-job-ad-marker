// Statistics page (#19). Reads daily aggregates from the background and sums
// the local-date buckets of the selected period. Works without a LinkedIn tab.

const STATISTICS_COUNT_FIELDS = ['total', 'new', 'viewed', 'applied', 'blacklisted', 'unwantedTitle', 'ageing'];
const STATISTICS_RESET_PROMPT = 'Reset all statistics? Jobs, notes and the blacklist are not affected.';

let statisticsData = { days: [], trackingSince: null };

function dateFromKey(key) {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day);
}

// Inclusive `YYYY-MM-DD` bounds; `from: null` means no lower bound. Weeks start on Monday.
function statisticsPeriodRange(period, today = new Date(), sinceKey = null) {
  const year = today.getFullYear();
  const month = today.getMonth();
  const date = today.getDate();
  switch (period) {
    case 'week': {
      const offset = (today.getDay() + 6) % 7;
      return { from: localDateKey(new Date(year, month, date - offset)), to: localDateKey(new Date(year, month, date - offset + 6)) };
    }
    case 'month':
      return { from: localDateKey(new Date(year, month, 1)), to: localDateKey(new Date(year, month + 1, 0)) };
    case 'all':
      return { from: null, to: null };
    case 'since':
      return { from: sinceKey || localDateKey(today), to: localDateKey(today) };
    default:
      return { from: localDateKey(today), to: localDateKey(today) };
  }
}

function statisticsSum(days, range) {
  const totals = Object.fromEntries(STATISTICS_COUNT_FIELDS.map((field) => [field, 0]));
  for (const day of days) {
    if (range.from && day.date < range.from) continue;
    if (range.to && day.date > range.to) continue;
    STATISTICS_COUNT_FIELDS.forEach((field) => { totals[field] += day[field] ?? 0; });
  }
  return totals;
}

function formatDay(key, options = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) {
  return dateFromKey(key).toLocaleDateString(undefined, options);
}

function describeRange(period, range) {
  if (period === 'all') return 'All recorded days';
  if (range.from === range.to) return formatDay(range.from);
  const short = { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' };
  return `${formatDay(range.from, short)} – ${formatDay(range.to, short)}`;
}

function selectedPeriod() {
  return document.querySelector('input[name="period"]:checked')?.value ?? 'today';
}

function renderStatistics() {
  const period = selectedPeriod();
  const today = new Date();
  const todayKey = localDateKey(today);
  const sinceInput = document.getElementById('since-date');
  sinceInput.disabled = period !== 'since';
  sinceInput.max = todayKey;

  const range = statisticsPeriodRange(period, today, sinceInput.value);
  const totals = statisticsSum(statisticsData.days, range);
  document.getElementById('period-range').textContent = describeRange(period, range);

  STATISTICS_COUNT_FIELDS.forEach((field) => {
    document.getElementById(`stat-${field}`).textContent = totals[field].toLocaleString();
  });
  ['new', 'viewed', 'applied'].forEach((field) => {
    const share = totals.total ? (totals[field] / totals.total) * 100 : 0;
    document.getElementById(`bar-${field}`).style.width = `${share}%`;
    document.getElementById(`share-${field}`).textContent = totals.total ? `${Math.round(share)}%` : '';
  });

  const trackingKey = statisticsData.trackingSince ? localDateKey(new Date(statisticsData.trackingSince)) : null;
  document.getElementById('tracking-since').textContent = trackingKey
    ? `Tracking since ${formatDay(trackingKey)}`
    : 'Nothing counted yet. Counting starts the next time job cards appear on a LinkedIn results page.';

  const partial = document.getElementById('partial-note');
  let partialText = '';
  if (period === 'since' && range.from > todayKey) {
    partialText = 'Choose a date on or before today.';
  } else if (trackingKey && range.to && trackingKey > range.to) {
    partialText = 'Tracking started after this period, so it has no counts.';
  } else if (trackingKey && range.from && trackingKey > range.from) {
    partialText = `Partial period: tracking started on ${formatDay(trackingKey)}.`;
  }
  partial.textContent = partialText;
  partial.hidden = !partialText;
}

async function loadStatistics() {
  const error = document.getElementById('load-error');
  try {
    const response = await chrome.runtime.sendMessage({ action: 'stats.get' });
    if (!response?.ok) throw new Error(response?.error || 'No response');
    statisticsData = response.statistics;
    error.hidden = true;
    error.textContent = '';
  } catch (e) {
    error.textContent = `Statistics could not be loaded: ${e?.message || e}`;
    error.hidden = false;
  }
  const sinceInput = document.getElementById('since-date');
  if (!sinceInput.value) {
    sinceInput.value = statisticsData.trackingSince
      ? localDateKey(new Date(statisticsData.trackingSince))
      : localDateKey();
  }
  renderStatistics();
}

async function resetStatistics() {
  if (!window.confirm(STATISTICS_RESET_PROMPT)) return;
  const button = document.getElementById('btn-reset');
  const message = document.getElementById('reset-message');
  button.disabled = true;
  try {
    const response = await chrome.runtime.sendMessage({ action: 'stats.reset' });
    if (!response?.ok) throw new Error(response?.error || 'No response');
    document.getElementById('since-date').value = '';
    message.textContent = 'Statistics reset.';
    await loadStatistics();
  } catch (e) {
    message.textContent = `Statistics were not reset: ${e?.message || e}`;
  } finally {
    button.disabled = false;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const mf = chrome.runtime.getManifest();
  document.title = `${mf.name} — Statistics`;
  document.getElementById('ext-title').textContent = `${mf.name} v${mf.version}`;

  document.querySelectorAll('input[name="period"]').forEach((input) => {
    input.addEventListener('change', renderStatistics);
  });
  document.getElementById('since-date').addEventListener('change', renderStatistics);
  document.getElementById('btn-reset').addEventListener('click', () => void resetStatistics());

  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'statistics-changed') void loadStatistics();
  });

  void loadStatistics();
});
