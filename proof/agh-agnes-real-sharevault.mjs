import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { createClient, memoryJournal } from '../.deps/agnes-harness/packages/sdk/src/index.node.ts'
import { mcpLocalToolPrefix } from '../.deps/agnes-harness/packages/base/src/mcp/naming.ts'
import { assertReviewedMcpDefinition } from './agh-mcp-policy.mjs'
import { currentTurnExport, redactSourceExport } from './redact-agnes-evidence.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const home = join(root, '.deps/agh-real-home')
const tmp = join(root, '.deps/tmp')
const entry = join(root, '.deps/agh-runtime/agnes.mjs')
const profile = 'local-dev'
const serverId = 'sentinel-vault'
const tool = `${mcpLocalToolPrefix(serverId)}sentinel_foundry_share_vault_test`
const evidence = join(root, 'evidence/agh-agnes-real-sharevault.log')
const sessionEvidence = join(root, 'evidence/agh-agnes-real-sharevault-session.jsonl')
const pendingExport = join(tmp, `agh-agnes-real-sharevault-${process.pid}.jsonl`)
const env = {
  PATH: '/usr/bin:/bin',
  HOME: home,
  TMPDIR: tmp,
  AGH_HOME: home,
  AGNES_PROFILE: profile,
  AGNES_MCP_STDIO_ALLOWLIST: process.execPath,
}
const run = async (args) => promisify(execFile)(process.execPath, [entry, ...args], {
  cwd: root, env, timeout: 45_000, maxBuffer: 1024 * 1024,
})
const waitOperation = async (client, receipt) => {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const operation = await client.resources.operation.get({ profile, operationId: receipt.operationId })
    if (operation.state === 'succeeded') return operation
    if (operation.state === 'failed' || operation.state === 'cancelled') {
      throw new Error(`MCP ${operation.state}: ${JSON.stringify(operation.lastSafeError)}`)
    }
    await new Promise((done) => setTimeout(done, 150))
  }
  throw new Error('MCP operation timed out')
}
const changeServer = async (client, action, revision, extra = {}) => waitOperation(client, await client.mcp.servers[action]({
  profile, serverId, expectedRevision: revision,
  clientId: await client.clientId(), commandId: `sentinel-${action}-${randomUUID()}`, ...extra,
}))

let client
let daemonStarted = false
let stopPermissionHandler
let stage = 'startup'
try {
  await mkdir(tmp, { recursive: true })
  await mkdir(join(root, 'evidence'), { recursive: true })
  const homeStats = await (await import('node:fs/promises')).stat(home)
  assert.equal(homeStats.mode & 0o077, 0, 'private AGH home must not be group/world accessible')
  await run(['sessions', '--json'])
  daemonStarted = true
  const owner = JSON.parse(await readFile(join(home, 'data/daemon/owner.json'), 'utf8'))
  const daemonEnvironment = (await readFile(`/proc/${owner.pid}/environ`, 'utf8'))
    .split('\0').find((item) => item.startsWith('AGNES_MCP_STDIO_ALLOWLIST='))
  assert.equal(daemonEnvironment, `AGNES_MCP_STDIO_ALLOWLIST=${process.execPath}`)
  client = createClient({
    transport: { kind: 'unix', path: owner.socketPath },
    auth: { kind: 'local' }, journal: memoryJournal(),
  })
  await client.initialize()
  const config = await client.config.get()
  assert.equal(config.provider?.id, 'agnes-ai')
  assert.equal(config.provider?.credentialConfigured, true)
  assert.equal(config.provider?.model, 'agnes-3.0-flash')

  const session = await client.session.new({ cwd: root, sessionKey: `sentinel:sharevault:${randomUUID()}` })
  let approvedCount = 0
  let rejectedCount = 0
  stopPermissionHandler = session.onPermissionRequest(async (request) => {
    const calledTool = request.toolCall?._meta?.['ai.agnes.harness']?.tool
    const args = request.toolCall?.rawInput
    const allowed = request.sessionId === session.id && calledTool === tool &&
      args && typeof args === 'object' && !Array.isArray(args) && Object.keys(args).length === 0 &&
      approvedCount === 0
    if (allowed) { approvedCount += 1; return { verdict: 'allowed-once' } }
    rejectedCount += 1
    return { verdict: 'rejected' }
  })
  await session.attach()
  const warmup = await session.prompt('SENTINEL 本地授权测试会话已建立。仅回复「就绪」，不要调用任何工具。', {
    signal: AbortSignal.timeout(120_000),
  })
  assert.equal(warmup.reason, 'completed')

  const definition = {
    serverId, displayName: 'SENTINEL fixed ShareVault test',
    transport: { kind: 'stdio', executable: process.execPath, args: [join(root, 'integrations/agh/foundry-mcp/server.mjs')] },
    secretBinding: { kind: 'none' },
    toolPolicy: { allow: ['sentinel_foundry_share_vault_test'] },
  }
  stage = 'mcp setup'
  let mcp = await client.mcp.servers.get({ profile, serverId }).catch(() => undefined)
  if (!mcp) {
    await waitOperation(client, await client.mcp.servers.create({
      profile, definition, clientId: await client.clientId(), commandId: `sentinel-create-${randomUUID()}`,
    }))
    mcp = await client.mcp.servers.get({ profile, serverId })
  }
  assertReviewedMcpDefinition(mcp.definition, definition)
  if (mcp.trust !== 'trusted') await changeServer(client, 'trustSet', mcp.revision, { trust: 'trusted' })
  mcp = await client.mcp.servers.get({ profile, serverId })
  const preflight = await changeServer(client, 'test', mcp.revision)
  assert.equal(preflight.result?.toolCount, 1)
  if (mcp.desired !== 'enabled') await changeServer(client, 'enable', mcp.revision)
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    mcp = await client.mcp.servers.get({ profile, serverId })
    if (mcp.actual === 'ready') break
    await new Promise((done) => setTimeout(done, 150))
  }
  assert.equal(mcp.actual, 'ready')
  assert.equal(mcp.trust, 'trusted')

  const source = await readFile(join(root, 'proof/foundry/src/ShareVault.sol'), 'utf8')
  const prompt = `只分析下面提供的本地授权 Solidity 人工夹具源码，不读写文件、不运行 shell、不生成代码。先写 M1 合约结构、M2 两用户各存入 1 ETH 后依次提现的状态转移与不变量、M3 可检验的漏洞假设。然后必须调用且只调用一次已连接的无参数工具 sentinel_foundry_share_vault_test。收到真实 Foundry 输出后，再写 M4 编译/测试结果、M5 区分复现通过与预期不变量失败，最后写 M6 结论与证据限制。不能把任意测试失败视作漏洞，也不能声称是首次发现；这是人工已知缺陷夹具。\n\n${source}`
  stage = 'real model and Foundry turn'
  const turn = await session.prompt(prompt, { signal: AbortSignal.timeout(180_000) })
  assert.equal(turn.reason, 'completed')
  await run(['export', session.id, '--format', 'agnes', '-o', pendingExport])
  const exported = await readFile(pendingExport, 'utf8')
  assert.doesNotMatch(exported, /sk-[A-Za-z0-9]{20,}/, 'session export contains a possible API key')
  const events = exported.trim().split('\n').map((line) => JSON.parse(line))
  const promptEvent = events.findLast((event) => event.type === 'user/message' &&
    event.data.content?.some((part) => part.type === 'text' && part.text === prompt))
  assert.ok(promptEvent, 'AGH export lacks this run prompt')
  const turnEvents = events.filter((event) => event.seq > promptEvent.seq)
  const sent = turnEvents.filter((event) => event.type === 'request/sent')
  assert.ok(sent.length >= 2 && sent.every((event) => event.data.model.route === 'agnes-ai' && event.data.model.id === 'agnes-3.0-flash'))
  const call = turnEvents.find((event) => event.type === 'tool/call' && event.data.name === tool)
  const result = turnEvents.find((event) => event.type === 'tool/result' && event.data.toolUseId === call?.data.toolUseId)
  assert.ok(call && result, 'real Agnes model did not complete AGH MCP tool call')
  assert.deepEqual(call.data.args, {})
  assert.equal(approvedCount, 1)
  const foundry = JSON.parse(result.data.content.find((part) => part.type === 'text').text)
  assert.equal(foundry.testClassification, 'expected_invariant_violations_observed')
  assert.equal(foundry.code, 1)
  assert.equal(foundry.timedOut, false)
  assert.equal(foundry.sandbox.engine, 'bubblewrap')
  assert.match(foundry.stdout, /Compiler run successful!/)
  assert.match(foundry.stdout, /\[PASS\] testExpectedBug_ReproducesBobHalfPayout\(\)/)
  assert.match(foundry.stdout, /\[FAIL: INV_FULL_REDEMPTION\]/)
  assert.match(foundry.stdout, /\[FAIL: INV_SHARE_SUPPLY_CONSERVATION\]/)
  assert.match(foundry.stdout, /1 passed; 2 failed/)
  const reply = turnEvents.find((event) => event.type === 'assistant/message' && event.origin === 'model' &&
    event.seq > result.seq && event.data.content?.some((part) => part.type === 'text' && part.text.trim()))
  assert.ok(reply, 'model did not interpret the actual Foundry result')
  const response = reply.data.content.filter((part) => part.type === 'text').map((part) => part.text).join('\n')
  await writeFile(pendingExport, redactSourceExport(currentTurnExport(exported, promptEvent.seq), source))
  await rename(pendingExport, sessionEvidence)
  await writeFile(evidence, [
    'SENTINEL real Agnes AGH -> MCP -> Foundry ShareVault experiment',
    'provider_id=agnes-ai', 'model=agnes-3.0-flash', 'route=agnes-ai',
    `session_id=${session.id}`, `turn_reason=${turn.reason}`,
    `mcp=${serverId} trust=${mcp.trust} actual=${mcp.actual} tool_count=${preflight.result.toolCount}`,
    `approved_fixed_tool_once=${approvedCount} rejected_other_requests=${rejectedCount}`,
    `model_request_count=${sent.length} prompt_seq=${promptEvent.seq} tool_call_seq=${call.seq} tool_result_seq=${result.seq} feedback_seq=${reply.seq}`,
    `foundry_exit=${foundry.code} timed_out=${foundry.timedOut} classification=${foundry.testClassification}`,
    `foundry_sandbox=${JSON.stringify(foundry.sandbox)}`,
    `model_feedback=${JSON.stringify(response)}`,
    'public_session_export=current_turn_only_source_redacted_with_sha256; raw_trace=private_AGH_home',
    'model_reasoning=NOT_ACCEPTED_BY_THIS_SCRIPT',
    'key_in_export=false', 'result=PASS_TOOLCHAIN_ONLY', '',
  ].join('\n'))
  console.log('PASS toolchain: real Agnes -> AGH MCP -> Foundry ShareVault; model reasoning requires review')
} catch (error) {
  await rm(pendingExport, { force: true })
  console.error(`FAIL real Agnes ShareVault experiment at ${stage}: ${error.message}`)
  process.exitCode = 1
} finally {
  stopPermissionHandler?.()
  await client?.close()
  if (daemonStarted) {
    try { await run(['daemon', 'stop']) }
    catch (error) { console.error(`AGH daemon stop failed: ${error.message}`); process.exitCode = 1 }
  }
}
