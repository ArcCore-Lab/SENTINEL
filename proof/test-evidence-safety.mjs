import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { assertReviewedMcpDefinition } from './agh-mcp-policy.mjs'
import { assertPublicExport, currentTurnExport, redactSourceExport } from './redact-agnes-evidence.mjs'

const root = resolve(import.meta.dirname, '..')

test('MCP policy accepts a label change but rejects changed execution fields', () => {
  const expected = { serverId: 'sentinel-vault', displayName: 'reviewed',
    transport: { kind: 'stdio', executable: '/usr/bin/node', args: ['/work/server.mjs'] },
    secretBinding: { kind: 'none' }, toolPolicy: { allow: ['sentinel_foundry_share_vault_test'] } }
  assert.doesNotThrow(() => assertReviewedMcpDefinition({ ...expected, displayName: 'old label' }, expected))
  assert.throws(() => assertReviewedMcpDefinition({ ...expected, transport: { ...expected.transport,
    args: ['/work/other.mjs'] } }, expected), /transport differs/)
  assert.throws(() => assertReviewedMcpDefinition({ ...expected, toolPolicy: { allow: ['shell'] } }, expected),
    /tool policy differs/)
})

test('public export keeps one turn and rejects a later prompt', () => {
  const event = (seq, type, content = '') => JSON.stringify({ seq, type, data: { content: [{ type: 'text', text: content }] } })
  const exportText = [event(1, 'user/message', 'old private text'), event(2, 'assistant/message'),
    event(3, 'user/message', 'current'), event(4, 'assistant/message')].join('\n') + '\n'
  const current = currentTurnExport(exportText, 3)
  assert.equal(current.includes('old private text'), false)
  assert.equal(current.trim().split('\n').length, 2)
  assert.throws(() => currentTurnExport(exportText, 1), /later user turn/)
  assert.throws(() => assertPublicExport(event(1, 'user/message', 'pragma solidity')), /source remains/)
  const source = 'pragma solidity ^0.8.20;'
  assert.match(redactSourceExport(event(1, 'user/message', source), source), /REDACTED LOCAL SHAREVAULT SOURCE/)
  assert.match(redactSourceExport(event(1, 'user/message', source), source, 'PUBLIC OPENZEPPELIN SOURCE'),
    /REDACTED PUBLIC OPENZEPPELIN SOURCE/)
})

test('readiness rejects stale session, sequence, route, and event identity', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'sentinel-readiness-test-'))
  try {
    for (const dir of ['docs', 'integrations', 'proof/foundry/src',
      'proof/foundry/lib/openzeppelin/v4.9.4/contracts/utils', 'reports', 'evidence']) {
      await mkdir(join(temp, dir), { recursive: true })
    }
    const files = ['README.md', 'pdplan.md', '.gitignore', 'proof/check-technical-readiness.mjs',
      'proof/foundry/src/ShareVault.sol',
      'proof/foundry/lib/openzeppelin/v4.9.4/contracts/utils/Multicall.sol',
      'reports/execution_trace.json', 'reports/analysis.json',
      'reports/hypotheses.json', 'reports/verification.json',
      'evidence/agh-agnes-real-sharevault.log', 'evidence/agh-agnes-real-sharevault-correction.log',
      ...['counter', 'sharevault', 'cases', 'openzeppelin', 'sharevault-corrected', 'probe'].map((name) =>
        `evidence/agh-agnes-real-${name}-session.jsonl`)]
    for (const file of files) await copyFile(join(root, file), join(temp, file))
    const check = () => spawnSync(process.execPath, [join(temp, 'proof/check-technical-readiness.mjs')],
      { cwd: temp, encoding: 'utf8', timeout: 10_000 })
    assert.equal(check().status, 0, 'current saved evidence should pass')

    const reportPath = join(temp, 'reports/execution_trace.json')
    const report = JSON.parse(await readFile(reportPath, 'utf8'))
    const fixedToolCall = report.events.fixed_tool_call
    const sessionId = report.session_id
    report.session_id = 'another-session'
    await writeFile(reportPath, JSON.stringify(report))
    assert.match(check().stderr, /session ID is stale/)

    report.session_id = sessionId
    report.events.fixed_tool_call = -1
    await writeFile(reportPath, JSON.stringify(report))
    assert.match(check().stderr, /tool call is stale/)

    report.events.fixed_tool_call = fixedToolCall
    await writeFile(reportPath, JSON.stringify(report))
    const correctedPath = join(temp, report.evidence.redacted_agh_session)
    const corrected = (await readFile(correctedPath, 'utf8')).trim().split('\n').map(JSON.parse)
    const correctionRequest = corrected.find((event) => event.type === 'request/sent' &&
      event.seq > report.events.explicit_correction_prompt)
    correctionRequest.data.model.route = 'other-provider'
    await writeFile(correctedPath, corrected.map((event) => JSON.stringify(event)).join('\n') + '\n')
    assert.match(check().stderr, /non-Agnes model/)

    correctionRequest.data.model.route = 'agnes-ai'
    corrected.find((event) => event.seq === report.events.fixed_tool_call).id = 'different-run'
    await writeFile(correctedPath, corrected.map((event) => JSON.stringify(event)).join('\n') + '\n')
    assert.match(check().stderr, /another run/)
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
})
