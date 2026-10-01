# Changelog

## 1.2.1

- Toolbar re-enabling saves the setting and refreshes only the current tab automatically.
- Added a clear “Enable and refresh page” label and unsaved-work warning.
- No refresh when disabling, when a parent exclusion still applies, or when saving fails.
- Refresh failures retain the saved setting and show manual-reload guidance.
- Ignore duplicate clicks while a site action is in progress; no new permissions or worker.
- Added regression and real-browser refresh tests; ZIP testing follows manifest version.

## 1.2.0

- Added synced website exclusions, a toolbar toggle and an options page.
- Added boundary-aware domain normalization and subdomain matching.
- Replaced legacy global-event handling with an explicit capture listener.
- Protected editable targets and ignored modifier, repeat and composition events.
- Added automated tests and allowlisted runtime-only packaging.
- Preserved upstream attribution and documented its missing explicit license.
