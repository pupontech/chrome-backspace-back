(function attachContentScript(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (typeof window !== 'undefined' && typeof document !== 'undefined' && root.chrome) {
    api.installContentScript({
      window,
      document,
      chrome: root.chrome,
      SiteRules: root.SiteRules,
    });
  }
})(globalThis, function createContentScript() {
  const SETTINGS_VERSION = 1;
  const PROTECTED_HOSTS = new Set(['chrome.google.com', 'chromewebstore.google.com']);

  function isEditingTarget(event, document) {
    if (String(document.designMode || '').toLowerCase() === 'on') return true;

    let path;
    try {
      path = typeof event.composedPath === 'function' ? event.composedPath() : null;
    } catch (_error) {
      path = null;
    }
    if (!Array.isArray(path) || path.length === 0) path = [event.target];

    for (const node of path) {
      if (!node || typeof node !== 'object') continue;
      const tag = String(node.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea') return true;
      if (node.isContentEditable) return true;

      const editable = typeof node.getAttribute === 'function' ? node.getAttribute('contenteditable') : null;
      if (editable !== null && /^(|true|plaintext-only)$/i.test(String(editable))) return true;

      // Retargeted events from closed-shadow editors expose only their host.
      if (tag.includes('-')) return true;
      const role = typeof node.getAttribute === 'function' ? node.getAttribute('role') : null;
      if (role && /^(textbox|searchbox|combobox)$/i.test(role)) return true;
      const multiline = typeof node.getAttribute === 'function' ? node.getAttribute('aria-multiline') : null;
      if (String(multiline).toLowerCase() === 'true') return true;
    }
    return false;
  }

  function topHostname(windowObject, siteRules) {
    try {
      const location = windowObject.top.location;
      const hostname = siteRules.normalizeSite(location.hostname || location.href);
      if (hostname) return hostname;
    } catch (_error) {
      // Cross-origin top access falls through to ancestorOrigins.
    }

    try {
      const ancestors = windowObject.location.ancestorOrigins || windowObject.ancestorOrigins;
      if (ancestors && ancestors.length) {
        return siteRules.normalizeSite(ancestors[ancestors.length - 1]);
      }
    } catch (_error) {
      // Unknown top identity is handled fail-closed by the caller.
    }
    return null;
  }

  function validSettings(settings, siteRules) {
    if (!settings || settings.settingsVersion !== SETTINGS_VERSION || !Array.isArray(settings.disabledSites)) {
      return null;
    }
    if (settings.disabledSites.some((rule) => siteRules.normalizeSite(rule) === null)) return null;
    return siteRules.normalizeRules(settings.disabledSites);
  }

  function installContentScript(environment) {
    const windowObject = environment.window;
    const document = environment.document;
    const chromeObject = environment.chrome;
    const siteRules = environment.SiteRules;
    const state = {
      ready: false,
      rules: [],
      rawRules: null,
      settingsVersion: SETTINGS_VERSION,
      revision: 0,
    };

    function onStorageChanged(changes, areaName) {
      if (areaName !== 'sync' || !changes ||
          (!Object.prototype.hasOwnProperty.call(changes, 'settingsVersion') &&
           !Object.prototype.hasOwnProperty.call(changes, 'disabledSites'))) {
        return;
      }

      state.revision += 1;
      const hasVersion = Object.prototype.hasOwnProperty.call(changes, 'settingsVersion');
      const hasRules = Object.prototype.hasOwnProperty.call(changes, 'disabledSites');
      const version = hasVersion ? changes.settingsVersion.newValue : state.settingsVersion;
      const rawRules = hasRules ? changes.disabledSites.newValue : state.rawRules;
      const rules = validSettings({ settingsVersion: version, disabledSites: rawRules }, siteRules);
      if (!rules) {
        state.ready = false;
        state.rules = [];
        state.rawRules = null;
        state.settingsVersion = version;
        return;
      }

      state.ready = true;
      state.rules = rules;
      state.rawRules = rawRules;
      state.settingsVersion = version;
    }

    try {
      chromeObject.storage.onChanged.addListener(onStorageChanged);
    } catch (_error) {
      return { state, onStorageChanged };
    }

    const initialRevision = state.revision;
    try {
      chromeObject.storage.sync.get({ settingsVersion: SETTINGS_VERSION, disabledSites: [] }, (settings) => {
        if (state.revision !== initialRevision) return;
        if (chromeObject.runtime && chromeObject.runtime.lastError) {
          state.ready = false;
          return;
        }
        state.settingsVersion = settings && settings.settingsVersion;
        state.rawRules = settings && settings.disabledSites;
        const rules = validSettings(settings, siteRules);
        if (!rules) {
          state.ready = false;
          return;
        }
        state.ready = true;
        state.rules = rules;

      });
    } catch (_error) {
      state.ready = false;
    }

    function onKeydown(event) {
      if (event.key !== 'Backspace' || event.defaultPrevented || event.isComposing || event.keyCode === 229 ||
          event.repeat || event.ctrlKey || event.altKey || event.metaKey || !state.ready ||
          isEditingTarget(event, document)) {
        return;
      }

      const protocol = windowObject.location && windowObject.location.protocol;
      if (protocol && !['http:', 'https:', 'about:'].includes(protocol)) return;

      const hostname = topHostname(windowObject, siteRules);
      if (!hostname || PROTECTED_HOSTS.has(hostname) ||
          siteRules.matchesDisabledSite(hostname, state.rules)) {
        return;
      }

      event.preventDefault();
      if (event.shiftKey) {
        windowObject.history.forward();
      } else {
        windowObject.history.back();
      }
    }

    windowObject.addEventListener('keydown', onKeydown, true);
    return { state, onKeydown, onStorageChanged };
  }

  return { installContentScript, isEditingTarget, topHostname };
});