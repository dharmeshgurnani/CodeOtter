// The backend's marked source regions (// <name> ... // </name>) across core/*.ts, for tests that run a block with stubs.
// Types are stripped (comments survive) and `export` keywords removed so a block evaluates inside new Function.
// ponytail: text slicing until each test imports its module.
import { readFileSync, readdirSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";

const coreDir = new URL("../../core/", import.meta.url);
const sources = readdirSync(coreDir).filter((f) => f.endsWith(".ts")).map((f) => [f, stripTypeScriptTypes(readFileSync(new URL(f, coreDir), "utf8"))] as const);
export const serverSource = sources.map(([, s]) => s).join("\n");
export function serverBlock(name: string): string {
  for (const [, source] of sources) {
    const start = source.indexOf(`// <${name}>`);
    const end = source.indexOf(`// </${name}>`);
    if (start >= 0 && end > start) return source.slice(start, end).replace(/^export (?=(?:async )?function|const|let|class)/gm, "");
  }
  throw new Error(`core/ is missing the <${name}> block`);
}
export const serverBlocks = (...names: string[]): string => names.map(serverBlock).join("\n");
