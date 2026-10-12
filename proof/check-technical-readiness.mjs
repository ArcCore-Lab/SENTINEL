import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, readdir, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (path) => readFile(join(root, path), 'utf8')
const json = async (path) => JSON.parse(await read(path))
const events = async (path) => (await read(path)).trim().split('\n').map((line) => JSON.parse(line))
const textOf = (event) => event?.data?.content?.filter((part) => part.type === 'text').map((part) => part.text).join('\n') ?? ''
const summary = []

async function checkRun(name, toolSuffix, expectedCode, expectedClass, markers) {
  const tracePath = `evidence/agh-agnes-real-${name}-session.jsonl`
  const trace = await events(tracePath)
  assert.equal(trace.filter((event) => event.type === 'user/message').length, 1, `${name}: public trace includes another user turn`)
  const call = trace.findLast((event) => event.type === 'tool/call' && event.data.name.endsWith(toolSuffix))
  assert.ok(call, `${name}: missing AGH model tool call`)
  const prompt = trace.filter((event) => event.type === 'user/message' && event.seq < call.seq).at(-1)
  assert.ok(prompt, `${name}: missing prompt`)
  const toolCalls = trace.filter((event) => event.type === 'tool/call' && event.seq > prompt.seq && event.seq <= call.seq)
  assert.equal(toolCalls.length, 1, `${name}: unexpected tool request in the accepted turn`)
  assert.deepEqual(call.data.args, {}, `${name}: tool arguments were not empty`)
  const asked = trace.find((event) => event.type === 'approval/asked' && event.data.toolUseId === call.data.toolUseId)
  const decided = trace.find((event) => event.type === 'approval/decided' && event.data.requestId === asked?.data.requestId)
  assert.equal(decided?.data.verdict, 'allowed-once', `${name}: fixed tool was not approved once`)
  const result = trace.find((event) => event.type === 'tool/result' && event.data.toolUseId === call.data.toolUseId)
  assert.ok(result, `${name}: missing AGH tool result`)
  const foundry = JSON.parse(textOf(result))
  assert.equal(foundry.code, expectedCode, `${name}: wrong Foundry exit`)
  assert.equal(foundry.timedOut, false, `${name}: Foundry timed out`)
  assert.equal(foundry.sandbox?.engine, 'bubblewrap', `${name}: sandbox missing`)
  assert.equal(foundry.sandbox?.limits?.timeoutSeconds, 30, `${name}: timeout limit changed`)
  assert.match(foundry.sandbox?.network ?? '', /isolated network namespace/)
  assert.match(foundry.stdout, /Compiler run successful!/)
  if (expectedClass) assert.equal(foundry.testClassification, expectedClass, `${name}: wrong test classification`)
  for (const marker of markers) assert.ok(foundry.stdout.includes(marker), `${name}: missing ${marker}`)
  const reply = trace.find((event) => event.type === 'assistant/message' && event.origin === 'model' && event.seq > result.seq && textOf(event).trim())
  assert.ok(reply, `${name}: model did not process tool feedback`)
  const nextPrompt = trace.find((event) => event.type === 'user/message' && event.seq > prompt.seq)
  assert.ok(!nextPrompt || reply.seq < nextPrompt.seq, `${name}: feedback belongs to a later turn`)
  const requests = trace.filter((event) => event.type === 'request/sent' && event.seq > prompt.seq && event.seq < reply.seq)
  assert.ok(requests.length >= 2 && requests.every((event) => event.data.model.route === 'agnes-ai' && event.data.model.id === 'agnes-3.0-flash'), `${name}: non-Agnes model request`)
  const http = trace.filter((event) => event.type === 'cost/ledger' && event.seq > prompt.seq &&
    event.seq < (nextPrompt?.seq ?? Infinity) && event.data.purpose === 'inference')
  assert.ok(http.length >= 2 && http.every((event) => event.data.response?.status === 200), `${name}: model HTTP status not 200`)
  if (name === 'cases') assert.match(textOf(reply), /不能把.{0,40}漏洞|非漏洞|无发现|不构成(?:.{0,20}漏洞|[。.!！])|no finding/i)
  summary.push(`${name}=PASS prompt_seq=${prompt.seq} tool_call_seq=${call.seq} result_seq=${result.seq} feedback_seq=${reply.seq} foundry_exit=${foundry.code} classification=${foundry.testClassification ?? 'normal_pass'}`)
  return { trace, foundry, prompt, call, result, reply }
}

await checkRun('counter', 'sentinel_foundry_counter_test', 0, null, [
  '[PASS] testIncrement()', '1 passed; 0 failed',
])
const vault = await checkRun('sharevault', 'sentinel_foundry_share_vault_test', 1, 'expected_invariant_violations_observed', [
  '[PASS] testExpectedBug_ReproducesBobHalfPayout()', '[FAIL: INV_FULL_REDEMPTION]',
  '[FAIL: INV_SHARE_SUPPLY_CONSERVATION]', '1 passed; 2 failed',
])
await checkRun('cases', 'sentinel_foundry_cases_test', 1, 'expected_fixture_test_failure_no_finding', [
  '[PASS] testBoundaryZeroDepositIsRejectedWithoutStateChange()',
  '[FAIL: FIXTURE_EXPECTED_TEST_FAILURE] testFixtureFailureIsNotAVulnerabilityFinding()', '1 passed; 1 failed',
])
const oz = await checkRun('openzeppelin', 'sentinel_foundry_oz_test', 1, 'known_upstream_issue_and_patch_reproduced', [
  '[PASS] testHistoricalV494OneSubcallExecutesTwice()',
  '[PASS] testPatchedV495OneSubcallExecutesOnce()',
  '[FAIL: INV_SINGLE_EXECUTION] testInvariantV494OneSubcallExecutesOnce()',
  '2 passed; 1 failed',
])
const ozPrediction = oz.trace.find((event) => event.type === 'assistant/message' && event.origin === 'model' && event.seq > oz.prompt.seq && event.seq < oz.call.seq && textOf(event).trim())
assert.ok(ozPrediction, 'openzeppelin: missing pre-tool model prediction')
assert.match(textOf(ozPrediction), /v4\.9\.4[^\n]*2|v4\.9\.4[\s\S]{0,150}最终 2/)
assert.match(textOf(ozPrediction), /v4\.9\.5[^\n]*1|v4\.9\.5[\s\S]{0,150}最终 1/)
assert.match(textOf(oz.reply), /预测错误/)
const ozSource = await read('proof/foundry/lib/openzeppelin/v4.9.4/contracts/utils/Multicall.sol')
const ozPublicTrace = await read('evidence/agh-agnes-real-openzeppelin-session.jsonl')
assert.ok(ozPublicTrace.includes(`REDACTED PUBLIC OPENZEPPELIN SOURCE sha256:`), 'openzeppelin: public source marker missing')
assert.ok(!ozPublicTrace.includes('pragma solidity'), 'openzeppelin: source not redacted from public trace')
assert.ok(ozSource.includes('Address.functionDelegateCall'), 'openzeppelin: source unavailable')
summary.push('openzeppelin=PASS pre_tool_prediction_and_feedback_error_preserved')

const report = await json('reports/execution_trace.json')
const analysis = await json('reports/analysis.json')
const hypotheses = await json('reports/hypotheses.json')
const verification = await json('reports/verification.json')
const shareVaultSession = (await read('evidence/agh-agnes-real-sharevault.log')).match(/^session_id=(.+)$/m)?.[1]
const correctionSession = (await read('evidence/agh-agnes-real-sharevault-correction.log')).match(/^session_id=(.+)$/m)?.[1]
assert.ok(shareVaultSession?.startsWith('sentinel:sharevault:'), 'report: ShareVault session is not isolated')
assert.equal(report.session_id, shareVaultSession, 'report: ShareVault session ID is stale')
assert.equal(correctionSession, shareVaultSession, 'report: correction belongs to another AGH session')
const corrected = await events(report.evidence.redacted_agh_session)
assert.equal(corrected.filter((event) => event.type === 'user/message').length, 2, 'report: public correction trace includes unrelated turns')
assert.equal(report.events.source_prompt, vault.prompt.seq, 'report: source prompt is stale')
assert.equal(report.events.fixed_tool_call, vault.call.seq, 'report: tool call is stale')
assert.equal(report.events.foundry_result, vault.result.seq, 'report: tool result is stale')
assert.equal(report.events.initial_feedback, vault.reply.seq, 'report: model feedback is stale')
for (const event of [vault.prompt, vault.call, vault.result, vault.reply]) {
  assert.equal(corrected.find((item) => item.seq === event.seq)?.id, event.id, 'report: ShareVault events came from another run')
}
for (const [label, type] of Object.entries({
  source_prompt: 'user/message', initial_analysis_wrong: 'assistant/message', fixed_tool_call: 'tool/call',
  tool_approval_once: 'approval/decided', foundry_result: 'tool/result', initial_feedback: 'assistant/message',
  explicit_correction_prompt: 'user/message', corrected_analysis: 'assistant/message',
})) {
  assert.equal(corrected.find((event) => event.seq === report.events[label])?.type, type, `report: wrong ${label} reference`)
}
const correction = corrected.find((event) => event.seq === report.events.corrected_analysis)
const firstAnalysis = corrected.find((event) => event.seq === report.events.initial_analysis_wrong)
const correctionPrompt = corrected.find((event) => event.seq === report.events.explicit_correction_prompt)
assert.ok(correctionPrompt.seq > vault.reply.seq && correction.seq > correctionPrompt.seq,
  'report: correction did not follow the accepted ShareVault run')
assert.equal(corrected.filter((event) => event.type === 'user/message').at(-1)?.id, correctionPrompt.id)
const correctionTurn = corrected.filter((event) => event.seq > correctionPrompt.seq)
const correctionRequests = correctionTurn.filter((event) => event.type === 'request/sent')
assert.ok(correctionRequests.length >= 1 && correctionRequests.every((event) =>
  event.data.model.route === 'agnes-ai' && event.data.model.id === 'agnes-3.0-flash'),
  'report: correction used a non-Agnes model')
assert.ok(correctionTurn.some((event) => event.type === 'cost/ledger' && event.data.purpose === 'inference' &&
  event.data.response?.status === 200), 'report: correction HTTP result is missing')
assert.ok(!correctionTurn.some((event) => event.type === 'tool/call'), 'report: correction called a tool')
assert.match(textOf(firstAnalysis), /A 与 B 各收到 1 ETH/)
assert.match(textOf(correction), /totalShares/)
assert.match(textOf(correction), /0\.5\s*ETH/)
assert.match(textOf(correction), /totalShares.{0,100}从不被扣减/)
assert.equal(analysis.provenance.corrected_model_analysis_seq, correction.seq)
assert.equal(analysis.m2.sequence.at(-1).totalShares, '2')
assert.equal(analysis.m2.sequence.at(-1).totalAssets, '0.5')
assert.equal(analysis.m2.sequence.at(-1).assetsOut, '0.5')
assert.equal(hypotheses.hypotheses[0].id, 'HYP-SV-001')
assert.equal(verification.m4.classification, vault.foundry.testClassification)
assert.equal(verification.m4.exit_code, vault.foundry.code)
assert.equal(verification.m4.tests.filter((test) => test.result === 'FAIL').length, 2)
summary.push('reports=PASS model_first_error_and_feedback_correction_preserved')

const source = await read('proof/foundry/src/ShareVault.sol')
const marker = `REDACTED LOCAL SHAREVAULT SOURCE sha256:${createHash('sha256').update(source).digest('hex')}`
for (const [name, path] of [
  ['sharevault', 'evidence/agh-agnes-real-sharevault-session.jsonl'],
  ['correction', report.evidence.redacted_agh_session],
]) {
  const content = await read(path)
  assert.ok(content.includes(marker), `${name}: source hash marker missing`)
  assert.ok(!content.includes('pragma solidity'), `${name}: unredacted source in public trace`)
}
const probe = await events('evidence/agh-agnes-real-probe-session.jsonl')
assert.equal(probe.filter((event) => event.type === 'user/message').length, 1, 'probe: public trace includes another user turn')
assert.ok(!JSON.stringify(probe).includes('pragma solidity'))
const counterTrace = await read('evidence/agh-agnes-real-counter-session.jsonl')
assert.ok(!counterTrace.includes('pragma solidity'))
const casesTrace = await read('evidence/agh-agnes-real-cases-session.jsonl')
assert.ok(!casesTrace.includes('pragma solidity'))
const home = await stat(join(root, '.deps/agh-real-home')).catch((error) => {
  if (error.code === 'ENOENT') return null
  throw error
})
if (home) assert.equal(home.mode & 0o077, 0, 'AGH private home is accessible to group or world')
summary.push(`private_agh_home=${home ? 'present_mode_0700' : 'not_included'}`)

async function scan(path) {
  for (const item of await readdir(join(root, path), { withFileTypes: true })) {
    const relative = join(path, item.name)
    if (item.isDirectory()) await scan(relative)
    else if (item.isFile()) assert.doesNotMatch(await read(relative), /sk-[A-Za-z0-9]{20,}/, `possible Key in ${relative}`)
  }
}
for (const dir of ['docs', 'evidence', 'integrations', 'proof', 'reports']) await scan(dir)
for (const file of ['README.md', 'pdplan.md', '.gitignore']) assert.doesNotMatch(await read(file), /sk-[A-Za-z0-9]{20,}/)
summary.push('public_redaction_and_key_scan=PASS')

const output = join(root, 'evidence/technical-readiness.log')
const pending = `${output}.${process.pid}.tmp`
await writeFile(pending, `SENTINEL technical readiness check\nchecked_at_utc=${new Date().toISOString()}\n${summary.join('\n')}\nresult=PASS\n`)
await rename(pending, output)
console.log(`PASS ${output}`)
