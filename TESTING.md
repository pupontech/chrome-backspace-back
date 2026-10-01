# Verification ledger

This file records executed evidence, not a checklist claimed as passing.

## Baseline inspection

- Upstream revision: `347e524e221fd7b85bedf2b751404fdf39e2c370` (master).
- Upstream manifest and current Web Store listing: 1.1.2.
- No tags, one branch, original Git history preserved.
- All tracked text files, PNG sizes and icon source inspected; no explicit license found.
- Keyboard/editing issues #2, #3, #10, #12, #13 and exclusions request #11 reviewed; protected-error-page issue #9 reviewed.
- Current Chrome storage, activeTab, tabs and content-script documentation consulted.

## Implementation gates

Executed locally on October 1, 2026:

- `npm test`: **44 passed, 0 failed, 0 skipped** (Node built-in runner).
- Genuine headed loaded-extension harness passed under both system Chromium 154 and Playwright's Chromium, not injected Chrome API fakes.
- Back/forward history; native input/search/textarea; inherited contenteditable; open and closed Shadow DOM; custom standards-based editor editing.
- Ctrl/Alt/Meta, repeat/composition flags and designMode are left untouched. Repeat/composition flags are synthetic browser events, not physical OS input-method evidence.
- Options invalid-input feedback, duplicates, adding/removing real sync rules, immediate disabling/re-enabling without tab reload.
- Same-origin and cross-origin iframe back navigation remains frame-local; both use top-level hostname exclusions.
- Real `chrome.storage.sync` data survives closing and restarting the same Chromium profile.
- Popup document loaded and rendered; ordinary page/status/parent-rule transitions separately covered by Node DOM/API tests. **Native toolbar invocation/activeTab grant not exercised.**
- Built runtime-only ZIP: **13 allowlisted files**, no tests, dependency tree or development metadata. Extracted ZIP passed the same genuine extension harness.
- Independent Luna review identified one unsupported-settings-version fail-closed defect. A regression failed before the fix, passed afterward, and a focused independent re-review passed.
- Simplification: shared 29-line `ui-settings.js` replaced duplicate UI storage/API wrappers. No worker, framework, network client or extra permission added.
- `git diff --check` passed. Runtime JavaScript is approximately 648 lines / 24,238 bytes in five files; tests and packaging are development-only.

Hosted Windows CI: pending first push; merge is gated on its result.

## Owner-only checks

- Manual current stable Google Chrome toolbar click/grant path, installing/reloading on your real browsing profile, and interactions with your existing extensions.
- Real OS IME, physically held-key repeat across page changes, and any canvas/opaque editor you use.
- Named third-party editors (Monaco, CodeMirror, ProseMirror, Lexical, TinyMCE) unless specifically listed in executed evidence below.
- Chrome Sync between signed-in devices; browser restart storage persistence is separately testable locally.
- Edge and Brave: Chromium API compatibility expected, not a tested-browser claim.

These checks do not require a backend or Web Store upload.
