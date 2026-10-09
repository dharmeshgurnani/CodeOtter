// Diff compression: an over-budget diff keeps whole high-priority files and names the rest.
// Runs the <dynamic-context> and <diff-compression> blocks of server.mjs itself.
import assert from "node:assert";
import { serverBlocks } from "./helpers/server-blocks.mjs";
import { test } from "node:test";

test("diff compression", async (ctx) => {

const { compressDiff, parseDiff } = new Function(`${serverBlocks("dynamic-context", "diff-compression")}; return { compressDiff, parseDiff };`)();

const file = (path, added, removed = 0, extra = "") => {
  const lines = [...Array(removed)].map((_, i) => `-old ${i}`).concat([...Array(added)].map((_, i) => `+new line ${i} in ${path}`));
  return `diff --git a/${path} b/${path}\nindex 1111111..2222222 100644\n--- a/${path}\n+++ b/${path}\n@@ -1,${removed + 1} +1,${added + 1} @@\n ctx\n${lines.join("\n")}${extra}`;
};
const deletionOnly = `diff --git a/src/old.ts b/src/old.ts\n--- a/src/old.ts\n+++ b/src/old.ts\n@@ -10,3 +10,1 @@\n ctx\n-gone1\n-gone2`;
const deletedFile = `diff --git a/src/legacy.ts b/src/legacy.ts\ndeleted file mode 100644\n--- a/src/legacy.ts\n+++ /dev/null\n@@ -1,2 +0,0 @@\n-a\n-b`;
const mixedDeletion = `diff --git a/src/mix.ts b/src/mix.ts\n--- a/src/mix.ts\n+++ b/src/mix.ts\n@@ -1,2 +1,2 @@\n ctx\n-x\n+y\n@@ -20,2 +20,1 @@\n ctx\n-removed only`;

const diff = [
  file("package-lock.json", 400),
  file("README.md", 60),
  file("src/a.ts", 40),
  file("src/b.ts", 30),
  file("scripts/tool.py", 30),
  deletionOnly,
  deletedFile,
  mixedDeletion,
].join("\n");

// Fits: untouched.
const fits = compressDiff(diff, diff.length + 10);
assert.strictEqual(fits.diff, diff);
assert.strictEqual(fits.compressed, false);
ctx.diagnostic("diff within budget is unchanged");

// Over budget: TypeScript (main language) first, lockfile never crowds out code.
const budget = 6000;
const r = compressDiff(diff, budget);
assert(r.compressed);
assert(r.diff.length <= budget, `within budget: ${r.diff.length}`);
for (const p of ["src/a.ts", "src/b.ts", "src/mix.ts"]) assert(r.diff.includes(`diff --git a/${p} b/${p}`), `${p} shown`);
assert(r.omitted.includes("package-lock.json"), "lockfile omitted first");
assert(/Also changed, not shown \(over the diff budget\):\n[\s\S]*package-lock\.json \+400 -0/.test(r.diff), "omitted files are named with counts");
assert(r.diff.indexOf("src/a.ts") < r.diff.indexOf("scripts/tool.py") || !r.diff.includes("diff --git a/scripts/tool.py"), "main language before other code");
ctx.diagnostic("main language first, lockfile omitted and named");

// Deletions: deleted files and deletion-only files are named; deletion-only hunks inside a kept file are dropped.
assert(r.deleted.includes("src/legacy.ts"));
assert(r.deleted.includes("src/old.ts (lines removed only)"));
assert(r.diff.includes("Deleted files:\nsrc/old.ts (lines removed only)\nsrc/legacy.ts") || r.diff.includes("Deleted files:\nsrc/legacy.ts"), "deleted list present");
assert(!r.diff.includes("-removed only"), "deletion-only hunk in a kept file dropped");
assert(r.diff.includes("+y"), "mixed hunk kept");
assert.strictEqual(r.deletionHunks, 2);
ctx.diagnostic("deletions summarised");

// Every shown hunk keeps a valid header.
for (const f of parseDiff(r.diff)) for (const h of f.parts.filter((p) => typeof p === "object")) {
  assert.strictEqual(h.lines.filter((l) => l[0] !== "+").length, h.oldN);
  assert.strictEqual(h.lines.filter((l) => l[0] !== "-").length, h.newN);
}
ctx.diagnostic("shown hunks stay valid");

// One file bigger than the whole budget still shows its start.
const huge = file("src/huge.ts", 2000);
const h = compressDiff(huge, 3000);
assert(h.diff.startsWith("diff --git a/src/huge.ts"));
assert(h.diff.includes("cut at the diff budget"));
assert(h.diff.length <= 3000);
ctx.diagnostic("oversized single file shows its start");

// A file too big to fit whole shows its leading hunks, at most half the budget, and the rest still get room.
const hunk = (i) => `@@ -${i * 100},2 +${i * 100},2 @@\n ctx\n-${"o".repeat(300)}\n+${"n".repeat(300)}`;
const big = `diff --git a/src/big.ts b/src/big.ts\n--- a/src/big.ts\n+++ b/src/big.ts\n${[...Array(40)].map((_, i) => hunk(i + 1)).join("\n")}`;
const p = compressDiff([big, file("src/small.ts", 20)].join("\n"), 10000);
assert.deepStrictEqual(p.partial, ["src/big.ts"]);
assert(/\(\d+ more hunk\(s\) in src\/big\.ts not shown\)/.test(p.diff));
assert(p.diff.includes("diff --git a/src/small.ts"), "smaller file still shown");
assert(p.diff.length <= 10000);
ctx.diagnostic("oversized file shows leading hunks without starving the rest");

});
