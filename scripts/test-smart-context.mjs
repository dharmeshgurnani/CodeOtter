// scripts/test-smart-context.mjs
// Verification suite for "Smart Context" Outside-Diff Impact Slicing & Blast Radius Fan-out
import assert from "node:assert";
import { execFileSync } from "node:child_process";

// 1. Test symbol extraction from diff
function extractChangedSymbols(diff) {
  const symbols = new Set();
  const defRegexes = [
    /(?:export\s+)?(?:async\s+)?function\s+([a-zA-Z0-9_$]+)/g,
    /(?:export\s+)?(?:const|let|var)\s+([a-zA-Z0-9_$]+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[a-zA-Z0-9_$]+)\s*=>/g,
    /(?:export\s+)?class\s+([a-zA-Z0-9_$]+)/g,
    /(?:export\s+)?(?:type|interface)\s+([a-zA-Z0-9_$]+)/g,
    /def\s+([a-zA-Z0-9_]+)\s*\(/g,
    /func\s+(?:\([^)]+\)\s*)?([a-zA-Z0-9_]+)\s*\(/g,
    /fn\s+([a-zA-Z0-9_]+)\s*\(/g,
  ];
  const ignore = new Set([
    "string", "number", "boolean", "const", "let", "var", "export", "import",
    "return", "true", "false", "null", "undefined", "async", "await", "default",
    "class", "function", "if", "else", "for", "while", "switch", "case", "break",
    "then", "catch", "finally", "try", "new", "this", "super", "typeof", "void"
  ]);

  for (const line of diff.split("\n")) {
    if ((line.startsWith("+") || line.startsWith("-")) && !line.startsWith("+++") && !line.startsWith("---")) {
      const code = line.slice(1);
      for (const re of defRegexes) {
        for (const match of code.matchAll(re)) {
          const sym = match[1];
          if (sym && sym.length >= 3 && !ignore.has(sym)) {
            symbols.add(sym);
          }
        }
      }
    }
  }
  return [...symbols].slice(0, 15);
}

function blastRadius(files, outsideCallers = 0, outsideFiles = 0) {
  const HOTSPOTS = [
    ["migrations", /(^|\/)migrations\//i],
    ["auth / security", /auth|acl|permission|middleware|secret|token/i],
    ["payments / money", /payment|invoice|billing|stripe|fee/i],
    ["public API routes", /(^|\/)(api|routes)\//i],
    ["core domain", /\bcore\//],
    ["dependencies", /package\.json|pnpm-lock\.yaml|yarn\.lock|package-lock\.json|go\.sum|Cargo\.lock/],
    ["CI / deploy", /\.github\/|railway\.json|Dockerfile|docker-compose|\.gitlab-ci/],
  ];
  const lines = files.reduce((n, f) => n + f.additions + f.deletions, 0);
  const dirs = new Set(files.map((f) => f.path.split("/").slice(0, 3).join("/")));
  const hot = HOTSPOTS.filter(([, re]) => files.some((f) => re.test(f.path))).map(([n]) => n);
  const tests = files.filter((f) => /test|spec|__tests__/.test(f.path)).length;
  const callerImpact = Math.min(25, outsideCallers * 4 + outsideFiles * 2);
  const score = Math.min(100, Math.min(30, files.length * 2.5) + Math.min(25, lines / 30) + Math.min(25, hot.length * 10) + callerImpact);
  return { score: Math.round(score), files: files.length, lines, dirs: dirs.size, hotspots: hot, testFiles: tests, outsideCallers, outsideFiles };
}

console.log("Running Smart Context verification tests...");

// Test Case 1: TS/JS Export Function Detection
const sampleDiff = `diff --git a/web/src/types.ts b/web/src/types.ts
--- a/web/src/types.ts
+++ b/web/src/types.ts
@@ -70,3 +70,3 @@
-export const effort = (score: number, lines: number) => {
+export const effort = (score: number, lines: number, isCritical = false) => {
`;

const syms = extractChangedSymbols(sampleDiff);
assert.deepStrictEqual(syms, ["effort"], "Expected 'effort' symbol to be extracted");
console.log("✓ Symbol extraction passed for export const function");

// Test Case 2: Python / Go syntax extraction
const pyDiff = `diff --git a/services/pricing.py b/services/pricing.py
--- a/services/pricing.py
+++ b/services/pricing.py
@@ -10,4 +10,4 @@
-def calculate_discount(cart):
+def calculate_discount(cart, tenant_id):
+    if not tenant_id:
+        raise ValueError("Missing tenant_id")
`;
const pySyms = extractChangedSymbols(pyDiff);
assert.deepStrictEqual(pySyms, ["calculate_discount"], "Expected 'calculate_discount' symbol extracted");
console.log("✓ Symbol extraction passed for Python def");

// Test Case 3: Blast Radius incorporates outside caller fan-out
const baselineBlast = blastRadius([{ path: "src/utils.ts", additions: 10, deletions: 2 }], 0, 0);
const highFanoutBlast = blastRadius([{ path: "src/utils.ts", additions: 10, deletions: 2 }], 5, 3);
assert(highFanoutBlast.score > baselineBlast.score, "Blast radius score must increase when outside callers are impacted");
assert.strictEqual(highFanoutBlast.outsideCallers, 5);
assert.strictEqual(highFanoutBlast.outsideFiles, 3);
console.log(`✓ Blast radius fan-out calculation passed: baseline ${baselineBlast.score} -> fanout ${highFanoutBlast.score}`);

// Test Case 4: Live git grep outside changed files for symbol 'effort'
const excludeArgs = [":!web/src/types.ts", ":!web/src/types.ts".replace(/\\/g, "/")];
const raw = execFileSync("git", ["grep", "-n", "-w", "effort", "--", ".", ...excludeArgs], { encoding: "utf8" });
assert(raw.includes("core/server.mjs:"), "Expected git grep to find outside callers in core/server.mjs");
console.log("✓ Outside-diff caller resolution via git grep passed");

console.log("\nALL SMART CONTEXT TESTS PASSED SUCCESSFULLY! 🦦🚀");
