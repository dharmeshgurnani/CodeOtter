// The backend's marked source regions (// <name> ... // </name>) across core/*.mjs, for tests that run a block with stubs.
// `export` keywords are stripped so a block evaluates inside new Function. ponytail: text slicing until each test imports its module.
import { readFileSync, readdirSync } from "node:fs";

const coreDir = new URL("../../core/", import.meta.url);
const sources = readdirSync(coreDir).filter((f) => f.endsWith(".mjs")).map((f) => [f, readFileSync(new URL(f, coreDir), "utf8")]);
export const serverSource = sources.map(([, s]) => s).join("\n");
export function serverBlock(name) {
  for (const [, source] of sources) {
    const start = source.indexOf(`// <${name}>`);
    const end = source.indexOf(`// </${name}>`);
    if (start >= 0 && end > start) return source.slice(start, end).replace(/^export (?=(?:async )?function|const|let|class)/gm, "");
  }
  throw new Error(`core/ is missing the <${name}> block`);
}
export const serverBlocks = (...names) => names.map(serverBlock).join("\n");
