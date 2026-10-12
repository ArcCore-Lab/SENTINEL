import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { access, chmod, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const aghRoot = join(root, '.deps/agnes-harness')
const aghRequire = createRequire(join(aghRoot, 'packages/base/package.json'))
const { Server } = aghRequire('@modelcontextprotocol/sdk/server/index.js')
const { StdioServerTransport } = aghRequire('@modelcontextprotocol/sdk/server/stdio.js')
const { ListToolsRequestSchema, CallToolRequestSchema } = aghRequire('@modelcontextprotocol/sdk/types.js')
const execFileAsync = promisify(execFile)
const forge = join(root, '.deps/tools/foundry/forge')
const solcjs = join(root, '.deps/tools/solcjs/node_modules/.bin/solcjs')
const nodeInstall = resolve(dirname(process.execPath), '..')
const sandboxPolicy = {
  engine: 'bubblewrap',
  filesystem: 'host root read-only; only /work fixture staging writable',
  network: 'isolated network namespace',
  process: 'isolated pid namespace',
  limits: { timeoutSeconds: 30, addressSpaceBytes: 4294967296, cpuSeconds: 20, processes: 64 },
}
const counterFixturePins = {
  'proof/run-foundry.sh': 'a88414b52cba0b41ed50d95b38a2239a71c649195816a9ce3870b3746e738f4a',
  'proof/solcjs-compat.sh': 'f11e6aad1fb3fd92a8aad3d91d768f8e8915b154349b3ff9efd6b5ee16e2f5e1',
  'proof/foundry/foundry.toml': 'e5488c6494382abb5f0968fbeb89340435ff43a99dc553c89302b848743ce157',
  'proof/foundry/test/Counter.t.sol': 'fcd69bde5f0d68ec225a42a1c2ca09197c39847d6f059b31d1e5ac95b80dde4b',
}
const shareVaultFixturePins = {
  'proof/run-sharevault.sh': '2bc871af282b74dbd2aca77f505815ee81634944f762eef7d1e881f86b00087d',
  'proof/solcjs-compat.sh': 'f11e6aad1fb3fd92a8aad3d91d768f8e8915b154349b3ff9efd6b5ee16e2f5e1',
  'proof/foundry/foundry.toml': 'e5488c6494382abb5f0968fbeb89340435ff43a99dc553c89302b848743ce157',
  'proof/foundry/src/ShareVault.sol': 'a32baad5c5e66b31b8e03592974280e4bfda7a9b6bacf9b5faeb8a3f229734f4',
  'proof/foundry/test/ShareVault.t.sol': '29e5601dd267c47f13e5eac56ee81f871fba4031aed6f7182a445e8b5f9e25ef',
}
const acceptanceFixturePins = {
  'proof/run-acceptance-cases.sh': 'ac3bbde7dc8bb895a6c7c47a0b108ba1ba9461185f6070ec4aa7cd6e40bd49ad',
  'proof/solcjs-compat.sh': 'f11e6aad1fb3fd92a8aad3d91d768f8e8915b154349b3ff9efd6b5ee16e2f5e1',
  'proof/foundry/foundry.toml': 'e5488c6494382abb5f0968fbeb89340435ff43a99dc553c89302b848743ce157',
  'proof/foundry/src/ShareVault.sol': 'a32baad5c5e66b31b8e03592974280e4bfda7a9b6bacf9b5faeb8a3f229734f4',
  'proof/foundry/test/AcceptanceCases.t.sol': '31afa08f50977a8c57f29cb99e9a40fd872d1878b7fa044f6c31c643112f5b1b',
}
const openZeppelinFixturePins = {
  'proof/run-openzeppelin-multicall.sh': '1c4b9f7cf8c5c8a07cecc0086f7846a613b7d92606fa86efa3db70b16e6a1851',
  'proof/solcjs-compat.sh': 'f11e6aad1fb3fd92a8aad3d91d768f8e8915b154349b3ff9efd6b5ee16e2f5e1',
  'proof/foundry/foundry.toml': 'e5488c6494382abb5f0968fbeb89340435ff43a99dc553c89302b848743ce157',
  'proof/foundry/test/OpenZeppelinMulticall.t.sol': '7f3d14e84b09bdd1bf5e0f62bf150bac9ee27633859171c0586ad577aaa3461e',
  'proof/foundry/lib/openzeppelin/LICENSE': '0e05b4f45c8769ece14ba2d202bf6f5ed7132600b642c981266f7255e0187ea3',
  'proof/foundry/lib/openzeppelin/v4.9.4/contracts/utils/Address.sol': '8b85a2463eda119c2f42c34fa3d942b61aee65df381f48ed436fe8edb3a7d602',
  'proof/foundry/lib/openzeppelin/v4.9.4/contracts/utils/Context.sol': 'b2cfee351bcafd0f8f27c72d76c054df9b571b62cfac4781ed12c86354e2a56c',
  'proof/foundry/lib/openzeppelin/v4.9.4/contracts/utils/Multicall.sol': 'c64cfcae8c69b9a1efe85d166cd54d0503adea871fed0e90aa48026cbfe03091',
  'proof/foundry/lib/openzeppelin/v4.9.5/contracts/utils/Address.sol': '8b85a2463eda119c2f42c34fa3d942b61aee65df381f48ed436fe8edb3a7d602',
  'proof/foundry/lib/openzeppelin/v4.9.5/contracts/utils/Context.sol': 'b2cfee351bcafd0f8f27c72d76c054df9b571b62cfac4781ed12c86354e2a56c',
  'proof/foundry/lib/openzeppelin/v4.9.5/contracts/utils/Multicall.sol': 'daa8d676f9046565cffe8cdb29d6b951955612140ceb5de174cc6632308e94ac',
}
const counterToolName = 'sentinel_foundry_counter_test'
const shareVaultToolName = 'sentinel_foundry_share_vault_test'
const acceptanceToolName = 'sentinel_foundry_cases_test'
const openZeppelinToolName = 'sentinel_foundry_oz_test'

async function executable(value) {
  if (!value.startsWith('/')) throw new Error('tool executable must be an absolute path')
  const resolved = await realpath(value)
  if (!(await stat(resolved)).isFile()) throw new Error(`${value} is not a file`)
  await access(resolved, constants.X_OK)
  return resolved
}

async function runFixedTest(fixturePins, runnerPath) {
  const forgePath = await executable(forge)
  const solcjsPath = await executable(solcjs)
  const nodeRoot = await realpath(nodeInstall)
  await executable(join(nodeRoot, 'bin/node'))
  const tempRoot = join(root, '.deps/tmp')
  await mkdir(tempRoot, { recursive: true })
  const stage = await mkdtemp(join(tempRoot, 'agh-mcp-foundry-'))
  try {
    for (const [relative, expected] of Object.entries(fixturePins)) {
      const content = await readFile(join(root, relative))
      const actual = createHash('sha256').update(content).digest('hex')
      if (!expected || actual !== expected) throw new Error(`Reviewed fixture hash mismatch: ${relative}`)
      const target = join(stage, relative)
      await mkdir(dirname(target), { recursive: true, mode: 0o700 })
      await writeFile(target, content, { mode: 0o600 })
    }
    const runner = join(stage, runnerPath)
    await chmod(runner, 0o700)
    await chmod(join(stage, 'proof/solcjs-compat.sh'), 0o700)
    const { stdout, stderr } = await execFileAsync('/usr/bin/bwrap', [
      '--die-with-parent', '--new-session', '--unshare-user', '--unshare-net', '--unshare-pid',
      '--ro-bind', '/usr', '/usr', '--ro-bind', '/bin', '/bin', '--ro-bind', '/lib', '/lib',
      '--ro-bind', '/lib64', '/lib64', '--ro-bind', '/etc', '/etc',
      '--dir', '/work', '--bind', stage, '/work',
      '--dir', '/deps', '--dir', '/deps/tools', '--ro-bind', join(root, '.deps/tools'), '/deps/tools',
      '--dir', '/node-runtime', '--ro-bind', nodeRoot, '/node-runtime',
      '--dir', '/home', '--tmpfs', '/home',
      '--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp',
      '--chdir', '/work/proof/foundry',
      '--setenv', 'PATH', '/usr/bin:/bin:/node-runtime/bin',
      '--setenv', 'HOME', '/work', '--setenv', 'TMPDIR', '/tmp',
      '--setenv', 'SENTINEL_FORGE', '/deps/tools/foundry/forge',
      '--setenv', 'SENTINEL_SOLC', '/work/proof/solcjs-compat.sh',
      '--setenv', 'SENTINEL_SOLCJS', '/deps/tools/solcjs/node_modules/.bin/solcjs',
      '--setenv', 'SENTINEL_IN_SANDBOX', '1',
      '--', '/usr/bin/bash', `/work/${runnerPath}`,
    ], {
      cwd: tempRoot,
      env: { PATH: '/usr/bin:/bin', HOME: tempRoot, TMPDIR: tempRoot },
      timeout: 35_000,
      maxBuffer: 128 * 1024,
    })
    return {
      code: 0,
      stdout,
      stderr,
      timedOut: false,
      sandbox: sandboxPolicy,
    }
  } catch (error) {
    const stdout = String(error.stdout ?? '')
    const completedTest = stdout.includes('Ran 1 test suite in')
    return {
      code: Number.isInteger(error.code) ? error.code : 1,
      stdout,
      stderr: String(error.stderr || `Foundry process exited with code ${error.code ?? 'unknown'}`).slice(0, 64 * 1024),
      timedOut: error.killed === true,
      sandbox: completedTest ? sandboxPolicy : null,
    }
  } finally {
    await rm(stage, { recursive: true, force: true })
  }
}

async function runCounterTest() {
  return runFixedTest(counterFixturePins, 'proof/run-foundry.sh')
}

async function runShareVaultTest() {
  const result = await runFixedTest(shareVaultFixturePins, 'proof/run-sharevault.sh')
  const expectedMarkers = [
    '[PASS] testExpectedBug_ReproducesBobHalfPayout()',
    '[FAIL: INV_FULL_REDEMPTION] testEveryShareholderCanRedeemOriginalDeposit()',
    '[FAIL: INV_SHARE_SUPPLY_CONSERVATION] testWithdrawPreservesOutstandingShareInvariant()',
    'Suite result: FAILED. 1 passed; 2 failed; 0 skipped',
  ]
  const recognized = result.code === 1 && !result.timedOut && result.sandbox &&
    expectedMarkers.every((marker) => result.stdout.includes(marker))
  const completed = result.sandbox && !result.timedOut && result.stdout.includes('Ran 1 test suite in')
  return {
    ...result,
    testClassification: recognized
      ? 'expected_invariant_violations_observed'
      : completed
        ? 'unexpected_test_result'
        : 'execution_error',
  }
}

async function runAcceptanceCasesTest() {
  const result = await runFixedTest(acceptanceFixturePins, 'proof/run-acceptance-cases.sh')
  const expectedMarkers = [
    '[PASS] testBoundaryZeroDepositIsRejectedWithoutStateChange()',
    '[FAIL: FIXTURE_EXPECTED_TEST_FAILURE] testFixtureFailureIsNotAVulnerabilityFinding()',
    'Suite result: FAILED. 1 passed; 1 failed; 0 skipped',
  ]
  const recognized = result.code === 1 && !result.timedOut && result.sandbox &&
    expectedMarkers.every((marker) => result.stdout.includes(marker))
  const completed = result.sandbox && !result.timedOut && result.stdout.includes('Ran 1 test suite in')
  return {
    ...result,
    testClassification: recognized
      ? 'expected_fixture_test_failure_no_finding'
      : completed
        ? 'unexpected_test_result'
        : 'execution_error',
  }
}

async function runOpenZeppelinMulticallTest() {
  const result = await runFixedTest(openZeppelinFixturePins, 'proof/run-openzeppelin-multicall.sh')
  const expectedMarkers = [
    '[PASS] testHistoricalV494OneSubcallExecutesTwice()',
    '[PASS] testPatchedV495OneSubcallExecutesOnce()',
    '[FAIL: INV_SINGLE_EXECUTION] testInvariantV494OneSubcallExecutesOnce()',
    'Suite result: FAILED. 2 passed; 1 failed; 0 skipped',
  ]
  const completed = result.sandbox && !result.timedOut && result.stdout.includes('Ran 1 test suite in')
  return {
    ...result,
    testClassification: result.code === 1 && completed && expectedMarkers.every((marker) => result.stdout.includes(marker))
      ? 'known_upstream_issue_and_patch_reproduced'
      : completed ? 'unexpected_test_result' : 'execution_error',
  }
}

const server = new Server({ name: 'sentinel-foundry', version: '0.0.1' }, { capabilities: { tools: {} } })
let running = false
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{
    name: counterToolName,
    description: 'Run only the pinned offline CounterTest.testIncrement Foundry baseline in a temporary isolated workspace.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  }, {
    name: shareVaultToolName,
    description: 'Run the pinned local ShareVault state-transition test and return compiler and test results.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  }, {
    name: acceptanceToolName,
    description: 'Run the pinned local boundary and fixture tests and return compiler and test results.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  }, {
    name: openZeppelinToolName,
    description: 'Run pinned offline OpenZeppelin Multicall version-comparison tests and return compiler and test results.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  }],
}))
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const args = request.params.arguments ?? {}
  if (![counterToolName, shareVaultToolName, acceptanceToolName, openZeppelinToolName].includes(request.params.name) || !args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).length !== 0)
    return { content: [{ type: 'text', text: 'Only the four no-argument pinned Foundry tests are available.' }], isError: true }
  if (running) return { content: [{ type: 'text', text: 'A Foundry baseline run is already active.' }], isError: true }
  running = true
  try {
    const result = request.params.name === counterToolName
      ? await runCounterTest()
      : request.params.name === shareVaultToolName
        ? await runShareVaultTest()
        : request.params.name === acceptanceToolName
          ? await runAcceptanceCasesTest()
          : await runOpenZeppelinMulticallTest()
    return {
      content: [{ type: 'text', text: JSON.stringify(result) }],
      ...((result.sandbox && !result.timedOut && result.stdout.includes('Ran 1 test suite in')) ? {} : { isError: true }),
    }
  } finally {
    running = false
  }
})
await server.connect(new StdioServerTransport())
