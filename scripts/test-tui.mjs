import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile, execFileSync, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { PassThrough } from 'node:stream';
import blessed from 'blessed';
import { createWorkspace, reviewSections } from '../tui/workspace.mjs';
import { normalizeReview, text } from '../tui/review-output.mjs';
import { startTui } from '../tui/tui.mjs';

const root = process.cwd();
const temp = mkdtempSync(join(tmpdir(), 'codeotter-tui-'));
// Reviews import core/server.mjs: keep storage and settings in the throwaway home, never the live installation.
process.env.CODEOTTER_HOME = temp; process.env.CODEOTTER_UPDATE_CHECK = '0'; process.env.PB_URL = '';
const gateIds = ['title', 'description', 'security', 'complexity', 'tests', 'docs', 'scope', 'guidelines'];
const fixture = {
  scores: Object.fromEntries(['quality', 'correctness_risk', 'test_coverage', 'readability', 'pr_hygiene', 'blast_radius'].map(k => [k, 55])),
  gates: gateIds.map(id => ({ id, pass: true, explanation: 'Fixture gate' })),
  summary: 'A fixture review.', walkthrough: [{ file: 'app.js', change: 'Update value' }],
  findings: [{ file: 'app.js', line: 1, severity: 'warning', title: 'Candidate', detail: 'Fixture finding' }],
};
let responseMode = 'normal';
let requests = [];
const server = createServer(async (req, res) => {
  let body = ''; for await (const chunk of req) body += chunk;
  const prompt = JSON.parse(body).messages[0].content;
  requests.push(prompt);
  if (responseMode === 'slow') return;
  const content = responseMode === 'invalid' ? '{}' : prompt.includes('checking another reviewer') ? '{"scores":[{"index":0,"score":0}]}' : prompt.includes('senior staff code reviewer') ? JSON.stringify(fixture) : '# Draft\nFixture answer';
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ choices: [{ message: { content } }] }));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let screen;
try {
  process.chdir(temp);
  const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  git('init', '-b', 'main'); git('config', 'core.autocrlf', 'false'); git('config', 'user.email', 'test@example.test'); git('config', 'user.name', 'Test');
  writeFileSync('app.js', 'const value = 1;\n'); git('add', '.'); git('commit', '-m', 'initial');
  writeFileSync('app.js', 'const value = 2;\n'); git('add', '.'); writeFileSync('app.js', 'const value = 3;\n');
  const workspace = createWorkspace({ provider: 'custom', model: 'fixture', baseUrl: `http://127.0.0.1:${server.address().port}/v1` });
  assert.match(workspace.refresh().diff, /\+const value = 3/);
  assert.match(workspace.refresh({ staged: true }).diff, /\+const value = 2/);
  assert.match(workspace.refresh({ staged: false, base: 'main' }).source, /main/);
  assert.throws(() => workspace.refresh({ base: '--output=unexpected' }));
  workspace.refresh({ base: null });
  const entry = await workspace.run('review');
  assert.equal(entry.result.blast.score, 55);
  assert.deepEqual(entry.result.findings, [], 'self-check can reject all findings');
  assert.deepEqual(entry.result.gates, [], 'gates come from System One only; none without it');
  for (const tool of ['ask', 'describe', 'improve', 'docs', 'changelog']) assert.match((await workspace.run(tool, 'Why?')).result, /Draft/);
  assert(requests.some(p => p.includes('QUESTION: Why?')));
  assert.equal(workspace.history.length, 6);
  const cliArgs = [resolve(root, 'tui/codeotter.mjs'), 'review', '--json', '--provider', 'custom', '--model', 'fixture', '--base-url', workspace.config.baseUrl];
  const cli = await promisify(execFile)(process.execPath, cliArgs, { encoding: 'utf8' });
  assert.equal(JSON.parse(cli.stdout).scores.quality, 55, 'CLI JSON stays machine-readable');
  await assert.rejects(promisify(execFile)(process.execPath, [...cliArgs, '--fail-on-gate', '--min-score', '90']), error => error.code === 1 && JSON.parse(error.stdout).scores.quality === 55);
  const path = workspace.export(entry, 'result.json');
  assert.equal(JSON.parse(readFileSync(path)).kind, 'review');
  assert.equal(JSON.parse(readFileSync(path)).model, undefined);
  assert.equal(JSON.parse(readFileSync(path)).result.model, undefined);
  assert(!reviewSections(entry).Summary.includes('custom/fixture'));
  assert.throws(() => workspace.export(entry, path), /EEXIST/);
  responseMode = 'invalid';
  await assert.rejects(workspace.run('review'), /score/);
  assert.equal(workspace.history.length, 6, 'failed requests never enter history');
  responseMode = 'slow';
  const controller = new AbortController();
  const pending = workspace.run('ask', 'cancel', controller.signal);
  controller.abort(); await assert.rejects(pending);
  responseMode = 'normal';
  assert.throws(() => normalizeReview({ ...fixture, gates: [{ id: 'title', pass: 'false' }] }, gateIds.map(id => ({ id }))), /gate/);
  assert.equal(text('\x1b]52;c;ZXZpbA==\x07safe\x1b[31m'), 'safe');

  // Exercise actual Blessed widgets and keyboard routing against an in-memory terminal.
  const input = new PassThrough(); input.isTTY = true; input.setRawMode = () => {};
  const output = new PassThrough(); output.isTTY = true; output.columns = 100; output.rows = 30; output.on('data', () => {});
  screen = blessed.screen({ input, output, terminal: 'xterm', smartCSR: true, ignoreLocked: ['C-c'] });
  const tui = startTui({ local: true }, { screen, workspace });
  const press = name => screen.program.emit('keypress', name.length === 1 ? name : undefined, { name, full: name });
  assert.match(screen.screenshot(), /CodeOtter/);
  press('s'); assert.match(screen.screenshot(), /Staged changes/); press('escape');
  press('a'); assert.match(screen.screenshot(), /Ask about these changes/);
  await new Promise(resolve => setImmediate(resolve)); press('escape');
  press('r');
  for (let i = 0; i < 100 && workspace.history.length === 6; i++) await new Promise(resolve => setTimeout(resolve, 20));
  assert.match(screen.screenshot(), /A fixture review/);
  responseMode = 'slow'; press('r'); press('escape');
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.match(screen.screenshot(), /Cancelled/);
  responseMode = 'normal';
  press('h'); assert.match(screen.screenshot(), /Session history/); press('escape');
  output.columns = 60; output.rows = 20; screen.program.cols = 60; screen.program.rows = 20; screen.emit('resize');
  assert.match(screen.screenshot(), /CodeOtter/);
  press('q'); await tui;
  screen = null;
  const noTty = spawnSync(process.execPath, [resolve(root, 'tui/codeotter.mjs'), 'tui'], { encoding: 'utf8' });
  assert.equal(noTty.status, 1); assert.match(noTty.stderr, /interactive terminal/);
  console.log('TUI tests passed: git sources, model review/tools, failures, cancellation, export, terminal widgets and resize.');
} finally {
  screen?.destroy();
  process.chdir(root);
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  rmSync(temp, { recursive: true, force: true });
}
