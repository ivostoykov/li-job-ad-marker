# Privacy Policy for LinkedIn Job Ad Marker

Effective date: 27 March 2026

LinkedIn Job Ad Marker is a Chrome extension that helps users recognise LinkedIn job adverts they have already viewed or applied for, and companies they have chosen to blacklist.

## What data the extension handles

The extension stores the following data in the user's browser:

- LinkedIn job IDs and their saved state, such as `viewed` or `applied`
- blacklisted company names
- extension settings, such as marker colours, viewed opacity, and debug preference

## How the data is used

This data is used only to provide the extension's core function: adding visual markers on LinkedIn job pages and restoring the user's settings and saved markers between sessions.

## Where the data is stored

Data is stored locally in the browser by using:

- IndexedDB for saved job marker records
- `chrome.storage.sync` for settings and blacklisted companies

If Chrome sync is enabled on the user's browser profile, settings and blacklist data may sync through Google's Chrome sync service as part of normal browser behaviour.

## Data sharing

The extension does not sell user data.

The extension does not send user data to the developer or to any third party.

The extension does not use remote code, external analytics, tracking, advertising, or external servers.

## Permissions

The extension requests only the permissions needed for its stated purpose:

- `storage` to save markers and settings
- `contextMenus` to provide job-marking actions on LinkedIn pages
- `tabs` to support options-page interactions with an open LinkedIn tab
- access to `https://www.linkedin.com/*` so it can run on LinkedIn pages

## Data retention and control

The stored data remains in the user's browser until the user removes it by clearing extension data, changing stored values, importing replacement data, or uninstalling the extension.

## Local statistics

The extension counts job cards shown on LinkedIn results pages as daily totals by category (shown, new, previously viewed, applied, blacklisted company, unwanted title, ageing), keyed by local date, together with the date tracking started or was last reset. It does not store job IDs, titles or companies for statistics; a short-lived list of job IDs already counted is kept only in the open page's memory to avoid counting re-rendered cards twice.

Statistics stay in the extension's database on this device. They are not synced, not included in backups and not changed by importing one, and they are not sent to the developer or anyone else. Private windows are not counted. **Reset statistics** on the Statistics page deletes them without affecting jobs, notes or the blacklist; removing extension data or uninstalling also deletes them.

## Contact

If you publish this extension, replace this section with your preferred contact method, such as an email address or project page.
