const test = require('node:test');
const assert = require('node:assert/strict');
const SiteRules = require('../site-rules.js');
const { installContentScript } = require('../contentscript.js');

function makeHarness({ settings = { settingsVersion: 1, disabledSites: [] }, autoLoad = true, top = 'https://example.com', protocol = 'https:', ancestors } = {}) {
  const calls = { back: 0, forward: 0 };
  const listeners = {};
  const storageListeners = [];
  let pendingGet;
  const topLocation = top === null ? null : new URL(top);
  const location = { protocol, href: 'https://frame.example/path', hostname: 'frame.example', ancestorOrigins: ancestors };
  const win = {
    history: {
      back() { calls.back += 1; },
      forward() { calls.forward += 1; },
    },
    addEventListener(type, callback, capture) {
      listeners[type] = { callback, capture };
    },
    get location() { return location; },
    get top() {
      if (topLocation === null) throw new Error('cross-origin');
      return { location: topLocation };
    },
    get ancestorOrigins() { return undefined; },
  };
  const chrome = {
    runtime: { lastError: null },
    storage: {
      sync: {
        get(defaults, callback) {
          pendingGet = () => callback(settings);
          if (autoLoad) pendingGet();
        },
      },
      onChanged: {
        addListener(callback) { storageListeners.push(callback); },
      },
    },
  };
  const document = { designMode: 'off' };
  const api = installContentScript({ window: win, document, chrome, SiteRules });

  function keydown(options = {}) {
    let prevented = false;
    const event = {
      key: 'Backspace',
      defaultPrevented: false,
      isComposing: false,
      repeat: false,
      ctrlKey: false,
      altKey: false,
      metaKey: false,
      shiftKey: false,
      target: { nodeType: 1, tagName: 'BODY', isContentEditable: false },
      composedPath() { return [this.target]; },
      preventDefault() { prevented = true; },
      ...options,
    };
    listeners.keydown.callback(event);
    return { prevented, event };
  }

  return {
    api, calls, chrome, document, keydown, listeners, location, storageListeners,
    load() { pendingGet(); },
    change(changes, area = 'sync') { storageListeners[0](changes, area); },
  };
}

test('waits for settings before installing navigation behavior and uses a capture listener', () => {
  const h = makeHarness({ autoLoad: false });
  assert.equal(h.listeners.keydown.capture, true);
  assert.equal(h.keydown().prevented, false);
  h.load();
  assert.equal(h.keydown().prevented, true);
  assert.equal(h.calls.back, 1);
});

test('Backspace navigates back and Shift+Backspace navigates forward', () => {
  const h = makeHarness();
  assert.equal(h.keydown().prevented, true);
  assert.equal(h.calls.back, 1);
  assert.equal(h.keydown({ shiftKey: true }).prevented, true);
  assert.equal(h.calls.forward, 1);
});

test('ignores non-Backspace, prevented, composing, repeated and modified keys', () => {
  const h = makeHarness();
  for (const options of [
    { key: 'Enter' }, { defaultPrevented: true }, { isComposing: true },
    { repeat: true }, { ctrlKey: true }, { altKey: true }, { metaKey: true },
  ]) {
    assert.equal(h.keydown(options).prevented, false, JSON.stringify(options));
  }
  assert.deepEqual(h.calls, { back: 0, forward: 0 });
});

test('leaves native editing and uncertain custom-editor targets untouched', () => {
  const h = makeHarness();
  const editableNodes = [
    { nodeType: 1, tagName: 'INPUT' }, { nodeType: 1, tagName: 'TEXTAREA' },
    { nodeType: 1, tagName: 'DIV', isContentEditable: true },
    { nodeType: 1, tagName: 'X-CODE-EDITOR' },
  ];
  for (const target of editableNodes) {
    assert.equal(h.keydown({ target }).prevented, false, target.tagName);
  }
  h.document.designMode = 'On';
  assert.equal(h.keydown().prevented, false);
});

test('disabled sites and protected Web Store hosts are untouched', () => {
  const disabled = makeHarness({
    top: 'https://sub.example.com',
    settings: { settingsVersion: 1, disabledSites: ['example.com'] },
  });
  assert.equal(disabled.keydown().prevented, false);

  for (const top of ['https://chrome.google.com', 'https://chromewebstore.google.com']) {
    const h = makeHarness({ top });
    assert.equal(h.keydown().prevented, false, top);
  }
});

test('a newer storage change wins over an in-flight initial read', () => {
  const h = makeHarness({ autoLoad: false, settings: { settingsVersion: 1, disabledSites: [] } });
  h.change({ disabledSites: { newValue: ['example.com'] } });
  h.load();
  assert.equal(h.keydown().prevented, false);
});

test('storage load errors fail closed; later valid changes recover', () => {
  const h = makeHarness({ autoLoad: false });
  h.chrome.runtime.lastError = { message: 'unavailable' };
  h.load();
  assert.equal(h.keydown().prevented, false);
  h.chrome.runtime.lastError = null;
  h.change({ disabledSites: { newValue: [] } });
  assert.equal(h.keydown().prevented, true);
});

test('unknown top-frame identity fails closed and never navigates top history', () => {
  const h = makeHarness({ top: null });
  assert.equal(h.keydown().prevented, false);
  assert.deepEqual(h.calls, { back: 0, forward: 0 });
});

test('unsupported initial settings version stays fail-closed after a partial rules change', () => {
  const h = makeHarness({ settings: { settingsVersion: 2, disabledSites: [] } });
  assert.equal(h.keydown().prevented, false);
  h.change({ disabledSites: { newValue: ['unrelated.test'] } });
  assert.equal(h.keydown().prevented, false);
  assert.deepEqual(h.calls, { back: 0, forward: 0 });
});

test('uses the top ancestor origin across frames and calls only the current frame history', () => {
  const h = makeHarness({
    top: null,
    ancestors: ['https://parent.example', 'https://example.com'],
  });
  assert.equal(h.keydown().prevented, true);
  assert.deepEqual(h.calls, { back: 1, forward: 0 });
});
