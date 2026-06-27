import { extractFunctions, normalize, findDrift } from './check-drift.mjs'

let failures = 0
function test(name, fn) {
  try { fn(); console.log(`\x1b[32m✓\x1b[0m ${name}`) }
  catch (e) { failures++; console.log(`\x1b[31m✗\x1b[0m ${name}\n  ${e.message}`) }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed') }

const SRC = `
(function () {
  function classifyMessage(s) {
    return s.includes('Already') ? 'dup' : 'ok';
  }
  const escapeHTML = (s) => {
    return String(s).replaceAll('<', '&lt;');
  };
})();
`

test('extractFunctions finds function declarations and braced consts', () => {
  const fns = extractFunctions(SRC)
  assert(fns.has('classifyMessage'), 'missing classifyMessage')
  assert(fns.has('escapeHTML'), 'missing escapeHTML')
})

test('normalize ignores comment and whitespace differences', () => {
  const a = normalize('function f(){ return 1; }')
  const b = normalize('function f() {\n  // a comment\n  return 1;\n}')
  assert(a === b, `expected equal, got\n  ${a}\n  ${b}`)
})

test('findDrift returns empty when test copy matches source', () => {
  const testFile = { name: 'test_x.mjs', text: `
    function test(){}
    function classifyMessage(s) { return s.includes('Already') ? 'dup' : 'ok'; }
  ` }
  const drift = findDrift(SRC, [testFile])
  assert(drift.length === 0, `expected no drift, got ${JSON.stringify(drift)}`)
})

test('findDrift flags a changed copy', () => {
  const testFile = { name: 'test_x.mjs', text: `
    function classifyMessage(s) { return 'STALE'; }
  ` }
  const drift = findDrift(SRC, [testFile])
  assert(drift.length === 1, `expected 1 drift, got ${drift.length}`)
  assert(drift[0].fn === 'classifyMessage', 'wrong fn')
  assert(drift[0].testFile === 'test_x.mjs', 'wrong file')
})

test('findDrift ignores names not present in source (e.g. test harness)', () => {
  const testFile = { name: 'test_x.mjs', text: `function test(name, fn){ return 99; }` }
  assert(findDrift(SRC, [testFile]).length === 0, 'harness should be ignored')
})

console.log(failures ? `\n${failures} failing` : '\nall passing')
process.exit(failures ? 1 : 0)
