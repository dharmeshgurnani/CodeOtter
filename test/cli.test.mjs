import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
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
} finally {
  assert.equal(dirname(temp), resolve(tmpdir()));
  rmSync(temp, { recursive: true, force: true });
}
ctx.diagnostic('CLI smoke tests passed: help, version, headless MCP and installation environment isolation.');
});
