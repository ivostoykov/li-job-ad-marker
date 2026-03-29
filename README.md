# LinkedIn Job Ad Marker

<img src="icons/Screenshot.png">

---

LinkedIn Job Ad Marker is an extension available for Chrome and Firefox applied solely on LinkedIn job search pages. It helps you work through large job lists faster by marking adverts you have already seen, jobs you have applied for, companies you do not want to deal with, and older listings you may want to skip.

The aim is simple: reduce repeat scanning. Instead of re-reading the same cards every time LinkedIn reshuffles, reloads, or promotes old listings again, the extension adds lightweight visual cues directly to the job list.

- **Chrome**: https://chromewebstore.google.com/detail/linkedin-job-ad-marker/eaegndbkfnnkmcedmhpdiiombakchjbe
- **FireFox**: **Pending approval** Will be here: https://addons.mozilla.org/en-US/firefox/addon/linkedin-job-ad-marker/

## What It Does

On supported LinkedIn job pages, the extension scans job cards, extracts job identity where available, and compares that against locally stored data.

It then applies visual marks:

- `Viewed`: the card is faded with reduced opacity
- `Applied`: the card gets a green outline
- `Blacklisted company`: the company line gets a reddish background and strikethrough
- `Ageing`: LinkedIn publish-age tokens can be highlighted in orange when they are older than your configured threshold

Blacklisted companies are independent of job state, so a job can be both `Applied` and `Blacklisted`, or `Viewed` and `Blacklisted`.

On supported LinkedIn jobs layouts, the ageing rule can mark:

- the publish date in the left-hand card list when LinkedIn exposes `time[datetime]`
- the relative age token in the left-hand AI-generated search cards, such as `4 days ago`
- the relative age token in the right-hand details panel, such as `2 weeks ago`

## How Viewed Jobs Are Tracked

The extension currently records a job as `viewed` when LinkedIn navigates to a specific job in the job details pane and the URL contains a `currentJobId`.

It also respects LinkedIn’s own `Viewed` badge on cards. If a card already shows LinkedIn’s `Viewed` state and the extension has no local record yet, it stores that as `viewed` as well.

## Context Menu Actions

Right-clicking on a LinkedIn jobs page gives you these actions:

- `Toggle company blacklist`
- `Toggle marker`
- `Mark as applied`
- `Options`

`Toggle marker` is a session-level kill switch. It removes all visual marks until you enable the marker again.

`Options` opens the extension options page in a new tab.

## Options Page

The options page lets you configure a small set of extension settings stored in `chrome.storage.sync`:

- debug logging on/off
- ageing limit in days
- viewed opacity
- applied colour
- blacklisted colour

It also provides:

- `Save`
- `Cancel`
- `Export`
- `Import`
- `Close`

Colour and ageing changes are applied live to LinkedIn pages, so a page reload is not required.

`Ageing limit (days)` accepts values from `1` to `7`. Any other value is treated as disabled and shown as `(disabled)` in the options page while remaining editable.

## Export and Import

The options page can export a JSON file containing:

- extension version
- saved options
- blacklisted companies
- stored jobs, if a LinkedIn tab is open and reachable

Import restores the same structure. Job imports preserve the stronger state, so an older backup cannot downgrade an `applied` record back to `viewed`.

## Storage

The extension uses two browser storage layers:

### IndexedDB

Database: `li-job-marker`
Store: `jobs`

Each record contains:

- `id`: LinkedIn job ID
- `type`: `viewed` or `applied`
- `timestamp`: when the record was saved

### `chrome.storage.sync`

Used for:

- options
- blacklisted companies

This means settings and blacklist data can follow the signed-in browser profile, subject to Chrome sync behaviour.

## Privacy

All data stays in your browser. Nothing is sent to, shared with, or stored by any third party.

## Where It Runs

The extension injects on:

- `https://www.linkedin.com/*`

It then activates its job-marking logic only when the current page is part of LinkedIn Jobs.

This broader match is intentional, because LinkedIn often moves into job pages through SPA navigation rather than a full page load.

## How It Handles LinkedIn’s Dynamic UI

LinkedIn job lists are rendered asynchronously and can change without a traditional page refresh. The extension deals with that by:

- waiting for job cards to appear after page load
- watching the DOM for newly inserted or replaced cards
- watching relevant job-details mutations for right-panel ageing updates
- re-marking cards after SPA navigation into jobs pages
- reapplying colour settings when synced options change

The extension currently routes DOM-specific behaviour through page adapters so it can support multiple LinkedIn job surfaces without relying on one shared selector set.

## Permissions

The manifest currently requests:

- `storage`: save jobs, blacklist entries, and options
- `contextMenus`: add the LinkedIn page actions
- `tabs`: allow the options page to talk to an open LinkedIn tab for export/import support

## Installation

1. Open Chrome and go to `chrome://extensions/`
2. Enable `Developer mode`
3. Click `Load unpacked`
4. Select the project root directory

Do not load the `src/` directory on its own. Load the repository root, where `manifest.json` lives.

## Current Version

Current manifest version: `1.1.46`

## Limitations

- This is a Chrome extension, not a published cross-browser package
- Runtime behaviour on live LinkedIn pages still depends on LinkedIn’s DOM structure
- Ageing support currently covers the classic LinkedIn jobs surface and the AI-generated `/jobs/search-results/` surface; relative-age matching still depends on English text such as `2 weeks ago`
- The durable project notes still contain one open documentation question around the precise definition of `viewed`
