import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient, memoryJournal } from '../.deps/agnes-harness/packages/sdk/src/index.node.ts'
import { startProviderFixture } from '../.deps/agnes-harness/tools/acceptance/provider-fixture.ts'
import { mcpLocalToolPrefix } from '../.deps/agnes-harness/packages/base/src/mcp/naming.ts'

const execFileAsync = promisify(execFile)
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const entry = join(root, '.deps/agh-runtime/agnes.mjs')
const profile = 'local-dev'
const home = await mkdtemp(join(root, '.deps/ah-'))
const tmp = join(root, '.deps/tmp')
const pendingSessionExport = join(tmp, `agh-foundry-t08-simulated-session-${process.pid}.jsonl`)
const node = process.execPath
const mcpScript = join(root, 'integrations/agh/foundry-mcp/server.mjs')
const mcpServerId = 'sentinel-foundry'
const counterToolName = `${mcpLocalToolPrefix(mcpServerId)}sentinel_foundry_counter_test`
const shareVaultToolName = `${mcpLocalToolPrefix(mcpServerId)}sentinel_foundry_share_vault_test`
const acceptanceToolName = `${mcpLocalToolPrefix(mcpServerId)}sentinel_foundry_cases_test`
const allowedToolNames = new Set([counterToolName, shareVaultToolName, acceptanceToolName])
const env = {
  PATH: '/usr/bin:/bin',
  HOME: home,
  TMPDIR: tmp,
  AGH_HOME: home,
  AGNES_PROFILE: profile,
  AGNES_MCP_STDIO_ALLOWLIST: node,
}
const evidence = []
await mkdir(join(root, 'evidence'), { recursive: true })
await rm(pendingSessionExport, { force: true })
const run = async (args) => {
  const { stdout, stderr } = await execFileAsync(process.execPath, [entry, ...args], {
    cwd: root,
    env,
    timeout: 45_000,
    maxBuffer: 1024 * 1024,
  })
  return { stdout, stderr }
}
const waitOperation = async (receipt, client) => {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const operation = await client.resources.operation.get({ profile, operationId: receipt.operationId })
    if (operation.state === 'failed' || operation.state === 'cancelled') {
      const serverId = operation.target.startsWith('mcp/') ? operation.target.slice(4) : undefined
      const status = serverId
        ? await client.mcp.servers.status({ profile, serverId }).catch(() => undefined)
        : undefined
      throw new Error(
        `MCP operation ${operation.state}: ${JSON.stringify({ operation: operation.lastSafeError, status })}`,
      )
    }
    if (operation.state === 'succeeded') return operation
    await new Promise((done) => setTimeout(done, 150))
  }
  throw new Error('MCP operation timed out')
}
const waitMcpReady = async (client) => {
  const deadline = Date.now() + 10_000
  let status
  while (Date.now() < deadline) {
    status = await client.mcp.servers.status({ profile, serverId: mcpServerId })
    if (status.connectionState === 'ready') return status
    await new Promise((done) => setTimeout(done, 150))
  }
  throw new Error(`MCP server did not become ready: ${JSON.stringify(status)}`)
}

let client
let provider
let daemonStarted = false
let daemonStopped = false
let succeeded = false
let stopPermissionHandler
try {
  assert.match((await run(['--version'])).stdout, /agh /)
  const version = (await run(['--version'])).stdout.trim()
  evidence.push(`agh=${version}`)
  await mkdir(join(home, 'profiles', profile), { recursive: true, mode: 0o700 })
  await writeFile(
    join(home, 'profiles', profile, 'profile.yaml'),
    [
      `name: ${profile}`,
      'policy:',
      '  capabilityCeiling: [tools, hooks, slots, events, resources, ui, network, network.publicRead, tools.invoke, artifacts, subagent]',
      'computerUse:',
      '  enabled: false',
      '',
    ].join('\n'),
  )
  const sessions = JSON.parse((await run(['sessions', '--json'])).stdout)
  assert.deepEqual(sessions.items, [])
  daemonStarted = true
  assert.match((await run(['daemon', 'status'])).stdout, /running/)
  const owner = JSON.parse(await readFile(join(home, 'data/daemon/owner.json'), 'utf8'))
  const daemonEnvironment = (await readFile(`/proc/${owner.pid}/environ`, 'utf8'))
    .split('\0')
    .find((item) => item.startsWith('AGNES_MCP_STDIO_ALLOWLIST='))
    ?.slice('AGNES_MCP_STDIO_ALLOWLIST='.length)
  evidence.push(`daemon_mcp_stdio_allowlist=${daemonEnvironment ?? 'missing'}`)
  assert.equal(daemonEnvironment, node)
  client = createClient({
    transport: { kind: 'unix', path: owner.socketPath },
    auth: { kind: 'local' },
    journal: memoryJournal(),
  })
  await client.initialize()

  const catalogue = await client.config.test({ providerId: 'deepseek' })
  const model = catalogue.models[0]?.id
  assert.ok(model, 'official DeepSeek model catalogue must provide a model ID')
  provider = await startProviderFixture('SENTINEL local simulated call completed.', undefined, model)
  await client.config.save({
    providerId: 'deepseek',
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
    model,
    expectedRevision: 0,
  })
  evidence.push('model_mode=official_AGH_local_provider_fixture (simulation; no Agnes/DeepSeek API call)')
  evidence.push(`provider_id=deepseek model=${model} endpoint=127.0.0.1`)

  const session = await client.session.new({ cwd: root })
  stopPermissionHandler = session.onPermissionRequest(async (request) => {
    const metadata = request.toolCall?._meta?.['ai.agnes.harness']
    const args = request.toolCall?.rawInput
    const toolName = metadata?.tool
    const allowed =
      request.sessionId === session.id &&
      allowedToolNames.has(toolName) &&
      args &&
      typeof args === 'object' &&
      !Array.isArray(args) &&
      Object.keys(args).length === 0
    if (!allowed) return { verdict: 'rejected' }
    evidence.push(`tool_approval=allowed-once tool=${toolName} args={}`)
    return { verdict: 'allowed-once' }
  })
  await session.attach()
  const warmup = await session.prompt('Initialize the local SENTINEL smoke-test session.', {
    signal: AbortSignal.timeout(60_000),
  })
  evidence.push(`session_warmup=${warmup.reason}`)

  const definition = {
    serverId: mcpServerId,
    displayName: 'SENTINEL fixed Foundry tests',
    transport: { kind: 'stdio', executable: node, args: [mcpScript] },
    secretBinding: { kind: 'none' },
    toolPolicy: { allow: ['sentinel_foundry_counter_test', 'sentinel_foundry_share_vault_test', 'sentinel_foundry_cases_test'] },
  }
  await waitOperation(await client.mcp.servers.create({
    profile,
    definition,
    clientId: await client.clientId(),
    commandId: `sentinel-mcp-create-${randomUUID()}`,
  }), client)
  let mcp = await client.mcp.servers.get({ profile, serverId: mcpServerId })
  await waitOperation(await client.mcp.servers.trustSet({
    profile,
    serverId: mcpServerId,
    expectedRevision: mcp.revision,
    trust: 'trusted',
    clientId: await client.clientId(),
    commandId: `sentinel-mcp-trust-${randomUUID()}`,
  }), client)
  mcp = await client.mcp.servers.get({ profile, serverId: mcpServerId })
  const mcpTest = await waitOperation(await client.mcp.servers.test({
    profile,
    serverId: mcpServerId,
    expectedRevision: mcp.revision,
    clientId: await client.clientId(),
    commandId: `sentinel-mcp-test-${randomUUID()}`,
  }), client)
  assert.equal(mcpTest.state, 'succeeded')
  assert.equal(mcpTest.result?.toolCount, 3)
  assert.match(mcpTest.result?.catalogRevision ?? '', /^[a-f0-9]{64}$/)
  evidence.push(`mcp_preflight=state:${mcpTest.state} toolCount:${mcpTest.result.toolCount} catalogRevision:${mcpTest.result.catalogRevision}`)
  await waitOperation(await client.mcp.servers.enable({
    profile,
    serverId: mcpServerId,
    expectedRevision: mcp.revision,
    clientId: await client.clientId(),
    commandId: `sentinel-mcp-enable-${randomUUID()}`,
  }), client)
  const mcpStatus = await waitMcpReady(client)
  mcp = await client.mcp.servers.get({ profile, serverId: mcpServerId })
  assert.equal(mcp.trust, 'trusted')
  assert.equal(mcp.desired, 'enabled')
  assert.equal(mcp.actual, 'ready')
  evidence.push(`mcp=${mcpServerId} trust=${mcp.trust} desired=${mcp.desired} actual=${mcp.actual} revision=${mcp.revision}`)
  evidence.push(`mcp_status=${JSON.stringify(mcpStatus)}`)
  evidence.push(`mcp_executable=${node} args=[${mcpScript}] allow_tools=sentinel_foundry_counter_test,sentinel_foundry_share_vault_test,sentinel_foundry_cases_test`)

  provider.queueTool({ name: counterToolName, args: {} })
  const counterTurn = await session.prompt('Use the connected local Foundry test tool to verify the pinned Counter baseline.', {
    signal: AbortSignal.timeout(60_000),
  })

  const counterModelRequest = provider.requests.find((request) => request.tools.includes(counterToolName))
  assert.ok(counterModelRequest, 'local model fixture must see the registered AGH Counter tool')
  const counterToolMessage = provider.requests
    .flatMap((request) => request.messages)
    .find(
      (message) =>
        message.role === 'tool' &&
        typeof message.content === 'string' &&
        message.content.includes('1 passed; 0 failed'),
    )
  assert.ok(counterToolMessage, 'model fixture must receive the actual Counter Foundry result')
  const parseToolResult = (message) => {
    const untrusted = message.content.match(/^<untrusted\b[^>]*>([\s\S]*)<\/untrusted\b[^>]*>$/)
    assert.ok(untrusted, 'AGH must return MCP tool results as untrusted payloads')
    return JSON.parse(untrusted[1])
  }
  const counterResult = parseToolResult(counterToolMessage)
  assert.equal(counterResult.code, 0)
  assert.equal(counterResult.timedOut, false)
  assert.equal(counterResult.sandbox.engine, 'bubblewrap')
  assert.equal(counterResult.sandbox.network, 'isolated network namespace')
  assert.match(counterResult.sandbox.filesystem, /only \/work fixture staging writable/)
  assert.equal(counterResult.sandbox.limits.timeoutSeconds, 30)
  assert.match(counterResult.stdout, /\[PASS\] testIncrement\(\)/)
  assert.match(counterResult.stdout, /1 passed; 0 failed/)

  provider.queueTool({ name: shareVaultToolName, args: {} })
  const shareVaultTurn = await session.prompt('Run the fixed ShareVault test and report whether its invariant assertions match the reviewed result classification.', {
    signal: AbortSignal.timeout(60_000),
  })
  const shareVaultModelRequest = provider.requests.find((request) => request.tools.includes(shareVaultToolName))
  assert.ok(shareVaultModelRequest, 'local model fixture must see the registered ShareVault tool')
  const shareVaultToolMessage = provider.requests
    .flatMap((request) => request.messages)
    .find((message) => message.role === 'tool' && typeof message.content === 'string' && message.content.includes('expected_invariant_violations_observed'))
  assert.ok(shareVaultToolMessage, 'model fixture must receive the classified ShareVault Foundry result')
  const shareVaultResult = parseToolResult(shareVaultToolMessage)
  assert.equal(shareVaultResult.code, 1)
  assert.equal(shareVaultResult.timedOut, false)
  assert.equal(shareVaultResult.testClassification, 'expected_invariant_violations_observed')
  assert.equal(shareVaultResult.sandbox.engine, 'bubblewrap')
  assert.equal(shareVaultResult.sandbox.network, 'isolated network namespace')
  assert.match(shareVaultResult.sandbox.filesystem, /only \/work fixture staging writable/)
  assert.equal(shareVaultResult.sandbox.limits.timeoutSeconds, 30)
  assert.match(shareVaultResult.stdout, /\[PASS\] testExpectedBug_ReproducesBobHalfPayout\(\)/)
  assert.match(shareVaultResult.stdout, /\[FAIL: INV_FULL_REDEMPTION\]/)
  assert.match(shareVaultResult.stdout, /\[FAIL: INV_SHARE_SUPPLY_CONSERVATION\]/)
  assert.match(shareVaultResult.stdout, /1 passed; 2 failed/)

  provider.queueTool({ name: acceptanceToolName, args: {} })
  const acceptanceTurn = await session.prompt('Run the pinned boundary and failure acceptance cases. Confirm the boundary assertion passes and the deliberate fixture test failure is not a vulnerability finding.', {
    signal: AbortSignal.timeout(60_000),
  })
  const acceptanceModelRequest = provider.requests.find((request) => request.tools.includes(acceptanceToolName))
  assert.ok(acceptanceModelRequest, 'local model fixture must see the registered acceptance-cases tool')
  const acceptanceToolMessage = provider.requests
    .flatMap((request) => request.messages)
    .find((message) => message.role === 'tool' && typeof message.content === 'string' && message.content.includes('expected_fixture_test_failure_no_finding'))
  assert.ok(acceptanceToolMessage, 'model fixture must receive the classified boundary/failure Foundry result')
  const acceptanceResult = parseToolResult(acceptanceToolMessage)
  assert.equal(acceptanceResult.code, 1)
  assert.equal(acceptanceResult.timedOut, false)
  assert.equal(acceptanceResult.testClassification, 'expected_fixture_test_failure_no_finding')
  assert.equal(acceptanceResult.sandbox.engine, 'bubblewrap')
  assert.equal(acceptanceResult.sandbox.network, 'isolated network namespace')
  assert.match(acceptanceResult.sandbox.filesystem, /only \/work fixture staging writable/)
  assert.equal(acceptanceResult.sandbox.limits.timeoutSeconds, 30)
  assert.match(acceptanceResult.stdout, /\[PASS\] testBoundaryZeroDepositIsRejectedWithoutStateChange\(\)/)
  assert.match(acceptanceResult.stdout, /\[FAIL: FIXTURE_EXPECTED_TEST_FAILURE\] testFixtureFailureIsNotAVulnerabilityFinding\(\)/)
  assert.match(acceptanceResult.stdout, /1 passed; 1 failed/)

  await run(['export', session.id, '--format', 'agnes', '-o', pendingSessionExport])
  const exported = await readFile(pendingSessionExport, 'utf8')
  assert.ok(exported.includes(counterToolName), 'sanitized AGH session export must include the Counter tool call')
  assert.ok(exported.includes(shareVaultToolName), 'sanitized AGH session export must include the ShareVault tool call')
  assert.ok(exported.includes(acceptanceToolName), 'sanitized AGH session export must include the acceptance-cases tool call')
  assert.ok(exported.includes('1 passed; 0 failed'), 'session export must include the Counter Foundry result')
  assert.ok(exported.includes('expected_invariant_violations_observed'), 'session export must include the ShareVault classification')
  assert.ok(exported.includes('expected_fixture_test_failure_no_finding'), 'session export must include the failure-case classification')
  assert.ok(!exported.includes(provider.apiKey), 'session export must not contain the fixture API key')
  evidence.push(`session_id=${session.id} counter_turn_reason=${counterTurn.reason} share_vault_turn_reason=${shareVaultTurn.reason} acceptance_turn_reason=${acceptanceTurn.reason}`)
  evidence.push(`model_fixture_tool_call=${counterToolName} args={}`)
  evidence.push(`foundry_counter_exit=${counterResult.code} timedOut=${counterResult.timedOut}`)
  evidence.push(`counter_sandbox=${JSON.stringify(counterResult.sandbox)}`)
  evidence.push(`counter_tool_result=${counterToolMessage.content}`)
  evidence.push(`model_fixture_tool_call=${shareVaultToolName} args={}`)
  evidence.push(`foundry_share_vault_exit=${shareVaultResult.code} timedOut=${shareVaultResult.timedOut} classification=${shareVaultResult.testClassification}`)
  evidence.push(`share_vault_sandbox=${JSON.stringify(shareVaultResult.sandbox)}`)
  evidence.push(`share_vault_tool_result=${shareVaultToolMessage.content}`)
  evidence.push(`model_fixture_tool_call=${acceptanceToolName} args={}`)
  evidence.push(`foundry_acceptance_cases_exit=${acceptanceResult.code} timedOut=${acceptanceResult.timedOut} classification=${acceptanceResult.testClassification}`)
  evidence.push(`acceptance_cases_sandbox=${JSON.stringify(acceptanceResult.sandbox)}`)
  evidence.push(`acceptance_cases_tool_result=${acceptanceToolMessage.content}`)
  evidence.push(`agh_session_export=evidence/agh-foundry-t08-simulated-session.jsonl bytes=${Buffer.byteLength(exported)} redacted=true`)
  evidence.push(`provider_fixture_requests=${provider.requests.length} tool_list_in_request=true tool_result_returned=true (simulation only)`)
  succeeded = true
  console.log('PASS AGH local simulation invoked all three fixed Foundry tools; normal, boundary, vulnerability, and non-vulnerability test-failure cases were classified')
} catch (error) {
  evidence.push(`failure=${error.name}: ${error.message}`)
  if (provider?.requests?.length) evidence.push(`provider_request_tools=${JSON.stringify(provider.requests.map((request) => request.tools))}`)
  const toolMessages = provider?.requests.flatMap((request) =>
    request.messages
      .filter((message) => message?.role === 'tool')
      .map((message) => ({ content: message.content })),
  )
  if (toolMessages?.length) evidence.push(`provider_tool_messages=${JSON.stringify(toolMessages).slice(0, 32_000)}`)
  throw error
} finally {
  await client?.close()
  stopPermissionHandler?.()
  if (daemonStarted) {
    try {
      await run(['daemon', 'stop'])
      evidence.push('daemon=stopped')
      daemonStopped = true
    } catch (error) {
      evidence.push(`daemon_stop_error=${error.message}`)
      succeeded = false
    }
  }
  await provider?.close()
  if (!daemonStarted || daemonStopped) await rm(home, { recursive: true, force: true })
  else evidence.push(`diagnostic_agh_home=${home}`)
  if (succeeded) {
    await rename(pendingSessionExport, join(root, 'evidence/agh-foundry-t08-simulated-session.jsonl'))
  } else {
    await rm(pendingSessionExport, { force: true })
  }
  evidence.unshift('SENTINEL AGH -> Foundry minimum experiment')
  evidence.push(`result=${succeeded ? 'PASS' : 'FAIL'}`)
  const path = succeeded
    ? join(root, 'evidence/agh-foundry-t08-simulated.log')
    : join(tmp, `agh-foundry-t08-simulated-failed-${process.pid}.log`)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${evidence.join('\n')}\n`)
  console.log(`Evidence: ${path}`)
}
