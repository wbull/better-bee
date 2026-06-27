import { extractFunctions, normalize, findDrift, extractBody } from './check-drift.mjs'

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

test('extractBody returns the text between the outermost braces', () => {
  const decl = 'function foo(x) { return x + 1; }'
  const body = extractBody(decl)
  assert(body === ' return x + 1; ', `expected ' return x + 1; ', got '${body}'`)
})

test('findDrift: signature differs but body identical → no drift', () => {
  // test file uses no params (parameterized adaptation), source has params
  const src = `function nextHint(hintQueue, hintIndex) { return hintQueue[hintIndex]; }`
  const testFile = {
    name: 'test_next.mjs',
    text: `function nextHint() { return hintQueue[hintIndex]; }`,
  }
  const drift = findDrift(src, [testFile])
  assert(drift.length === 0, `expected no drift (signature change only), got ${JSON.stringify(drift)}`)
})

test('findDrift: body differs → flagged even if name matches', () => {
  const src = `function calc(a, b) { return a; }`
  const testFile = {
    name: 'test_calc.mjs',
    text: `function calc(a, b) { return b; }`,
  }
  const drift = findDrift(src, [testFile])
  assert(drift.length === 1, `expected 1 drift, got ${drift.length}`)
  assert(drift[0].fn === 'calc', `expected fn 'calc', got '${drift[0].fn}'`)
})

console.log(failures ? `\n${failures} failing` : '\nall passing')
process.exit(failures ? 1 : 0)
