import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { defaultJobsAdapter, getNotesPopupState, setMarkerEnabled, stopObservingCards } =
  globalThis._testExports;

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
});
