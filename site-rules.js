(function attachSiteRules(root, factory) {
  const api = factory();
  root.SiteRules = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(globalThis, function createSiteRules() {
  function isIpv4(hostname) {
    const parts = hostname.split('.');
    return parts.length === 4 && parts.every((part) =>
      /^(0|[1-9]\d{0,2})$/.test(part) && Number(part) <= 255,
    );
  }

  function isIpLiteral(hostname) {
    return hostname.startsWith('[') && hostname.endsWith(']') || isIpv4(hostname);
  }

  function authorityHostname(authority) {
    if (!authority || authority.includes('@')) return null;
    if (authority.startsWith('[')) {
      const close = authority.indexOf(']');
      if (close < 0 || !/^\](:\d+)?$/.test(authority.slice(close))) return null;
      return authority.slice(0, close + 1).toLowerCase();
    }

    const colon = authority.lastIndexOf(':');
    if (colon < 0) return authority.toLowerCase();
    if (authority.indexOf(':') !== colon || !/^\d+$/.test(authority.slice(colon + 1))) return null;
    return authority.slice(0, colon).toLowerCase();
  }

  function validDnsHostname(hostname) {
    if (hostname.length > 253 || hostname.length === 0) return false;
    return hostname.split('.').every((label) =>
      label.length > 0 && label.length <= 63 &&
      /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label),
    );
  }

  function normalizeSite(input) {
    if (typeof input !== 'string') return null;
    const value = input.trim();
    if (!value || /[\u0000-\u001f\u007f]/.test(value)) return null;

    const isUrl = /^[a-z][a-z\d+.-]*:\/\//i.test(value);
    if (isUrl && !/^https?:\/\//i.test(value)) return null;
    if (!isUrl && /[/?#]/.test(value)) return null;

    const authority = isUrl ? value.replace(/^[a-z][a-z\d+.-]*:\/\//i, '').split(/[/?#]/, 1)[0] : value;
    if (!authority || /\s|\*/.test(authority)) return null;
    const inputHostname = authorityHostname(authority);
    if (!inputHostname) return null;

    let parsed;
    try {
      parsed = new URL(isUrl ? value : `http://${value}`);
    } catch (_error) {
      return null;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    if (parsed.username || parsed.password || !parsed.hostname) return null;

    let hostname = parsed.hostname.toLowerCase();
    if (hostname.endsWith('.')) hostname = hostname.slice(0, -1);
    if (!hostname || hostname.endsWith('.')) return null;

    if (/^\d+(?:\.\d+){3}$/.test(hostname)) {
      if (!isIpv4(hostname) || inputHostname !== hostname) return null;
    } else if (hostname.startsWith('[') && hostname.endsWith(']')) {
      if (hostname.length < 4 || !/^[\[\]a-f\d:.]+$/.test(hostname)) return null;
    } else if (!validDnsHostname(hostname)) {
      return null;
    }

    return hostname;
  }

  function normalizeRules(rules) {
    if (!Array.isArray(rules)) return [];
    const seen = new Set();
    const normalized = [];
    for (const rule of rules) {
      const hostname = normalizeSite(rule);
      if (hostname && !seen.has(hostname)) {
        seen.add(hostname);
        normalized.push(hostname);
      }
    }
    return normalized;
  }

  function findMatchingRule(hostname, rules) {
    const site = normalizeSite(hostname);
    if (!site) return null;
    const normalizedRules = normalizeRules(rules);
    if (normalizedRules.includes(site)) return site;
    if (isIpLiteral(site)) return null;

    let match = null;
    for (const rule of normalizedRules) {
      if (isIpLiteral(rule)) continue;
      if (site.endsWith(`.${rule}`) && (!match || rule.length > match.length)) {
        match = rule;
      }
    }
    return match;
  }

  function matchesDisabledSite(hostname, rules) {
    return findMatchingRule(hostname, rules) !== null;
  }

  return { normalizeSite, normalizeRules, findMatchingRule, matchesDisabledSite };
});
