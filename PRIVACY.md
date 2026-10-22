# Privacy Policy for Job Ad Marker

Effective date: 22 October 2026

Job Ad Marker is an independent extension for Chrome and Firefox. It is not affiliated with or endorsed by LinkedIn. It helps users recognise jobs they have viewed or applied for, mark companies on a personal blacklist, filter unwanted titles and keep notes.

## What data the extension handles

The extension reads content already loaded on LinkedIn pages you open, including job IDs, titles, company names and company-page identifiers, viewed/applied labels, and listing age and promotion labels. It uses this information to show visual marks and match saved records. It does not automatically browse LinkedIn, submit applications, send messages or change your LinkedIn account's saved jobs or application status.

The extension stores:

- LinkedIn job IDs and saved marker states, such as `viewed` or `applied`.
- Company names, company-page identifiers when available, and personal blacklist status.
- Notes you enter, together with the associated job title, company and available job ID or company-page identifier.
- Settings, including colours, opacity, ageing rules, unwanted-title words, the promoted/reposted option and debug preference.
- Record identifiers, creation and update times, deletion and merge information, and migration/import metadata needed to maintain these records.
- Local sync status and error information used to show sync problems.

If you enable debug logging, diagnostic information, which may include page or job details, is written to the browser console. It is not automatically sent to the developer.

## How the data is used

Data is used only for the extension's user-facing features: visual marking, saved job history, personal company blacklists, title rules, notes, local statistics, settings, browser sync and backup/restore. The extension does not use this data for advertising, developer analytics, creditworthiness or lending decisions.

Job Ad Marker's use of user data complies with the Chrome Web Store User Data Policy, including its Limited Use requirements. Data is not sold or used for purposes unrelated to the extension's stated features.

## Where the data is stored

Jobs, companies and notes are stored in the extension's IndexedDB database on your device. Browser local storage also holds operational information such as sync status. Clearing LinkedIn website data does not clear the extension's database. Older versions stored job history in LinkedIn-origin browser storage; the extension migrates those records into its own database when a LinkedIn page is opened.

Settings and company blacklist records use the browser's extension sync storage. When browser sync is enabled, these records may be transmitted to and stored by your browser provider, such as Google for Chrome or Mozilla for Firefox, and synchronised with your other browsers using the same account. Company records include available company-page identifiers and record/deletion metadata. This service is governed by your browser provider's privacy policy and account settings.

Jobs and notes are not automatically synced by the extension.

## Data sharing

The extension does not send your data to the developer or to developer-operated servers. It does not sell data, use external analytics or advertising services, or load remote executable code. It does not require a separate extension account.

Browser-provider sync is the exception to device-only storage described above. Exporting a backup also creates a file at a location you choose; its contents can leave your device if you save it in a synced folder or share it yourself.

## Permissions

The extension uses:

- `storage` to save settings, sync company blacklists and keep local operational information.
- `contextMenus` to provide marking, notes and settings actions.
- `tabs` to find open LinkedIn tabs and communicate extension changes to them.
- Access to `https://www.linkedin.com/*` to read relevant page content and display marks and notes on supported job and company pages. The domain-wide match supports LinkedIn's navigation between pages without a full reload.

## Data retention and control

Saved jobs and notes have no automatic expiry. You can edit notes, remove notes from view, change settings and remove companies from your personal blacklist. Deletions are recorded rather than immediately erasing the underlying records: deleted records, including note text, can remain in local storage and exported backups. Company deletion records may also be retained in browser sync to propagate changes across devices.

Export creates a JSON backup containing settings, jobs, companies and notes, including retained deleted records. Import merges records with existing data; it is not a way to erase all previous data.

You can remove local extension data using your browser's extension-data controls or by uninstalling the extension. Removing the extension from one device does not guarantee deletion of copies on other devices, browser-provider sync services or exported files. Manage browser sync through your browser/account settings and delete backup files separately when you no longer need them.

The Toggle marker menu controls visual marking; it is not a data-deletion or complete data-processing pause control. Disable or uninstall the extension in your browser to stop it running on LinkedIn pages.

## Local statistics

The extension counts job cards shown on LinkedIn results pages as daily totals by category (shown, new, previously viewed, applied, blacklisted company, unwanted title, ageing), keyed by local date, together with the date tracking started or was last reset. It does not store job IDs, titles or companies for statistics; a short-lived list of job IDs already counted is kept only in the open page's memory to avoid counting re-rendered cards twice.

Statistics stay in the extension's database on this device. They are not synced, not included in backups and not changed by importing one, and they are not sent to the developer or anyone else. Private windows are not counted. **Reset statistics** on the Statistics page deletes them without affecting jobs, notes or the blacklist; removing extension data or uninstalling also deletes them.

## Contact

For privacy questions, use the [Job Ad Marker project issue tracker](https://github.com/ivostoykov/li-job-ad-marker/issues). Issues are public: do not include personal notes, backup files or other private information.
