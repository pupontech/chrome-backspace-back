# Backspace to Go Back

A tiny Google Chrome extension restoring **Backspace → back** and **Shift + Backspace → forward**, with one addition: disable navigation on selected websites.

## Features

- Protects inputs, textareas and editable content, including Shadow DOM where visible.
- Ignores Ctrl/Alt/Meta, repeated keydowns and IME composition.
- Toolbar site toggle and a small exclusion-management options page.
- Settings stored in Chrome Sync and applied to already-open pages.
- Vanilla JavaScript; no background worker, framework, analytics or backend.

## Disable on a site

1. Visit the website.
2. Click the extension icon.
3. Click **Disable on this site**.

An exclusion for `example.com` also covers `mail.example.com` and deeper subdomains, but not `notexample.com` or `example.com.fake.com`. A rule for `mail.example.com` does not cover its parent or siblings. `www` is preserved. Ports and URL paths are discarded; IP rules match exactly.

If a parent rule controls the current site, the popup identifies that rule and sends you to options. It never silently removes a parent exclusion and enables all its other subdomains.

## Re-enable on a site

Click **Enable and refresh page** in the toolbar popup. The extension first saves the exclusion change, then refreshes only that tab so its keyboard handler is ready. **Save any unsaved work before clicking:** refreshing may discard form/editor changes or prompt you to confirm leaving. Disabling does not refresh the page.

If another parent-domain rule still excludes the site, the button instead removes only the redundant site rule; it does not refresh or silently remove the parent. Use options to manage the controlling parent rule. Removing a rule in options updates already-injected tabs without automatically refreshing them.

If saving fails, the tab is not refreshed. If refreshing fails after a successful save, navigation remains enabled and the popup asks you to reload manually. Browser-level disabling/re-enabling of the entire extension in `chrome://extensions` is separate: an inactive extension cannot run this toolbar action.

## Manage exclusions

Open **Manage excluded sites** in the popup (or the extension's options in `chrome://extensions`). Add a hostname or an HTTP(S) URL; entries are trimmed, lowercased and normalized to hostnames. Equivalent entries are duplicates. Remove rules individually. Validation and storage errors appear inline.

Rules are not regular expressions, wildcards or URL-path filters. The simple deny list has no allow overrides. Chrome Sync imposes storage limits; failed writes do not count as saved. Simultaneous edits from separate windows/devices are not transactional.

## Installation from source

1. Clone `https://github.com/pupontech/chrome-backspace-back.git`, or extract the prototype ZIP.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select the directory containing `manifest.json`.

Disable the original Backspace extension to avoid two extensions handling the same key. Reload already-open website tabs after installation or extension reload. Unpacked installations do not update automatically. No Chrome Web Store submission has been made for this fork.

## Permissions and architecture

- `storage`: save and observe exclusion settings in `chrome.storage.sync`.
- `activeTab`: read the current site's URL when you invoke the toolbar popup, without broad `tabs` permission.
- Static content-script URL matches: deliver keyboard handling on supported ordinary web pages; required for navigation without first clicking the toolbar.

Content scripts cache settings, listen for storage changes and handle keyboard events. Popup and options read/write storage directly. There is no service worker, message relay or per-key storage request. Restricted browser pages and Chrome Web Store pages cannot be controlled.

Frames retain individual keyboard handling without cross-frame event forwarding. A frame uses the top-level hostname when it can identify it safely; uncertain contexts must not navigate. Frame history remains frame-local. Browser site-access restrictions still apply.

Editable detection is deliberately conservative. Standards-based editors using inputs, textareas or contenteditable are protected; opaque canvas/custom editors cannot be perfectly identified. Exclude such a site if necessary rather than risking unsaved edits.

## Privacy

No analytics, telemetry, browsing-history collection, page-text collection or remote services. The extension makes no external network requests. Only exclusion settings and their settings version are stored. Chrome may sync those settings through your browser account; when Sync is disabled, Chrome stores them locally.

## Development and verification

Node 22+ and Python 3 are used only for development/packaging:

```sh
npm ci --include=dev
npm test
npx playwright install chromium
npm run test:e2e
npm run release
```

On Linux, run headed browser tests under `xvfb-run -a npm run test:e2e`. The Playwright dependency is development-only and is not packaged. ZIP creation uses an explicit runtime allowlist and verifies every member. See `TESTING.md` for executed evidence and remaining owner checks; an automated Chromium pass is not a manual Google Chrome/Edge/Brave pass.

## Upstream and attribution

Modified fork of [oslego/chrome-backspace-back](https://github.com/oslego/chrome-backspace-back) by **Razvan Caliman**, preserving upstream Git history. Inspected upstream revision: `347e524e221fd7b85bedf2b751404fdf39e2c370`. Upstream manifest and Chrome Web Store version were **1.1.2** when checked October 1, 2026.

Icon: [Backspace by Rflor](https://thenounproject.com/term/backspace/300516/) from the Noun Project; upstream attribution retained.

## License

The inspected upstream repository contains **no explicit LICENSE file, package license field or source license header**; GitHub reports no detected license. Public availability does not imply an unrestricted open-source license. This fork does not invent an MIT/GPL license, claim ownership of upstream work or remove attribution. Rights to upstream code and icons remain with their respective holders; obtain permission or licensing clarification before redistribution beyond the authorized fork/testing workflow.
