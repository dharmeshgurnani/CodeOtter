// Self-reflection: a second model pass scores findings 0-10; low scores are dropped, the rest ordered by score.
// Runs the real blocks from server.mjs with a stubbed model.
import assert from "node:assert";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../server.mjs", import.meta.url), "utf8");
const block = (name) => src.slice(src.indexOf(`// <${name}>`), src.indexOf(`// </${name}>`));
const load = (askModel) => new Function("askModel", `${block("dynamic-context")}\n${block("diff-compression")}\n${block("reflect")}; return reflectFindings;`)(askModel);

const pr = { number: 7, title: "Fix totals" };
const diff = "diff --git a/a.js b/a.js\n--- a/a.js\n+++ b/a.js\n@@ -1,2 +1,2 @@\n ctx\n-a\n+b";
const r = { reflectMin: 5, diffChars: 90000 };
const c = { provider: "test", model: "stub" };
const findings = [
  { severity: "low", file: "a.js", line: 2, title: "Style nit", detail: "rename b" },
  { severity: "high", file: "a.js", line: 2, title: "Wrong total", detail: "b drops tax", suggestion: "b + tax" },
  { severity: "medium", file: "a.js", title: "Maybe race", detail: "unsure" },
];

let seen = "";
const kept = await load(async (prompt, cfg) => {
  seen = prompt;
  assert.strictEqual(cfg.temperature, 0);
  return 'Sure: {"scores":[{"index":0,"score":2,"why":"style"},{"index":1,"score":9,"why":"real"},{"index":2,"score":5,"why":"plausible"}]}';
})(pr, diff, c, r, findings);
assert.deepStrictEqual(kept.map((f) => [f.title, f.confidence]), [["Wrong total", 0.9], ["Maybe race", 0.5]]);
assert(seen.includes("1. [high] a.js:2: Wrong total") && seen.includes("Suggested code:\nb + tax") && seen.includes("+b"), "prompt lists findings and the diff");
console.log("✓ drops low scores, orders by score");

await assert.rejects(load(async () => '{"scores":[{"index":0,"score":3}]}')(pr, diff, c, r, findings), /did not score every finding/);
await assert.rejects(load(async () => "no json here")(pr, diff, c, r, findings), /did not return valid JSON/);
console.log("✓ incomplete or invalid answers fail loudly");

const clamped = await load(async () => '{"scores":[{"index":0,"score":42},{"index":1,"score":-3},{"index":2,"score":"7"}]}')(pr, diff, c, r, findings);
assert.deepStrictEqual(clamped.map((f) => f.confidence), [1, 0.7]);
console.log("✓ scores clamped to 0-10");

console.log("All self-reflection tests passed");
