import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixturePath = path.join(root, 'tests', 'fixtures', 'editor-page.html');
const extensionDir = path.resolve(process.env.EXTENSION_DIR || root);
const manifest = JSON.parse(await readFile(path.join(extensionDir, 'manifest.json'), 'utf8'));
const fixtureHtml = await readFile(fixturePath, 'utf8');
const extensionName = manifest.name;
const browserLaunchArgs = [
  `--disable-extensions-except=${extensionDir}`,
  `--load-extension=${extensionDir}`,
  '--no-first-run',
  '--no-default-browser-check'
];

if (process.platform === 'linux' && !process.env.DISPLAY) {
  throw new Error('Run the headed extension harness under Xvfb: xvfb-run -a npm run test:e2e');
}

function logPass(message) {
  console.log(`PASS ${message}`);
}

function extensionIdFromManifestKey(key) {
  const digest = createHash('sha256').update(Buffer.from(key, 'base64')).digest();
  return [...digest.subarray(0, 16)].map((byte) =>
    String.fromCharCode(97 + (byte >> 4), 97 + (byte & 0x0f))
  ).join('');
}

async function extensionIdFromChromePage(context) {
  const page = await context.newPage();
  await page.goto('chrome://extensions/');
  let found = null;
  let diagnostics = '';
  for (let attempt = 0; attempt < 20 && !found; attempt += 1) {
    found = await page.evaluate((expectedName) => {
      const roots = [document];
      const all = [];
      for (let i = 0; i < roots.length; i += 1) {
        const rootNode = roots[i];
        for (const element of rootNode.querySelectorAll('*')) {
          all.push(element);
          if (element.shadowRoot) roots.push(element.shadowRoot);
        }
      }
      const isId = (value) => /^[a-p]{32}$/.test(value || '');
      const deepText = (element) => {
        let text = element.innerText || element.textContent || '';
        if (element.shadowRoot) text += ` ${deepText(element.shadowRoot)}`;
        for (const child of element.children || []) {
          if (child.shadowRoot) text += ` ${deepText(child)}`;
        }
        return text;
      };
      const cards = all.filter((element) => element.tagName?.toLowerCase() === 'extensions-item');
      for (const card of cards) {
        const text = deepText(card);
        const id = card.id || card.getAttribute('item-id') || card.getAttribute('extension-id');
        if (isId(id) && text.toLowerCase().includes(expectedName.toLowerCase())) {
          return { id, name: expectedName };
        }
      }
      const ids = [...new Set(all.map((element) => element.id).filter(isId))];
      if (ids.length === 1) return { id: ids[0], name: expectedName };
      return null;
    }, extensionName);
    if (!found) {
      diagnostics = await page.locator('body').innerText().catch(() => 'No readable extensions page text');
      await page.waitForTimeout(250);
    }
  }
  await page.close();
  if (!found) {
    throw new Error(`Could not discover unpacked extension ID on chrome://extensions. Page text: ${diagnostics}`);
  }
  return found.id;
}

async function discoverExtensionId(context) {
  if (manifest.key) return extensionIdFromManifestKey(manifest.key);
  return extensionIdFromChromePage(context);
}

function extensionPagePath() {
  return manifest.options_ui?.page || manifest.options_page || null;
}

function popupPagePath() {
  return manifest.action?.default_popup || manifest.browser_action?.default_popup || null;
}

function assertPageFile(relativePath, label) {
  assert.ok(relativePath, `manifest.json must declare ${label}`);
  const normalized = path.resolve(extensionDir, relativePath);
  assert.ok(normalized.startsWith(`${extensionDir}${path.sep}`), `${label} must be inside the extension directory`);
  return readFile(normalized).then(() => normalized);
}

async function serveFixture() {
  const server = createServer((request, response) => {
    if (request.url === '/favicon.ico') {
      response.writeHead(204).end();
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    response.end(fixtureHtml);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  return {
    server,
    origin: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  };
}

async function launchContext(profileDir) {
  return chromium.launchPersistentContext(profileDir, {
    channel: 'chromium',
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
    headless: false,
    args: browserLaunchArgs,
    viewport: { width: 1280, height: 900 }
  });
}

async function waitForPath(page, pathname) {
  await page.waitForFunction((expectedPath) => location.pathname === expectedPath, pathname, { timeout: 5000 });
}

async function assertNoNavigation(page, pathname) {
  await page.waitForTimeout(250);
  assert.equal(new URL(page.url()).pathname, pathname, 'Backspace unexpectedly navigated the test page');
}

async function focusDocumentBody(page) {
  await page.locator('body').evaluate((body) => {
    body.tabIndex = -1;
    body.focus();
  });
}

async function setChromeSync(page, settings) {
  const result = await page.evaluate((value) => new Promise((resolve) => {
    chrome.storage.sync.set(value, () => resolve(chrome.runtime.lastError?.message || null));
  }), settings);
  assert.equal(result, null, `chrome.storage.sync.set failed: ${result}`);
}

async function getChromeSync(page) {
  return page.evaluate(() => new Promise((resolve) => {
    chrome.storage.sync.get(null, (value) => resolve({
      error: chrome.runtime.lastError?.message || null,
      value
    }));
  }));
}

async function visibleOptionsInput(page) {
  const candidates = await page.locator('input, textarea').evaluateAll((elements) => elements
    .map((element, index) => ({ element, index }))
    .filter(({ element }) => {
      const type = (element.getAttribute('type') || 'text').toLowerCase();
      return !['button', 'submit', 'reset', 'checkbox', 'radio', 'hidden', 'file'].includes(type) &&
        element.getClientRects().length > 0;
    })
    .map(({ element, index }) => ({
      index,
      id: element.id,
      name: element.name,
      placeholder: element.placeholder,
      ariaLabel: element.getAttribute('aria-label'),
      labels: [...(element.labels || [])].map((label) => label.innerText).join(' ')
    })));
  assert.ok(candidates.length, 'Options page has no visible text field for site rules');
  const preferred = candidates.find((candidate) =>
    /site|domain|host|url|rule/i.test(`${candidate.id} ${candidate.name} ${candidate.placeholder} ${candidate.ariaLabel} ${candidate.labels}`)
  );
  const selected = preferred || candidates[0];
  return page.locator('input, textarea').nth(selected.index);
}

async function submitSiteRule(page, input, site) {
  await input.fill(site);
  const addButton = page.getByRole('button', { name: /add|save|disable/i }).first();
  if (await addButton.count()) {
    await addButton.click();
  } else {
    await input.press('Enter');
  }
}

async function pageHasRule(page, site) {
  return page.getByText(site, { exact: true }).count();
}

async function removeFirstRule(page) {
  const removeButton = page.getByRole('button', { name: /remove|delete/i }).first();
  assert.ok(await removeButton.count(), 'Options page has no accessible remove button for the site rule');
  await removeButton.click();
}

async function run() {
  const profileDir = await mkdtemp(path.join(os.tmpdir(), 'backspace-extension-e2e-'));
  const fixture = await serveFixture();
  let context = null;
  try {
    const optionsRelativePath = extensionPagePath();
    const popupRelativePath = popupPagePath();
    if (!optionsRelativePath) throw new Error('Extension prerequisite pending: manifest does not declare options_ui.page or options_page');
    if (!popupRelativePath) throw new Error('Extension prerequisite pending: manifest does not declare action.default_popup');
    await assertPageFile(optionsRelativePath, 'an options page');
    await assertPageFile(popupRelativePath, 'a popup page');

    context = await launchContext(profileDir);
    let extensionId = await discoverExtensionId(context);
    const extensionOrigin = `chrome-extension://${extensionId}`;
    console.log(`Loaded unpacked extension: ${extensionName} (${extensionId})`);
    logPass('extension ID discovered without requiring a service worker');

    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.goto(`${fixture.origin}/one`);
    await page.getByRole('link', { name: 'Open second history entry' }).click();
    await waitForPath(page, '/two');
    await page.keyboard.press('Backspace');
    await waitForPath(page, '/one');
    await page.keyboard.press('Shift+Backspace');
    await waitForPath(page, '/two');
    logPass('real Backspace goes back and Shift+Backspace goes forward in browser history');

    const textInput = page.locator('#text-input');
    await textInput.fill('abc');
    await textInput.focus();
    await page.keyboard.press('Backspace');
    assert.equal(await textInput.inputValue(), 'ab');
    await assertNoNavigation(page, '/two');

    const searchInput = page.locator('#search-input');
    await searchInput.fill('abc');
    await searchInput.focus();
    await page.keyboard.press('Backspace');
    assert.equal(await searchInput.inputValue(), 'ab');
    await assertNoNavigation(page, '/two');

    const textarea = page.locator('#text-area');
    await textarea.fill('abc');
    await textarea.focus();
    await page.keyboard.press('Backspace');
    assert.equal(await textarea.inputValue(), 'ab');
    await assertNoNavigation(page, '/two');

    const editable = page.locator('#editable-child');
    await editable.evaluate((element) => {
      element.focus();
      const range = element.ownerDocument.createRange();
      range.selectNodeContents(element);
      range.collapse(false);
      const selection = element.ownerDocument.defaultView.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    });
    await page.keyboard.press('Backspace');
    assert.equal(await editable.innerText(), 'ab');
    await assertNoNavigation(page, '/two');

    const openShadowInput = page.locator('open-editor').locator('#shadow-input');
    await openShadowInput.fill('abc');
    await openShadowInput.focus();
    await page.keyboard.press('Backspace');
    assert.equal(await openShadowInput.inputValue(), 'ab');
    await assertNoNavigation(page, '/two');

    const customEditable = page.locator('custom-editor').locator('#custom-editable');
    await customEditable.fill('abc');
    await customEditable.focus();
    await page.keyboard.press('Backspace');
    assert.equal(await customEditable.innerText(), 'ab');
    await assertNoNavigation(page, '/two');

    await page.evaluate(() => document.querySelector('#closed-editor').focusEditor());
    await page.keyboard.press('End');
    await page.keyboard.press('Backspace');
    assert.equal(await page.locator('#closed-editor').evaluate((element) => element.readEditorText()), 'ab');
    await assertNoNavigation(page, '/two');
    logPass('native input, textarea, inherited contenteditable, open/closed shadow and custom editor retain Backspace editing');

    const guardedKeyEvents = await page.evaluate(() => {
      const before = window.__backspaceEvents.length;
      const options = [
        { ctrlKey: true },
        { altKey: true },
        { metaKey: true },
        { repeat: true },
        { isComposing: true }
      ];
      for (const init of options) {
        document.body.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'Backspace', bubbles: true, cancelable: true, composed: true, ...init
        }));
      }
      return window.__backspaceEvents.slice(before);
    });
    assert.equal(guardedKeyEvents.length, 5);
    assert.ok(guardedKeyEvents.every((event) => !event.defaultPrevented), 'A modifier, repeat or composition event was intercepted');
    const designModePrevented = await page.evaluate(() => {
      document.designMode = 'on';
      const event = new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true, composed: true });
      document.body.dispatchEvent(event);
      document.designMode = 'off';
      return event.defaultPrevented;
    });
    assert.equal(designModePrevented, false, 'Backspace was intercepted while document.designMode was on');
    await assertNoNavigation(page, '/two');
    logPass('Ctrl/Alt/Meta, repeat, composition and designMode guards leave events untouched');

    const optionsPage = await context.newPage();
    await optionsPage.goto(`${extensionOrigin}/${optionsRelativePath}`);
    await optionsPage.waitForFunction(() => Boolean(globalThis.chrome?.storage?.sync));
    const input = await visibleOptionsInput(optionsPage);

    const invalidValue = 'https://user:pass@example.com';
    await submitSiteRule(optionsPage, input, invalidValue);
    const errorMessage = optionsPage.locator('#options-error');
    await errorMessage.waitFor({ state: 'visible' });
    assert.equal(await pageHasRule(optionsPage, invalidValue), 0, 'Invalid URL was added as a site rule');
    assert.match(await errorMessage.innerText(), /invalid|valid|enter/i, 'Invalid input did not receive visible inline feedback');

    const host = new URL(fixture.origin).hostname;
    await submitSiteRule(optionsPage, input, host);
    await optionsPage.getByText(host, { exact: true }).waitFor({ state: 'visible' });
    await submitSiteRule(optionsPage, input, host);
    await optionsPage.waitForTimeout(150);
    assert.equal(await pageHasRule(optionsPage, host), 1, 'Adding a duplicate created more than one visible site rule');
    logPass('options reject invalid sites and deduplicate repeated site rules');

    await focusDocumentBody(page);
    await page.keyboard.press('Backspace');
    await assertNoNavigation(page, '/two');
    const disabledEvent = await page.evaluate(() => window.__backspaceEvents.at(-1));
    assert.equal(disabledEvent?.defaultPrevented, false, 'A live-disabled site had its Backspace event intercepted');
    logPass('options write chrome.storage.sync and disable navigation live in an already-loaded tab');

    await removeFirstRule(optionsPage);
    await optionsPage.getByText(host, { exact: true }).waitFor({ state: 'detached' });
    await focusDocumentBody(page);
    await page.keyboard.press('Backspace');
    await waitForPath(page, '/one');
    logPass('removing the site rule re-enables navigation live without reloading the content tab');

    await page.goto(`${fixture.origin}/one`);
    await page.getByRole('link', { name: 'Open second history entry' }).click();
    await waitForPath(page, '/two');
    await setChromeSync(optionsPage, { settingsVersion: 1, disabledSites: [host] });
    await focusDocumentBody(page);
    await page.keyboard.press('Backspace');
    await assertNoNavigation(page, '/two');
    await setChromeSync(optionsPage, { settingsVersion: 1, disabledSites: [] });
    await focusDocumentBody(page);
    await page.keyboard.press('Backspace');
    await waitForPath(page, '/one');
    logPass('real chrome.storage.sync changes propagate live to content-script behavior');

    // Native per-frame injection: events must not cause top-level double navigation.
    for (const frameOrigin of [fixture.origin, fixture.origin.replace('127.0.0.1', 'localhost')]) {
      await page.goto(`${fixture.origin}/two`);
      await page.evaluate((src) => {
        const frame = document.createElement('iframe');
        frame.id = 'proof-frame';
        frame.src = src;
        document.body.append(frame);
      }, `${frameOrigin}/one`);
      const frameElement = await page.locator('#proof-frame').elementHandle();
      const frame = await frameElement.contentFrame();
      await frame.waitForLoadState();
      await frame.getByRole('link', { name: 'Open second history entry' }).click();
      await waitForPath(frame, '/two');
      await focusDocumentBody(frame);
      await page.bringToFront();
      await page.waitForTimeout(150);
      await page.keyboard.press('Backspace');
      try {
        await waitForPath(frame, '/one');
      } catch (error) {
        console.error('Frame diagnostics', { frame: frame.url(), top: page.url(),
          events: await frame.evaluate(() => window.__backspaceEvents),
          active: await page.evaluate(() => document.activeElement.tagName) });
        throw error;
      }
      assert.equal(new URL(page.url()).pathname, '/two');
      await frame.getByRole('link', { name: 'Open second history entry' }).click();
      await setChromeSync(optionsPage, { settingsVersion: 1, disabledSites: [host] });
      await page.waitForTimeout(150);
      await focusDocumentBody(frame);
      await page.keyboard.press('Backspace');
      await assertNoNavigation(frame, '/two');
      assert.equal(await frame.evaluate(() => window.__backspaceEvents.at(-1).defaultPrevented), false);
      await setChromeSync(optionsPage, { settingsVersion: 1, disabledSites: [] });
    }
    logPass('same/cross-origin iframe navigation is frame-local and respects top-level site exclusions');

    const popupPage = await context.newPage();
    await popupPage.goto(`${extensionOrigin}/${popupRelativePath}`);
    await popupPage.waitForFunction(() => Boolean(globalThis.chrome?.runtime?.id));
    await popupPage.waitForFunction(() => {
      const site = document.querySelector('#site-name')?.textContent;
      const action = document.querySelector('#site-action')?.textContent;
      return site && site !== 'Checking this page…' && action && action !== 'Loading…';
    });
    assert.equal(await popupPage.evaluate(() => chrome.runtime.id), extensionId);
    assert.ok((await popupPage.locator('#site-name').innerText()).trim().length, 'Popup did not render a page status');
    console.log('LIMIT popup document was opened as a chrome-extension page; Playwright did not activate the browser toolbar action, so action-popup focus/activeTab behavior is not claimed');

    await submitSiteRule(optionsPage, input, 'persist.example');
    await optionsPage.getByText('persist.example', { exact: true }).waitFor({ state: 'visible' });
    const beforeRestart = await getChromeSync(optionsPage);
    assert.equal(beforeRestart.error, null, `Could not read sync storage before restart: ${beforeRestart.error}`);
    assert.ok(beforeRestart.value.disabledSites?.includes('persist.example'), 'Options page did not persist the restart marker');

    const unchangedPageErrors = [...pageErrors];
    await context.close();
    context = null;
    context = await launchContext(profileDir);
    extensionId = await discoverExtensionId(context);
    assert.equal(extensionId, new URL(extensionOrigin).hostname, 'Extension ID changed across a persistent-profile restart');
    const restartedOptions = await context.newPage();
    await restartedOptions.goto(`${extensionOrigin}/${optionsRelativePath}`);
    const afterRestart = await getChromeSync(restartedOptions);
    assert.equal(afterRestart.error, null, `Could not read sync storage after restart: ${afterRestart.error}`);
    assert.ok(afterRestart.value.disabledSites?.includes('persist.example'), 'chrome.storage.sync state did not survive browser restart');
    assert.deepEqual(unchangedPageErrors, [], `Fixture page raised errors: ${unchangedPageErrors.join('; ')}`);
    logPass('chrome.storage.sync settings persist after closing and relaunching the headed Chromium profile');

    console.log('NOTE automated headed Chromium result only; this is not a manual Chrome or Chrome Web Store verification');
  } finally {
    if (context) await context.close().catch(() => {});
    await fixture.close().catch(() => {});
    await rm(profileDir, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(`FAIL ${error.stack || error.message}`);
  process.exitCode = 1;
});
