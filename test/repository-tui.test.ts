import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFile, spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { once } from 'node:events';
import { promisify, stripVTControlCharacters } from 'node:util';
import { PassThrough } from 'node:stream';
import blessed from 'blessed';
import { createRepositoryClient, repositoryRows, reviewComplete, formatRepositoryReview, formatWalkthrough } from '../tui/repositories.ts';
import type { RepositoryCore, ReviewRecord } from '../tui/repositories.ts';
import { startRepositoryTui } from '../tui/repository-tui.ts';
import { scoreColor, colorScores } from '../tui/tui-theme.ts';
import { formatDetailText } from '../tui/tui-details.ts';
import { test } from 'node:test';

// What the layout checks read off blessed widgets at runtime: @types/blessed types positions as strings and omits
// the internals (lpos, sattr, items).
type Probe = {
  type: string; content: string; top: number; left: number; width: number; height: number; iheight: number; ileft: number; itop: number;
  lpos: { xi: number; yi: number }; scrollable?: boolean; selected: number; items: Probe[];
  style: { border?: object; scrollbar: { fg?: number } }; scrollbar: { ch: string };
  sattr(style: object | undefined): number; emit(event: string, ...args: unknown[]): boolean; focus(): void;
};
// blessed.unicode is not in @types/blessed.
const unicode = (blessed as unknown as { unicode: { charWidth(text: string): number; strWidth(text: string): number } }).unicode;

test('repository TUI', async (ctx) => {

assert.match(formatDetailText('#1 PR\nhttps://github.com/one/repo/pull/1'), /\{130-fg\}\{underline\}https:/);

for (const [value, color] of [[0, 124], [39, 124], [40, 166], [69, 166], [70, 28], [100, 28]]) {
  assert.equal(scoreColor(value, 'quality'), color);
  assert.equal(scoreColor(100 - value, 'correctness_risk'), color);
  assert.equal(scoreColor(100 - value, 'blast_radius'), color);
}
assert.equal(colorScores('quality             ░░░/100'), 'quality             ░░░/100');

const pr = (owner: string, number: number) => ({ url: `https://github.com/${owner}/repo/pull/${number}`, number, title: `${owner} change ${number}` });
const record = (owner: string, number: number) => ({ pr: pr(owner, number), at: '2026-10-09', blast: { score: 0 }, review: { summary: `${owner} summary`, scores: { quality: 0, correctness_risk: 0, test_coverage: 0, readability: 0, pr_hygiene: 0 }, findings: [], walkthrough: [] } });
const complete = record('one', 1);
assert.equal(formatWalkthrough([
  { file: 'README.md', change: 'Update usage.' },
  { file: 'src/ui/app.ts', change: 'Render the view.\nPreserve focus.' },
  { file: 'src\\index.ts', change: 'Start the app.' },
]), '├─ src/\n│  ├─ ui/\n│  │  └─ app.ts\n│  │       Render the view.\n│  │       Preserve focus.\n│  └─ index.ts\n│       Start the app.\n└─ README.md\n     Update usage.');
assert(reviewComplete(complete), 'zero is a valid model score');
assert(!reviewComplete({ ...complete, pending: { narrative: true } }));
assert.match(formatRepositoryReview({ pr: complete.pr, record: complete }), /one summary/);
const withEngines = { ...complete, engines: { llm: 'microsoft/codereviewer', s1: 'private-engine' } };
assert(!formatRepositoryReview({ pr: complete.pr, record: withEngines }).includes('codereviewer'));
const forgePr = { ...pr('one', 3), url: 'https://gitea.test/one/repo/pulls/3' };
const mixed = { forgeUrls: { gitea: 'https://gitea.test' }, reviewed: [complete, record('two', 1)], open: [pr('one', 2), forgePr] };
assert.equal(repositoryRows(mixed, 'one/repo').length, 2);
assert.equal(repositoryRows(mixed, 'gitea~one/repo').length, 1);

let calls: unknown[][] = [];
// A partial core: the board has no repository list and repositoryDiff is never called.
const client = createRepositoryClient({ pollMs: 1, core: {
  repositoryBoard: async (org: string) => { calls.push(['board', org]); return mixed; },
  repositoryReview: async (...args: unknown[]) => { calls.push(args); return calls.filter(c => c[0] !== 'board').length === 1 ? { ...complete, pending: { scores: true } } : complete; },
} as unknown as RepositoryCore });
await client.board('one');
await client.review('one/repo', { pr: complete.pr }, { force: true });
assert.deepEqual(calls, [['board', 'one'], ['one/repo', complete.pr.url, true], ['one/repo', complete.pr.url, false]]);
await assert.rejects(client.review('two/repo', { pr: complete.pr }), /outside/);
const cancelled = new AbortController(); cancelled.abort();
await assert.rejects(client.review('one/repo', { pr: complete.pr }, { signal: cancelled.signal }));

// Import and use the real backend with isolated file storage and all network/listen calls forbidden.
const temp = mkdtempSync(join(tmpdir(), 'codeotter-core-'));
let screen: blessed.Widgets.Screen | null = null;
let backend: ChildProcess | null = null;
try {
  writeFileSync(join(temp, 'config.json'), JSON.stringify({ repos: ['one/repo', 'two/repo'], llm: { provider: 'custom', model: 'fixture' } }));
  mkdirSync(join(temp, 'scores'));
  const cached = record('one', 1); cached.review.scores.quality = 70;
  writeFileSync(join(temp, 'scores', 'one-repo-pull-1.json'), JSON.stringify(cached));
  writeFileSync(join(temp, 'scores', 'two-repo-pull-1.json'), JSON.stringify(record('two', 1)));
  const runner = join(temp, 'check.ts');
  writeFileSync(runner, `
    import assert from 'node:assert/strict';
    import http from 'node:http';
    http.Server.prototype.listen = () => { throw Error('Unexpected HTTP server'); };
    globalThis.fetch = () => { throw Error('Unexpected network request'); };
    const intervals = [];
    const timer = globalThis.setInterval;
    globalThis.setInterval = (fn, ms) => { intervals.push(ms); return timer(fn, ms); };
    const core = await import(${JSON.stringify(pathToFileURL(resolve('core/server.ts')).href)});
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

  // Normal node server.ts startup still serves the same scoped API against throwaway storage.
  const portProbe = createServer();
  await new Promise<void>(resolve => portProbe.listen(0, '127.0.0.1', () => resolve()));
  const port = (portProbe.address() as AddressInfo).port;
  await new Promise<void>(resolve => portProbe.close(() => resolve()));
  backend = spawn(process.execPath, [resolve('core/server.ts')], { env: { SystemRoot: process.env.SystemRoot, PATH: '', CODEOTTER_HOME: temp, REPO: 'one/repo', CODEOTTER_UPDATE_CHECK: '0', PORT: String(port) }, stdio: 'ignore' });
  let liveBoard: { reviewed: { pr: { url: string } }[] } | undefined;
  for (let i = 0; i < 50; i++) {
    try { liveBoard = await (await fetch(`http://127.0.0.1:${port}/api/reviews?org=one`, { signal: AbortSignal.timeout(500) })).json() as typeof liveBoard; break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(liveBoard?.reviewed.length, 1);
  assert.equal(liveBoard?.reviewed[0].pr.url, complete.pr.url);
  const stopped = once(backend, 'exit'); backend.kill(); await stopped; backend = null;

  // Actual terminal widgets: cached review, automatic queue, organization switch and stale results.
  const input = Object.assign(new PassThrough(), { isTTY: true, setRawMode: () => {} });
  const output = Object.assign(new PassThrough(), { isTTY: true, columns: 110, rows: 35 }); output.on('data', () => {});
  const term = blessed.screen({ input, output, terminal: 'xterm', smartCSR: true, fullUnicode: true });
  screen = term;
  // @types/blessed types the no-argument screenshot() as void; it returns the SGR text.
  const screenshot = () => term.screenshot() as unknown as string;
  const focused = () => term.focused as unknown as Probe;
  const children = () => term.children as unknown as Probe[];
  const reviews: string[] = [];
  const fake = {
    origin: 'Local CodeOtter',
    async diff(_repo: string, pr: { number: number }) { return `diff --git a/file b/file\n+PR ${pr.number}\n`; },
    async board(org?: string) { return { repos: ['one/repo', 'two/repo'], model: 'fixture', reviewed: org ? [record(org, 1)] : [], open: org ? [pr(org, 2)] : [] }; },
    async review(repo: string, _row: unknown, options: { onProgress(record: object): void; signal: AbortSignal }) {
      reviews.push(repo);
      options.onProgress({ ...record(repo.split('/')[0], 2), pending: { scores: true, narrative: true } });
      return new Promise<ReviewRecord>((_resolve, reject) => { options.signal.addEventListener('abort', () => reject(new Error('Aborted')), { once: true }); });
    },
  };
  const copied: string[] = [];
  const opened: string[] = [];
  const running = startRepositoryTui({}, { screen: term, client: fake, clipboard: async (content: string) => { copied.push(content); return 'Copied'; }, openLink: async (url: string) => { opened.push(url); }, diffRenderer: async (raw: string) => `\x1b[32m${raw}\x1b[0m` });
  const tick = () => new Promise(resolve => setImmediate(resolve));
  const press = (name: string) => term.program.emit('keypress', name.length === 1 ? name : undefined, { name, full: name });
  await tick(); await tick();
  assert.match(screenshot(), /one\/repo/);
  const headerLines = stripVTControlCharacters(screenshot()).split('\n');
  assert.equal(unicode.charWidth('🦦'), 2);
  assert.equal(unicode.strWidth(headerLines[0].split('CodeOtter')[0]), headerLines[1].indexOf('one/repo'));
  assert.match(screenshot(), /▾ two/);
  assert.deepEqual(focused().items.map((item: Probe) => item.content), ['▾ one', '  └─ repo', '▾ two', '  └─ repo']);
  press('left'); press('enter');
  assert.deepEqual(focused().items.map((item: Probe) => item.content), ['▸ one', '▾ two', '  └─ repo']);
  press('right'); press('right');
  assert.equal(focused().selected, 1);
  assert(!screenshot().includes('Organization'));
  assert.deepEqual(reviews, ['one/repo']);
  assert(!screenshot().includes('two summary'));
  press('down'); press('down'); press('enter'); await tick(); await tick();
  assert.deepEqual(reviews, ['one/repo', 'two/repo']);
  assert(!screenshot().includes('one summary'));
  const repoList = focused();
  const borderColor = (widget: Probe) => (widget.sattr(widget.style.border) >> 9) & 0x1ff;
  const selectedColor = (widget: Probe) => widget.items[widget.selected].sattr(widget.items[widget.selected].style) & 0x1ff;
  assert.equal(borderColor(repoList), 130);
  assert.equal(selectedColor(repoList), 142);
  press('tab');
  assert.equal(focused().type, 'list');
  assert.notEqual(focused(), repoList);
  assert.equal(borderColor(repoList), 130);
  assert.equal(selectedColor(repoList), 130);
  assert.equal(borderColor(focused()), 130);
  assert.equal(selectedColor(focused()), 142);
  const prList = focused();
  const [scoresPane, summaryPane, reviewPane] = children().filter((widget: Probe) => widget.scrollable && widget.type === 'box');
  assert.equal(scoresPane.top, summaryPane.top);
  assert(summaryPane.left >= scoresPane.left + scoresPane.width);
  assert(reviewPane.top >= scoresPane.top + scoresPane.height);
  assert.match(reviewPane.content, /#2 two change 2/);
  press('c'); await tick();
  assert.equal(copied.length, 1);
  assert.match(copied[0], /^#2 two change 2/);
  assert(!copied[0].includes('{bold}'), 'Clipboard excludes display formatting');
  press('down');
  assert.equal(focused(), prList, 'Previewing keeps focus in the PR list');
  assert.match(reviewPane.content, /#1 two change 1/);
  assert.match(summaryPane.content, /two summary/);
  assert.match(scoresPane.content, /quality\s+\{124-fg\}0\/100/);
  press('up');
  assert.match(reviewPane.content, /#2 two change 2/);
  press('tab');
  assert.equal(borderColor(repoList), 130);
  assert.equal(focused(), reviewPane, 'Navigation skips Scores and Summary');
  press('o'); await tick();
  assert.deepEqual(opened, ['https://github.com/two/repo/pull/2']);
  reviewPane.emit('click', { x: reviewPane.lpos.xi + reviewPane.ileft + 2, y: reviewPane.lpos.yi + reviewPane.itop + 1 });
  await tick();
  assert.equal(opened.length, 2, 'Clicking the underlined PR URL opens it');
  assert.equal(reviewPane.style.scrollbar.fg, 142);
  assert.equal(reviewPane.scrollbar.ch, '█');
  const paneCount = children().length;
  press('tab'); await tick(); await tick();
  assert.equal(focused(), reviewPane, 'Tab switches Review to Changes in place');
  assert.equal(children().length, paneCount, 'Diff reuses Full details instead of opening another screen');
  assert.equal(term.grabKeys, false);
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
  assert.equal(focused(), repoList);
  assert.equal(borderColor(repoList), 130);
  assert.equal(selectedColor(repoList), 142);
  press('escape'); // Return the Changes pane to Review.
  press('S-tab'); await tick(); await tick();
  assert.equal(focused(), reviewPane);
  assert.match(reviewPane.content, /\+PR 1/);
  press('S-tab');
  assert.equal(focused(), reviewPane);
  assert.match(reviewPane.content, /#1 two change 1/);
  press('S-tab'); assert.equal(focused(), prList);
  press('S-tab'); assert.equal(focused(), repoList);
  press('escape'); assert.match(screenshot(), /Queue stopped/);
  output.columns = 60; output.rows = 20;
  term.program.cols = 60; term.program.rows = 20;
  term.emit('resize');
  assert(scoresPane.height - scoresPane.iheight >= 6, 'All six scores fit in a compact terminal');
  const tabs = children().filter((widget: Probe) => widget.type === 'button');
  const copyButton = tabs.find((widget: Probe) => widget.content.includes('Copy'));
  const changesButton = tabs.find((widget: Probe) => widget.content.includes('Changes'));
  assert(copyButton!.left >= changesButton!.left + changesButton!.width, 'Compact copy action does not overlap tabs');
  assert(reviewPane.top < (term.height as number) - 1, 'Compact layout keeps details visible');
  press('q'); await running; screen = null;
  ctx.diagnostic('Repository TUI tests passed: shared code, no web server, scope, cache, queue and cancellation.');
} finally {
  if (backend && backend.exitCode === null) { const stopped = once(backend, 'exit'); backend.kill(); await stopped; }
  screen?.destroy();
  assert.equal(dirname(temp), resolve(tmpdir()));
  rmSync(temp, { recursive: true, force: true });
}
});
