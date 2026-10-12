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
import { assertPublicExport, currentTurnExport, redactSourceExport } from './redact-agnes-evidence.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const home = join(root, '.deps/agh-real-home')
const tmp = join(root, '.deps/tmp')
const entry = join(root, '.deps/agh-runtime/agnes.mjs')
const profile = 'local-dev'
const mode = process.argv[2] ?? 'counter'
assert.ok(['counter', 'cases', 'openzeppelin'].includes(mode), 'only fixed counter/cases/openzeppelin modes are allowed')
const cases = mode === 'cases'
const openzeppelin = mode === 'openzeppelin'
const serverId = openzeppelin ? 'sentinel-oz' : cases ? 'sentinel-cases' : 'sentinel-foundry'
const toolId = openzeppelin ? 'sentinel_foundry_oz_test' : cases ? 'sentinel_foundry_cases_test' : 'sentinel_foundry_counter_test'
const tool = `${mcpLocalToolPrefix(serverId)}${toolId}`
const evidence = join(root, `evidence/agh-agnes-real-${mode}.log`)
const sessionEvidence = join(root, `evidence/agh-agnes-real-${mode}-session.jsonl`)
const pendingExport = join(tmp, `agh-agnes-real-${mode}-${process.pid}.jsonl`)
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

  const session = await client.session.new({ cwd: root, sessionKey: `sentinel:${mode}:${randomUUID()}` })
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
    serverId, displayName: `SENTINEL fixed ${mode} test`,
    transport: { kind: 'stdio', executable: process.execPath, args: [join(root, 'integrations/agh/foundry-mcp/server.mjs')] },
    secretBinding: { kind: 'none' },
    toolPolicy: { allow: [toolId] },
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

  const source = openzeppelin ? [
    'OpenZeppelin Contracts v4.9.4 contracts/utils/Multicall.sol:',
    await readFile(join(root, 'proof/foundry/lib/openzeppelin/v4.9.4/contracts/utils/Multicall.sol'), 'utf8'),
    'OpenZeppelin Contracts v4.9.5 contracts/utils/Multicall.sol:',
    await readFile(join(root, 'proof/foundry/lib/openzeppelin/v4.9.5/contracts/utils/Multicall.sol'), 'utf8'),
    'OpenZeppelin Contracts v4.9.4 contracts/utils/Context.sol:',
    await readFile(join(root, 'proof/foundry/lib/openzeppelin/v4.9.4/contracts/utils/Context.sol'), 'utf8'),
  ].join('\n\n') : ''
  const prompt = openzeppelin
    ? `只分析以下已公开的 OpenZeppelin 官方源码，不读写文件、不运行 shell、不生成或执行代码。先给出 M1 两版 Multicall 的相关状态转移逻辑，M2 假设子调用为将计数器加一，预测一次 multicall 传入一个子调用后两版计数器的值，M3 写出可检验的不变量；在看到测试结果前先明确你的预测。然后只调用一次已连接的无参数工具 sentinel_foundry_oz_test。收到真实 Foundry 输出后写 M4 编译和测试结果、M5 对照预测与执行、M6 结论及限制。不要把已公开历史问题称为新发现；不要仅凭测试失败断言存在新漏洞。\n\n${source}`
    : cases
      ? 'SENTINEL 本地边界与失败测试检查。不要读取文件、运行 shell 或生成代码。只调用一次已连接的无参数工具 sentinel_foundry_cases_test。收到真实 Foundry 输出后，分别说明零值存款边界测试和刻意失败的夹具测试结果，并判断该测试失败是否构成智能合约漏洞证据；说明原因。'
      : 'SENTINEL 工具链连通性检查。不要读取文件、运行 shell 或生成代码。只调用一次已连接的无参数工具 sentinel_foundry_counter_test；收到工具返回后，报告真实 Foundry 测试通过/失败数量及沙箱结果。这是固定的本地 Counter 测试，不要求漏洞分析。'
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
  assert.equal(foundry.code, cases || openzeppelin ? 1 : 0)
  assert.equal(foundry.timedOut, false)
  assert.equal(foundry.sandbox.engine, 'bubblewrap')
  assert.match(foundry.stdout, /Compiler run successful!/)
  if (openzeppelin) {
    assert.equal(foundry.testClassification, 'known_upstream_issue_and_patch_reproduced')
    assert.match(foundry.stdout, /\[PASS\] testHistoricalV494OneSubcallExecutesTwice\(\)/)
    assert.match(foundry.stdout, /\[PASS\] testPatchedV495OneSubcallExecutesOnce\(\)/)
    assert.match(foundry.stdout, /\[FAIL: INV_SINGLE_EXECUTION\] testInvariantV494OneSubcallExecutesOnce\(\)/)
    assert.match(foundry.stdout, /2 passed; 1 failed/)
  } else if (cases) {
    assert.equal(foundry.testClassification, 'expected_fixture_test_failure_no_finding')
    assert.match(foundry.stdout, /\[PASS\] testBoundaryZeroDepositIsRejectedWithoutStateChange\(\)/)
    assert.match(foundry.stdout, /\[FAIL: FIXTURE_EXPECTED_TEST_FAILURE\] testFixtureFailureIsNotAVulnerabilityFinding\(\)/)
    assert.match(foundry.stdout, /1 passed; 1 failed/)
  } else {
    assert.match(foundry.stdout, /\[PASS\] testIncrement\(\)/)
    assert.match(foundry.stdout, /1 passed; 0 failed/)
  }
  const reply = turnEvents.find((event) => event.type === 'assistant/message' && event.origin === 'model' &&
    event.seq > result.seq && event.data.content?.some((part) => part.type === 'text' && part.text.trim()))
  assert.ok(reply, 'model did not interpret the actual Foundry result')
  const response = reply.data.content.filter((part) => part.type === 'text').map((part) => part.text).join('\n')
  if (cases) assert.match(response, /非漏洞|不是漏洞|不构成(?:.{0,20}漏洞|[。.!！])|不能把.{0,40}漏洞|no finding/i, 'model did not clearly reject the fixture failure as a finding')
  const publicExport = currentTurnExport(exported, promptEvent.seq)
  await writeFile(pendingExport, openzeppelin
    ? redactSourceExport(publicExport, source, 'PUBLIC OPENZEPPELIN SOURCE')
    : assertPublicExport(publicExport))
  await rename(pendingExport, sessionEvidence)
  await writeFile(evidence, [
    `SENTINEL real Agnes AGH -> MCP -> Foundry ${mode} experiment`,
    'provider_id=agnes-ai', 'model=agnes-3.0-flash', 'route=agnes-ai',
    `session_id=${session.id}`, `turn_reason=${turn.reason}`,
    `mcp=${serverId} trust=${mcp.trust} actual=${mcp.actual} tool_count=${preflight.result.toolCount}`,
    `approved_fixed_tool_once=${approvedCount} rejected_other_requests=${rejectedCount}`,
    `model_request_count=${sent.length} prompt_seq=${promptEvent.seq} tool_call_seq=${call.seq} tool_result_seq=${result.seq} feedback_seq=${reply.seq}`,
    `foundry_exit=${foundry.code} timed_out=${foundry.timedOut} classification=${cases || openzeppelin ? foundry.testClassification : 'normal_pass'} tests=${openzeppelin ? '2_passed_1_expected_failed' : cases ? '1_passed_1_expected_failed' : '1_passed_0_failed'}`,
    `foundry_sandbox=${JSON.stringify(foundry.sandbox)}`,
    `model_feedback=${JSON.stringify(response)}`,
    'public_session_export=current_turn_only; raw_trace=private_AGH_home',
    'key_in_export=false', 'result=PASS', '',
  ].join('\n'))
  console.log(`PASS real Agnes -> AGH MCP -> Foundry ${mode}`)
} catch (error) {
  await rm(pendingExport, { force: true })
  console.error(`FAIL real Agnes ${mode} experiment at ${stage}: ${error.message}`)
  process.exitCode = 1
} finally {
  stopPermissionHandler?.()
  await client?.close()
  if (daemonStarted) {
    try { await run(['daemon', 'stop']) }
    catch (error) { console.error(`AGH daemon stop failed: ${error.message}`); process.exitCode = 1 }
  }
}
