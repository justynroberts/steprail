// MIT License - Copyright (c) fintonlabs.com
// E2E test server: wipes the throwaway data dir, then boots the real app so the
// browser suite runs against a fresh store every time. Launched by Playwright's
// webServer (env comes from playwright.config.ts). Never point this at real data.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const dir = process.env.STEPRAIL_DATA_DIR || path.join(here, '.data')
fs.rmSync(dir, { recursive: true, force: true })

// The real server reads STEPRAIL_DATA_DIR/PORT from the environment on import.
await import('../server/index.mjs')
