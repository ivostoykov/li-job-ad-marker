const NOTES_POPUP_ID = "ljm-notes-popup";
const NOTES_POPUP_MARGIN = 8;
const NOTE_MARKER_ATTRIBUTE = "data-ljm-notes";
const NOTES_DISCARD_PROMPT = "Discard unsaved note changes?";
const NOTES_DELETE_PROMPT = "Delete this note?";
const NOTES_ERROR_MESSAGES = {
  incognito: "Notes cannot be saved in a private window.",
};

let notesPopupState = null;

function getCardNoteContext(card, adapter = currentPageAdapter) {
  return {
    linkedInJobId: adapter.getJobId(card) || null,
    title: getTextContent(adapter.getTitleElement?.(card)),
    company: adapter.getCompanyName(card),
    companySlug: null,
  };
}

function formatNoteTimestamp(timestamp) {
  return new Date(timestamp).toLocaleString();
}

function isNotesPopupDirty(state = notesPopupState) {
  if (!state) return false;
  if (state.draft.value.trim()) return true;
  return [...state.editors.values()].some(
    ({ note, textarea }) => textarea.value !== note.text,
  );
}

function closeNotesPopup({ force = false } = {}) {
  const state = notesPopupState;
  if (!state) return true;
  if (!force && isNotesPopupDirty(state) && !window.confirm(NOTES_DISCARD_PROMPT))
    return false;

  window.removeEventListener("resize", state.onResize);
  document.removeEventListener("keydown", state.onKeyDown, true);
  state.popup.remove();
  notesPopupState = null;
  return true;
}

function positionNotesPopup(state = notesPopupState) {
  if (!state) return;

  const { popup, anchorRect } = state;
  const { width, height } = popup.getBoundingClientRect();
  const maxLeft = Math.max(
    NOTES_POPUP_MARGIN,
    window.innerWidth - width - NOTES_POPUP_MARGIN,
  );
  const maxTop = Math.max(
    NOTES_POPUP_MARGIN,
    window.innerHeight - height - NOTES_POPUP_MARGIN,
  );

  let left = anchorRect.right + NOTES_POPUP_MARGIN;
  if (left > maxLeft) left = anchorRect.left - width - NOTES_POPUP_MARGIN;

  popup.style.left = `${Math.min(Math.max(left, NOTES_POPUP_MARGIN), maxLeft)}px`;
  popup.style.top = `${Math.min(Math.max(anchorRect.top, NOTES_POPUP_MARGIN), maxTop)}px`;
}

function showNotesStatus(text, state = notesPopupState) {
  if (!state) return;
  state.status.textContent = text || "";
  state.status.hidden = !text;
}

function showNotesError(error, state = notesPopupState) {
  showNotesStatus(
    NOTES_ERROR_MESSAGES[error] || `Notes request failed: ${error}`,
    state,
  );
}

function buildNotesPopup(context) {
  const popup = document.createElement("div");
  popup.id = NOTES_POPUP_ID;
  popup.className = "ljm-notes-popup";
  popup.setAttribute("role", "dialog");
  popup.setAttribute("aria-label", "Notes");

  const header = document.createElement("div");
  header.className = "ljm-notes-header";

  const heading = document.createElement("div");
  heading.className = "ljm-notes-heading";
  const title = document.createElement("strong");
  title.textContent = context.title;
  const company = document.createElement("span");
  company.textContent = context.company;
  heading.append(title, company);

  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "ljm-notes-close";
  closeButton.setAttribute("aria-label", "Close notes");
  closeButton.textContent = "×";
  closeButton.addEventListener("click", () => closeNotesPopup());
  header.append(heading, closeButton);

  const status = document.createElement("p");
  status.className = "ljm-notes-status";
  status.setAttribute("role", "status");
  status.hidden = true;

  const draftSection = document.createElement("div");
  draftSection.className = "ljm-notes-draft";
  const draftJobId = document.createElement("p");
  draftJobId.className = "ljm-notes-meta";
  draftJobId.textContent = context.linkedInJobId
    ? `New note for Job ID ${context.linkedInJobId}`
    : "New note · Job ID unavailable";
  const draft = document.createElement("textarea");
  draft.className = "ljm-notes-textarea";
  draft.placeholder = "Write a note";
  draft.rows = 3;
  const addButton = document.createElement("button");
  addButton.type = "button";
  addButton.className = "ljm-notes-add";
  addButton.textContent = "Add note";
  addButton.addEventListener("click", () => addNoteFromDraft());
  draftSection.append(draftJobId, draft, addButton);

  const list = document.createElement("ol");
  list.className = "ljm-notes-list";

  popup.append(header, status, draftSection, list);
  return { popup, status, draft, list };
}

function buildNoteEntry(note, state) {
  const item = document.createElement("li");
  item.className = "ljm-notes-entry";
  item.dataset.noteId = note.id;

  const meta = document.createElement("p");
  meta.className = "ljm-notes-meta";
  const parts = [
    note.linkedInJobId ? `Job ID ${note.linkedInJobId}` : "Job ID unavailable",
    `Created ${formatNoteTimestamp(note.createdAt)}`,
  ];
  if (note.updatedAt > note.createdAt)
    parts.push(`Edited ${formatNoteTimestamp(note.updatedAt)}`);
  meta.textContent = parts.join(" · ");
  item.appendChild(meta);

  const actions = document.createElement("div");
  actions.className = "ljm-notes-actions";

  const editor = state.editors.get(note.id);
  if (editor) {
    editor.note = note;
    const saveButton = document.createElement("button");
    saveButton.type = "button";
    saveButton.textContent = "Save";
    saveButton.addEventListener("click", () => updateNoteFromEditor(note.id));
    const cancelButton = document.createElement("button");
    cancelButton.type = "button";
    cancelButton.textContent = "Cancel";
    cancelButton.addEventListener("click", () => {
      state.editors.delete(note.id);
      renderNotesList(state.notes, state);
    });
    actions.append(saveButton, cancelButton);
    item.append(editor.textarea, actions);
    return item;
  }

  const text = document.createElement("p");
  text.className = "ljm-notes-text";
  text.textContent = note.text;

  const editButton = document.createElement("button");
  editButton.type = "button";
  editButton.textContent = "Edit";
  editButton.addEventListener("click", () => {
    const textarea = document.createElement("textarea");
    textarea.className = "ljm-notes-textarea";
    textarea.value = note.text;
    textarea.rows = 3;
    state.editors.set(note.id, { note, textarea });
    renderNotesList(state.notes, state);
    textarea.focus();
  });
  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.textContent = "Delete";
  deleteButton.addEventListener("click", () => deleteNoteEntry(note.id));
  actions.append(editButton, deleteButton);

  item.append(text, actions);
  return item;
}

function renderNotesList(notes, state = notesPopupState) {
  if (!state) return;

  state.notes = notes;
  const activeIds = new Set(notes.map((note) => note.id));
  [...state.editors.keys()].forEach((id) => {
    if (!activeIds.has(id)) state.editors.delete(id);
  });

  if (!notes.length) {
    const empty = document.createElement("li");
    empty.className = "ljm-notes-empty";
    empty.textContent = "No notes for this title and company yet.";
    state.list.replaceChildren(empty);
  } else {
    state.list.replaceChildren(
      ...notes.map((note) => buildNoteEntry(note, state)),
    );
  }
  positionNotesPopup(state);
}

async function refreshNotesPopup(state = notesPopupState) {
  if (!state) return;

  const { title, company, companySlug } = state.context;
  const response = await chrome.runtime.sendMessage({
    action: "notes.listGroup",
    title,
    company,
    companySlug,
  }).catch((e) => ({ ok: false, error: e?.message || String(e) }));
  if (notesPopupState !== state) return;
  if (!response?.ok) {
    showNotesError(response?.error ?? "no response", state);
    return;
  }
  renderNotesList(response.notes ?? [], state);
}

async function addNoteFromDraft(state = notesPopupState) {
  if (!state) return;

  const text = state.draft.value.trim();
  if (!text) return;

  const { linkedInJobId, title, company, companySlug } = state.context;
  const response = await chrome.runtime.sendMessage({
    action: "notes.add",
    linkedInJobId,
    title,
    company,
    companySlug,
    text,
  }).catch((e) => ({ ok: false, error: e?.message || String(e) }));
  if (notesPopupState !== state) return;
  if (!response?.ok) {
    showNotesError(response?.error ?? "no response", state);
    return;
  }

  state.draft.value = "";
  showNotesStatus("", state);
  await refreshNotesPopup(state);
}

async function updateNoteFromEditor(id, state = notesPopupState) {
  const editor = state?.editors.get(id);
  if (!editor) return;

  const text = editor.textarea.value.trim();
  if (!text) {
    showNotesStatus("A note cannot be empty; use Delete to remove it.", state);
    return;
  }

  const response = await chrome.runtime.sendMessage({
    action: "notes.update",
    id,
    text,
  }).catch((e) => ({ ok: false, error: e?.message || String(e) }));
  if (notesPopupState !== state) return;
  if (!response?.ok) {
    showNotesError(response?.error ?? "no response", state);
    return;
  }

  state.editors.delete(id);
  showNotesStatus("", state);
  await refreshNotesPopup(state);
}

async function deleteNoteEntry(id, state = notesPopupState) {
  if (!state || !window.confirm(NOTES_DELETE_PROMPT)) return;

  const response = await chrome.runtime.sendMessage({
    action: "notes.delete",
    id,
  }).catch((e) => ({ ok: false, error: e?.message || String(e) }));
  if (notesPopupState !== state) return;
  if (!response?.ok) {
    showNotesError(response?.error ?? "no response", state);
    return;
  }

  state.editors.delete(id);
  showNotesStatus("", state);
  await refreshNotesPopup(state);
}

async function openNotesPopup(context, anchorRect, { focusDraft = false } = {}) {
  if (!closeNotesPopup()) return;

  const elements = buildNotesPopup(context);
  const state = {
    ...elements,
    context,
    anchorRect,
    notes: [],
    editors: new Map(),
    onResize: () => positionNotesPopup(state),
    onKeyDown: (event) => {
      if (!state.popup.contains(event.target) && event.key !== "Escape") return;
      event.stopPropagation();
      if (event.key === "Escape") closeNotesPopup();
    },
  };

  document.body.appendChild(state.popup);
  notesPopupState = state;
  window.addEventListener("resize", state.onResize);
  document.addEventListener("keydown", state.onKeyDown, true);
  positionNotesPopup(state);
  if (focusDraft) state.draft.focus();

  await refreshNotesPopup(state);
}

async function openNotesFromContextMenu(action) {
  const adapter = currentPageAdapter;
  const card = getContextCard(action);
  if (!card || !adapter) return;

  const context = getCardNoteContext(card, adapter);
  if (!context.title || !context.company) {
    console.warn(
      `${getLogPrefix(console.warn.name)} - ${getLineNumber()} - ${action}: title or company not found for selected card`,
    );
    return;
  }

  await openNotesPopup(context, card.getBoundingClientRect(), {
    focusDraft: action === "add-note",
  });
}

function clearCardNoteMarkers(root = document) {
  root.querySelectorAll(`[${NOTE_MARKER_ATTRIBUTE}]`).forEach((el) => {
    el.removeAttribute(NOTE_MARKER_ATTRIBUTE);
  });
}

async function markCardNotes() {
  const adapter = currentPageAdapter;
  if (!enabled || !adapter) return;

  const cards = [...adapter.getJobCards()];
  if (!cards.length) return;

  const groups = cards.map((card) => {
    const { title, company, companySlug } = getCardNoteContext(card, adapter);
    return { title, company, companySlug };
  });

  try {
    const response = await chrome.runtime.sendMessage({
      action: "notes.groupsWithNotes",
      groups,
    });
    if (!enabled || adapter !== currentPageAdapter) return;
    if (!response?.ok) {
      console.warn(
        `${getLogPrefix(console.warn.name)} - ${getLineNumber()} - notes.groupsWithNotes failed:`,
        response?.error ?? "no response",
      );
      return;
    }

    cards.forEach((card, index) => {
      clearCardNoteMarkers(card);
      if (!response.matches?.[index]) return;
      const target =
        adapter.getStateElement?.(card) || adapter.getTitleElement?.(card);
      target?.setAttribute(NOTE_MARKER_ATTRIBUTE, "");
    });
  } catch (e) {
    console.error(
      `${getLogPrefix(console.error.name)} - ${getLineNumber()} - Failed to mark card notes:`,
      e,
    );
  }
}

addMessageAction("add-note", () => openNotesFromContextMenu("add-note"));

addMessageAction("show-notes", () => openNotesFromContextMenu("show-notes"));

addMessageAction("marker-toggle", () => {
  if (!enabled) clearCardNoteMarkers();
});

addMessageAction("data-changed", async (message) => {
  if (!message.notes) return;
  await Promise.all([markCardNotes(), refreshNotesPopup()]);
});
