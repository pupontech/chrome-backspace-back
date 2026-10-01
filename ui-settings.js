(function (root) {
  "use strict";
  // Chrome callbacks work from MV3's Chrome 88 baseline; no compatibility layer.
  function apiCall(target, method, args, chromeApi) {
    return new Promise(function (resolve, reject) {
      target[method].apply(target, args.concat(function (value) {
        const error = chromeApi.runtime.lastError;
        if (error) reject(new Error(error.message || "Browser API error"));
        else resolve(value);
      }));
    });
  }
  function readSettings(chromeApi, siteRules) {
    return apiCall(chromeApi.storage.sync, "get", [{ settingsVersion: 1, disabledSites: [] }], chromeApi)
      .then(function (stored) {
        if (stored.settingsVersion !== 1 || !Array.isArray(stored.disabledSites) ||
            stored.disabledSites.some(function (rule) { return siteRules.normalizeSite(rule) === null; })) {
          throw new Error("Saved settings are invalid or from an unsupported version.");
        }
        return { settingsVersion: 1, disabledSites: siteRules.normalizeRules(stored.disabledSites) };
      });
  }
  function writeSettings(chromeApi, rules) {
    return apiCall(chromeApi.storage.sync, "set", [{ settingsVersion: 1, disabledSites: rules }], chromeApi);
  }
  const api = { apiCall, readSettings, writeSettings };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.UiSettings = api;
})(globalThis);
