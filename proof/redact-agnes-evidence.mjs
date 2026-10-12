import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

export function currentTurnExport(exported, promptSeq) {
  const events = exported.trim().split('\n').map((line) => JSON.parse(line))
  const start = events.findIndex((event) => event.seq === promptSeq && event.type === 'user/message')
  assert.ok(start >= 0, 'current prompt missing from AGH export')
  const turn = events.slice(start)
  assert.equal(turn.filter((event) => event.type === 'user/message').length, 1, 'AGH export includes a later user turn')
  return turn.map((event) => JSON.stringify(event)).join('\n') + '\n'
}

export function assertPublicExport(exported) {
  assert.ok(!exported.includes('pragma solidity'), 'source remains in public evidence')
  assert.doesNotMatch(exported, /sk-[A-Za-z0-9]{20,}/, 'possible API key remains in public evidence')
  return exported
}

export function redactSourceExport(exported, source, label = 'LOCAL SHAREVAULT SOURCE') {
  const digest = createHash('sha256').update(source).digest('hex')
  const marker = `[REDACTED ${label} sha256:${digest}]`
  const replace = (value) => {
    if (typeof value === 'string') return value.replaceAll(source, marker)
    if (Array.isArray(value)) return value.map(replace)
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replace(item)]))
    return value
  }
  const redacted = exported.trim().split('\n').map((line) => JSON.stringify(replace(JSON.parse(line)))).join('\n') + '\n'
  assert.ok(redacted.includes(marker), 'source was not found in AGH export')
  return assertPublicExport(redacted)
}
