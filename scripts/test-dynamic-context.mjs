// Dynamic context: hunks extend upward to the enclosing declaration and trailing context is trimmed.
// Runs the <dynamic-context> block of server.mjs itself, so the test cannot drift from the server.
import assert from "node:assert";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../server.mjs", import.meta.url), "utf8");
const block = src.slice(src.indexOf("// <dynamic-context>"), src.indexOf("// </dynamic-context>"));
assert(block.length > 100, "server.mjs is missing the <dynamic-context> block");
const { declName, parseDiff, dynamicContextFiles, extendDiffContext } =
  new Function(`${block}; return { declName, parseDiff, dynamicContextFiles, extendDiffContext };`)();

// Declarations across languages; control flow is not a declaration.
assert.strictEqual(declName("export async function calculateTax(rate, amount) {"), "calculateTax");
assert.strictEqual(declName("const formatCurrency = (val) => {"), "formatCurrency");
assert.strictEqual(declName("export class OrderService {"), "OrderService");
assert.strictEqual(declName("  public processPayment(charge: Charge): Promise<Result> {"), "processPayment");
assert.strictEqual(declName("    public static int add(int a, int b) {"), "add");
assert.strictEqual(declName("def handle_webhook(event, signature):"), "handle_webhook");
assert.strictEqual(declName("func (s *Server) Start() error {"), "Start");
assert.strictEqual(declName("pub async fn run(cfg: Config) -> Result<()> {"), "run");
assert.strictEqual(declName("if (!validated) {"), null);
assert.strictEqual(declName("} else if (x) {"), null);
assert.strictEqual(declName("while (count > 0) {"), null);
assert.strictEqual(declName("describe(\"x\", () => {"), null);
assert.strictEqual(declName("return compute(a, b);"), null);
console.log("✓ declaration detection");

const orders = `import { db } from "./db.js";

export function processOrder(orderId, items) {
  const total = items.reduce((sum, item) => sum + item.price, 0);
  const validated = validateItems(items);
  if (!validated) {
    logger.warn("Validation failed for order", orderId);
    throw new Error("Invalid order items: check sku");
  }
  const status = "pending";
  return { orderId, total, status };
}
`;
const diff = `diff --git a/src/orders.js b/src/orders.js
index 1111111..2222222 100644
--- a/src/orders.js
+++ b/src/orders.js
@@ -5,6 +5,7 @@ export function processOrder(orderId, items) {
   const validated = validateItems(items);
   if (!validated) {
-    throw new Error("Invalid order items");
+    logger.warn("Validation failed for order", orderId);
+    throw new Error("Invalid order items: check sku");
   }
   const status = "pending";
   return { orderId, total, status };
diff --git a/README.md b/README.md
--- a/README.md
+++ b/README.md
@@ -10,4 +10,4 @@
 one
-two
+deux
 three
 four
`;

assert.deepStrictEqual(dynamicContextFiles(parseDiff(diff)), ["src/orders.js"], "only code files lacking a declaration are fetched");

const { diff: out, stats } = extendDiffContext(diff, new Map([["src/orders.js", orders]]), { before: 16, after: 1 });
const lines = out.split("\n");
assert(lines.includes(" export function processOrder(orderId, items) {"), "enclosing function is prepended");
assert(lines.includes("@@ -3,6 +3,7 @@ export function processOrder(orderId, items) {"), `header is recounted: ${lines.find((l) => l.startsWith("@@"))}`);
assert(!out.includes("const status"), "trailing context trimmed to one line");
assert(out.includes("@@ -10,4 +10,4 @@\n one\n-two\n+deux\n three\n four"), "non-code files are untouched");
assert.deepStrictEqual(stats, { extended: 1, added: 2, trimmed: 2 });
console.log("✓ extends to the enclosing declaration and trims trailing context");

// Header counts must still describe the hunk body.
for (const f of parseDiff(out)) for (const h of f.parts.filter((p) => typeof p === "object")) {
  assert.strictEqual(h.lines.filter((l) => l[0] !== "+").length, h.oldN, "old count");
  assert.strictEqual(h.lines.filter((l) => l[0] !== "-").length, h.newN, "new count");
}
console.log("✓ hunk headers stay valid");

// A stale or mismatched file never invents context.
const stale = extendDiffContext(diff, new Map([["src/orders.js", "something\nelse\nentirely\n"]]));
assert(!stale.diff.split("\n").includes(" export function processOrder(orderId, items) {"), "mismatched source is ignored");
assert.strictEqual(stale.stats.extended, 0);
console.log("✓ mismatched source is ignored");

// Extension stops at lines the previous hunk already showed.
const two = `export function a() {
  one();
  two();
  three();
  four();
  five();
  six();
  seven();
}
`;
const twoDiff = `diff --git a/x.js b/x.js
--- a/x.js
+++ b/x.js
@@ -1,3 +1,3 @@
 export function a() {
-  uno();
+  one();
   two();
@@ -6,3 +6,3 @@
   five();
-  seis();
+  six();
   seven();
`;
const twoOut = extendDiffContext(twoDiff, new Map([["x.js", two]]));
assert.strictEqual(twoOut.stats.extended, 0, "no declaration between the hunks, so no extension");
assert.strictEqual((twoOut.diff.match(/export function a/g) || []).length, 1, "no repeated lines");
console.log("✓ never repeats lines from the previous hunk");

// Python, CRLF input.
const py = `from fastapi import APIRouter\n\n@router.post("/checkout")\ndef handle_checkout(payload):\n    cart = get_cart(payload.cart_id)\n    if not cart.is_valid():\n        raise HTTPException(400)\n    return {"status": "ok"}\n`;
const pyDiff = `diff --git a/api.py b/api.py\r\n--- a/api.py\r\n+++ b/api.py\r\n@@ -6,3 +6,3 @@\r\n     if not cart.is_valid():\r\n-        raise HTTPException(400)\r\n+        raise HTTPException(400, "expired")\r\n     return {"status": "ok"}\r\n`;
const pyOut = extendDiffContext(pyDiff, new Map([["api.py", py]]));
assert(pyOut.diff.includes("@@ -4,5 +4,5 @@\n def handle_checkout(payload):\n     cart = get_cart"), pyOut.diff);
console.log("✓ Python, CRLF");

// Off: before = 0 only trims.
assert.strictEqual(extendDiffContext(diff, new Map([["src/orders.js", orders]]), { before: 0 }).stats.extended, 0);
console.log("All dynamic context tests passed");
