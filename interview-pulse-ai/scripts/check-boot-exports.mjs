/**
 * Boot/import CI — fail if critical named exports go missing (blank white screen).
 * Run: node scripts/check-boot-exports.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')

const checks = [
  {
    file: 'src/services/parser.ts',
    exports: [
      'rankMemories',
      'vectorizeToMemories',
      'looksLikeBinaryGarbage',
      'sanitizeResumeText',
      'parseUploadedFile',
      'nameFromResumeFilename',
    ],
  },
  {
    file: 'src/services/jobsearch.ts',
    exports: [
      'runJobSearch',
      'oneClickAutoApply',
      'browserApplyOne',
      'loadStoredFormPack',
      'FORM_PACK_STORAGE_KEY',
    ],
  },
  {
    file: 'src/main.tsx',
    contains: ['createRoot', 'App'],
  },
  {
    file: 'src/App.tsx',
    contains: ['JobSearchPage', 'HashRouter'],
  },
]

let failed = 0
for (const c of checks) {
  const full = path.join(root, c.file)
  if (!fs.existsSync(full)) {
    console.error(`FAIL missing file: ${c.file}`)
    failed++
    continue
  }
  const src = fs.readFileSync(full, 'utf8')
  if (c.exports) {
    for (const name of c.exports) {
      const re = new RegExp(
        `export\\s+(async\\s+)?function\\s+${name}\\b|export\\s+(const|type|function)\\s+${name}\\b|export\\s*\\{[^}]*\\b${name}\\b`,
      )
      if (!re.test(src)) {
        console.error(`FAIL ${c.file}: missing export ${name}`)
        failed++
      } else {
        console.log(`ok  ${c.file} :: ${name}`)
      }
    }
  }
  if (c.contains) {
    for (const s of c.contains) {
      if (!src.includes(s)) {
        console.error(`FAIL ${c.file}: missing ${s}`)
        failed++
      } else {
        console.log(`ok  ${c.file} contains ${s}`)
      }
    }
  }
}

// Consumers that import rankMemories must not break boot
const consumers = ['src/pages/KnowledgePage.tsx', 'src/services/pipeline.ts']
for (const f of consumers) {
  const full = path.join(root, f)
  const src = fs.readFileSync(full, 'utf8')
  if (src.includes('rankMemories')) {
    const parser = fs.readFileSync(path.join(root, 'src/services/parser.ts'), 'utf8')
    if (!/export\s+function\s+rankMemories\b/.test(parser)) {
      console.error(`FAIL ${f} imports rankMemories but parser does not export it`)
      failed++
    } else {
      console.log(`ok  ${f} → rankMemories`)
    }
  }
}

if (failed) {
  console.error(`\nBoot check failed: ${failed} issue(s)`)
  process.exit(1)
}
console.log('\nBoot check passed')
