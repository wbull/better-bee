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

const source = readFileSync(join(repoRoot, 'better_bee.user.js'), 'utf8')
const testFiles = readdirSync(repoRoot)
  .filter((f) => /^test_.*\.mjs$/.test(f))
  .map((f) => ({ name: f, text: readFileSync(join(repoRoot, f), 'utf8') }))

// drift is ADVISORY only — body-only comparison can legitimately differ for the
// repo's parameterized test adaptations, so it warns but never blocks.
const drift = findDrift(source, testFiles)
if (drift.length) {
  console.error('ship-guard (advisory): function bodies differ from test copies — review if you changed logic:\n  - ' +
    drift.map((d) => `${d.fn}(${d.testFile})`).join(', '))
}

// version is the only BLOCKING gate.
try {
  const head = execFileSync('git', ['show', 'HEAD:better_bee.user.js'], { cwd: repoRoot, encoding: 'utf8' })
  if (needsBump(head, source)) {
    console.error('ship-guard blocked this commit:\n  - version: @version not bumped despite script changes')
    process.exit(2)
  }
} catch { /* new file, skip */ }

process.exit(0)
