# Changelog

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
