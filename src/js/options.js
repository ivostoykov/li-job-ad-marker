let savedOptions = null;

function getAgeingLimitInputValue() {
  return document.getElementById('ageing-limit-days').value.trim();
}

function formToOptions() {
  return {
    debug: document.getElementById('debug').checked,
    ageingLimitDays: getAgeingLimitInputValue(),
    treatPromotedAsViewed: document.getElementById('treat-promoted-as-viewed').checked,
    unwantedTitleWords: document.getElementById('unwanted-title-words').value,
    colours: {
      viewed: parseFloat(document.getElementById('colour-viewed').value),
      applied: document.getElementById('colour-applied').value,
      blacklisted: document.getElementById('colour-blacklisted').value
    }
  };
}

function populateForm(options) {
  document.getElementById('debug').checked = options.debug;
  document.getElementById('ageing-limit-days').value = options.ageingLimitDays;
  document.getElementById('treat-promoted-as-viewed').checked = options.treatPromotedAsViewed;
  document.getElementById('unwanted-title-words').value = options.unwantedTitleWords;
  document.getElementById('colour-viewed').value = options.colours.viewed;
  document.getElementById('colour-viewed-val').value = options.colours.viewed;
  document.getElementById('colour-applied').value = options.colours.applied;
  document.getElementById('colour-blacklisted').value = options.colours.blacklisted;
  updateAgeingLimitStatus();
}

function isDirty() {
  if (!savedOptions) return false;
  return JSON.stringify(formToOptions()) !== JSON.stringify(savedOptions);
}

function showMessage(text, type) {
  const el = document.getElementById('message');
  el.textContent = text;
  el.className = type ?? '';
}

function updateAgeingLimitStatus() {
  const status = document.getElementById('ageing-limit-status');
  const ageingLimitDays = getValidAgeingLimitDays({ ageingLimitDays: getAgeingLimitInputValue() });
  status.textContent = ageingLimitDays === null ? '(disabled)' : '';
}

async function refreshSyncStatus() {
  const el = document.getElementById('sync-status');
  try {
    const response = await chrome.runtime.sendMessage({ action: 'sync.status' });
    if (!response?.ok) throw new Error(response?.error || 'Sync status unavailable');
    el.textContent = response.status?.mirror === 'ok' ? ''
      : 'Blacklist sync is paused. Your data is still saved on this device. Sync will retry automatically.';
  } catch {
    el.textContent = 'Blacklist sync status is unavailable. Your local data has not been changed.';
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  const mf = chrome.runtime.getManifest();
  document.title = `${mf.name} v${mf.version} — Options`;
  document.getElementById('ext-title').textContent = `${mf.name} v${mf.version}`;

  savedOptions = normaliseOptions(await getOptions());
  populateForm(savedOptions);
  void refreshSyncStatus();

  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'data-changed' || message.action === 'sync-status-changed') {
      void refreshSyncStatus();
    }
  });

  document.getElementById('colour-viewed').addEventListener('input', (e) => {
    document.getElementById('colour-viewed-val').value = e.target.value;
  });

  document.getElementById('ageing-limit-days').addEventListener('input', () => {
    updateAgeingLimitStatus();
  });

  document.getElementById('btn-save').addEventListener('click', async () => {
    const buttons = ['btn-save', 'btn-import', 'btn-export'].map((id) => document.getElementById(id));
    buttons.forEach((button) => { button.disabled = true; });
    try {
      const options = normaliseOptions(formToOptions());
      await setOptions(options);
      savedOptions = options;
      showMessage('Saved.', 'success');
    } catch (err) {
      showMessage(`Save failed: ${err.message}`, 'error');
    } finally {
      buttons.forEach((button) => { button.disabled = false; });
    }
  });

  document.getElementById('btn-cancel').addEventListener('click', () => {
    populateForm(savedOptions);
    showMessage('');
  });

  document.getElementById('btn-export').addEventListener('click', async () => {
    const buttons = ['btn-save', 'btn-import', 'btn-export'].map((id) => document.getElementById(id));
    buttons.forEach((button) => { button.disabled = true; });
    try {
      const response = await chrome.runtime.sendMessage({ action: 'data.export' });
      if (!response?.ok || !response.data) throw new Error(response?.error || 'Backup unavailable');
      const blob = new Blob([JSON.stringify(response.data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      try {
        const a = document.createElement('a');
        a.href = url;
        a.download = `ljm-export-${new Date().toISOString().split('T')[0]}.json`;
        a.click();
      } finally {
        setTimeout(() => URL.revokeObjectURL(url), 0);
      }
      showMessage('Backup download started.', 'success');
    } catch (err) {
      showMessage(`Export failed: ${err.message}`, 'error');
    } finally {
      buttons.forEach((button) => { button.disabled = false; });
    }
  });

  document.getElementById('btn-import').addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const buttons = ['btn-save', 'btn-import', 'btn-export'].map((id) => document.getElementById(id));
      buttons.forEach((button) => { button.disabled = true; });
      const reader = new FileReader();
      reader.onerror = () => {
        showMessage('Import failed: the file could not be read.', 'error');
        buttons.forEach((button) => { button.disabled = false; });
      };
      reader.onload = async () => {
        try {
          const data = JSON.parse(reader.result);
          const response = await chrome.runtime.sendMessage({ action: 'data.import', data });
          if (!response?.ok) throw new Error(response?.error || 'Restore unavailable');
          try {
            savedOptions = normaliseOptions(await getOptions());
            populateForm(savedOptions);
            showMessage('Imported.', 'success');
          } catch {
            showMessage('Imported. Reload this page to see the restored settings.', 'success');
          }
          await refreshSyncStatus();
        } catch (err) {
          showMessage(`Import failed: ${err.message}`, 'error');
        } finally {
          buttons.forEach((button) => { button.disabled = false; });
        }
      };
      reader.readAsText(file);
    });
    input.click();
  });

  document.getElementById('btn-close').addEventListener('click', () => {
    if (isDirty() && !confirm('You have unsaved changes. Close anyway?')) return;
    window.close();
  });
});
