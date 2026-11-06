// OpenAI-compatible chat requests: Claude 4 and later carry max_tokens 16000, Claude 5 also drops temperature; every other
// model keeps the review temperature and sends no max_tokens.
// Runs reviewDiff in a child process with fetch stubbed against throwaway storage, so nothing leaves the machine.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

// Claude 5: output budget, no temperature. claude-haiku-5-5 is the one family name the other Claude 5 ids do not cover.
const CLAUDE_5 = ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5", "claude-fable-5-1", "anthropic/claude-sonnet-5", "anthropic/claude-sonnet-5.5"];
// Claude 4: output budget and the review temperature.
const CLAUDE_4 = ["claude-sonnet-4-5", "claude-haiku-4-5-20251001", "anthropic/claude-sonnet-4.5"];
// Claude 3.x puts the version first; the rest are not Claude. All keep the request they had before the budget existed.
const UNCHANGED = ["claude-3-5-sonnet-latest", "anthropic/claude-3.5-sonnet", "gpt-5", "MiniMax-M3", "qwen2.5-coder:latest", "my-claude-finetune"];

test("openai-compatible request shape", async (ctx) => {
  const temp = mkdtempSync(join(tmpdir(), "codeotter-oai-"));
  try {
    const runner = join(temp, "check.mjs");
    writeFileSync(runner, `
      import http from 'node:http';
      import { writeFileSync } from 'node:fs';
      import { join } from 'node:path';
      http.Server.prototype.listen = () => { throw Error('Unexpected HTTP server'); };
      const sent = [];
      const review = { summary: 'Edits a file.', verdict: 'comment', scores: { quality: 80, correctness_risk: 10, test_coverage: 50, readability: 80, pr_hygiene: 70, blast_radius: 20 }, findings: [], walkthrough: [] };
      globalThis.fetch = async (url, opts) => {
        if (!String(url).startsWith('https://proxy.example.test/v1/chat/completions')) throw Error('Unexpected network request ' + url);
        sent.push(JSON.parse(opts.body));
        return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(review) }, finish_reason: 'stop' }] }), { headers: { 'content-type': 'application/json' } });
      };
      const core = await import(${JSON.stringify(pathToFileURL(resolve("core/server.mjs")).href)});
      const diff = 'diff --git a/a.js b/a.js\\n--- a/a.js\\n+++ b/a.js\\n@@ -1 +1 @@\\n-a\\n+b\\n';
      const files = [{ path: 'a.js', additions: 1, deletions: 1 }];
      const bodiesFor = async (model) => {
        sent.length = 0;
        await core.reviewDiff({ diff, files, llm: { provider: 'custom', baseUrl: 'https://proxy.example.test/v1', apiKey: 'test-key', model } });
        return sent.map((b) => ({ ...b, messages: b.messages.length }));
      };
      const saved = {};
      for (const model of ${JSON.stringify([...CLAUDE_5, ...CLAUDE_4, ...UNCHANGED])}) saved[model] = await bodiesFor(model);
      writeFileSync(join(process.env.CODEOTTER_HOME, 'config.json'), JSON.stringify({ review: { temperature: 0.7 } }));
      const userSet = {};
      for (const model of ['gpt-5', 'claude-sonnet-4-5', 'claude-sonnet-5-5']) userSet[model] = await bodiesFor(model);
      console.log('RESULT ' + JSON.stringify({ saved, userSet }));
    `);
    const result = await promisify(execFile)(process.execPath, [runner], { encoding: "utf8", env: { SystemRoot: process.env.SystemRoot, PATH: "", CODEOTTER_HOME: temp, CODEOTTER_UPDATE_CHECK: "0" }, timeout: 20000 });
    const { saved, userSet } = JSON.parse(result.stdout.split("\n").find((line) => line.startsWith("RESULT ")).slice("RESULT ".length));

    // Collect every mismatch first so one failure lists all the model ids that are wrong.
    const problems = [];
    const expectBody = (model, bodies, maxTokens, temperature, label) => {
      if (!bodies.length) problems.push(`${model} (${label}): no request reached the endpoint`);
      for (const b of bodies) {
        const keys = Object.keys(b).sort().join();
        const want = ["messages", "model", ...(maxTokens === undefined ? [] : ["max_tokens"]), ...(temperature === undefined ? [] : ["temperature"])].sort().join();
        if (b.model !== model || b.max_tokens !== maxTokens || b.temperature !== temperature || keys !== want) {
          problems.push(`${model} (${label}): sent max_tokens=${b.max_tokens} temperature=${b.temperature} keys=${keys}; expected max_tokens=${maxTokens} temperature=${temperature} keys=${want}`);
        }
      }
    };
    for (const model of CLAUDE_5) expectBody(model, saved[model], 16000, undefined, "default");
    for (const model of CLAUDE_4) expectBody(model, saved[model], 16000, 0.2, "default");
    for (const model of UNCHANGED) expectBody(model, saved[model], undefined, 0.2, "default");
    // A review temperature the user chose is passed through, except to Claude 5.
    expectBody("gpt-5", userSet["gpt-5"], undefined, 0.7, "temperature 0.7");
    expectBody("claude-sonnet-4-5", userSet["claude-sonnet-4-5"], 16000, 0.7, "temperature 0.7");
    expectBody("claude-sonnet-5-5", userSet["claude-sonnet-5-5"], 16000, undefined, "temperature 0.7");
    assert.deepEqual(problems, [], "request body differs for:\n" + problems.join("\n"));
    ctx.diagnostic(`Claude 4+: max_tokens 16000 (${CLAUDE_4.length + CLAUDE_5.length} ids); Claude 5: no temperature (${CLAUDE_5.length} ids); ${UNCHANGED.length} other ids unchanged`);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
