// PreToolUse hook. Two jobs, both deterministic:
//   1. BACKSTOP: block any command that would push to / merge into `main`. This is
//      the pipeline's strongest invariant — agents must stop at a PR — so it gets a
//      hard gate, not just prose in bee-shipper.md.
//   2. VERSION GATE: block a `git commit` that changes better_bee.user.js without
//      bumping @version. Compares the STAGED index against HEAD so working-tree
//      tricks can't bypass or false-trip it.
// Drift is NOT checked here — it is advisory and already surfaces via `npm test`.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { needsBump } from './check-version-bump.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

function readStdin() { try { return readFileSync(0, 'utf8') } catch { return '' } }
function git(args) { return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }) }
function currentBranch() { try { return git(['rev-parse', '--abbrev-ref', 'HEAD']).trim() } catch { return '' } }

let cmd = ''
try { cmd = JSON.parse(readStdin() || '{}')?.tool_input?.command ?? '' } catch { cmd = '' }
if (!cmd) process.exit(0)

// 1) BACKSTOP — anything that targets `main`.
const onMain = currentBranch() === 'main'
const targetsMain =
  /\bgh\s+pr\s+merge\b/.test(cmd) ||
  /\bgit\s+push\b[^\n]*\borigin\s+main\b/.test(cmd) ||
  /\bgit\s+push\b[^\n]*:\s*main\b/.test(cmd) ||
  /\bgit\s+push\b[^\n]*refs\/heads\/main\b/.test(cmd) || // explicit refspec form
  (/\bgit\s+push\b/.test(cmd) && onMain) ||
  (/\bgit\s+merge\b/.test(cmd) && onMain)
if (targetsMain) {
  console.error('ship-guard blocked: this command would modify `main`. The pipeline must stop at a PR — push a feature branch and open a PR instead.')
  process.exit(2)
}

// 2) VERSION GATE — only on commits that stage the userscript.
if (/\bgit\s+commit\b/.test(cmd)) {
  let staged = []
  try { staged = git(['diff', '--cached', '--name-only']).split('\n').filter(Boolean) } catch { process.exit(0) }
  if (!staged.includes('better_bee.user.js')) process.exit(0)
  let head, index
  try { head = git(['show', 'HEAD:better_bee.user.js']) } catch { process.exit(0) } // new file
  try { index = git(['show', ':better_bee.user.js']) } catch { process.exit(0) }
  // Wrap the sole hard gate so an unexpected throw fails closed-to-allow (exit 0),
  // never an undefined exit-1 the hook contract doesn't define.
  try {
    if (needsBump(head, index)) {
      console.error('ship-guard blocked this commit:\n  - version: @version not bumped despite changes to better_bee.user.js')
      process.exit(2)
    }
  } catch { process.exit(0) }
}
process.exit(0)
