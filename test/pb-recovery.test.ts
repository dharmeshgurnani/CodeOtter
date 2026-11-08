import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import childProcess, { type SpawnOptions } from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';

test('PocketBase recovery', async (ctx) => {

// Fully isolated: fake binary and HTTP transport, never connect to live storage.
const home = mkdtempSync(join(tmpdir(), 'codeotter-pb-recovery-'));
let available = false;
let starts = 0;
let detached = 0;
const originalExec = childProcess.execFileSync;
const originalSpawn = childProcess.spawn;
const originalFetch = globalThis.fetch;
const originalInterval = globalThis.setInterval;
const timers: ReturnType<typeof setInterval>[] = [];
try {
  process.env.CODEOTTER_HOME = home;
  process.env.PB_URL = 'http://127.0.0.1:18090';
  process.env.FORGEJO_URL = ''; process.env.GITEA_URL = '';
  process.env.REPO = 'one/repo';
  mkdirSync(join(home, '.pb'));
  writeFileSync(join(home, '.pb', process.platform === 'win32' ? 'pocketbase.exe' : 'pocketbase'), 'fixture');
  writeFileSync(join(home, 'config.json'), JSON.stringify({ repos: ['one/repo'] }));
  childProcess.execFileSync = (() => '') as unknown as typeof childProcess.execFileSync;
  childProcess.spawn = ((binary: string, args: readonly string[], options: SpawnOptions) => {
    assert(binary.startsWith(home)); assert.equal(args[0], 'serve');
    assert.equal(options.detached, true); assert.equal(options.windowsHide, true);
    available = true; starts++;
    const child = Object.assign(new EventEmitter(), { unref: () => { detached++; } }); return child;
  }) as unknown as typeof childProcess.spawn;
  syncBuiltinESMExports();
  globalThis.setInterval = ((...args: Parameters<typeof originalInterval>) => { const timer = originalInterval(...args); timers.push(timer); return timer; }) as typeof setInterval;
  const stubFetch: typeof fetch = async (url, init = {}) => {
    assert(String(url).startsWith(String(process.env.PB_URL)));
    if (!available) throw new TypeError('fetch failed', { cause: Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }) });
    if (String(url).includes('auth-with-password')) return Response.json({ token: 'fixture-token' });
    assert.equal(init.method || 'GET', 'GET', 'No storage writes during recovery');
    return Response.json({ items: [] });
  };
  globalThis.fetch = stubFetch;
  const { repositoryBoard } = await import('../core/server.ts');
  await repositoryBoard();
  assert.equal(starts, 1);
  available = false;
  await Promise.all([repositoryBoard(), repositoryBoard()]);
  assert.equal(starts, 2, 'Concurrent reads share one database restart');
  assert.equal(detached, 2, 'Database lifecycle is independent of terminal lifetime');
  ctx.diagnostic('PocketBase recovery tests passed: detached local service and coalesced read recovery, isolated from live data.');
} finally {
  childProcess.execFileSync = originalExec; childProcess.spawn = originalSpawn; syncBuiltinESMExports();
  globalThis.fetch = originalFetch; globalThis.setInterval = originalInterval;
  timers.forEach(clearInterval);
  assert.equal(dirname(home), resolve(tmpdir()));
  rmSync(home, { recursive: true, force: true });
}
});
