import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { test } from 'node:test';

test('CLI: help, version, MCP, installation isolation', async (ctx) => {

const cli = fileURLToPath(new URL('../tui/codeotter.mjs', import.meta.url));
const run = (args, input) => execFileSync(process.execPath, [cli, ...args], { encoding: 'utf8', input, timeout: 10000 });
assert.match(run(['--help']), /CodeOtter CLI/);
assert.match(run(['--version']), /\d+\.\d+\.\d+/);
const messages = [
  { jsonrpc: '2.0', id: 1, method: 'initialize' },
  { jsonrpc: '2.0', id: 2, method: 'tools/list' },
  { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'codeotter_get_gates', arguments: {} } },
];
const responses = run(['mcp'], messages.map(message => JSON.stringify(message)).join('\n') + '\n').trim().split('\n').map(line => JSON.parse(line));
assert.equal(responses.length, 3, 'MCP stdout contains only protocol messages');
assert.equal(responses[0].result.serverInfo.name, 'codeotter-mcp');
assert.deepEqual(responses[1].result.tools.map(tool => tool.name), ['codeotter_review_diff', 'codeotter_get_gates']);
const definitions = JSON.parse(responses[2].result.content[0].text);
assert(definitions.gates.length > 0);
assert(Object.keys(definitions.rubrics).length > 0);
const temp = mkdtempSync(join(tmpdir(), 'codeotter-cli-env-'));
try {
  const installation = join(temp, 'installation');
  mkdirSync(installation);
  writeFileSync(join(temp, '.env'), 'CODEOTTER_TEST_INSTALLATION=wrong\n');
  writeFileSync(join(installation, '.env'), 'CODEOTTER_TEST_INSTALLATION=selected\n');
  const probe = `await import(${JSON.stringify(new URL('../tui/codeotter.mjs', import.meta.url).href)}); console.log(process.env.CODEOTTER_TEST_INSTALLATION)`;
  const env = { ...process.env, CODEOTTER_HOME: installation };
  delete env.CODEOTTER_TEST_INSTALLATION;
  const result = execFileSync(process.execPath, ['--input-type=module', '-e', probe], { cwd: temp, env, encoding: 'utf8', timeout: 10000 });
  assert.equal(result.trim(), 'selected', 'Explicit installation ignores the working directory env');

  // Argument validation: bad flags and unknown commands exit 2 before any git or model work runs.
  // `temp` is not a git repository, so a review that slipped past validation would fail with exit 1, not 2.
  const spawn = (args, input = '') => spawnSync(process.execPath, [cli, ...args], { cwd: temp, env, encoding: 'utf8', input, timeout: 10000 });
  const noValue = spawn(['--min-score']);
  assert.equal(noValue.status, 2, '--min-score without a value exits 2');
  assert.match(noValue.stderr, /Missing value for --min-score/);
  const notNumber = spawn(['--min-score', 'abc']);
  assert.equal(notNumber.status, 2, '--min-score abc exits 2');
  assert.match(notNumber.stderr, /--min-score/);
  const flagAsValue = spawn(['--base', '--json']);
  assert.equal(flagAsValue.status, 2, 'a flag where a value belongs exits 2');
  assert.match(flagAsValue.stderr, /Missing value for --base/);
  const unknown = spawn(['frobnicate']);
  assert.equal(unknown.status, 2, 'unknown command exits 2');
  assert.match(unknown.stderr, /Unknown command: frobnicate/);
  assert.match(unknown.stderr, /USAGE/, 'help goes to stderr for an unknown command');
  assert.equal(unknown.stdout.trim(), '', 'nothing on stdout for an unknown command');
  const helpOk = spawn(['help']);
  assert.equal(helpOk.status, 0, 'help exits 0');
  assert.match(helpOk.stdout, /USAGE/, 'help goes to stdout');
  ctx.diagnostic('CLI argument validation: missing/invalid flag values and unknown commands exit 2.');

  // MCP server hardening: malformed requests get JSON-RPC errors and the process keeps answering.
  const hostile = [
    'null',
    JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'codeotter_review_diff' } }),
    JSON.stringify({ jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'codeotter_review_diff', arguments: { title: 'no diff' } } }),
    JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'tools/list' }),
  ];
  const mcp = spawn(['mcp'], hostile.join('\n') + '\n');
  assert.equal(mcp.status, 0, `MCP server exits cleanly at end of input: ${mcp.stderr}`);
  const hostileResponses = mcp.stdout.trim().split('\n').map(line => JSON.parse(line));
  assert.equal(hostileResponses.length, 4, 'every line gets exactly one answer');
  assert.equal(hostileResponses[0].error.code, -32600, 'a null request is an Invalid Request');
  assert.equal(hostileResponses[0].id, null);
  assert.equal(hostileResponses[1].id, 7);
  assert.equal(hostileResponses[1].error.code, -32602, 'tools/call without arguments is Invalid params');
  assert.match(hostileResponses[1].error.message, /arguments/);
  assert.equal(hostileResponses[2].id, 8);
  assert.equal(hostileResponses[2].error.code, -32602, 'tools/call without a diff string is Invalid params');
  assert.match(hostileResponses[2].error.message, /diff/);
  assert.equal(hostileResponses[3].id, 9);
  assert.deepEqual(hostileResponses[3].result.tools.map(tool => tool.name), ['codeotter_review_diff', 'codeotter_get_gates'], 'the server still answers after bad requests');
  ctx.diagnostic('MCP server survives a null line and tools/call without arguments, answering with JSON-RPC errors.');
} finally {
  assert.equal(dirname(temp), resolve(tmpdir()));
  rmSync(temp, { recursive: true, force: true });
}
ctx.diagnostic('CLI smoke tests passed: help, version, headless MCP and installation environment isolation.');
});
