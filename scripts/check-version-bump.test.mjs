import { extractVersion, stripVersionLine, needsBump } from './check-version-bump.mjs'

let failures = 0
function test(name, fn) {
  try { fn(); console.log(`\x1b[32m✓\x1b[0m ${name}`) }
  catch (e) { failures++; console.log(`\x1b[31m✗\x1b[0m ${name}\n  ${e.message}`) }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed') }

const v = (ver, body) => `// ==UserScript==\n// @version      ${ver}\n// ==/UserScript==\n${body}`

test('extractVersion reads the header value', () => {
  assert(extractVersion(v('1.39', 'x')) === '1.39', 'wrong version')
})

test('needsBump=true when body changes but version is unchanged', () => {
  assert(needsBump(v('1.39', 'A'), v('1.39', 'B')) === true, 'should block')
})

test('needsBump=false when version was bumped alongside body change', () => {
  assert(needsBump(v('1.39', 'A'), v('1.40', 'B')) === false, 'should allow')
})

test('needsBump=false when nothing changed', () => {
  assert(needsBump(v('1.39', 'A'), v('1.39', 'A')) === false, 'no change → allow')
})

console.log(failures ? `\n${failures} failing` : '\nall passing')
process.exit(failures ? 1 : 0)
