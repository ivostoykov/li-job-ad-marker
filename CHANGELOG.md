# Changelog

## [0.0.3] - 2026-03-26

### Changed
- Broadened content script match from `https://www.linkedin.com/jobs/*` to `https://www.linkedin.com/*` to handle SPA navigation entering `/jobs/` from other LinkedIn pages

### Added
- `blacklisted` and `viewed`/`applied` states now coexist — blacklist style applies independently of job state
- Single "Toggle company blacklist" context menu item (replaces separate add/remove items)
- "Toggle marker" context menu item — session kill switch to disable/re-enable all marking
- Context menu now works on links (`a` tags) in addition to the page background
- `observeCards` MutationObserver handles both initial card wait and scroll-triggered lazy loading
- SPA navigation into `/jobs/` from any LinkedIn page now triggers marking correctly

### Fixed
- `markCards()` returned no results on load — LinkedIn renders cards asynchronously after `document_idle`
- Blacklist toggle had no visual effect — focused card selector lost match after right-click; now tracks last right-clicked card via `contextmenu` event
- Cards on page 3+ (via "Next") were not marked — `knownCount` now resets on card removal so new page cards are detected

## [0.0.1] - 2026-03-26

### Added
- Initial scaffold: `manifest.json`, `src/content.js`, `src/background.js`, `src/css/marker.css`, `src/js/db.js`, `src/js/blacklist.js`
- IndexedDB layer for job records (`viewed`, `applied`) with no-downgrade rule
- `chrome.storage.sync` blacklist for company names
- CSS marks: opacity for viewed, limegreen outline for applied, red strikethrough for blacklisted company name
- Context menu for blacklist add/remove on LinkedIn jobs pages
- `currentJobId` URL param tracking via `history.pushState` intercept and `popstate` event
