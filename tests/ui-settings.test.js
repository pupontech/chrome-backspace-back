const test = require('node:test');
const assert = require('node:assert/strict');
const { readSettings, apiCall } = require('../ui-settings.js');
const SiteRules = require('../site-rules.js');

function chromeWith(stored) {
  return { runtime: {}, storage: { sync: { get(defaults, callback) { callback({ ...defaults, ...stored }); } } } };
}
test('shared UI settings default to a fresh empty list and normalize valid rules', async () => {
  assert.deepEqual(await readSettings(chromeWith({}), SiteRules), { settingsVersion: 1, disabledSites: [] });
  assert.deepEqual((await readSettings(chromeWith({ disabledSites: ['Example.com', 'https://example.com/a'] }), SiteRules)).disabledSites, ['example.com']);
});
test('UI never silently overwrites corrupt or unsupported saved settings', async () => {
  for (const stored of [{ settingsVersion: 2 }, { disabledSites: 'bad' }, { disabledSites: ['*.example.com'] }]) {
    await assert.rejects(readSettings(chromeWith(stored), SiteRules), /Saved settings/);
  }
});
test('shared callback helper rejects thrown APIs and lastError', async () => {
  await assert.rejects(apiCall({ run() { throw new Error('gone'); } }, 'run', [], { runtime: {} }), /gone/);
  await assert.rejects(apiCall({ run(callback) { callback(); } }, 'run', [], { runtime: { lastError: { message: 'quota' } } }), /quota/);
});
