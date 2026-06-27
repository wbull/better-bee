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

// Return the text between the outermost { and its matching } (exclusive).
export function extractBody(decl) {
  const openIdx = decl.indexOf('{')
  if (openIdx === -1) return ''
  let depth = 0
  let i = openIdx
  for (; i < decl.length; i++) {
    const c = decl[i]
    if (c === '{') depth++
    else if (c === '}') { depth--; if (depth === 0) break }
  }
  return decl.slice(openIdx + 1, i)
}

export function normalize(code) {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '') // drop block comments (e.g. JSDoc)
    .replace(/\/\/[^\n]*/g, '')        // drop line comments
    .replace(/\s+/g, ' ')              // collapse whitespace
    .replace(/\)\s*{/g, ') {')         // ensure space between ) and {
    .trim()
}

export function findDrift(sourceText, testFiles) {
  const src = extractFunctions(sourceText)
  const out = []
  for (const { name, text } of testFiles) {
    const fns = extractFunctions(text)
    for (const [fn, decl] of fns) {
      if (!src.has(fn)) continue // only compare functions that exist in both
      // Compare normalized bodies only — signature differences (param names/count)
      // are expected in parameterized test adaptations and must not count as drift.
      if (normalize(extractBody(decl)) !== normalize(extractBody(src.get(fn)))) {
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
    // Advisory only — the version-guard is the hard gate; this never blocks.
    process.stderr.write(`\x1b[33mdrift-guard (advisory): ${drift.length} function BODIES differ — review if you changed logic:\x1b[0m\n`)
    for (const d of drift) process.stderr.write(`  - ${d.fn}  (in ${d.testFile})\n`)
  } else {
    console.log('drift-guard: function bodies in sync')
  }
  process.exit(0)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
