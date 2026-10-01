const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');

test('runtime manifest stays minimal and its files exist', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json')));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, '1.2.0');
  assert.deepEqual([...manifest.permissions].sort(), ['activeTab', 'storage']);
  assert.equal(manifest.background, undefined);
  for (const forbidden of ['host_permissions', 'optional_permissions', 'web_accessible_resources']) {
    assert.equal(manifest[forbidden], undefined, forbidden);
  }
  assert.equal(manifest.action.default_popup, 'popup.html');
  assert.equal(manifest.options_ui?.page ?? manifest.options_page, 'options.html');
  assert.deepEqual(manifest.content_scripts[0].js, ['site-rules.js', 'contentscript.js']);
  for (const name of [...manifest.content_scripts[0].js, manifest.action.default_popup,
    manifest.options_ui?.page ?? manifest.options_page, ...Object.values(manifest.icons)]) {
    assert.ok(fs.existsSync(path.join(root, name)), name);
  }
});

test('runtime has no remote code, network clients or unsafe HTML generation', () => {
  for (const name of ['contentscript.js', 'site-rules.js', 'popup.js', 'options.js', 'ui-settings.js']) {
    const code = fs.readFileSync(path.join(root, name), 'utf8');
    assert.doesNotMatch(code, /\b(?:fetch|XMLHttpRequest|WebSocket|eval)\s*\(|new\s+Function\s*\(|\.innerHTML\s*=/, name);
    assert.doesNotMatch(code, /console\.(?:log|debug)\s*\(/, name);
  }
  for (const name of ['popup.html', 'options.html']) {
    const html = fs.readFileSync(path.join(root, name), 'utf8');
    assert.doesNotMatch(html, /<script\b[^>]*src=["']https?:|\son\w+\s*=/i, name);
  }
});
