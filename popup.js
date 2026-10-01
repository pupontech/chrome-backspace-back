(function (root) {
  "use strict";

  const { apiCall, readSettings, writeSettings } =
    typeof module !== "undefined" && module.exports ? require("./ui-settings.js") : root.UiSettings;

  function isSupportedUrl(url, siteRules) {
    if (typeof url !== "string") return null;
    var parsed;
    try { parsed = new URL(url); } catch (_) { return null; }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    var hostname = parsed.hostname.toLowerCase();
    if (hostname === "chrome.google.com" && parsed.pathname.toLowerCase().startsWith("/webstore")) return null;
    if (hostname === "chromewebstore.google.com") return null;
    return siteRules.normalizeSite(url);
  }

  function createPopupController(dependencies) {
    var doc = dependencies.document;
    var chromeApi = dependencies.chrome;
    var siteRules = dependencies.SiteRules;
    var siteName = doc.getElementById("site-name");
    var siteStatus = doc.getElementById("site-status");
    var errorMessage = doc.getElementById("popup-error");
    var actionButton = doc.getElementById("site-action");
    var optionsLink = doc.getElementById("options-link");
    var hostname = null;
    var tabId = null;
    var rules = [];
    var settingsLoaded = false;
    var revision = 0;
    var operationQueue = Promise.resolve();
    var busy = false;

    function setError(error) {
      errorMessage.textContent = error ? (error.message || "Something went wrong. Please try again.") : "";
      errorMessage.hidden = !error;
    }

    function matchingRule() {
      return hostname ? siteRules.findMatchingRule(hostname, rules) : null;
    }

    function render() {
      if (!hostname) {
        siteName.textContent = "Unsupported page";
        siteStatus.textContent = "This extension works on regular http and https websites, not browser pages or the Chrome Web Store.";
        actionButton.disabled = true;
        actionButton.textContent = "Unavailable on this page";
        return;
      }
      siteName.textContent = hostname;
      if (!settingsLoaded) {
        siteStatus.textContent = "Loading saved site settings…";
        actionButton.disabled = true;
        actionButton.textContent = "Loading…";
        return;
      }
      var match = matchingRule();
      var exact = rules.indexOf(hostname) !== -1;
      if (!match) {
        siteStatus.textContent = "Backspace navigation is enabled on this site.";
        actionButton.textContent = "Disable for this site";
      } else if (exact) {
        var parent = siteRules.findMatchingRule(hostname, rules.filter(function (rule) { return rule !== hostname; }));
        siteStatus.textContent = parent
          ? "Also disabled by the parent rule “" + parent + "”. Removing this site rule will not enable navigation."
          : "Enabling navigation refreshes this page. Unsaved changes may be lost.";
        actionButton.textContent = parent ? "Remove site rule" : "Enable and refresh page";
      } else {
        siteStatus.textContent = "Backspace navigation is disabled by the parent rule “" + match + "”.";
        actionButton.textContent = "Manage in options";
      }
      actionButton.disabled = busy;
    }

    function refresh() {
      var request = ++revision;
      return readSettings(chromeApi, siteRules).then(function (settings) {
        if (request !== revision) return;
        rules = settings.disabledSites;
        settingsLoaded = true;
        render();
      });
    }

    function enqueue(operation) {
      operationQueue = operationQueue.then(operation).catch(function (error) {
        setError(error || new Error("Unable to update site settings."));
      });
      return operationQueue;
    }

    function handleAction() {
      if (!hostname || busy) return operationQueue;
      busy = true;
      render();
      return enqueue(function () {
        setError(null);
        return readSettings(chromeApi, siteRules).then(function (latest) {
          rules = latest.disabledSites;
          settingsLoaded = true;
          render();
          var exactIndex = rules.indexOf(hostname);
          if (exactIndex !== -1) {
            var updated = rules.filter(function (rule) { return rule !== hostname; });
            return writeSettings(chromeApi, updated).then(function () {
              rules = updated;
              render();
              if (!matchingRule()) {
                return apiCall(chromeApi.tabs, "reload", [tabId], chromeApi).catch(function (error) {
                  throw new Error("Navigation is enabled, but the page could not be refreshed. Reload it manually. " + error.message);
                });
              }
            });
          }
          if (matchingRule()) {
            return apiCall(chromeApi.runtime, "openOptionsPage", [], chromeApi);
          }
          var added = siteRules.normalizeRules(rules.concat(hostname));
          return writeSettings(chromeApi, added).then(function () {
            rules = added;
            render();
          });
        });
      }).finally(function () {
        busy = false;
        render();
      });
    }

    function onStorageChanged(changes, areaName) {
      if (areaName !== "sync" || (!changes.disabledSites && !changes.settingsVersion)) return;
      refresh().catch(function (error) {
        settingsLoaded = false;
        render();
        setError(error);
      });
    }

    function onOptionsClick(event) {
      if (event && typeof event.preventDefault === "function") event.preventDefault();
      apiCall(chromeApi.runtime, "openOptionsPage", [], chromeApi).catch(setError);
    }

    function init() {
      actionButton.disabled = true;
      actionButton.addEventListener("click", handleAction);
      optionsLink.addEventListener("click", onOptionsClick);
      if (chromeApi.storage.onChanged && chromeApi.storage.onChanged.addListener) {
        chromeApi.storage.onChanged.addListener(onStorageChanged);
      }
      return apiCall(chromeApi.tabs, "query", [{ active: true, currentWindow: true }], chromeApi)
        .then(function (tabs) {
          var activeTab = Array.isArray(tabs) ? tabs[0] : null;
          tabId = activeTab && Number.isInteger(activeTab.id) && activeTab.id >= 0 ? activeTab.id : null;
          hostname = tabId !== null ? isSupportedUrl(activeTab.url, siteRules) : null;
          render();
          if (!hostname) return;
          return refresh().catch(function (error) {
            settingsLoaded = false;
            render();
            setError(error);
          });
        })
        .catch(function (error) {
          setError(error);
          hostname = null;
          siteName.textContent = "Page unavailable";
          siteStatus.textContent = "The active page could not be read, so its site setting cannot be changed.";
          actionButton.disabled = true;
          actionButton.textContent = "Unavailable";
        });
    }

    function dispose() {
      if (chromeApi.storage.onChanged && chromeApi.storage.onChanged.removeListener) {
        chromeApi.storage.onChanged.removeListener(onStorageChanged);
      }
      actionButton.removeEventListener("click", handleAction);
      optionsLink.removeEventListener("click", onOptionsClick);
    }

    return { init: init, dispose: dispose, handleAction: handleAction };
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { createPopupController: createPopupController, isSupportedUrl: isSupportedUrl };
  } else if (root.document && root.chrome && root.SiteRules) {
    var start = function () { createPopupController({ document: root.document, chrome: root.chrome, SiteRules: root.SiteRules }).init(); };
    if (root.document.readyState === "loading") root.document.addEventListener("DOMContentLoaded", start, { once: true });
    else start();
  }
})(globalThis);
