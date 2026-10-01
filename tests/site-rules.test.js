const test = require('node:test');
const assert = require('node:assert/strict');
const SiteRules = require('../site-rules.js');

test('normalizeSite accepts URLs and bare hosts while preserving www', () => {
  for (const [input, expected] of [
    [' Example.COM ', 'example.com'],
    ['https://www.Example.com:8443/path?q=1#top', 'www.example.com'],
    ['https://example.com/path with spaces?q=*', 'example.com'],
    ['http://localhost:3000', 'localhost'],
    ['192.0.2.10:8080', '192.0.2.10'],
    ['[2001:db8::1]:8443', '[2001:db8::1]'],
    ['https://bücher.example/', 'xn--bcher-kva.example'],
  ]) {
    assert.equal(SiteRules.normalizeSite(input), expected, input);
  }
});

test('normalizeSite rejects malformed, credentialed, wildcard and non-http inputs', () => {
  for (const input of [
    '', '   ', null, 42, '*.example.com', 'https://*.example.com',
    'ftp://example.com', 'javascript:alert(1)', 'https://user@example.com',
    'https://example.com@evil.test', 'bad host', 'example..com',
    '-bad.example', 'bad-.example', 'https://example.com:99999',
    'https://exa mple.com/path',
  ]) {
    assert.equal(SiteRules.normalizeSite(input), null, String(input));
  }
});

test('normalizeSite rejects ambiguous numeric IPv4 forms', () => {
  for (const input of ['127.1', '2130706433', '0x7f000001', '192.168.001.1']) {
    assert.equal(SiteRules.normalizeSite(input), null, input);
  }
  assert.equal(SiteRules.normalizeSite('127.0.0.1'), '127.0.0.1');
});

test('normalizeRules filters invalid entries and deduplicates normalized hosts', () => {
  assert.deepEqual(
    SiteRules.normalizeRules(['Example.com', 'https://example.com/path', '*.bad.test', 'www.example.com', '']),
    ['example.com', 'www.example.com'],
  );
  assert.deepEqual(SiteRules.normalizeRules('example.com'), []);
});

test('findMatchingRule prefers exact and most-specific dot-boundary parent rules', () => {
  const rules = ['example.com', 'deep.example.com', 'other.test'];
  assert.equal(SiteRules.findMatchingRule('deep.example.com', rules), 'deep.example.com');
  assert.equal(SiteRules.findMatchingRule('a.deep.example.com', rules), 'deep.example.com');
  assert.equal(SiteRules.findMatchingRule('notexample.com', rules), null);
  assert.equal(SiteRules.findMatchingRule('other.test', rules), 'other.test');
  assert.equal(SiteRules.matchesDisabledSite('a.example.com', rules), true);
  assert.equal(SiteRules.matchesDisabledSite('unrelated.test', rules), false);
});

test('IP literals match exactly, never as parent rules', () => {
  assert.equal(SiteRules.findMatchingRule('192.0.2.1', ['192.0.2.1']), '192.0.2.1');
  assert.equal(SiteRules.findMatchingRule('sub.192.0.2.1', ['192.0.2.1']), null);
  assert.equal(SiteRules.findMatchingRule('[2001:db8::1]', ['[2001:db8::1]']), '[2001:db8::1]');
  assert.equal(SiteRules.findMatchingRule('[2001:db8::2]', ['[2001:db8::1]']), null);
});
