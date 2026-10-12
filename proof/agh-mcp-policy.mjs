import assert from 'node:assert/strict'

export function assertReviewedMcpDefinition(actual, expected) {
  assert.equal(actual.serverId, expected.serverId, 'MCP server ID differs from reviewed definition')
  assert.deepEqual(actual.transport, expected.transport, 'MCP transport differs from reviewed definition')
  assert.deepEqual(actual.secretBinding, expected.secretBinding, 'MCP secret binding differs from reviewed definition')
  assert.deepEqual(actual.toolPolicy, expected.toolPolicy, 'MCP tool policy differs from reviewed definition')
}
