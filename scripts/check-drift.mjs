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
    .replace(/\)\s*{/g, ') {')     // ensure space between ) and {
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
