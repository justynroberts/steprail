// MIT License - Copyright (c) fintonlabs.com
// Single source of truth for the app version — read from package.json so the
// health endpoint, MCP handshakes, and OTel scope never drift from the release.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const pkgPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json')
export const VERSION = JSON.parse(readFileSync(pkgPath, 'utf8')).version
