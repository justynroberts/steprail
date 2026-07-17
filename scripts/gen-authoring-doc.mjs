// MIT License - Copyright (c) fintonlabs.com
// Regenerates docs/LLM-AUTHORING.md from shared/promptcore.mjs so the doc
// always matches the tool catalog. Run after adding or changing tools:
//   node scripts/gen-authoring-doc.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { llmPrompt } from '../shared/promptcore.mjs'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const header = `<!-- GENERATED from shared/promptcore.mjs — regenerate with: node scripts/gen-authoring-doc.mjs -->

# Authoring steprail flows as JSON — LLM prompt

Paste everything below the line into any LLM, replace the brief at the bottom, and import the JSON it returns (Flows → Import, or the {} dialog in the editor).

---

`
fs.writeFileSync(path.join(root, 'docs', 'LLM-AUTHORING.md'), header + llmPrompt('<describe the flow you want here>') + '\n')
console.log('docs/LLM-AUTHORING.md regenerated')
