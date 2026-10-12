import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { createClient, memoryJournal } from '../.deps/agnes-harness/packages/sdk/src/index.node.ts'
import { assertPublicExport, currentTurnExport } from './redact-agnes-evidence.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const home = join(root, '.deps/agh-real-home')
const tmp = join(root, '.deps/tmp')
const entry = join(root, '.deps/agh-runtime/agnes.mjs')
const output = join(root, 'evidence/agh-agnes-real-sharevault-corrected-session.jsonl')
const log = join(root, 'evidence/agh-agnes-real-sharevault-correction.log')
const pending = join(tmp, `agh-agnes-correction-${process.pid}.jsonl`)
const env = { PATH: '/usr/bin:/bin', HOME: home, TMPDIR: tmp, AGH_HOME: home, AGNES_PROFILE: 'local-dev' }
const run = (args) => promisify(execFile)(process.execPath, [entry, ...args], {
  cwd: root, env, timeout: 45_000, maxBuffer: 1024 * 1024,
})
let client
let started = false
let stopPermissionHandler
try {
  await run(['sessions', '--json'])
  started = true
  const owner = JSON.parse(await readFile(join(home, 'data/daemon/owner.json'), 'utf8'))
  client = createClient({ transport: { kind: 'unix', path: owner.socketPath }, auth: { kind: 'local' }, journal: memoryJournal() })
  await client.initialize()
  const sourceLog = await readFile(join(root, 'evidence/agh-agnes-real-sharevault.log'), 'utf8')
  const sourceSessionId = sourceLog.match(/^session_id=(.+)$/m)?.[1]
  assert.ok(sourceSessionId, 'saved ShareVault session ID is missing')
  const session = await client.session.load(sourceSessionId, {
    cwd: root,
    onPermissionRequest: async () => ({ verdict: 'rejected' }),
    onPermissionRequestRegistered: (off) => { stopPermissionHandler = off },
  })
  await session.attach()
  const shareVaultTrace = await readFile(join(root, 'evidence/agh-agnes-real-sharevault-session.jsonl'), 'utf8')
  const before = shareVaultTrace.trim().split('\n').map((line) => JSON.parse(line))
  const sourcePrompt = before.find((event) => event.type === 'user/message')
  const toolCall = before.find((event) => event.type === 'tool/call' && event.data.name.endsWith('sentinel_foundry_share_vault_test'))
  assert.equal(before.filter((event) => event.type === 'user/message').length, 1, 'ShareVault evidence must contain one turn')
  assert.ok(sourcePrompt && toolCall && before.some((event) => event.type === 'tool/result' && event.data.toolUseId === toolCall.data.toolUseId))
  const initial = before.find((event) => event.type === 'assistant/message' && event.seq < toolCall.seq &&
    event.data.content?.some((part) => part.type === 'text' && part.text.includes('A 与 B 各收到 1 ETH')))
  assert.ok(initial, 'saved first analysis does not contain the error this feedback corrects')
  await run(['export', session.id, '--format', 'agnes', '-o', pending])
  const liveBefore = (await readFile(pending, 'utf8')).trim().split('\n').map((line) => JSON.parse(line))
  assert.equal(liveBefore.filter((event) => event.type === 'user/message').at(-1)?.id, sourcePrompt.id,
    'latest AGH turn is not the ShareVault run being corrected')
  assert.ok(liveBefore.some((event) => event.id === toolCall.id), 'saved ShareVault tool call is not in the live AGH session')
  const baselineSeq = liveBefore.at(-1).seq
  const prompt = `请复核你刚才对 ShareVault.sol 的 M2/M3/M5/M6 分析。你在 M2 表和 M3 中写成 Alice 与 Bob 各收到 1 ETH、两人提现后 totalAssets 为 0；但 Foundry 的 Bob 半额支付复现测试通过。源码的 withdraw() 扣减 balanceOf[msg.sender] 和 totalAssets，**没有**扣减 totalShares。请用 Alice/Bob 各存 1 ETH、Alice 先提 1 股、Bob 再提 1 股，逐步列出 totalAssets、totalShares、balanceOf[Alice]、balanceOf[Bob]、assetsOut（单位 ETH）；核对 Bob 实得金额与剩余资产，重新给出不变量、根因、假设与结论。明确说明这是针对人工已知夹具、在明确反馈后修正的模型分析，不能称为独立发现。不要调用任何工具。`
  const turn = await session.prompt(prompt, { signal: AbortSignal.timeout(120_000) })
  assert.equal(turn.reason, 'completed')
  await run(['export', session.id, '--format', 'agnes', '-o', pending])
  const exported = await readFile(pending, 'utf8')
  assert.doesNotMatch(exported, /sk-[A-Za-z0-9]{20,}/)
  const events = exported.trim().split('\n').map((line) => JSON.parse(line))
  const promptEvent = events.findLast((event) => event.type === 'user/message' &&
    event.data.content?.some((part) => part.type === 'text' && part.text === prompt))
  assert.ok(promptEvent && promptEvent.seq > baselineSeq, 'current correction prompt missing from AGH export')
  const added = events.filter((event) => event.seq > baselineSeq)
  assert.ok(added.some((event) => event.type === 'request/sent' && event.data.model.route === 'agnes-ai' && event.data.model.id === 'agnes-3.0-flash'))
  assert.ok(!added.some((event) => event.type === 'tool/call'), 'correction turn unexpectedly called a tool')
  const reply = added.findLast((event) => event.type === 'assistant/message' && event.origin === 'model' &&
    event.data.content?.some((part) => part.type === 'text' && part.text.trim()))
  assert.ok(reply, 'missing model correction')
  const response = reply.data.content.filter((part) => part.type === 'text').map((part) => part.text).join('\n')
  assert.match(response, /totalShares/)
  assert.match(response, /0\.5\s*ETH|0\.5\s*eth|半.*ETH/)
  assert.match(response, /未.*减少|没有.*减少|未.*扣减|未.*更新/)
  await writeFile(pending, assertPublicExport(shareVaultTrace.trim() + '\n' + currentTurnExport(exported, promptEvent.seq)))
  await rename(pending, output)
  await writeFile(log, [
    'SENTINEL Agnes feedback and correction experiment',
    `session_id=${session.id}`, `baseline_seq=${baselineSeq}`, `correction_reply_seq=${reply.seq}`,
    'model=agnes-3.0-flash route=agnes-ai',
    'feedback=prior_model_state_transition_and_payout_were_wrong',
    'correction_turn_tool_calls=0',
    `model_correction=${JSON.stringify(response)}`,
    'public_session_export=sharevault_and_correction_turns_only; raw_trace=private_AGH_home',
    'key_in_export=false', 'result=PASS', '',
  ].join('\n'))
  console.log('PASS real Agnes correction turn completed; inspect reasoning before report acceptance')
} catch (error) {
  await rm(pending, { force: true })
  console.error(`FAIL ShareVault correction: ${error.message}`)
  process.exitCode = 1
} finally {
  stopPermissionHandler?.()
  await client?.close()
  if (started) {
    try { await run(['daemon', 'stop']) }
    catch (error) { console.error(`AGH daemon stop failed: ${error.message}`); process.exitCode = 1 }
  }
}
