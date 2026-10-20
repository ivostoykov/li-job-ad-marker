import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { defaultJobsAdapter, getNotesPopupState, setMarkerEnabled, stopObservingCards } =
  globalThis._testExports;

// Provided by src/js/utils.js on the background data branch (dev1).
globalThis.normaliseNameKey ??= (text) => String(text ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function holdAction(background, action) {
  const held = [];
  const passThrough = background.sendMessage.getMockImplementation();
  background.sendMessage.mockImplementation((message) => {
    if (message.action !== action) return passThrough(message);
    const gate = deferred();
    held.push({ message, release: (override) => gate.resolve(override ?? passThrough(message)) });
    return gate.promise;
  });
  return held;
}

function groupKeyOf({ title, company }) {
  const normalise = (text) => String(text ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
  return `${normalise(title)}\u001f${normalise(company)}`;
}

function createNotesBackground() {
  const notes = [];
  let clock = 1_700_000_000_000;
  let sequence = 0;

  const handlers = {
    'notes.listGroup': (message) => ({
      ok: true,
      notes: notes
        .filter((note) => !note.deletedAt && note.groupKey === groupKeyOf(message))
        .sort((a, b) => b.createdAt - a.createdAt),
    }),
    'notes.add': ({ linkedInJobId, title, company, companySlug, text }) => {
      clock += 1000;
      sequence += 1;
      const note = {
        id: `note-${sequence}`,
        groupKey: groupKeyOf({ title, company }),
        title,
        company,
        companySlug: companySlug ?? null,
        linkedInJobId,
        text,
        createdAt: clock,
        updatedAt: clock,
        deletedAt: null,
      };
      notes.push(note);
      return { ok: true, note };
    },
    'notes.update': ({ id, text }) => {
      const note = notes.find((entry) => entry.id === id);
      clock += 1000;
      Object.assign(note, { text, updatedAt: clock });
      return { ok: true, note };
    },
    'notes.delete': ({ id }) => {
      const note = notes.find((entry) => entry.id === id);
      clock += 1000;
      Object.assign(note, { deletedAt: clock, updatedAt: clock });
      return { ok: true, note };
    },
    'notes.groupsWithNotes': ({ groups }) => ({
      ok: true,
      matches: groups.map((group) =>
        notes.some((note) => !note.deletedAt && note.groupKey === groupKeyOf(group)),
      ),
    }),
  };

  const sendMessage = vi.fn(async (message) =>
    handlers[message.action]?.(message) ?? { ok: false, error: `unknown ${message.action}` },
  );

  return { notes, sendMessage };
}

function makeCard({ jobId = '111', title = 'Senior Engineer', company = 'Acme Corp', viewed = true } = {}) {
  const card = document.createElement('div');
  card.className = 'job-card-container';
  if (jobId) card.dataset.jobId = jobId;

  const link = document.createElement('a');
  link.className = 'job-card-container__link';
  if (jobId) link.href = `/jobs/view/${jobId}`;
  link.textContent = title;
  card.appendChild(link);

  const companyEl = document.createElement('span');
  companyEl.className = 'artdeco-entity-lockup__subtitle';
  companyEl.textContent = company;
  card.appendChild(companyEl);

  if (viewed) {
    const state = document.createElement('li');
    state.className = 'job-card-container__footer-item job-card-container__footer-job-state';
    state.textContent = 'Viewed';
    card.appendChild(state);
  }

  document.body.appendChild(card);
  return card;
}

function flushAsyncWork() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function sendContentMessage(message) {
  globalThis.__runtimeMessageListeners.forEach((listener) => listener(message, {}, () => {}));
  for (let i = 0; i < 5; i += 1) await flushAsyncWork();
}

async function rightClickAndSend(card, action) {
  card.querySelector('a').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
  await sendContentMessage({ action });
}

function popup() {
  return document.getElementById('ljm-notes-popup');
}

function entries() {
  return [...popup().querySelectorAll('.ljm-notes-entry')].map((item) => ({
    id: item.dataset.noteId,
    meta: item.querySelector('.ljm-notes-meta').textContent,
    text: item.querySelector('.ljm-notes-text')?.textContent ?? null,
  }));
}

async function typeAndAdd(text) {
  popup().querySelector('.ljm-notes-draft textarea').value = text;
  popup().querySelector('.ljm-notes-add').click();
  for (let i = 0; i < 5; i += 1) await flushAsyncWork();
}

function buttonIn(item, label) {
  return [...item.querySelectorAll('button')].find((button) => button.textContent === label);
}

function actionsSent(sendMessage) {
  return sendMessage.mock.calls.map(([message]) => message.action);
}

describe('card notes UI', () => {
  let background;

  beforeEach(() => {
    stopObservingCards();
    closeNotesPopup({ force: true });
    document.body.innerHTML = '';
    background = createNotesBackground();
    chrome.runtime.sendMessage = background.sendMessage;
    window.confirm = vi.fn(() => true);
    setMarkerEnabled(true);
  });

  afterEach(() => {
    window.confirm = vi.fn(() => true);
    closeNotesPopup({ force: true });
    chrome.runtime.sendMessage = () => Promise.resolve({ ok: true });
    document.body.innerHTML = '';
  });

  describe('independent entries and provenance', () => {
    it('adds several independent notes from one job ID without updating existing ones', async () => {
      const card = makeCard({ jobId: '111' });
      await rightClickAndSend(card, 'add-note');

      await typeAndAdd('First impression');
      await typeAndAdd('Recruiter called');

      const addCalls = background.sendMessage.mock.calls.filter(([m]) => m.action === 'notes.add');
      expect(addCalls.map(([m]) => m.linkedInJobId)).toEqual(['111', '111']);
      expect(actionsSent(background.sendMessage)).not.toContain('notes.update');
      expect(entries().map((entry) => entry.text)).toEqual(['Recruiter called', 'First impression']);
      expect(entries().every((entry) => entry.meta.startsWith('Job ID 111 · Created '))).toBe(true);
    });

    it('shows the existing group with original job IDs when opened from a repost', async () => {
      await rightClickAndSend(makeCard({ jobId: '111' }), 'add-note');
      await typeAndAdd('From the original advert');
      closeNotesPopup();
      document.body.innerHTML = '';

      await rightClickAndSend(
        makeCard({ jobId: '222', title: '  senior   ENGINEER ', company: 'acme corp' }),
        'show-notes',
      );

      expect(entries()).toHaveLength(1);
      expect(entries()[0].meta).toMatch(/^Job ID 111 · Created /);
      expect(popup().querySelector('.ljm-notes-draft .ljm-notes-meta').textContent).toBe(
        'New note for Job ID 222',
      );
    });

    it('edits only the selected entry and keeps its job ID and creation time', async () => {
      await rightClickAndSend(makeCard(), 'add-note');
      await typeAndAdd('Keep me');
      await typeAndAdd('Change me');
      const [target, other] = background.notes.slice().reverse();
      const createdAt = target.createdAt;

      const item = popup().querySelector(`[data-note-id="${target.id}"]`);
      buttonIn(item, 'Edit').click();
      const editor = popup().querySelector(`[data-note-id="${target.id}"] textarea`);
      editor.value = 'Changed';
      buttonIn(popup().querySelector(`[data-note-id="${target.id}"]`), 'Save').click();
      for (let i = 0; i < 5; i += 1) await flushAsyncWork();

      const updateCalls = background.sendMessage.mock.calls.filter(([m]) => m.action === 'notes.update');
      expect(updateCalls.map(([m]) => m)).toEqual([{ action: 'notes.update', id: target.id, text: 'Changed' }]);
      expect(target).toMatchObject({ text: 'Changed', linkedInJobId: '111', createdAt });
      expect(other.text).toBe('Keep me');
      const edited = entries().find((entry) => entry.id === target.id);
      expect(edited.meta).toMatch(/Created .* · Edited /);
    });

    it('deletes only the selected entry after confirmation', async () => {
      await rightClickAndSend(makeCard(), 'add-note');
      await typeAndAdd('Stays');
      await typeAndAdd('Goes');
      const goes = background.notes.find((note) => note.text === 'Goes');

      buttonIn(popup().querySelector(`[data-note-id="${goes.id}"]`), 'Delete').click();
      for (let i = 0; i < 5; i += 1) await flushAsyncWork();

      expect(window.confirm).toHaveBeenCalledWith('Delete this note?');
      expect(entries().map((entry) => entry.text)).toEqual(['Stays']);
      expect(background.notes.find((note) => note.text === 'Stays').deletedAt).toBeNull();
    });

    it('keeps a note when deletion is not confirmed', async () => {
      await rightClickAndSend(makeCard(), 'add-note');
      await typeAndAdd('Stays');
      window.confirm = vi.fn(() => false);

      buttonIn(popup().querySelector('.ljm-notes-entry'), 'Delete').click();
      for (let i = 0; i < 5; i += 1) await flushAsyncWork();

      expect(actionsSent(background.sendMessage)).not.toContain('notes.delete');
      expect(entries()).toHaveLength(1);
    });

    it('does not create a note from a blank draft', async () => {
      await rightClickAndSend(makeCard(), 'add-note');
      await typeAndAdd('Existing');
      await typeAndAdd('   \n  ');

      expect(background.notes).toHaveLength(1);
      expect(entries()).toHaveLength(1);
    });

    it('refuses to save an emptied edit instead of deleting the entry', async () => {
      await rightClickAndSend(makeCard(), 'add-note');
      await typeAndAdd('Existing');
      buttonIn(popup().querySelector('.ljm-notes-entry'), 'Edit').click();
      popup().querySelector('.ljm-notes-entry textarea').value = '  ';
      buttonIn(popup().querySelector('.ljm-notes-entry'), 'Save').click();
      for (let i = 0; i < 5; i += 1) await flushAsyncWork();

      expect(actionsSent(background.sendMessage)).not.toContain('notes.update');
      expect(background.notes[0].text).toBe('Existing');
    });

    it('renders note text as plain text', async () => {
      await rightClickAndSend(makeCard(), 'add-note');
      await typeAndAdd('<img src=x onerror="alert(1)">');

      expect(popup().querySelector('img')).toBeNull();
      expect(entries()[0].text).toBe('<img src=x onerror="alert(1)">');
    });

    it('shows a readable message when the background refuses writes in incognito', async () => {
      chrome.runtime.sendMessage = vi.fn(async (message) =>
        message.action === 'notes.add'
          ? { ok: false, error: 'incognito' }
          : background.sendMessage(message),
      );
      await rightClickAndSend(makeCard(), 'add-note');
      await typeAndAdd('Private');

      expect(popup().querySelector('.ljm-notes-status').textContent).toBe(
        'Notes cannot be saved in a private window.',
      );
      expect(popup().querySelector('.ljm-notes-draft textarea').value).toBe('Private');
    });
  });

  describe('missing job ID', () => {
    it('creates a note with a null job ID and labels it as unavailable', async () => {
      const card = makeCard({ jobId: null });
      expect(defaultJobsAdapter.getJobId(card)).toBeNull();

      await rightClickAndSend(card, 'add-note');
      expect(popup().querySelector('.ljm-notes-draft .ljm-notes-meta').textContent).toBe(
        'New note · Job ID unavailable',
      );
      await typeAndAdd('No ID here');

      const addCall = background.sendMessage.mock.calls.find(([m]) => m.action === 'notes.add');
      expect(addCall[0].linkedInJobId).toBeNull();
      expect(entries()[0].meta).toMatch(/^Job ID unavailable · Created /);
    });
  });

  describe('unsaved drafts', () => {
    it('closes without asking when nothing is unsaved', async () => {
      await rightClickAndSend(makeCard(), 'show-notes');
      popup().querySelector('.ljm-notes-close').click();

      expect(window.confirm).not.toHaveBeenCalled();
      expect(popup()).toBeNull();
    });

    it('keeps the popup open when discarding a dirty draft is declined', async () => {
      await rightClickAndSend(makeCard(), 'add-note');
      popup().querySelector('.ljm-notes-draft textarea').value = 'Half written';
      window.confirm = vi.fn(() => false);

      popup().querySelector('.ljm-notes-close').click();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

      expect(window.confirm).toHaveBeenCalledTimes(2);
      expect(window.confirm).toHaveBeenCalledWith('Discard unsaved note changes?');
      expect(popup().querySelector('.ljm-notes-draft textarea').value).toBe('Half written');
    });

    it('discards a dirty edit after confirmation and writes nothing', async () => {
      await rightClickAndSend(makeCard(), 'add-note');
      await typeAndAdd('Original');
      buttonIn(popup().querySelector('.ljm-notes-entry'), 'Edit').click();
      popup().querySelector('.ljm-notes-entry textarea').value = 'Unsaved edit';

      popup().querySelector('.ljm-notes-close').click();

      expect(window.confirm).toHaveBeenCalledWith('Discard unsaved note changes?');
      expect(popup()).toBeNull();
      expect(actionsSent(background.sendMessage)).not.toContain('notes.update');
    });

    it('asks before replacing a dirty popup with another card', async () => {
      const first = makeCard({ jobId: '111' });
      const second = makeCard({ jobId: '222', company: 'Other Ltd' });
      await rightClickAndSend(first, 'add-note');
      popup().querySelector('.ljm-notes-draft textarea').value = 'Half written';
      window.confirm = vi.fn(() => false);

      await rightClickAndSend(second, 'show-notes');

      expect(window.confirm).toHaveBeenCalledTimes(1);
      expect(getNotesPopupState().context.linkedInJobId).toBe('111');
      expect(document.querySelectorAll('#ljm-notes-popup')).toHaveLength(1);
    });

    it('preserves an open edit when another change refreshes the list', async () => {
      await rightClickAndSend(makeCard(), 'add-note');
      await typeAndAdd('Original');
      buttonIn(popup().querySelector('.ljm-notes-entry'), 'Edit').click();
      popup().querySelector('.ljm-notes-entry textarea').value = 'Still typing';

      await typeAndAdd('Another note');

      const edited = popup().querySelector(`[data-note-id="${background.notes[0].id}"] textarea`);
      expect(edited.value).toBe('Still typing');
    });
  });

  describe('card snapshot and popup placement', () => {
    it('appends the popup to the body and keeps the snapshot after the card unmounts', async () => {
      const card = makeCard({ jobId: '111' });
      await rightClickAndSend(card, 'add-note');

      expect(popup().parentElement).toBe(document.body);
      expect(card.contains(popup())).toBe(false);

      card.remove();
      await typeAndAdd('Card is gone');

      const addCall = background.sendMessage.mock.calls.find(([m]) => m.action === 'notes.add');
      expect(addCall[0]).toMatchObject({
        linkedInJobId: '111',
        title: 'Senior Engineer',
        company: 'Acme Corp',
        companySlug: null,
      });
    });

    it('ignores the menu when no card was right-clicked', async () => {
      makeCard();
      document.body.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
      await sendContentMessage({ action: 'show-notes' });

      expect(popup()).toBeNull();
      expect(background.sendMessage).not.toHaveBeenCalled();
    });

    it('clamps the popup inside the viewport and re-clamps on resize', async () => {
      const card = makeCard();
      card.getBoundingClientRect = () => ({ top: 580, bottom: 680, left: 600, right: 790, width: 190, height: 100 });
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 800 });
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: 600 });
      const rect = { width: 360, height: 300 };
      const originalRect = HTMLElement.prototype.getBoundingClientRect;
      HTMLElement.prototype.getBoundingClientRect = function () {
        return this.id === 'ljm-notes-popup' ? rect : originalRect.call(this);
      };

      try {
        await rightClickAndSend(card, 'show-notes');
        expect(popup().style.left).toBe('232px');
        expect(popup().style.top).toBe('292px');

        Object.defineProperty(window, 'innerHeight', { configurable: true, value: 250 });
        window.dispatchEvent(new Event('resize'));
        expect(popup().style.top).toBe('8px');
      } finally {
        HTMLElement.prototype.getBoundingClientRect = originalRect;
      }
    });
  });

  describe('card marker', () => {
    it('marks matching cards next to the viewed state using reads only', async () => {
      const withNotes = makeCard({ jobId: '111' });
      const withoutNotes = makeCard({ jobId: '333', company: 'Other Ltd', viewed: false });
      background.notes.push({
        id: 'n1', groupKey: groupKeyOf({ title: 'Senior Engineer', company: 'Acme Corp' }),
        linkedInJobId: '999', text: 'x', createdAt: 1, updatedAt: 1, deletedAt: null,
      });

      await markCardNotes();

      expect(actionsSent(background.sendMessage)).toEqual(['notes.groupsWithNotes']);
      expect(withNotes.querySelector('.job-card-container__footer-job-state').hasAttribute('data-ljm-notes')).toBe(true);
      expect(withoutNotes.querySelector('[data-ljm-notes]')).toBeNull();
      expect(background.notes).toHaveLength(1);
    });

    it('falls back to the title when the card has no viewed state', async () => {
      const card = makeCard({ viewed: false });
      background.notes.push({
        id: 'n1', groupKey: groupKeyOf({ title: 'Senior Engineer', company: 'Acme Corp' }),
        linkedInJobId: '111', text: 'x', createdAt: 1, updatedAt: 1, deletedAt: null,
      });

      await markCardNotes();

      expect(card.querySelector('.job-card-container__link').hasAttribute('data-ljm-notes')).toBe(true);
    });

    it('re-applies the marker to a re-rendered card and removes it once notes are gone', async () => {
      makeCard();
      background.notes.push({
        id: 'n1', groupKey: groupKeyOf({ title: 'Senior Engineer', company: 'Acme Corp' }),
        linkedInJobId: '111', text: 'x', createdAt: 1, updatedAt: 1, deletedAt: null,
      });
      await markCardNotes();

      document.body.innerHTML = '';
      const rerendered = makeCard();
      await markCardNotes();
      expect(rerendered.querySelector('[data-ljm-notes]')).not.toBeNull();

      background.notes[0].deletedAt = 2;
      await markCardNotes();
      expect(rerendered.querySelector('[data-ljm-notes]')).toBeNull();
    });

    it('refreshes markers and the open popup when notes change elsewhere', async () => {
      const card = makeCard();
      await rightClickAndSend(card, 'show-notes');
      expect(entries()).toHaveLength(0);

      const { note } = await background.sendMessage({
        action: 'notes.add', linkedInJobId: '111', title: 'Senior Engineer', company: 'Acme Corp', text: 'Other tab',
      });
      await sendContentMessage({ action: 'data-changed', notes: [note] });

      expect(entries().map((entry) => entry.text)).toEqual(['Other tab']);
      expect(card.querySelector('[data-ljm-notes]')).not.toBeNull();
    });

    it('clears markers when the marker is disabled and does not re-mark while disabled', async () => {
      const card = makeCard();
      background.notes.push({
        id: 'n1', groupKey: groupKeyOf({ title: 'Senior Engineer', company: 'Acme Corp' }),
        linkedInJobId: '111', text: 'x', createdAt: 1, updatedAt: 1, deletedAt: null,
      });
      await markCardNotes();

      await sendContentMessage({ action: 'marker-toggle' });
      expect(card.querySelector('[data-ljm-notes]')).toBeNull();

      await markCardNotes();
      expect(card.querySelector('[data-ljm-notes]')).toBeNull();
    });

    it('leaves markers untouched when the background is unavailable', async () => {
      const card = makeCard();
      card.querySelector('.job-card-container__footer-job-state').setAttribute('data-ljm-notes', '');
      chrome.runtime.sendMessage = vi.fn(() => Promise.reject(new Error('Could not establish connection')));
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});

      await markCardNotes();

      expect(card.querySelector('[data-ljm-notes]')).not.toBeNull();
      expect(error).toHaveBeenCalled();
      error.mockRestore();
    });
  });

  describe('pending saves', () => {
    it('sends one add for a double click and keeps text typed while saving', async () => {
      await rightClickAndSend(makeCard(), 'add-note');
      const held = holdAction(background, 'notes.add');
      const draft = popup().querySelector('.ljm-notes-draft textarea');
      const addButton = popup().querySelector('.ljm-notes-add');

      draft.value = 'First';
      addButton.click();
      addButton.click();
      addNoteFromDraft();
      await flushAsyncWork();
      expect(held).toHaveLength(1);
      expect(addButton.disabled).toBe(true);

      draft.value = 'First and more';
      held[0].release();
      for (let i = 0; i < 5; i += 1) await flushAsyncWork();

      expect(background.notes.map((note) => note.text)).toEqual(['First']);
      expect(draft.value).toBe('First and more');
      expect(addButton.disabled).toBe(false);
    });

    it('retains the draft and re-enables Add when saving fails', async () => {
      await rightClickAndSend(makeCard(), 'add-note');
      const held = holdAction(background, 'notes.add');
      await typeAndAdd('Keep me');
      held[0].release({ ok: false, error: 'boom' });
      for (let i = 0; i < 5; i += 1) await flushAsyncWork();

      expect(popup().querySelector('.ljm-notes-draft textarea').value).toBe('Keep me');
      expect(popup().querySelector('.ljm-notes-add').disabled).toBe(false);
      expect(popup().querySelector('.ljm-notes-status').textContent).toBe('Notes request failed: boom');
    });

    it('blocks repeated saves of an edit and keeps text typed while saving', async () => {
      await rightClickAndSend(makeCard(), 'add-note');
      await typeAndAdd('Original');
      const id = background.notes[0].id;
      buttonIn(popup().querySelector('.ljm-notes-entry'), 'Edit').click();
      const editor = popup().querySelector('.ljm-notes-entry textarea');
      editor.value = 'Saved text';
      const held = holdAction(background, 'notes.update');

      buttonIn(popup().querySelector('.ljm-notes-entry'), 'Save').click();
      await flushAsyncWork();
      const pendingSave = buttonIn(popup().querySelector('.ljm-notes-entry'), 'Save');
      expect(pendingSave.disabled).toBe(true);
      pendingSave.click();
      await flushAsyncWork();
      expect(held).toHaveLength(1);

      editor.value = 'Saved text, then more';
      held[0].release();
      for (let i = 0; i < 5; i += 1) await flushAsyncWork();

      expect(background.notes[0].text).toBe('Saved text');
      const reopened = popup().querySelector(`[data-note-id="${id}"] textarea`);
      expect(reopened.value).toBe('Saved text, then more');
      expect(getNotesPopupState().editors.get(id).note.text).toBe('Saved text');
    });

    it('allows only one delete request per entry', async () => {
      await rightClickAndSend(makeCard(), 'add-note');
      await typeAndAdd('Goes');
      const held = holdAction(background, 'notes.delete');

      buttonIn(popup().querySelector('.ljm-notes-entry'), 'Delete').click();
      await flushAsyncWork();
      expect(buttonIn(popup().querySelector('.ljm-notes-entry'), 'Delete').disabled).toBe(true);
      buttonIn(popup().querySelector('.ljm-notes-entry'), 'Delete').click();
      held[0].release();
      for (let i = 0; i < 5; i += 1) await flushAsyncWork();

      expect(held).toHaveLength(1);
      expect(entries()).toHaveLength(0);
    });
  });

  describe('cancelling an edit', () => {
    it('cancels a clean edit without asking', async () => {
      await rightClickAndSend(makeCard(), 'add-note');
      await typeAndAdd('Original');
      buttonIn(popup().querySelector('.ljm-notes-entry'), 'Edit').click();
      buttonIn(popup().querySelector('.ljm-notes-entry'), 'Cancel').click();

      expect(window.confirm).not.toHaveBeenCalled();
      expect(entries()[0].text).toBe('Original');
    });

    it('asks before cancelling a dirty edit and keeps it when declined', async () => {
      await rightClickAndSend(makeCard(), 'add-note');
      await typeAndAdd('Original');
      buttonIn(popup().querySelector('.ljm-notes-entry'), 'Edit').click();
      popup().querySelector('.ljm-notes-entry textarea').value = 'Unsaved';
      window.confirm = vi.fn(() => false);

      buttonIn(popup().querySelector('.ljm-notes-entry'), 'Cancel').click();
      expect(window.confirm).toHaveBeenCalledWith('Discard unsaved note changes?');
      expect(popup().querySelector('.ljm-notes-entry textarea').value).toBe('Unsaved');

      window.confirm = vi.fn(() => true);
      buttonIn(popup().querySelector('.ljm-notes-entry'), 'Cancel').click();
      expect(entries()[0].text).toBe('Original');
    });
  });

  describe('stale responses', () => {
    it('ignores an older list response that arrives after a newer one', async () => {
      await rightClickAndSend(makeCard(), 'add-note');
      const held = holdAction(background, 'notes.listGroup');

      const older = refreshNotesPopup();
      const newer = refreshNotesPopup();
      await flushAsyncWork();
      held[1].release({ ok: true, notes: [{ id: 'new', text: 'Newer', linkedInJobId: '111', createdAt: 2, updatedAt: 2 }] });
      await newer;
      held[0].release({ ok: true, notes: [] });
      await older;

      expect(entries().map((entry) => entry.text)).toEqual(['Newer']);
    });

    it('ignores an older marker pass that resolves after a newer one', async () => {
      const card = makeCard();
      const held = holdAction(background, 'notes.groupsWithNotes');

      const older = markCardNotes();
      const newer = markCardNotes();
      await flushAsyncWork();
      held[1].release({ ok: true, matches: [false] });
      await newer;
      held[0].release({ ok: true, matches: [true] });
      await older;

      expect(card.querySelector('[data-ljm-notes]')).toBeNull();
    });

    it('does not mark a recycled card that shows another job when the response arrives', async () => {
      const card = makeCard({ jobId: '111' });
      const held = holdAction(background, 'notes.groupsWithNotes');

      const pass = markCardNotes();
      await flushAsyncWork();
      card.dataset.jobId = '222';
      card.querySelector('a').href = '/jobs/view/222';
      card.querySelector('a').textContent = 'Different Role';
      held[0].release({ ok: true, matches: [true] });
      await pass;

      expect(card.querySelector('[data-ljm-notes]')).toBeNull();
    });
  });

  describe('company identity', () => {
    function detailTitle(jobId) {
      const link = document.createElement('a');
      link.href = `/jobs/view/${jobId}`;
      return link;
    }

    function adapterWith(overrides) {
      return { ...defaultJobsAdapter, ...overrides };
    }

    it('uses a slug from a company link inside the card', () => {
      const card = makeCard();
      const adapter = adapterWith({ getCompanySlug: () => 'acme-corp' });

      expect(getCardNoteContext(card, adapter).companySlug).toBe('acme-corp');
    });

    it('uses the detail-panel slug only for the selected and rendered job with the same company', () => {
      const card = makeCard({ jobId: '111', company: 'Acme  Corp' });
      const adapter = adapterWith({
        getCurrentJobId: () => '111',
        getDetailPanelTitleElement: () => detailTitle('111'),
        getDetailPanelCompany: () => ({ name: 'acme corp', slug: 'acme-corp-uk' }),
      });

      expect(getCardNoteContext(card, adapter).companySlug).toBe('acme-corp-uk');
    });

    it.each([
      ['another job is selected', { getCurrentJobId: () => '999' }],
      ['the panel still renders the previous job', { getDetailPanelTitleElement: () => detailTitle('999') }],
      ['the panel company name differs', { getDetailPanelCompany: () => ({ name: 'Acme Holdings', slug: 'acme-holdings' }) }],
    ])('ignores the detail-panel slug when %s', (_label, override) => {
      const card = makeCard({ jobId: '111' });
      const adapter = adapterWith({
        getCurrentJobId: () => '111',
        getDetailPanelTitleElement: () => detailTitle('111'),
        getDetailPanelCompany: () => ({ name: 'Acme Corp', slug: 'acme-corp-uk' }),
        ...override,
      });

      expect(getCardNoteContext(card, adapter).companySlug).toBeNull();
    });

    it('never takes a detail-panel slug by company name when the card has no job ID', () => {
      const card = makeCard({ jobId: null });
      const adapter = adapterWith({
        getCurrentJobId: () => null,
        getDetailPanelTitleElement: () => null,
        getDetailPanelCompany: () => ({ name: 'Acme Corp', slug: 'acme-corp-uk' }),
      });

      expect(getCardNoteContext(card, adapter).companySlug).toBeNull();
    });

    it('sends the captured slug with the add request and group lookup', async () => {
      const card = makeCard();
      card.querySelector('a').insertAdjacentHTML('afterend', '<a href="/company/acme-corp/">Acme</a>');
      defaultJobsAdapter.getCompanySlug = (target) =>
        target.querySelector('a[href*="/company/"]')?.getAttribute('href').match(/\/company\/([^/]+)/)?.[1] ?? null;
      try {
        await rightClickAndSend(card, 'add-note');
        await typeAndAdd('With slug');
        await markCardNotes();
      } finally {
        delete defaultJobsAdapter.getCompanySlug;
      }

      const sent = background.sendMessage.mock.calls.map(([m]) => m);
      expect(sent.find((m) => m.action === 'notes.add').companySlug).toBe('acme-corp');
      expect(sent.find((m) => m.action === 'notes.groupsWithNotes').groups[0].companySlug).toBe('acme-corp');
    });
  });

  describe('closing while a write is pending', () => {
    it('refuses Close and Escape during a pending add and keeps newer text', async () => {
      await rightClickAndSend(makeCard(), 'add-note');
      const held = holdAction(background, 'notes.add');
      await typeAndAdd('A');
      const draft = popup().querySelector('.ljm-notes-draft textarea');
      draft.value = 'A then B';

      expect(popup().querySelector('.ljm-notes-close').disabled).toBe(true);
      expect(closeNotesPopup()).toBe(false);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

      expect(window.confirm).not.toHaveBeenCalled();
      expect(popup()).not.toBeNull();
      expect(popup().querySelector('.ljm-notes-status').textContent).toMatch(/^Saving/);

      held[0].release();
      for (let i = 0; i < 5; i += 1) await flushAsyncWork();

      expect(background.notes.map((note) => note.text)).toEqual(['A']);
      expect(draft.value).toBe('A then B');
      expect(popup().querySelector('.ljm-notes-close').disabled).toBe(false);
      expect(popup().querySelector('.ljm-notes-status').hidden).toBe(true);
    });

    it('refuses closing during a pending update', async () => {
      await rightClickAndSend(makeCard(), 'add-note');
      await typeAndAdd('Original');
      buttonIn(popup().querySelector('.ljm-notes-entry'), 'Edit').click();
      popup().querySelector('.ljm-notes-entry textarea').value = 'Changed';
      const held = holdAction(background, 'notes.update');
      buttonIn(popup().querySelector('.ljm-notes-entry'), 'Save').click();
      await flushAsyncWork();

      expect(closeNotesPopup()).toBe(false);
      expect(window.confirm).not.toHaveBeenCalled();

      held[0].release();
      for (let i = 0; i < 5; i += 1) await flushAsyncWork();
      expect(closeNotesPopup()).toBe(true);
      expect(background.notes[0].text).toBe('Changed');
    });

    it('re-enables the editor when the save succeeds but the list refresh fails', async () => {
      await rightClickAndSend(makeCard(), 'add-note');
      await typeAndAdd('Original');
      const id = background.notes[0].id;
      buttonIn(popup().querySelector('.ljm-notes-entry'), 'Edit').click();
      const editor = popup().querySelector('.ljm-notes-entry textarea');
      editor.value = 'First save';
      const heldUpdate = holdAction(background, 'notes.update');
      buttonIn(popup().querySelector('.ljm-notes-entry'), 'Save').click();
      await flushAsyncWork();
      editor.value = 'First save plus more';
      const heldList = holdAction(background, 'notes.listGroup');
      heldUpdate[0].release();
      for (let i = 0; i < 3; i += 1) await flushAsyncWork();
      heldList[0].release({ ok: false, error: 'offline' });
      for (let i = 0; i < 3; i += 1) await flushAsyncWork();

      const entry = popup().querySelector(`[data-note-id="${id}"]`);
      expect(buttonIn(entry, 'Save').disabled).toBe(false);
      expect(buttonIn(entry, 'Cancel').disabled).toBe(false);
      expect(entry.querySelector('textarea').value).toBe('First save plus more');
      expect(isNotesPopupDirty()).toBe(true);
    });
  });

  describe('body replacement', () => {
    it('re-attaches a dirty popup to a replaced body without duplicating listeners', async () => {
      await rightClickAndSend(makeCard(), 'add-note');
      const draft = popup().querySelector('.ljm-notes-draft textarea');
      draft.value = 'Typed before navigation';

      document.documentElement.replaceChild(document.createElement('body'), document.body);
      expect(popup()).toBeNull();
      makeCard();
      await markCardNotes();

      expect(popup().parentElement).toBe(document.body);
      expect(popup().querySelector('.ljm-notes-draft textarea')).toBe(draft);
      expect(draft.value).toBe('Typed before navigation');

      window.confirm = vi.fn(() => false);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      expect(window.confirm).toHaveBeenCalledTimes(1);
    });

    it('shows a detached popup again before asking to discard it', async () => {
      await rightClickAndSend(makeCard(), 'add-note');
      popup().querySelector('.ljm-notes-draft textarea').value = 'Typed';
      document.documentElement.replaceChild(document.createElement('body'), document.body);
      let visibleWhenAsked = null;
      window.confirm = vi.fn(() => { visibleWhenAsked = !!popup(); return false; });

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

      expect(visibleWhenAsked).toBe(true);
    });
  });

  describe('editor focus', () => {
    async function openEditorWithSelection() {
      await rightClickAndSend(makeCard(), 'add-note');
      await typeAndAdd('Original text');
      buttonIn(popup().querySelector('.ljm-notes-entry'), 'Edit').click();
      const editor = popup().querySelector('.ljm-notes-entry textarea');
      editor.value = 'Edited text';
      editor.focus();
      editor.setSelectionRange(2, 6);
      return editor;
    }

    it('keeps focus and caret when another change refreshes the list', async () => {
      const editor = await openEditorWithSelection();
      const { note } = await background.sendMessage({
        action: 'notes.add', linkedInJobId: '111', title: 'Senior Engineer', company: 'Acme Corp', text: 'Other tab',
      });
      await sendContentMessage({ action: 'data-changed', notes: [note] });

      expect(entries()).toHaveLength(2);
      expect(document.activeElement).toBe(editor);
      expect([editor.selectionStart, editor.selectionEnd]).toEqual([2, 6]);
    });

    it('keeps focus and caret while a save is pending', async () => {
      const editor = await openEditorWithSelection();
      const held = holdAction(background, 'notes.update');
      updateNoteFromEditor(background.notes[0].id);
      await flushAsyncWork();

      expect(document.activeElement).toBe(editor);
      expect([editor.selectionStart, editor.selectionEnd]).toEqual([2, 6]);
      held[0].release();
      for (let i = 0; i < 5; i += 1) await flushAsyncWork();
    });
  });

  describe('status messages', () => {
    it('clears a request error after a later successful refresh', async () => {
      await rightClickAndSend(makeCard(), 'show-notes');
      const held = holdAction(background, 'notes.listGroup');
      const failed = refreshNotesPopup();
      await flushAsyncWork();
      held[0].release({ ok: false, error: 'offline' });
      await failed;
      expect(popup().querySelector('.ljm-notes-status').textContent).toBe('Notes request failed: offline');

      const succeeded = refreshNotesPopup();
      await flushAsyncWork();
      held[1].release();
      await succeeded;

      expect(popup().querySelector('.ljm-notes-status').hidden).toBe(true);
    });

    it('keeps a validation notice across a successful refresh', async () => {
      await rightClickAndSend(makeCard(), 'add-note');
      await typeAndAdd('Existing');
      buttonIn(popup().querySelector('.ljm-notes-entry'), 'Edit').click();
      popup().querySelector('.ljm-notes-entry textarea').value = ' ';
      buttonIn(popup().querySelector('.ljm-notes-entry'), 'Save').click();
      await refreshNotesPopup();

      expect(popup().querySelector('.ljm-notes-status').textContent).toBe(
        'A note cannot be empty; use Delete to remove it.',
      );
    });
  });
});
