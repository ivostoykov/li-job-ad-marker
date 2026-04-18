# Changelog

## [1.1.70] - 2026-04-18

### Added
- Viewed job cards now show the date and time first viewed as a hover hint, rendered via CSS `::after` using a `data-ljm-viewed-at` attribute set at mark time
- "Add title to ignore list" context menu item — stores the full job title as an exact-match entry (prefixed `=`) in the unwanted-title list
- "Add selection to ignore list" context menu item — stores the selected text as a substring-match entry; only appears when text is selected
- Exact-match entries (prefixed `=`) in the unwanted-title list now match only when the full job title equals the entry; unprefixed entries continue to match as substrings

## [1.1.67] - 2026-04-08

### Changed
- Test harness exports now match the current content-script lifecycle, so the Vitest suite can bootstrap the active observer path again

### Fixed
- Right-click capture now no-ops cleanly on non-jobs LinkedIn pages instead of throwing when no page adapter is active
- Non-jobs LinkedIn pages now skip page-marking and clear-mark passes safely when the content script has no active jobs adapter
- Vitest bootstrap drift around removed adapter helpers is resolved again; `npm test` passes with 133 tests

## [1.1.65] - 2026-04-04

### Added
- page-console debug helper for quick surface diagnostics during LinkedIn regressions

### Changed
- Jobs-surface detection now follows the visible DOM rather than trusting only the route, so the path can resolve to the correct classic or AI adapter at runtime
- URL-change diagnostics now log the real SPA sequence, including page-context changes

### Fixed
- Classic and AI alert flows now stay marked after rapid LinkedIn SPA hops between notifications, AI search, and classic search
- The visible jobs surface inside LinkedIn’s same-origin frame now receives the content script, stylesheet, and initial mark pass
- AI-style result cards on now resolve job IDs reliably through page-side annotations instead of missing most cards
- Non-job footer and feedback rows on the AI search surface no longer inflate card counts or produce false missing-ID diagnostics

## [1.1.56] - 2026-04-01

### Changed
- Content-script observation now keeps one active observer per injected LinkedIn page context and only rebuilds it when the matched adapter or observed root changes
- Jobs-surface startup now runs an immediate first marking pass before relying on later DOM mutations
- Content-script startup now applies stored colour and debug settings before the first jobs-surface handling begins

### Fixed
- Notification-to-jobs SPA navigation no longer drops the initial marking pass when LinkedIn issues rapid `pushState` and `replaceState` updates
- Query-string-only changes such as `currentJobId` no longer restart jobs-page handling or tear down the active card observer
- Debug logging now initialises consistently at startup instead of missing the first pass while the async log bootstrap catches up

## [1.1.52] - 2026-03-31

### Added
- `src/js/constants.js` — shared constants file (`LOG_MARKER`, `LOG_BADGE_DEBUG`) loaded first in both manifests and imported into the Chrome service worker via `importScripts`

### Changed
- `log.js` rewritten to match the reference model: only `console.debug` is patched (gated by `debugEnabled`), with badge and correct caller line number via named-function skip; `logDebug`, `logInfo`, `logWarn`, `logError` wrappers removed
- All `logDebug` / `logWarn` / `logError` call sites in `content.js` replaced with native `console.debug` / `console.warn` / `console.error`

## [1.1.50] - 2026-03-29

### Added
- Now the user can treat "*Promoted*" and "*Reposted*" as *Viewed* by switching the checkbox on the options page — when enabled, cards carrying a `Promoted` or `Reposted` label are treated as `viewed`
- Added `Unwanted title words` textarea on the options page (comma-separated, case-insensitive) — to improve search result by filtering off any title that contains a listed word or phrase
- Unwanted-title marking also applies to the right-hand detail panel title, updated live on panel navigation

### Changed
- `markPage()` now runs `markDetailPanelUnwantedTitle()` alongside the existing card and ageing passes
- `applyMark()` accepts an `isUnwantedTitle` flag, keeping the mark independent of job state so applied or viewed cards can also carry the strikethrough

## [1.1.46] - 2026-03-29

### Added
- `Ageing limit (days)` option on the options page, with a live disabled-state hint when the value is outside the supported range
- Dedicated ageing marker styles for list and detail age tokens across the supported LinkedIn jobs surfaces
- `markDetailPanelAging()` for right-hand job details, using the existing mutation and URL-change flow instead of DOM polling

### Changed
- Ageing-limit settings now refresh both list-card and detail-panel marking live after save
- AI-generated `/jobs/search-results/` cards now resolve ageing from relative-age spans instead of relying on paragraph position
- AI-generated `/jobs/search-results/` right-hand details now scope ageing to the top summary row only, avoiding lower `Application status` age text

### Fixed
- Classic left-list cards with `time[datetime]` can now be highlighted when their age is above the configured threshold
- Classic right-hand detail panels can now highlight the relative age token when the configured ageing rule matches
- AI-generated `/jobs/search-results/` left-list cards can now highlight relative age tokens such as `4 days ago` using the same configured threshold
- AI-generated `/jobs/search-results/` right-hand detail panels can now highlight the publish-age token from the top summary row
- Invalid ageing-limit values are now treated as disabled instead of producing partial behaviour

## [1.1.35] - 2026-03-28

### Added
- Dedicated page adapter for LinkedIn’s AI-generated jobs search surface

### Changed
- Cards without a stable job ID can now still be styled from LinkedIn’s own `Viewed` or `Applied` labels and from the company blacklist; DB writes still require a real job ID
- Applied styling now colours the title and state text on the AI-generated results surface, matching the classic search list more closely

### Fixed
- AI-generated search-result cards now resolve through their own card selectors
- Company extraction for AI-generated cards now enable blacklist styling on that surface
- The selected AI-result card can now reuse `currentJobId` from its in-list anchor when present

## [1.1.32] - 2026-03-28

### Added
- Page-adapter routing in the content script, with a dedicated company-search adapter for the `COMPANY_PAGE_JOBS_CLUSTER_EXPANSION` LinkedIn jobs surface
- Structured log helpers with marker/badge prefixes for `error`, `warn`, `log`, and `debug`

### Changed
- Card lookup, job ID lookup, company lookup, and readiness checks now flow through the active page adapter instead of one shared DOM assumption
- Log prefixes now use `✎` plus a coloured badge instead of the old `>>>` prefix

### Fixed
- Company-page jobs-cluster search results now resolve right-clicked cards more reliably for context-menu actions
- Company-search cards can now fall back to job IDs
- Content-script failures in async handlers, mutation processing, options loading, and URL-change handling now log explicitly instead of failing silently

## [1.1.30] - 2026-03-27

### Fixed
- LinkedIn’s native `Applied` badge is now detected and promoted into the extension state, so applied cards are marked without needing the context menu first
- Applied cards now colour LinkedIn’s own title using the configured applied colour
- The marker toggle now removes all extension-applied classes when switched off and re-scans the page to reapply marks when switched on again

## [1.1.25] - 2026-03-27

### Fixed
- DB Restore now applies the same rank check — importing an older backup can no longer downgrade `applied` to `viewed`
- Context menu separator scope no longer leaks onto unrelated pages
- Options page browser tab title now includes the version number
- Viewed cards on the initial LinkedIn jobs-page load are now marked without requiring a manual page reload
- Now late mutations inside existing job cards are convered as well

## [1.1.17] - 2026-03-27

### Added
- Line Number utility and colour helper
- Options page with default values
- log utility
- debug flag
- Options buttons: Save / Cancel / Export / Import / Close
- Export as a JSON
- `"Options"` context menu item — opens the options page in a new tab
- DB — direct put without rank check, used by the import path
- `tabs` permission added to manifest (required for options page to query LinkedIn tabs)

### Changed
- Hardcoded values replaced with CSS variables so colour settings apply live without a page reload
- Content script load order updated
- Colour settings applied on load and on storage change

## [0.1.0] - 2026-03-27

### Fixed
- An `applied` record can no longer be overwritten by a later `viewed` write; the get and put share a single readwrite transaction
- Cards observer now detects equal-count list replacements — so a same-size batch swap correctly triggers the marker
- Context menu items are now registered inside `removeAll()` to prevent stale duplicate entries after extension reload or update

### Added
- "Mark as applied" context menu item — writes `applied` state to IndexedDB for the right-clicked job card, completing the previously display-only `applied` workflow

## [0.0.3] - 2026-03-26

### Changed
- Broadened content script match LinkedIn and to handle SPA navigation entering `/jobs/` from other LinkedIn pages

### Added
- `blacklisted` and `viewed`/`applied` states now coexist — blacklist style applies independently of job state
- Single "Toggle company blacklist" context menu item (replaces separate add/remove items)
- "Toggle marker" context menu item — session kill switch to disable/re-enable all marking
- Context menu now works on links (`a` tags) in addition to the page background
- `observeCards` MutationObserver handles both initial card wait and scroll-triggered lazy loading
- SPA navigation into `/jobs/` from any LinkedIn page now triggers marking correctly

### Fixed
- Mark Cards returned no results on load — LinkedIn renders cards asynchronously after `document_idle`
- Blacklist toggle had no visual effect — focused card selector lost match after right-click; now tracks last right-clicked card
- Cards on page 3+ (via "Next") were not marked — `knownCount` now resets on card removal so new page cards are detected

## [0.0.1] - 2026-03-26

### Added
- Initial scaffold
- IndexedDB layer for job records status with no-downgrade rule
- blacklist for company names
- CSS marks: opacity for viewed, limegreen outline for applied, red strikethrough for blacklisted company name
- Context menu for blacklist add/remove on LinkedIn jobs pages
- `currentJobId` URL param tracking
