// The server's marked source regions (// <name> ... // </name>), for tests that run a block with stubs.
// ponytail: text slicing until core/ is split into importable modules (plans/12); then import the module instead.
import { readFileSync } from "node:fs";

export const serverSource = readFileSync(new URL("../../core/server.mjs", import.meta.url), "utf8");
export function serverBlock(name) {
  const start = serverSource.indexOf(`// <${name}>`);
  const end = serverSource.indexOf(`// </${name}>`);
  if (start < 0 || end < start) throw new Error(`core/server.mjs is missing the <${name}> block`);
  return serverSource.slice(start, end);
}
export const serverBlocks = (...names) => names.map(serverBlock).join("\n");
