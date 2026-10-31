// OpenAI-compatible chat requests: Claude 5 models behind a proxy (OpenRouter, VoyageAge) get no sampling parameters
// and a 16000-token budget; every other model keeps the review temperature. Runs reviewDiff in a child process with
// fetch stubbed against throwaway storage, so nothing leaves the machine.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

test("openai-compatible request shape", async (ctx) => {
  const temp = mkdtempSync(join(tmpdir(), "codeotter-oai-"));
  try {
    const runner = join(temp, "check.mjs");
    writeFileSync(runner, `
      import assert from 'node:assert/strict';
      import http from 'node:http';
      http.Server.prototype.listen = () => { throw Error('Unexpected HTTP server'); };
      const sent = [];
      const review = { summary: 'Adds a provider.', verdict: 'comment', scores: { quality: 80, correctness_risk: 10, test_coverage: 50, readability: 80, pr_hygiene: 70, blast_radius: 20 }, findings: [], walkthrough: [] };
      globalThis.fetch = async (url, opts) => {
        if (!String(url).startsWith('https://api.voyageage.com/v1/chat/completions')) throw Error('Unexpected network request ' + url);
        sent.push(JSON.parse(opts.body));
        return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(review) }, finish_reason: 'stop' }] }), { headers: { 'content-type': 'application/json' } });
      };
      const core = await import(${JSON.stringify(pathToFileURL(resolve("core/server.mjs")).href)});
      const diff = 'diff --git a/a.js b/a.js\\n--- a/a.js\\n+++ b/a.js\\n@@ -1 +1 @@\\n-a\\n+b\\n';
      const files = [{ path: 'a.js', additions: 1, deletions: 1 }];
      const llm = (model) => ({ provider: 'voyageage', baseUrl: 'https://api.voyageage.com/v1', apiKey: 'test-key', model });

      await core.reviewDiff({ diff, files, llm: llm('claude-sonnet-5-5') });
      assert.ok(sent.length > 0);
      for (const b of sent) { assert.equal(b.model, 'claude-sonnet-5-5'); assert.equal('temperature' in b, false); assert.equal(b.max_tokens, 16000); }

      sent.length = 0;
      await core.reviewDiff({ diff, files, llm: llm('gpt-6-astra') });
      assert.ok(sent.length > 0);
      for (const b of sent) { assert.equal(typeof b.temperature, 'number'); assert.equal('max_tokens' in b, false); }
      console.log('request shape ok');
    `);
    const result = await promisify(execFile)(process.execPath, [runner], { encoding: "utf8", env: { SystemRoot: process.env.SystemRoot, PATH: "", CODEOTTER_HOME: temp, CODEOTTER_UPDATE_CHECK: "0" }, timeout: 20000 });
    assert.match(result.stdout, /request shape ok/);
    ctx.diagnostic("Claude 5 via proxy: no temperature, max_tokens 16000; other models keep temperature");
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
