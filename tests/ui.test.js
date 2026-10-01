"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const SiteRules = require("../site-rules.js");
const { createPopupController, isSupportedUrl } = require("../popup.js");
const { createOptionsController } = require("../options.js");

const root = path.resolve(__dirname, "..");

class FakeElement {
  constructor(tagName = "div") {
    this.tagName = tagName.toUpperCase();
    this.textContent = "";
    this.value = "";
    this.hidden = false;
    this.disabled = false;
    this.children = [];
    this.listeners = new Map();
    this.attributes = {};
    this.className = "";
    this.type = "";
  }
  addEventListener(name, callback) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name).add(callback);
  }
  removeEventListener(name, callback) { this.listeners.get(name)?.delete(callback); }
  setAttribute(name, value) { this.attributes[name] = value; }
  appendChild(child) { this.children.push(child); return child; }
  replaceChildren(...children) { this.children = children; }
  focus() { this.focused = true; }
  async dispatch(name, event = {}) {
    for (const callback of this.listeners.get(name) || []) await callback({ preventDefault() {}, ...event });
  }
}

class FakeDocument {
  constructor(ids) { this.elements = Object.fromEntries(ids.map((id) => [id, new FakeElement(id.includes("form") ? "form" : "div")])); }
  getElementById(id) { return this.elements[id]; }
  createElement(tagName) { return new FakeElement(tagName); }
}

function fakeChrome(initial, activeUrl = "https://www.example.com/path") {
  let data = { settingsVersion: 1, disabledSites: initial.slice() };
  const listeners = new Set();
  const writes = [];
  const optionsOpens = { count: 0 };
  const chrome = {
    runtime: {
      lastError: null,
      openOptionsPage(callback) { optionsOpens.count += 1; if (callback) callback(); }
    },
    tabs: {
      query(_query, callback) { callback([{ id: 73, url: activeUrl }]); }
    },
    storage: {
      sync: {
        get(_keys, callback) { callback({ ...data, disabledSites: data.disabledSites.slice() }); },
        set(values, callback) {
          writes.push(JSON.parse(JSON.stringify(values)));
          data = { ...data, ...values };
          const changes = {};
          for (const [key, value] of Object.entries(values)) changes[key] = { oldValue: undefined, newValue: value };
          for (const listener of listeners) listener(changes, "sync");
          if (callback) callback();
        }
      },
      onChanged: {
        addListener(listener) { listeners.add(listener); },
        removeListener(listener) { listeners.delete(listener); }
      }
    }
  };
  return {
    chrome,
    writes,
    optionsOpens,
    get data() { return data; },
    externalSet(values) {
      const changes = {};
      for (const [key, value] of Object.entries(values)) {
        changes[key] = { oldValue: data[key], newValue: value };
      }
      data = { ...data, ...values };
      for (const listener of listeners) listener(changes, "sync");
    }
  };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

function popupDocument() {
  return new FakeDocument(["site-name", "site-status", "popup-error", "site-action", "options-link"]);
}

function optionsDocument() {
  return new FakeDocument(["add-site-form", "site-input", "options-error", "options-status", "site-list", "empty-state"]);
}

test("UI pages load the classic shared rules script before their page controller", () => {
  for (const [html, controller] of [["popup.html", "popup.js"], ["options.html", "options.js"]]) {
    const contents = fs.readFileSync(path.join(root, html), "utf8");
    assert.ok(contents.indexOf('src="site-rules.js"') < contents.indexOf(`src="${controller}"`));
    assert.match(contents, /ui\.css/);
  }
});

test("popup identifies unsupported browser and Chrome Web Store pages", () => {
  assert.equal(isSupportedUrl("chrome://settings/", SiteRules), null);
  assert.equal(isSupportedUrl("https://chrome.google.com/webstore/detail/abc", SiteRules), null);
  assert.equal(isSupportedUrl("https://chromewebstore.google.com/detail/abc", SiteRules), null);
  assert.equal(isSupportedUrl("https://example.com/", SiteRules), "example.com");
});

test("popup re-enables the site before refreshing only the originally selected tab", async () => {
  const doc = popupDocument();
  const fake = fakeChrome(["www.example.com", "other.example"]);
  const reloaded = [];
  fake.chrome.tabs.reload = (id, callback) => {
    assert.deepEqual(fake.data.disabledSites, ["other.example"], "settings must save before reload");
    reloaded.push(id);
    callback();
  };
  const controller = createPopupController({ document: doc, chrome: fake.chrome, SiteRules });
  await controller.init();
  await doc.elements["site-action"].dispatch("click");
  assert.deepEqual(reloaded, [73]);
  assert.equal(doc.elements["site-action"].textContent, "Disable for this site");
  controller.dispose();
});

test("popup coalesces repeated clicks while enabling and refreshing", async () => {
  const doc = popupDocument();
  const fake = fakeChrome(["www.example.com"]);
  let finishReload;
  fake.chrome.tabs.reload = (_id, callback) => { finishReload = callback; };
  const controller = createPopupController({ document: doc, chrome: fake.chrome, SiteRules });
  await controller.init();
  const first = controller.handleAction();
  const second = controller.handleAction();
  await flush();
  assert.equal(typeof finishReload, "function");
  finishReload();
  await Promise.all([first, second]);
  assert.deepEqual(fake.data.disabledSites, []);
  assert.equal(fake.writes.length, 1);
  assert.equal(doc.elements["site-action"].disabled, false);
  controller.dispose();
});

test("popup warns before refreshing and reports refresh failure without undoing saved enable", async () => {
  const doc = popupDocument();
  const fake = fakeChrome(["www.example.com"]);
  fake.chrome.tabs.reload = (_id, callback) => {
    fake.chrome.runtime.lastError = { message: "Tab closed" };
    callback();
    fake.chrome.runtime.lastError = null;
  };
  const controller = createPopupController({ document: doc, chrome: fake.chrome, SiteRules });
  await controller.init();
  assert.equal(doc.elements["site-action"].textContent, "Enable and refresh page");
  assert.match(doc.elements["site-status"].textContent, /unsaved changes/i);
  await doc.elements["site-action"].dispatch("click");
  assert.deepEqual(fake.data.disabledSites, []);
  assert.match(doc.elements["popup-error"].textContent, /enabled.*reload.*manually.*Tab closed/i);
  assert.equal(doc.elements["popup-error"].hidden, false);
  controller.dispose();
});

test("popup removes only the exact rule; inherited parent rule remains and opens options", async () => {
  const doc = popupDocument();
  const fake = fakeChrome(["example.com", "www.example.com"]);
  const controller = createPopupController({ document: doc, chrome: fake.chrome, SiteRules });
  await controller.init();
  assert.equal(doc.elements["site-action"].textContent, "Remove site rule");
  await doc.elements["site-action"].dispatch("click");
  await flush();
  assert.deepEqual(fake.data.disabledSites, ["example.com"]);
  assert.equal(doc.elements["site-action"].textContent, "Manage in options");
  assert.match(doc.elements["site-status"].textContent, /parent rule/);
  await doc.elements["site-action"].dispatch("click");
  assert.equal(fake.optionsOpens.count, 1);
  assert.deepEqual(fake.data.disabledSites, ["example.com"]);
  assert.equal(fake.writes.length, 1);
  controller.dispose();
});

test("popup adds a site only after a fresh storage read and reacts to external changes", async () => {
  const doc = popupDocument();
  const fake = fakeChrome([]);
  const controller = createPopupController({ document: doc, chrome: fake.chrome, SiteRules });
  await controller.init();
  assert.equal(doc.elements["site-action"].textContent, "Disable for this site");
  await doc.elements["site-action"].dispatch("click");
  await flush();
  assert.deepEqual(fake.data.disabledSites, ["www.example.com"]);
  fake.externalSet({ disabledSites: ["example.com"] });
  await flush();
  assert.equal(doc.elements["site-action"].textContent, "Manage in options");
  controller.dispose();
});

test("popup never refreshes when disabling, parent-controlled, or on an unsupported page", async () => {
  for (const [rules, url] of [
    [[], "https://www.example.com/"],
    [["example.com"], "https://www.example.com/"],
    [["example.com", "www.example.com"], "https://www.example.com/"],
    [[], "chrome://settings/"]
  ]) {
    const doc = popupDocument();
    const fake = fakeChrome(rules, url);
    let reloads = 0;
    fake.chrome.tabs.reload = (_id, callback) => { reloads++; callback(); };
    const controller = createPopupController({ document: doc, chrome: fake.chrome, SiteRules });
    await controller.init();
    await controller.handleAction();
    assert.equal(reloads, 0, url);
    controller.dispose();
  }
});

test("popup does not refresh or clear the exclusion if saving fails", async () => {
  const doc = popupDocument();
  const fake = fakeChrome(["www.example.com"]);
  let reloads = 0;
  fake.chrome.tabs.reload = (_id, callback) => { reloads++; callback(); };
  fake.chrome.storage.sync.set = (_values, callback) => {
    fake.chrome.runtime.lastError = { message: "Sync quota exceeded" };
    callback();
    fake.chrome.runtime.lastError = null;
  };
  const controller = createPopupController({ document: doc, chrome: fake.chrome, SiteRules });
  await controller.init();
  await controller.handleAction();
  assert.equal(reloads, 0);
  assert.deepEqual(fake.data.disabledSites, ["www.example.com"]);
  assert.match(doc.elements["popup-error"].textContent, /Sync quota exceeded/);
  assert.equal(doc.elements["site-action"].disabled, false);
  controller.dispose();
});

test("options validates input, normalizes duplicates, and refuses redundant child rules", async () => {
  const doc = optionsDocument();
  const fake = fakeChrome(["example.com"]);
  const controller = createOptionsController({ document: doc, chrome: fake.chrome, SiteRules });
  await controller.init();
  doc.elements["site-input"].value = "not a valid host!";
  await doc.elements["add-site-form"].dispatch("submit");
  assert.equal(fake.writes.length, 0);
  assert.match(doc.elements["options-error"].textContent, /valid hostname/);

  doc.elements["site-input"].value = "WWW.Example.com";
  await doc.elements["add-site-form"].dispatch("submit");
  assert.equal(fake.writes.length, 0);
  assert.match(doc.elements["options-status"].textContent, /already covered by/);

  doc.elements["site-input"].value = "https://another.example/path";
  await doc.elements["add-site-form"].dispatch("submit");
  await flush();
  assert.deepEqual(fake.data.disabledSites, ["example.com", "another.example"]);
  assert.equal(doc.elements["site-list"].children.length, 2);
  assert.equal(doc.elements["site-list"].children[0].children[0].textContent, "example.com");
  assert.equal(doc.elements["site-list"].children[0].children[0].innerHTML, undefined);
  controller.dispose();
});

test("options handles duplicate rules and removes a rule using fresh storage", async () => {
  const doc = optionsDocument();
  const fake = fakeChrome(["example.com"]);
  const controller = createOptionsController({ document: doc, chrome: fake.chrome, SiteRules });
  await controller.init();
  doc.elements["site-input"].value = "EXAMPLE.COM";
  await doc.elements["add-site-form"].dispatch("submit");
  assert.equal(fake.writes.length, 0);
  assert.match(doc.elements["options-status"].textContent, /already in the list/);
  await doc.elements["site-list"].children[0].children[1].dispatch("click");
  await flush();
  assert.deepEqual(fake.data.disabledSites, []);
  assert.equal(doc.elements["empty-state"].hidden, false);
  controller.dispose();
});

test("storage failures are shown inline in both popup and options", async () => {
  const brokenChrome = fakeChrome([]).chrome;
  brokenChrome.storage.sync.get = function (_keys, callback) {
    brokenChrome.runtime.lastError = { message: "Storage unavailable" };
    callback(undefined);
    brokenChrome.runtime.lastError = null;
  };
  const pdoc = popupDocument();
  const popup = createPopupController({ document: pdoc, chrome: brokenChrome, SiteRules });
  await popup.init();
  assert.equal(pdoc.elements["popup-error"].hidden, false);
  assert.match(pdoc.elements["popup-error"].textContent, /Storage unavailable/);
  popup.dispose();

  const odoc = optionsDocument();
  const options = createOptionsController({ document: odoc, chrome: brokenChrome, SiteRules });
  await options.init();
  assert.equal(odoc.elements["options-error"].hidden, false);
  assert.match(odoc.elements["options-error"].textContent, /Storage unavailable/);
  options.dispose();
});

test("options reflects external storage changes and reports failed writes inline", async () => {
  const doc = optionsDocument();
  const fake = fakeChrome([]);
  const controller = createOptionsController({ document: doc, chrome: fake.chrome, SiteRules });
  await controller.init();

  fake.externalSet({ disabledSites: ["remote.example"] });
  await flush();
  assert.equal(doc.elements["site-list"].children.length, 1);
  assert.equal(doc.elements["site-list"].children[0].children[0].textContent, "remote.example");

  fake.chrome.storage.sync.set = function (_values, callback) {
    fake.chrome.runtime.lastError = { message: "Sync quota exceeded" };
    callback();
    fake.chrome.runtime.lastError = null;
  };
  doc.elements["site-input"].value = "local.example";
  await doc.elements["add-site-form"].dispatch("submit");
  assert.equal(doc.elements["options-error"].hidden, false);
  assert.match(doc.elements["options-error"].textContent, /Sync quota exceeded/);
  assert.deepEqual(fake.data.disabledSites, ["remote.example"]);
  controller.dispose();
});
