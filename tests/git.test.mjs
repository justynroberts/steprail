// MIT License - Copyright (c) fintonlabs.com
// infra.git executor against a local bare remote — no network, git is always
// present in CI. Covers the full verb set plus the non-repo-dir guard.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { executeStep } from '../server/executors.mjs'

const ctx = { settings: {} }
const git = cfg => executeStep('infra.git', cfg, ctx)

test('infra.git: clone → commit → log → checkout → tag → merge → push → pull', async () => {
  const remote = mkdtempSync(join(tmpdir(), 'git-remote-'))
  execFileSync('git', ['init', '--bare', '-b', 'main', remote])

  const cloned = await git({ op: 'clone', repo: remote })
  assert.ok(cloned.dir, 'clone returns a working dir')

  writeFileSync(join(cloned.dir, 'README.md'), '# hi\n')
  const status = await git({ op: 'status', dir: cloned.dir })
  assert.match(status.output, /README/)

  const commit = await git({ op: 'commit', dir: cloned.dir, message: 'add readme' })
  assert.equal(commit.exitCode, 0)

  const log = await git({ op: 'log', dir: cloned.dir })
  assert.match(log.output, /add readme/)

  const co = await git({ op: 'checkout', dir: cloned.dir, ref: 'feature/x' })
  assert.equal(co.branch, 'feature/x', 'checkout creates the branch when missing')

  const tag = await git({ op: 'tag', dir: cloned.dir, ref: 'v1.0.0', message: 'first' })
  assert.equal(tag.exitCode, 0)

  await git({ op: 'checkout', dir: cloned.dir, ref: 'main' })
  const merge = await git({ op: 'merge', dir: cloned.dir, ref: 'feature/x' })
  assert.equal(merge.exitCode, 0)

  const push = await git({ op: 'push', dir: cloned.dir, ref: 'main' })
  assert.equal(push.exitCode, 0)

  const pull = await git({ op: 'pull', dir: cloned.dir, ref: 'main' })
  assert.equal(pull.exitCode, 0)
})

test('infra.git: refuses to operate on a non-repo directory', async () => {
  await assert.rejects(() => git({ op: 'status', dir: tmpdir() }), /isn't a git repo/)
})

test('infra.git: commit requires a message', async () => {
  const repo = mkdtempSync(join(tmpdir(), 'git-repo-'))
  execFileSync('git', ['init', '-b', 'main', repo])
  writeFileSync(join(repo, 'f.txt'), 'x')
  await assert.rejects(() => git({ op: 'commit', dir: repo }), /set a Message/)
})
