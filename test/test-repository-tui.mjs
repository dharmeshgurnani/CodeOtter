import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFile, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { promisify, stripVTControlCharacters } from 'node:util';
import { PassThrough } from 'node:stream';
import blessed from 'blessed';
import { createRepositoryClient, repositoryRows, reviewComplete, formatRepositoryReview, formatWalkthrough } from '../tui/repositories.mjs';
import { startRepositoryTui } from '../tui/repository-tui.mjs';
import { scoreColor, colorScores } from '../tui/tui-theme.mjs';
import { formatDetailText } from '../tui/tui-details.mjs';

assert.match(formatDetailText('#1 PR\nhttps://github.com/one/repo/pull/1'), /\{130-fg\}\{underline\}https:/);

for (const [value, color] of [[0, 124], [39, 124], [40, 166], [69, 166], [70, 28], [100, 28]]) {
  assert.equal(scoreColor(value, 'quality'), color);
  assert.equal(scoreColor(100 - value, 'correctness_risk'), color);
  assert.equal(scoreColor(100 - value, 'blast_radius'), color);
}
assert.equal(colorScores('quality             ░░░/100'), 'quality             ░░░/100');

const pr = (owner, number) => ({ url: `https://github.com/${owner}/repo/pull/${number}`, number, title: `${owner} change ${number}` });
const record = (owner, number) => ({ pr: pr(owner, number), at: '2026-10-09', blast: { score: 0 }, review: { summary: `${owner} summary`, scores: { quality: 0, correctness_risk: 0, test_coverage: 0, readability: 0, pr_hygiene: 0 }, findings: [], walkthrough: [] } });
const complete = record('one', 1);
assert.equal(formatWalkthrough([
  { file: 'README.md', change: 'Update usage.' },
  { file: 'src/ui/app.ts', change: 'Render the view.\nPreserve focus.' },
  { file: 'src\\index.ts', change: 'Start the app.' },
]), '├─ src/\n│  ├─ ui/\n│  │  └─ app.ts\n│  │       Render the view.\n│  │       Preserve focus.\n│  └─ index.ts\n│       Start the app.\n└─ README.md\n     Update usage.');
assert(reviewComplete(complete), 'zero is a valid model score');
assert(!reviewComplete({ ...complete, pending: { narrative: true } }));
assert.match(formatRepositoryReview({ pr: complete.pr, record: complete }), /one summary/);
assert(!formatRepositoryReview({ pr: complete.pr, record: { ...complete, engines: { llm: 'microsoft/codereviewer', s1: 'private-engine' } } }).includes('codereviewer'));
const forgePr = { ...pr('one', 3), url: 'https://gitea.test/one/repo/pulls/3' };
const mixed = { forgeUrls: { gitea: 'https://gitea.test' }, reviewed: [complete, record('two', 1)], open: [pr('one', 2), forgePr] };
assert.equal(repositoryRows(mixed, 'one/repo').length, 2);
assert.equal(repositoryRows(mixed, 'gitea~one/repo').length, 1);

let calls = [];
const client = createRepositoryClient({ pollMs: 1, core: {
  repositoryBoard: async org => { calls.push(['board', org]); return mixed; },
  repositoryReview: async (...args) => { calls.push(args); return calls.filter(c => c[0] !== 'board').length === 1 ? { ...complete, pending: { scores: true } } : complete; },
} });
await client.board('one');
await client.review('one/repo', { pr: complete.pr }, { force: true });
assert.deepEqual(calls, [['board', 'one'], ['one/repo', complete.pr.url, true], ['one/repo', complete.pr.url, false]]);
await assert.rejects(client.review('two/repo', { pr: complete.pr }), /outside/);
const cancelled = new AbortController(); cancelled.abort();
await assert.rejects(client.review('one/repo', { pr: complete.pr }, { signal: cancelled.signal }));

// Import and use the real backend with isolated file storage and all network/listen calls forbidden.
const temp = mkdtempSync(join(tmpdir(), 'codeotter-core-'));
let screen;
let backend;
try {
  writeFileSync(join(temp, 'config.json'), JSON.stringify({ repos: ['one/repo', 'two/repo'], llm: { provider: 'custom', model: 'fixture' } }));
  mkdirSync(join(temp, 'scores'));
  const cached = record('one', 1); cached.review.scores.quality = 70;
  writeFileSync(join(temp, 'scores', 'one-repo-pull-1.json'), JSON.stringify(cached));
  writeFileSync(join(temp, 'scores', 'two-repo-pull-1.json'), JSON.stringify(record('two', 1)));
  const runner = join(temp, 'check.mjs');
  writeFileSync(runner, `
    import assert from 'node:assert/strict';
    import http from 'node:http';
    http.Server.prototype.listen = () => { throw Error('Unexpected HTTP server'); };
    globalThis.fetch = () => { throw Error('Unexpected network request'); };
    const intervals = [];
    const timer = globalThis.setInterval;
    globalThis.setInterval = (fn, ms) => { intervals.push(ms); return timer(fn, ms); };
    const core = await import(${JSON.stringify(pathToFileURL(resolve('core/server.mjs')).href)});
    assert.deepEqual(intervals, [60000], 'only model idle cleanup, no PR automation');
    const catalog = await core.repositoryBoard();
    assert.equal(catalog.reviewed.length, 0);
    assert.equal(catalog.repos.length, 2);
    const board = await core.repositoryBoard('one');
    assert.equal(board.reviewed.length, 1);
    assert.equal(board.model, 'custom/fixture');
    const review = await core.repositoryReview('one/repo', 'https://github.com/one/repo/pull/1');
    assert.equal(review.review.scores.quality, 70);
    await assert.rejects(core.repositoryReview('two/repo', 'https://github.com/one/repo/pull/1'), /outside/);
    await assert.rejects(core.repositoryDiff('two/repo', 'https://github.com/one/repo/pull/1'), /outside/);
    await assert.rejects(core.repositoryDiff('one/repo', 'https://untrusted.test/one/repo/pull/1'), /outside/);
    console.log('Shared backend imported and used without HTTP or model calls');
  `);
  const result = await promisify(execFile)(process.execPath, [runner], { encoding: 'utf8', env: { SystemRoot: process.env.SystemRoot, PATH: '', CODEOTTER_HOME: temp, REPO: 'one/repo', CODEOTTER_UPDATE_CHECK: '0' }, timeout: 10000 });
  assert.match(result.stdout, /without HTTP/);

  // Normal node server.mjs startup still serves the same scoped API against throwaway storage.
  const portProbe = createServer();
  await new Promise(resolve => portProbe.listen(0, '127.0.0.1', resolve));
  const port = portProbe.address().port;
  await new Promise(resolve => portProbe.close(resolve));
  backend = spawn(process.execPath, [resolve('core/server.mjs')], { env: { SystemRoot: process.env.SystemRoot, PATH: '', CODEOTTER_HOME: temp, REPO: 'one/repo', CODEOTTER_UPDATE_CHECK: '0', PORT: String(port) }, stdio: 'ignore' });
  let liveBoard;
  for (let i = 0; i < 50; i++) {
    try { liveBoard = await (await fetch(`http://127.0.0.1:${port}/api/reviews?org=one`, { signal: AbortSignal.timeout(500) })).json(); break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(liveBoard?.reviewed.length, 1);
  assert.equal(liveBoard.reviewed[0].pr.url, complete.pr.url);
  const stopped = once(backend, 'exit'); backend.kill(); await stopped; backend = null;

  // Actual terminal widgets: cached review, automatic queue, organization switch and stale results.
  const input = new PassThrough(); input.isTTY = true; input.setRawMode = () => {};
  const output = new PassThrough(); output.isTTY = true; output.columns = 110; output.rows = 35; output.on('data', () => {});
  screen = blessed.screen({ input, output, terminal: 'xterm', smartCSR: true, fullUnicode: true });
  const reviews = [];
  const fake = {
    origin: 'Local CodeOtter',
    async diff(repo, pr) { return `diff --git a/file b/file\n+PR ${pr.number}\n`; },
    async board(org) { return { repos: ['one/repo', 'two/repo'], model: 'fixture', reviewed: org ? [record(org, 1)] : [], open: org ? [pr(org, 2)] : [] }; },
    async review(repo, row, options) {
      reviews.push(repo);
      options.onProgress({ ...record(repo.split('/')[0], 2), pending: { scores: true, narrative: true } });
      await new Promise((resolve, reject) => { options.signal.addEventListener('abort', () => reject(new Error('Aborted')), { once: true }); });
    },
  };
  const copied = [];
  const opened = [];
  const running = startRepositoryTui({}, { screen, client: fake, clipboard: async content => { copied.push(content); return 'Copied'; }, openLink: async url => { opened.push(url); }, diffRenderer: async raw => `\x1b[32m${raw}\x1b[0m` });
  const tick = () => new Promise(resolve => setImmediate(resolve));
  const press = name => screen.program.emit('keypress', name.length === 1 ? name : undefined, { name, full: name });
  await tick(); await tick();
  assert.match(screen.screenshot(), /one\/repo/);
  const headerLines = stripVTControlCharacters(screen.screenshot()).split('\n');
  assert.equal(blessed.unicode.charWidth('🦦'), 2);
  assert.equal(blessed.unicode.strWidth(headerLines[0].split('CodeOtter')[0]), headerLines[1].indexOf('one/repo'));
  assert.match(screen.screenshot(), /▾ two/);
  assert.deepEqual(screen.focused.items.map(item => item.content), ['▾ one', '  └─ repo', '▾ two', '  └─ repo']);
  press('left'); press('enter');
  assert.deepEqual(screen.focused.items.map(item => item.content), ['▸ one', '▾ two', '  └─ repo']);
  press('right'); press('right');
  assert.equal(screen.focused.selected, 1);
  assert(!screen.screenshot().includes('Organization'));
  assert.deepEqual(reviews, ['one/repo']);
  assert(!screen.screenshot().includes('two summary'));
  press('down'); press('down'); press('enter'); await tick(); await tick();
  assert.deepEqual(reviews, ['one/repo', 'two/repo']);
  assert(!screen.screenshot().includes('one summary'));
  const repoList = screen.focused;
  const borderColor = widget => (widget.sattr(widget.style.border) >> 9) & 0x1ff;
  const selectedColor = widget => widget.items[widget.selected].sattr(widget.items[widget.selected].style) & 0x1ff;
  assert.equal(borderColor(repoList), 130);
  assert.equal(selectedColor(repoList), 142);
  press('tab');
  assert.equal(screen.focused.type, 'list');
  assert.notEqual(screen.focused, repoList);
  assert.equal(borderColor(repoList), 130);
  assert.equal(selectedColor(repoList), 130);
  assert.equal(borderColor(screen.focused), 130);
  assert.equal(selectedColor(screen.focused), 142);
  const prList = screen.focused;
  const [scoresPane, summaryPane, reviewPane] = screen.children.filter(widget => widget.scrollable && widget.type === 'box');
  assert.equal(scoresPane.top, summaryPane.top);
  assert(summaryPane.left >= scoresPane.left + scoresPane.width);
  assert(reviewPane.top >= scoresPane.top + scoresPane.height);
  assert.match(reviewPane.content, /#2 two change 2/);
  press('c'); await tick();
  assert.equal(copied.length, 1);
  assert.match(copied[0], /^#2 two change 2/);
  assert(!copied[0].includes('{bold}'), 'Clipboard excludes display formatting');
  press('down');
  assert.equal(screen.focused, prList, 'Previewing keeps focus in the PR list');
  assert.match(reviewPane.content, /#1 two change 1/);
  assert.match(summaryPane.content, /two summary/);
  assert.match(scoresPane.content, /quality\s+\{124-fg\}0\/100/);
  press('up');
  assert.match(reviewPane.content, /#2 two change 2/);
  press('tab');
  assert.equal(borderColor(repoList), 130);
  assert.equal(screen.focused, reviewPane, 'Navigation skips Scores and Summary');
  press('o'); await tick();
  assert.deepEqual(opened, ['https://github.com/two/repo/pull/2']);
  reviewPane.emit('click', { x: reviewPane.lpos.xi + reviewPane.ileft + 2, y: reviewPane.lpos.yi + reviewPane.itop + 1 });
  await tick();
  assert.equal(opened.length, 2, 'Clicking the underlined PR URL opens it');
  assert.equal(reviewPane.style.scrollbar.fg, 142);
  assert.equal(reviewPane.scrollbar.ch, '█');
  const paneCount = screen.children.length;
  press('tab'); await tick(); await tick();
  assert.equal(screen.focused, reviewPane, 'Tab switches Review to Changes in place');
  assert.equal(screen.children.length, paneCount, 'Diff reuses Full details instead of opening another screen');
  assert.equal(screen.grabKeys, false);
  assert.match(reviewPane.content, /\+PR 2/);
  assert.match(summaryPane.content, /two summary/);
  press('c'); await tick();
  assert.equal(copied.at(-1), 'diff --git a/file b/file\n+PR 2\n');
  prList.focus(); press('down'); await tick(); await tick();
  assert.match(reviewPane.content, /\+PR 1/, 'Inline diff follows PR selection');
  press('d');
  assert.match(reviewPane.content, /#1 two change 1/);
  reviewPane.focus();
  press('tab'); await tick(); await tick();
  assert.match(reviewPane.content, /\+PR 1/);
  press('tab');
  assert.equal(screen.focused, repoList);
  assert.equal(borderColor(repoList), 130);
  assert.equal(selectedColor(repoList), 142);
  press('escape'); // Return the Changes pane to Review.
  press('S-tab'); await tick(); await tick();
  assert.equal(screen.focused, reviewPane);
  assert.match(reviewPane.content, /\+PR 1/);
  press('S-tab');
  assert.equal(screen.focused, reviewPane);
  assert.match(reviewPane.content, /#1 two change 1/);
  press('S-tab'); assert.equal(screen.focused, prList);
  press('S-tab'); assert.equal(screen.focused, repoList);
  press('escape'); assert.match(screen.screenshot(), /Queue stopped/);
  output.columns = 60; output.rows = 20;
  screen.program.cols = 60; screen.program.rows = 20;
  screen.emit('resize');
  assert(scoresPane.height - scoresPane.iheight >= 6, 'All six scores fit in a compact terminal');
  const tabs = screen.children.filter(widget => widget.type === 'button');
  const copyButton = tabs.find(widget => widget.content.includes('Copy'));
  const changesButton = tabs.find(widget => widget.content.includes('Changes'));
  assert(copyButton.left >= changesButton.left + changesButton.width, 'Compact copy action does not overlap tabs');
  assert(reviewPane.top < screen.height - 1, 'Compact layout keeps details visible');
  press('q'); await running; screen = null;
  console.log('Repository TUI tests passed: shared code, no web server, scope, cache, queue and cancellation.');
} finally {
  if (backend && backend.exitCode === null) { const stopped = once(backend, 'exit'); backend.kill(); await stopped; }
  screen?.destroy();
  assert.equal(dirname(temp), resolve(tmpdir()));
  rmSync(temp, { recursive: true, force: true });
}
