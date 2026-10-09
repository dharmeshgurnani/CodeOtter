// Accepted suggestions: a suggestion counts as applied when its code is at the new head and was not at the previously
// reviewed commit. Runs the real <accepted> block from server.mjs.
import assert from "node:assert";
import { serverBlock, serverSource } from "./helpers/server-blocks.mjs";
import { test } from "node:test";

test("accepted suggestions", async (ctx) => {

const block = serverBlock("accepted");
const { acceptedSuggestions, codeKey } = new Function(`${block}; return { acceptedSuggestions, codeKey };`)();

assert.strictEqual(codeKey("  a\r\n\n    b  \n"), "a\nb");
ctx.diagnostic("code compared line by line, ignoring indentation and blank lines");

const before = new Map([
  ["src/cart.js", "export function total(items) {\n  return sum(items) * 1.15;\n}\n"],
  ["src/user.js", "export const name = (u) => u.name.trim();\n"],
]);
const after = new Map([
  ["src/cart.js", "export function total(items) {\r\n    return sum(items) * (1 + TAX_RATE);\r\n}\r\n"],
  ["src/user.js", "export const name = (u) => u.name.trim();\n"],
]);
const findings = [
  { file: "src/cart.js", title: "Tax rate is hard-coded", suggestion: "  return sum(items) * (1 + TAX_RATE);" },
  { file: "src/user.js", title: "Already there before", suggestion: "export const name = (u) => u.name.trim();" },
  { file: "src/cart.js", title: "Not applied", suggestion: "return sum(items, { tax: true });" },
  { file: "src/cart.js", title: "Too short to tell", suggestion: "}" },
  { file: "src/cart.js", title: "Dismissed", suggestion: "return sum(items) * (1 + TAX_RATE);", dismissed: true },
  { file: "src/gone.js", title: "File unreadable", suggestion: "return sum(items) * (1 + TAX_RATE);" },
  { file: "src/cart.js", title: "No suggestion" },
];
assert.deepStrictEqual(acceptedSuggestions(findings, before, after), ["[src/cart.js] Tax rate is hard-coded"]);
assert.deepStrictEqual(acceptedSuggestions(findings, new Map(), after), [], "previous version is required");
assert.deepStrictEqual(acceptedSuggestions(null, before, after), []);
ctx.diagnostic("only suggestions applied since the last review count");

// headFileTexts reads the previous commit when given a ref.
const hf = serverSource.slice(serverSource.indexOf("async function headFileTexts("), serverSource.indexOf("\n}\n", serverSource.indexOf("async function headFileTexts(")) + 3);
const refs = [];
const headFileTexts = new Function("REPO_RE", "repoOf", "isForgeRepo", "forgeApi", "ghAsync", `${hf}; return headFileTexts;`)(
  /^[\w.-]+\/[\w.-]+$/, () => "acme/shop", () => false, null, async (...a) => { refs.push(a[1]); return "text"; },
);
const pr = { url: "https://github.com/acme/shop/pull/7", headRefOid: "b".repeat(40) };
await headFileTexts(pr, ["src/cart.js"]);
await headFileTexts(pr, ["src/cart.js"], 25, 400000, "a".repeat(40));
assert(refs[0].endsWith(`?ref=${"b".repeat(40)}`) && refs[1].endsWith(`?ref=${"a".repeat(40)}`), refs.join(" "));
ctx.diagnostic("previous commit read by ref");

});
