import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { createClient, memoryJournal } from '../.deps/agnes-harness/packages/sdk/src/index.node.ts'
import { assertPublicExport, currentTurnExport } from './redact-agnes-evidence.mjs'

const execFileAsync = promisify(execFile)
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const entry = join(root, '.deps/agh-runtime/agnes.mjs')
const home = join(root, '.deps/agh-real-home')
const tmp = join(root, '.deps/tmp')
const evidence = join(root, 'evidence/agh-agnes-real-probe.log')
const sessionEvidence = join(root, 'evidence/agh-agnes-real-probe-session.jsonl')
const pendingExport = join(tmp, `agh-agnes-real-probe-${process.pid}.jsonl`)
const profile = 'local-dev'
const key = readFileSync(0, 'utf8').trim()
assert.ok(key.length > 10, 'Agnes Key is missing from standard input')

const env = {
  PATH: '/usr/bin:/bin',
  HOME: home,
  TMPDIR: tmp,
  AGH_HOME: home,
  AGNES_PROFILE: profile,
}
const run = async (args) => execFileAsync(process.execPath, [entry, ...args], {
  cwd: root,
  env,
  timeout: 45_000,
  maxBuffer: 1024 * 1024,
})
const redact = (value) => String(value).replaceAll(key, '[REDACTED]')

let client
let daemonStarted = false
let stopPermissionHandler
try {
  await mkdir(home, { recursive: true, mode: 0o700 })
  await chmod(home, 0o700)
  await mkdir(tmp, { recursive: true })
  await mkdir(join(root, 'evidence'), { recursive: true })
  await mkdir(join(home, 'profiles', profile), { recursive: true, mode: 0o700 })
  await writeFile(join(home, 'profiles', profile, 'profile.yaml'), [
    `name: ${profile}`,
    'policy:',
    '  capabilityCeiling: [tools, hooks, slots, events, resources, ui, network, network.publicRead, tools.invoke, artifacts, subagent]',
    'computerUse:',
    '  enabled: false',
    '',
  ].join('\n'), { mode: 0o600 })

  const version = (await run(['--version'])).stdout.trim()
  assert.match(version, /^agh /)
  await run(['sessions', '--json'])
  daemonStarted = true
  assert.match((await run(['daemon', 'status'])).stdout, /running/)
  const owner = JSON.parse(await readFile(join(home, 'data/daemon/owner.json'), 'utf8'))
  client = createClient({
    transport: { kind: 'unix', path: owner.socketPath },
    auth: { kind: 'local' },
    journal: memoryJournal(),
  })
  await client.initialize()

  const before = await client.config.get()
  const tested = await client.config.test({ providerId: 'agnes-ai', apiKey: key })
  assert.equal(tested.verified, true, 'Agnes model catalogue was not verified')
  const model = tested.models.find((item) => item.id === 'agnes-3.0-flash') ?? tested.models[0]
  assert.ok(model?.id?.startsWith('agnes-'), 'No reviewed Agnes chat model is available')
  const saved = await client.config.save({
    providerId: 'agnes-ai',
    apiKey: key,
    model: model.id,
    expectedRevision: before.revision,
    makeDefault: true,
  })
  assert.equal(saved.provider?.id, 'agnes-ai')
  assert.equal(saved.provider?.model, model.id)
  assert.equal(saved.provider?.credentialConfigured, true)

  const session = await client.session.new({ cwd: root, sessionKey: `sentinel:probe:${randomUUID()}` })
  stopPermissionHandler = session.onPermissionRequest(async () => ({ verdict: 'rejected' }))
  await session.attach()
  const prompt = 'SENTINEL 连通性检查：请用一句中文说明你已收到这条消息。'
  const turn = await session.prompt(prompt, {
    signal: AbortSignal.timeout(120_000),
  })
  assert.equal(turn.reason, 'completed')
  await run(['export', session.id, '--format', 'agnes', '-o', pendingExport])
  const exported = await readFile(pendingExport, 'utf8')
  assert.ok(!exported.includes(key), 'AGH export contains the Agnes Key')
  const events = exported.trim().split('\n').map((line) => JSON.parse(line))
  const promptEvent = events.findLast((event) => event.type === 'user/message' &&
    event.data.content?.some((part) => part.type === 'text' && part.text === prompt))
  assert.ok(promptEvent, 'AGH export lacks this probe prompt')
  const turnEvents = events.filter((event) => event.seq > promptEvent.seq)
  const sent = turnEvents.find((event) => event.type === 'request/sent' && event.data?.model?.id === model.id)
  const reply = turnEvents.find((event) => event.type === 'assistant/message' && event.origin === 'model' &&
    event.data?.content?.some((part) => part.type === 'text' && part.text.trim()))
  assert.ok(sent, 'AGH export lacks a request to the selected Agnes model')
  assert.ok(reply, 'AGH export lacks a nonempty model response')
  assert.equal(sent.data.model.route, saved.provider.route ?? 'agnes-ai')

  await writeFile(pendingExport, assertPublicExport(currentTurnExport(exported, promptEvent.seq)))
  await rename(pendingExport, sessionEvidence)
  await writeFile(evidence, [
    'SENTINEL real Agnes model connectivity probe',
    `agh=${version}`,
    'provider_id=agnes-ai',
    `model=${model.id}`,
    `route=${sent.data.model.route}`,
    `catalogue_verified=${tested.verified}`,
    `catalogue_model_count=${tested.models.length}`,
    `session_id=${session.id}`,
    `turn_reason=${turn.reason}`,
    `request_sent_seq=${sent.seq}`,
    `assistant_message_seq=${reply.seq}`,
    `session_export=${sessionEvidence}`,
    'key_in_export=false',
    'result=PASS',
    '',
  ].join('\n'))
  console.log(`PASS real Agnes model response via AGH: ${model.id}; evidence=${evidence}`)
} catch (error) {
  await rm(pendingExport, { force: true })
  console.error(`FAIL real Agnes probe: ${redact(error.message)}`)
  process.exitCode = 1
} finally {
  stopPermissionHandler?.()
  await client?.close()
  if (daemonStarted) {
    try {
      await run(['daemon', 'stop'])
    } catch (error) {
      console.error(`AGH daemon stop failed: ${redact(error.message)}`)
      process.exitCode = 1
    }
  }
}
