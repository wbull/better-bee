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
