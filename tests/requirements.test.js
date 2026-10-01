const test = require('node:test');
const assert = require('node:assert/strict');
const rules = require('../site-rules.js');
for (const [host, rule, expected] of [
  ['example.com', 'example.com', true],
  ['mail.example.com', 'example.com', true],
  ['one.two.example.com', 'example.com', true],
  ['notexample.com', 'example.com', false],
  ['example.com.fake.com', 'example.com', false],
  ['example.com', 'mail.example.com', false],
  ['shop.example.com', 'mail.example.com', false],
  ['anything.mail.example.com', 'mail.example.com', true],
  ['example.com', 'www.example.com', false]
]) {
  test(`${host} with exclusion ${rule}: ${expected ? 'disabled' : 'enabled'}`, () => {
    assert.equal(rules.matchesDisabledSite(host, [rule]), expected);
  });
}
for (const [input, expected] of [
  ['https://Example.COM/test?q=123', 'example.com'],
  ['example.com:8080', 'example.com'],
  ['http://localhost:3000/test', 'localhost'],
  ['http://192.168.1.5:8080', '192.168.1.5'],
  ['https://[2001:db8::1]:8443/path', '[2001:db8::1]']
]) {
  test(`normalization: ${input}`, () => assert.equal(rules.normalizeSite(input), expected));
}
test('equivalent normalized URL cannot add a duplicate', () => {
  assert.deepEqual(rules.normalizeRules(['example.com', 'https://EXAMPLE.COM/foo']), ['example.com']);
});
