let savedOptions = null;

function formToOptions() {
  return {
    debug: document.getElementById('debug').checked,
    colours: {
      viewed: parseFloat(document.getElementById('colour-viewed').value),
      applied: document.getElementById('colour-applied').value,
      blacklisted: document.getElementById('colour-blacklisted').value
    }
  };
}

function populateForm(options) {
  document.getElementById('debug').checked = options.debug;
  document.getElementById('colour-viewed').value = options.colours.viewed;
  document.getElementById('colour-viewed-val').value = options.colours.viewed;
  document.getElementById('colour-applied').value = options.colours.applied;
  document.getElementById('colour-blacklisted').value = options.colours.blacklisted;
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

async function getJobsFromLinkedIn() {
  const tabs = await chrome.tabs.query({ url: 'https://www.linkedin.com/*' });
  if (!tabs.length) return null;
  try {
    const response = await chrome.tabs.sendMessage(tabs[0].id, { action: 'get-all-jobs' });
    return response?.jobs ?? [];
  } catch {
    return null;
  }
}

async function importJobsToLinkedIn(jobs) {
  const tabs = await chrome.tabs.query({ url: 'https://www.linkedin.com/*' });
  if (!tabs.length) return false;
  try {
    const response = await chrome.tabs.sendMessage(tabs[0].id, { action: 'import-jobs', jobs });
    return response?.ok ?? false;
  } catch {
    return false;
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  const mf = chrome.runtime.getManifest();
  document.title = `${mf.name} — Options`;
  document.getElementById('ext-title').textContent = `${mf.name} v${mf.version}`;

  savedOptions = await getOptions();
  populateForm(savedOptions);

  document.getElementById('colour-viewed').addEventListener('input', (e) => {
    document.getElementById('colour-viewed-val').value = e.target.value;
  });

  document.getElementById('btn-save').addEventListener('click', async () => {
    const options = formToOptions();
    await setOptions(options);
    savedOptions = options;
    showMessage('Saved.', 'success');
  });

  document.getElementById('btn-cancel').addEventListener('click', () => {
    populateForm(savedOptions);
    showMessage('');
  });

  document.getElementById('btn-export').addEventListener('click', async () => {
    const mf = chrome.runtime.getManifest();
    const [options, blacklist, jobs] = await Promise.all([
      getOptions(),
      blGetList(),
      getJobsFromLinkedIn()
    ]);

    const payload = { version: mf.version, options, blacklist };
    if (jobs !== null) payload.jobs = jobs;

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ljm-export-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);

    showMessage(
      jobs === null ? 'Exported (no LinkedIn tab open — jobs not included).' : 'Exported.',
      'success'
    );
  });

  document.getElementById('btn-import').addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onloadend = async () => {
        try {
          const data = JSON.parse(reader.result);

          if (data.options) {
            await setOptions(data.options);
            savedOptions = data.options;
            populateForm(savedOptions);
          }

          if (Array.isArray(data.blacklist)) {
            await blSaveList(data.blacklist);
          }

          let jobsNote = '';
          if (Array.isArray(data.jobs) && data.jobs.length) {
            const ok = await importJobsToLinkedIn(data.jobs);
            jobsNote = ok ? '' : ' Jobs skipped — no LinkedIn tab open.';
          }

          showMessage(`Imported.${jobsNote}`, 'success');
        } catch (err) {
          showMessage(`Import failed: ${err.message}`, 'error');
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
