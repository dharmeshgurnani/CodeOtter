// pnpm test: every offline test in this folder, one process each, stop at the first failure.
// Forge tests need Docker and are run by hand: pnpm test:forgejo, pnpm test:gitea.
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
const only = process.argv[2] || "";
const files = readdirSync(import.meta.dirname).filter((f) => f.startsWith("test-") && f.endsWith(".mjs") && !f.includes("forge") && f.includes(only)).sort();
for (const f of files) {
  console.log(`\n== ${f}`);
  const r = spawnSync(process.execPath, [new URL(f, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")], { stdio: "inherit", cwd: new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1") });
  if (r.status !== 0) { console.error(`\nFAIL ${f}`); process.exit(1); }
}
console.log(`\nPASS ${files.length} test file(s)`);
