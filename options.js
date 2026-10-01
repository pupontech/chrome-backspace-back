(function (root) {
  "use strict";

  const { readSettings, writeSettings } =
    typeof module !== "undefined" && module.exports ? require("./ui-settings.js") : root.UiSettings;

  function createOptionsController(dependencies) {
    var doc = dependencies.document;
    var chromeApi = dependencies.chrome;
    var siteRules = dependencies.SiteRules;
    var form = doc.getElementById("add-site-form");
    var input = doc.getElementById("site-input");
    var errorMessage = doc.getElementById("options-error");
    var statusMessage = doc.getElementById("options-status");
    var list = doc.getElementById("site-list");
    var emptyState = doc.getElementById("empty-state");
    var rules = [];
    var revision = 0;
    var operationQueue = Promise.resolve();

    function setError(error) {
      errorMessage.textContent = error ? (error.message || "Something went wrong. Please try again.") : "";
      errorMessage.hidden = !error;
    }

    function render() {
      list.replaceChildren();
      rules.forEach(function (rule) {
        var item = doc.createElement("li");
        item.className = "site-item";
        var name = doc.createElement("span");
        name.className = "site-item-name";
        name.textContent = rule;
        var remove = doc.createElement("button");
        remove.type = "button";
        remove.className = "remove-button";
        remove.textContent = "Remove";
        remove.setAttribute("aria-label", "Remove " + rule);
        remove.addEventListener("click", function () { removeRule(rule); });
        item.appendChild(name);
        item.appendChild(remove);
        list.appendChild(item);
      });
      emptyState.hidden = rules.length !== 0;
    }

    function refresh() {
      var request = ++revision;
      return readSettings(chromeApi, siteRules).then(function (settings) {
        if (request !== revision) return;
        rules = settings.disabledSites;
        render();
      });
    }

    function enqueue(operation) {
      operationQueue = operationQueue.then(operation).catch(function (error) {
        setError(error || new Error("Unable to update site settings."));
      });
      return operationQueue;
    }

    function addRule(event) {
      if (event && typeof event.preventDefault === "function") event.preventDefault();
      setError(null);
      statusMessage.textContent = "";
      var hostname = siteRules.normalizeSite(input.value);
      if (!hostname) {
        setError(new Error("Enter a valid hostname or http/https URL."));
        input.focus();
        return Promise.resolve();
      }
      return enqueue(function () {
        return readSettings(chromeApi, siteRules).then(function (latest) {
          rules = latest.disabledSites;
          render();
          if (rules.indexOf(hostname) !== -1) {
            statusMessage.textContent = hostname + " is already in the list.";
            return;
          }
          var coveringRule = siteRules.findMatchingRule(hostname, rules);
          if (coveringRule) {
            statusMessage.textContent = hostname + " is already covered by “" + coveringRule + "”.";
            return;
          }
          var updated = siteRules.normalizeRules(rules.concat(hostname));
          return writeSettings(chromeApi, updated).then(function () {
            rules = updated;
            render();
            input.value = "";
            statusMessage.textContent = hostname + " was added.";
            input.focus();
          });
        });
      });
    }

    function removeRule(rule) {
      setError(null);
      statusMessage.textContent = "";
      return enqueue(function () {
        return readSettings(chromeApi, siteRules).then(function (latest) {
          rules = latest.disabledSites;
          render();
          if (rules.indexOf(rule) === -1) {
            statusMessage.textContent = rule + " is no longer in the list.";
            return;
          }
          var updated = rules.filter(function (entry) { return entry !== rule; });
          return writeSettings(chromeApi, updated).then(function () {
            rules = updated;
            render();
            statusMessage.textContent = rule + " was removed.";
          });
        });
      });
    }

    function onStorageChanged(changes, areaName) {
      if (areaName !== "sync" || (!changes.disabledSites && !changes.settingsVersion)) return;
      refresh().then(function () { statusMessage.textContent = "Site settings updated."; }).catch(setError);
    }

    function init() {
      form.addEventListener("submit", addRule);
      if (chromeApi.storage.onChanged && chromeApi.storage.onChanged.addListener) {
        chromeApi.storage.onChanged.addListener(onStorageChanged);
      }
      return refresh().catch(function (error) {
        setError(error);
        rules = [];
        render();
      });
    }

    function dispose() {
      if (chromeApi.storage.onChanged && chromeApi.storage.onChanged.removeListener) {
        chromeApi.storage.onChanged.removeListener(onStorageChanged);
      }
      form.removeEventListener("submit", addRule);
    }

    return { init: init, dispose: dispose, addRule: addRule, removeRule: removeRule };
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { createOptionsController: createOptionsController };
  } else if (root.document && root.chrome && root.SiteRules) {
    var start = function () { createOptionsController({ document: root.document, chrome: root.chrome, SiteRules: root.SiteRules }).init(); };
    if (root.document.readyState === "loading") root.document.addEventListener("DOMContentLoaded", start, { once: true });
    else start();
  }
})(globalThis);
