# Better Bee Agentic Ship Pipeline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a `/ship-bee` slash command that hands an issue or prompt to a 4-agent team (planner → implementer → verifier → shipper) which takes a change from idea to a reviewable PR, backed by two deterministic commit-blocking guard scripts.

**Architecture:** Two Node guard scripts (drift-guard, version-guard) provide deterministic safety as a PreToolUse hook. Four Claude Code subagents (markdown definitions under `.claude/agents/`) each own one pipeline role with a minimal tool grant. A `.claude/commands/ship-bee.md` orchestrator dispatches them in sequence and stops at a PR. Spec: `docs/superpowers/specs/2026-06-27-bee-ship-pipeline-design.md`.

**Tech Stack:** Node 24+ (ESM `.mjs`), the repo's existing tiny test harness (`function test()` with ✓/✗ output), Claude Code subagents/commands/hooks, the `claude-in-chrome` MCP for browser verification, `gh` CLI for PRs.

## Global Constraints

- **Never push to or merge `main`.** The pipeline stops at an opened PR.
- **The `.user.js` file is the deliverable** — no build step is introduced.
- Userscript version lives in the `@version` line (~line 4 of `better_bee.user.js`); user-visible changes bump it.
- Pure functions are copy-pasted from `better_bee.user.js` into `test_*.mjs`; source and test copies must stay byte-identical after normalization.
- Follow the repo's existing test style: plain ESM `.mjs`, inline `function test(name, fn)` harness, no test framework.
- New `@connect`/`@grant` header lines are required before the script may reach a new host or GM API.
- Repo home: `/Users/wbull/git/better-bee`. Work happens on a feature branch, not `main`.
- Screenshots are attached to the PR conversation, never committed to the repo.

---

### Task 1: Drift-guard script (pure core + CLI)

Detects when a pure function in `better_bee.user.js` differs from its copied version in a `test_*.mjs` file. Auto-discovers pairs by function name (no manifest to maintain): for every function name defined in **both** the source and a test file, compare normalized bodies.

**Files:**
- Create: `scripts/check-drift.mjs`
- Test: `scripts/check-drift.test.mjs`

**Interfaces:**
- Produces:
  - `extractFunctions(text: string): Map<string,string>` — name → raw declaration text (signature through matching `}`). Handles `function NAME(...) {…}` and `const/let NAME = … {…}` (any declaration whose head ends in `{`). One-liner arrow bodies without braces are not extracted.
  - `normalize(code: string): string` — strips `//` line comments and collapses all whitespace to single spaces, trimmed.
  - `findDrift(sourceText: string, testFiles: {name:string,text:string}[]): {fn:string,testFile:string}[]` — for each name present in both source and a test file, returns an entry when normalized bodies differ.

- [ ] **Step 1: Write the failing test**

Create `scripts/check-drift.test.mjs`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/check-drift.test.mjs`
Expected: FAIL — `Cannot find module './check-drift.mjs'` (or import error).

- [ ] **Step 3: Write minimal implementation**

Create `scripts/check-drift.mjs`:

```js
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

// Capture a declaration whose head ends in `{`, then brace-match to its close.
export function extractFunctions(text) {
  const map = new Map()
  const headRe = /(?:function\s+([A-Za-z0-9_$]+)\s*\([^)]*\)|(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=\s*(?:async\s*)?(?:function\s*)?\([^)]*\)\s*(?:=>)?)\s*\{/g
  let m
  while ((m = headRe.exec(text)) !== null) {
    const name = m[1] || m[2]
    const openIdx = text.indexOf('{', m.index + m[0].length - 1)
    if (openIdx === -1) continue
    let depth = 0
    let i = openIdx
    for (; i < text.length; i++) {
      const c = text[i]
      if (c === '{') depth++
      else if (c === '}') { depth--; if (depth === 0) { i++; break } }
    }
    map.set(name, text.slice(m.index, i))
  }
  return map
}

export function normalize(code) {
  return code
    .replace(/\/\/[^\n]*/g, '')   // drop line comments
    .replace(/\s+/g, ' ')          // collapse whitespace
    .trim()
}

export function findDrift(sourceText, testFiles) {
  const src = extractFunctions(sourceText)
  const out = []
  for (const { name, text } of testFiles) {
    const fns = extractFunctions(text)
    for (const [fn, body] of fns) {
      if (!src.has(fn)) continue // only compare functions that exist in both
      if (normalize(body) !== normalize(src.get(fn))) {
        out.push({ fn, testFile: name })
      }
    }
  }
  return out
}

function main() {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
  const source = readFileSync(join(repoRoot, 'better_bee.user.js'), 'utf8')
  const testFiles = readdirSync(repoRoot)
    .filter((f) => /^test_.*\.mjs$/.test(f))
    .map((f) => ({ name: f, text: readFileSync(join(repoRoot, f), 'utf8') }))
  const drift = findDrift(source, testFiles)
  if (drift.length) {
    console.error('\x1b[31mDRIFT: source/test copies differ for:\x1b[0m')
    for (const d of drift) console.error(`  - ${d.fn}  (in ${d.testFile})`)
    console.error('\nMirror the source function into its test file (or vice versa).')
    process.exit(1)
  }
  console.log('drift-guard: source/test copies in sync')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node scripts/check-drift.test.mjs`
Expected: PASS — all 5 tests `✓`, ends with `all passing`.

- [ ] **Step 5: Run the CLI against the real repo (informational)**

Run: `node scripts/check-drift.mjs`
Expected: either `drift-guard: source/test copies in sync`, or a list of pre-existing drift. **If pre-existing drift is reported, record it but do NOT fix it as part of this task** — it is a separate code issue; note it for the user.

- [ ] **Step 6: Commit**

```bash
git add scripts/check-drift.mjs scripts/check-drift.test.mjs
git commit -m "feat: add drift-guard (source/test function parity checker)"
```

---

### Task 2: Version-guard script (pure core + CLI)

Blocks a commit that changes `better_bee.user.js` without bumping its `@version`.

**Files:**
- Create: `scripts/check-version-bump.mjs`
- Test: `scripts/check-version-bump.test.mjs`

**Interfaces:**
- Produces:
  - `extractVersion(text: string): string|null` — value of the `@version` header line.
  - `stripVersionLine(text: string): string` — text with the `@version` line removed.
  - `needsBump(headText: string, newText: string): boolean` — `true` (block) when non-version content changed but the version did not.

- [ ] **Step 1: Write the failing test**

Create `scripts/check-version-bump.test.mjs`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/check-version-bump.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `scripts/check-version-bump.mjs`:

```js
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const VERSION_RE = /^\s*\/\/\s*@version\s+(.+?)\s*$/m

export function extractVersion(text) {
  const m = text.match(VERSION_RE)
  return m ? m[1] : null
}

export function stripVersionLine(text) {
  return text.split('\n').filter((l) => !VERSION_RE.test(l)).join('\n')
}

export function needsBump(headText, newText) {
  const bodyChanged = stripVersionLine(headText) !== stripVersionLine(newText)
  const versionSame = extractVersion(headText) === extractVersion(newText)
  return bodyChanged && versionSame
}

function main() {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
  const file = 'better_bee.user.js'
  let headText
  try {
    headText = execFileSync('git', ['show', `HEAD:${file}`], { cwd: repoRoot, encoding: 'utf8' })
  } catch {
    process.exit(0) // no HEAD version (new file) → nothing to compare
  }
  const newText = readFileSync(join(repoRoot, file), 'utf8')
  if (needsBump(headText, newText)) {
    console.error('\x1b[31mVERSION: better_bee.user.js changed but @version was not bumped.\x1b[0m')
    console.error('Bump the @version line (~line 4) before committing.')
    process.exit(1)
  }
  console.log('version-guard: ok')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node scripts/check-version-bump.test.mjs`
Expected: PASS — 4 `✓`, `all passing`.

- [ ] **Step 5: Commit**

```bash
git add scripts/check-version-bump.mjs scripts/check-version-bump.test.mjs
git commit -m "feat: add version-guard (@version bump checker)"
```

---

### Task 3: Hook dispatcher + settings.json + npm test wiring

A single hook script decides whether a Bash tool call is a commit/PR and, if it touches the userscript or a test file, runs both guards. Registered as a PreToolUse hook. The guards are also chained into `npm test`.

**Files:**
- Create: `scripts/ship-guard-hook.mjs`
- Create: `.claude/settings.json`
- Modify: `package.json` (the `test` script)

**Interfaces:**
- Consumes: `check-drift.mjs` (`findDrift`), `check-version-bump.mjs` (`needsBump`).
- Produces: a hook that exits `2` (blocking) with an explanation on stderr when a guard fails.

- [ ] **Step 1: Write the hook dispatcher**

Create `scripts/ship-guard-hook.mjs`:

```js
// PreToolUse hook. Reads the tool call JSON on stdin. If the Bash command is a
// `git commit` or `gh pr create` that stages better_bee.user.js or a test file,
// run drift-guard + version-guard. Exit 2 to block (stderr is shown to Claude).
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { findDrift } from './check-drift.mjs'
import { needsBump } from './check-version-bump.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

function readStdin() {
  try { return readFileSync(0, 'utf8') } catch { return '' }
}

const payload = JSON.parse(readStdin() || '{}')
const cmd = payload?.tool_input?.command ?? ''
if (!/\bgit\s+commit\b|\bgh\s+pr\s+create\b/.test(cmd)) process.exit(0)

let staged = []
try {
  staged = execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: repoRoot, encoding: 'utf8' })
    .split('\n').filter(Boolean)
} catch { process.exit(0) }

const touchesGuarded = staged.some((f) => f === 'better_bee.user.js' || /^test_.*\.mjs$/.test(f))
if (!touchesGuarded) process.exit(0)

const problems = []

// drift
const source = readFileSync(join(repoRoot, 'better_bee.user.js'), 'utf8')
const testFiles = readdirSync(repoRoot)
  .filter((f) => /^test_.*\.mjs$/.test(f))
  .map((f) => ({ name: f, text: readFileSync(join(repoRoot, f), 'utf8') }))
const drift = findDrift(source, testFiles)
if (drift.length) {
  problems.push('drift: ' + drift.map((d) => `${d.fn}(${d.testFile})`).join(', '))
}

// version
try {
  const head = execFileSync('git', ['show', 'HEAD:better_bee.user.js'], { cwd: repoRoot, encoding: 'utf8' })
  if (needsBump(head, source)) problems.push('version: @version not bumped despite script changes')
} catch { /* new file, skip */ }

if (problems.length) {
  console.error('ship-guard blocked this commit:\n  - ' + problems.join('\n  - '))
  process.exit(2)
}
process.exit(0)
```

- [ ] **Step 2: Create the hook registration**

Create `.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          { "type": "command", "command": "node scripts/ship-guard-hook.mjs" }
        ]
      }
    ]
  }
}
```

- [ ] **Step 3: Wire the guards into `npm test`**

Modify `package.json` — replace the `test` script value with (append the two new test files and the live guard):

```json
"test": "node test_hints.mjs && node test_pure_edge_cases.mjs && node test_build_hint_queue.mjs && node test_build_panel_content.mjs && node test_dom_functions.mjs && node test_next_hint.mjs && node scripts/check-drift.test.mjs && node scripts/check-version-bump.test.mjs && node scripts/check-drift.mjs"
```

- [ ] **Step 4: Verify the hook blocks a drifted commit (manual)**

Run this scripted check (creates a throwaway drift, confirms exit 2, then reverts):

```bash
node -e "const {findDrift}=await import('./scripts/check-drift.mjs'); process.stdout.write('loaded\n')"
printf '%s' '{"tool_input":{"command":"git commit -m x"}}' | node scripts/ship-guard-hook.mjs; echo "exit=$?"
```

Expected: `exit=0` when nothing guarded is staged. (Full block path is exercised in Task 9.)

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: all existing suites pass, plus `check-drift.test.mjs` and `check-version-bump.test.mjs` pass, and `check-drift.mjs` reports in-sync (or surfaces pre-existing drift noted in Task 1).

- [ ] **Step 6: Commit**

```bash
git add scripts/ship-guard-hook.mjs .claude/settings.json package.json
git commit -m "feat: register ship-guard PreToolUse hook and wire guards into npm test"
```

---

### Task 4: bee-planner agent

**Files:**
- Create: `.claude/agents/bee-planner.md`

**Interfaces:**
- Produces: a JSON plan object (schema in the spec §5.1) consumed by every later agent. Field names: `task_summary`, `issue_ref`, `target_module`, `mirror_pairs[].fn`, `mirror_pairs[].test_file`, `header_changes.version_bump`, `header_changes.connect_add`, `header_changes.grant_add`, `risk`, `plan_steps`.

- [ ] **Step 1: Create the agent definition**

Create `.claude/agents/bee-planner.md`:

```markdown
---
name: bee-planner
description: Plans a Better Bee change from an issue or prompt. Read-only on code; locates the target module, the source/test mirror pairs, header changes, and a risk level.
tools: Read, Grep, Glob, Bash
---

You plan a single change to the Better Bee userscript. You do NOT edit code.

Input: a GitHub issue reference (a number, `#n`, or an issues URL) OR a free-text task description.

Steps:
1. If the input is an issue reference, run `gh issue view <n> --json title,body,comments` and read it. Otherwise treat the input as the task.
2. Read `better_bee.user.js`. It is one IIFE split into `// Module 1`…`// Module 5` sections (see CLAUDE.md). Identify the single module the change belongs to.
3. List the pure functions you expect to change. For each, find which `test_*.mjs` file copies it (grep the test files for the function name) — these are the mirror pairs that the implementer must keep in sync.
4. Decide header changes: a `@version` bump is required for any user-visible change (default "minor"); list any new hosts needing `@connect` or new GM APIs needing `@grant`.
5. Classify risk as `high` if the change touches any of: `WORD_LIST_SELECTORS`, the shared `MutationObserver`, `gmFetch`/`GM_xmlhttpRequest`/`@connect`, or `unsafeWindow.gameData` reads. Otherwise `low`.

Output ONLY this JSON (no prose):

{
  "task_summary": "<imperative one-liner>",
  "issue_ref": <number or null>,
  "target_module": "<e.g. Module 5: Hint System>",
  "mirror_pairs": [ { "fn": "<name>", "test_file": "<test_x.mjs>" } ],
  "header_changes": { "version_bump": "minor", "connect_add": [], "grant_add": [] },
  "risk": "low" | "high",
  "plan_steps": [ "<concrete step>", "..." ]
}

If you cannot confidently locate the target module, output {"error": "<what is unclear>"} and stop.
```

- [ ] **Step 2: Verify the agent is registered**

Run: `claude agents` (or check the agent appears) — at minimum confirm the file is valid frontmatter:
`node -e "const t=require('fs').readFileSync('.claude/agents/bee-planner.md','utf8'); if(!t.startsWith('---'))throw new Error('bad frontmatter'); console.log('ok')"`
Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add .claude/agents/bee-planner.md
git commit -m "feat: add bee-planner agent"
```

---

### Task 5: bee-implementer agent

**Files:**
- Create: `.claude/agents/bee-implementer.md`

**Interfaces:**
- Consumes: the planner JSON.
- Produces: a JSON object `{ "files_changed": [..], "new_version": "x.y" }`.

- [ ] **Step 1: Create the agent definition**

Create `.claude/agents/bee-implementer.md`:

```markdown
---
name: bee-implementer
description: Applies a planned Better Bee change to better_bee.user.js, mirrors changed pure functions into their test files, and bumps @version.
tools: Read, Edit, Bash
---

You implement the change described by the planner JSON you are given. Do exactly what the plan says — no extra scope.

Steps:
1. Apply the code change to `better_bee.user.js` in the planned module.
2. For EACH `mirror_pairs` entry: copy the updated function body verbatim from `better_bee.user.js` into the named `test_*.mjs` file, replacing the existing copy. The drift-guard will block the commit if any copy differs, so this is mandatory, not optional.
3. Bump the `@version` line (~line 4) by the planned amount (minor = increment the last number, e.g. 1.39 → 1.40).
4. Apply any `header_changes.connect_add` / `grant_add` as new `// @connect`/`// @grant` header lines.

Do NOT run git. Do NOT open a browser. Output ONLY:

{ "files_changed": ["better_bee.user.js", "test_x.mjs"], "new_version": "1.40" }
```

- [ ] **Step 2: Verify frontmatter**

Run: `node -e "const t=require('fs').readFileSync('.claude/agents/bee-implementer.md','utf8'); if(!t.startsWith('---'))throw new Error('bad'); console.log('ok')"`
Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add .claude/agents/bee-implementer.md
git commit -m "feat: add bee-implementer agent"
```

---

### Task 6: bee-verifier agent + GM_* shim snippet

**Files:**
- Create: `.claude/agents/bee-verifier.md`
- Create: `.claude/snippets/gm-shims.js`

**Interfaces:**
- Consumes: planner JSON (for `risk`) + implementer JSON.
- Produces: `{ "pass": bool, "npm_test_output": "...", "screenshots": [..], "notes": "..." }`.

- [ ] **Step 1: Create the GM_* shim snippet**

Create `.claude/snippets/gm-shims.js`:

```js
// Minimal greasemonkey shims so better_bee.user.js can run when injected into a
// normal page during verification. Define BEFORE injecting the userscript IIFE.
// When a new @grant is added to the header, add a matching shim here.
window.unsafeWindow = window;
window.GM_addStyle = (css) => { const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s); return s; };
window.GM_getValue = (k, d) => { const v = localStorage.getItem('GM_' + k); return v === null ? d : JSON.parse(v); };
window.GM_setValue = (k, v) => localStorage.setItem('GM_' + k, JSON.stringify(v));
window.GM_registerMenuCommand = (label) => { (window.__gmMenu = window.__gmMenu || []).push(label); };
window.GM_xmlhttpRequest = (o) => {
  fetch(o.url, { method: o.method || 'GET', headers: o.headers })
    .then(async (r) => o.onload && o.onload({ status: r.status, responseText: await r.text() }))
    .catch((e) => o.onerror && o.onerror(e));
};
```

- [ ] **Step 2: Create the agent definition**

Create `.claude/agents/bee-verifier.md`:

```markdown
---
name: bee-verifier
description: Verifies a Better Bee change — runs npm test, always screenshots sandbox.html, and for high-risk changes injects the script into live NYT (with GM_* shims) and drives a puzzle.
tools: Bash, Read, mcp__claude-in-chrome__tabs_context_mcp, mcp__claude-in-chrome__tabs_create_mcp, mcp__claude-in-chrome__navigate, mcp__claude-in-chrome__computer, mcp__claude-in-chrome__read_page, mcp__claude-in-chrome__javascript_tool
---

You verify the change just implemented. You are given the planner JSON (for `risk`) and the implementer JSON.

Steps:
1. Run `npm test`. If it exits non-zero, STOP and output `{ "pass": false, "npm_test_output": "<tail>", "screenshots": [], "notes": "unit tests failed" }`.
2. ALWAYS: open `sandbox.html` in Chrome (navigate to its file:// path), exercise the affected UI, and capture a screenshot. Record the screenshot path.
3. IF `risk == "high"`: open https://www.nytimes.com/puzzles/spelling-bee in the user's Chrome session. Inject the contents of `.claude/snippets/gm-shims.js` via the javascript_tool FIRST, then inject the contents of `better_bee.user.js`. Drive a minimal interaction (type a valid word; press `?` to trigger a hint). Capture a screenshot. If the shims cannot reproduce the behavior under test, set `pass` based on sandbox + npm test only and say so in `notes` — NEVER claim a live pass you did not observe.

Output ONLY:
{ "pass": true|false, "npm_test_output": "<short tail>", "screenshots": ["<path>", ...], "notes": "<what you observed; sandbox-only if live was skipped>" }
```

- [ ] **Step 3: Verify frontmatter on both files**

Run: `node -e "for (const f of ['.claude/agents/bee-verifier.md']) { const t=require('fs').readFileSync(f,'utf8'); if(!t.startsWith('---'))throw new Error('bad '+f);} console.log('ok')"`
Expected: `ok`

- [ ] **Step 4: Commit**

```bash
git add .claude/agents/bee-verifier.md .claude/snippets/gm-shims.js
git commit -m "feat: add bee-verifier agent and GM_* shims"
```

---

### Task 7: bee-shipper agent

**Files:**
- Create: `.claude/agents/bee-shipper.md`

**Interfaces:**
- Consumes: all prior agent outputs.
- Produces: `{ "pr_url": "..." }` or `{ "error": "..." }`. Never merges.

- [ ] **Step 1: Create the agent definition**

Create `.claude/agents/bee-shipper.md`:

```markdown
---
name: bee-shipper
description: Branches, commits with the vX.Y convention, pushes, and opens a PR for a verified Better Bee change. Never pushes to or merges main.
tools: Bash
---

You ship a verified change as a Pull Request. You NEVER commit to, push to, or merge `main`.

Preconditions: the verifier reported `pass: true`. If not, output `{ "error": "verification did not pass" }` and stop.

Steps:
1. Confirm `gh` is authenticated: `gh auth status`. If it fails, output `{ "error": "gh not authenticated — run: gh auth login" }` and stop.
2. Create a branch: `git checkout -b ship/<kebab-task-summary>-v<new_version>`.
3. Stage the changed files and commit with subject `v<new_version>: <task_summary>` (matches the repo convention). The ship-guard hook will block if drift or a missing version bump slipped through — if blocked, report the hook message and stop.
4. Push: `git push -u origin HEAD`.
5. Open a PR with `gh pr create --base main --title "v<new_version>: <task_summary>" --body "<body>"`. The body includes: the plan, the npm test tail, the risk level, and `Closes #<n>` if an issue drove it. Attach screenshots to the PR conversation with `gh pr comment <url> --body "..."` referencing the screenshot files (do NOT git-add screenshots).
6. Output `{ "pr_url": "<url>" }`.
```

- [ ] **Step 2: Verify frontmatter**

Run: `node -e "const t=require('fs').readFileSync('.claude/agents/bee-shipper.md','utf8'); if(!t.startsWith('---'))throw new Error('bad'); console.log('ok')"`
Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add .claude/agents/bee-shipper.md
git commit -m "feat: add bee-shipper agent"
```

---

### Task 8: `/ship-bee` orchestrator command

**Files:**
- Create: `.claude/commands/ship-bee.md`

**Interfaces:**
- Consumes: `$ARGUMENTS` (issue ref or prompt). Dispatches the four agents in order, forwarding each JSON output to the next.

- [ ] **Step 1: Create the command**

Create `.claude/commands/ship-bee.md`:

```markdown
---
description: Take a Better Bee change from an issue or prompt to an opened PR via the planner→implementer→verifier→shipper agent team.
---

Run the Better Bee ship pipeline for: **$ARGUMENTS**

Orchestrate these subagents in strict order, passing each one's JSON output to the next. Do not edit code or run git yourself — the agents own their steps.

1. Dispatch **bee-planner** with the input `$ARGUMENTS`. If it returns `{"error": ...}`, relay it and STOP.
2. Dispatch **bee-implementer** with the planner JSON.
3. Dispatch **bee-verifier** with the planner JSON (for `risk`) and the implementer JSON.
   - If `pass` is false: dispatch **bee-implementer** again with the verifier's `notes` appended to the plan, then re-run **bee-verifier**. Allow at most 2 implementer attempts total. If still failing, STOP, summarize, and leave the branch for manual inspection (no PR).
4. Once the verifier reports `pass: true`, dispatch **bee-shipper** with all prior outputs.
5. Report the returned `pr_url` to the user. Do not merge.

Guardrails (drift-guard, version-guard) run automatically as a commit hook — if the shipper is blocked, surface the hook message.
```

- [ ] **Step 2: Verify the command file**

Run: `node -e "const t=require('fs').readFileSync('.claude/commands/ship-bee.md','utf8'); if(!t.includes('$ARGUMENTS'))throw new Error('missing args'); console.log('ok')"`
Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add .claude/commands/ship-bee.md
git commit -m "feat: add /ship-bee orchestrator command"
```

---

### Task 9: End-to-end smoke test of the guardrails

Proves the safety core actually blocks. Uses a throwaway edit; reverts it.

**Files:** none created (verification only).

- [ ] **Step 1: Prove drift-guard blocks**

Introduce a deliberate drift, stage it, run the hook, expect block, then revert:

```bash
cp better_bee.user.js /tmp/bb.bak
# pick any function copied into a test file and change ONLY the source copy trivially
node -e "let s=require('fs').readFileSync('better_bee.user.js','utf8'); s=s.replace('function ', 'function /*drift*/ ',1); require('fs').writeFileSync('better_bee.user.js',s)"
git add better_bee.user.js
printf '%s' '{"tool_input":{"command":"git commit -m test"}}' | node scripts/ship-guard-hook.mjs; echo "exit=$?"
git restore --staged better_bee.user.js && cp /tmp/bb.bak better_bee.user.js
```

Expected: hook prints a `ship-guard blocked` message and `exit=2`. After revert, `git status` is clean for that file.

- [ ] **Step 2: Prove version-guard blocks**

```bash
cp better_bee.user.js /tmp/bb.bak
node -e "let s=require('fs').readFileSync('better_bee.user.js','utf8'); s=s.replace('document-idle','document-idle /*x*/'); require('fs').writeFileSync('better_bee.user.js',s)"
git add better_bee.user.js
printf '%s' '{"tool_input":{"command":"git commit -m test"}}' | node scripts/ship-guard-hook.mjs; echo "exit=$?"
git restore --staged better_bee.user.js && cp /tmp/bb.bak better_bee.user.js
```

Expected: hook reports `version: @version not bumped` and `exit=2`. Revert leaves the file clean.

- [ ] **Step 3: Prove a clean unrelated commit is NOT blocked**

```bash
printf '%s' '{"tool_input":{"command":"git commit -m docs"}}' | node scripts/ship-guard-hook.mjs; echo "exit=$?"
```

Expected: `exit=0` (nothing guarded staged).

- [ ] **Step 4: Final suite + summary**

Run: `npm test`
Expected: all green.

Then report to the user: the pipeline is installed, how to invoke it (`/ship-bee "<issue # or prompt>"`), and that the branch is ready to PR.

---

## Notes for the executor

- All work stays on the current feature branch; do not touch `main`.
- The `claude-in-chrome` MCP tools may be deferred — load them via ToolSearch before the verifier uses them (see the agent's tool list).
- If `node scripts/check-drift.mjs` reports pre-existing drift in the repo (Task 1 Step 5), raise it with the user as a separate fix — do not silently "fix" functions to make the guard pass.
</content>
