// Migrated from test_pure_edge_cases.mjs: escapeHTML is the real function from
// better_bee.user.js, not a copy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScript } from './harness.mjs';

const escape = str => loadScript().internals.escapeHTML(str);

test('escapes <>&" characters', () => {
  assert.equal(escape('<>&"'), '&lt;&gt;&amp;&quot;');
});
test('empty input returns empty string', () => {
  assert.equal(escape(''), '');
});
test('safe strings pass through unchanged', () => {
  assert.equal(escape('hello world'), 'hello world');
});
test('handles strings with multiple special chars like script tags', () => {
  assert.equal(
    escape('<script>alert("xss")</script>'),
    '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
  );
});
