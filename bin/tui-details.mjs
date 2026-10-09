import blessed from "blessed";
import { PRIMARY } from "./tui-theme.mjs";
import { text } from "./review-output.mjs";
import { spawn } from "node:child_process";

export async function openPrLink(value) {
  const url = new URL(value);
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new Error("Invalid PR link");
  const command = process.platform === "win32" ? "explorer.exe" : process.platform === "darwin" ? "open" : "xdg-open";
  await new Promise((resolve, reject) => {
    const child = spawn(command, [url.href], { windowsHide: true, stdio: "ignore" });
    child.once("error", reject);
    child.once("spawn", resolve);
    child.unref();
  });
}

export function formatDetailText(content) {
  return text(content).split("\n").map((line, index) => {
    // Escape model-provided braces before adding our own display markup.
    const safe = blessed.helpers.escape(line);
    if (index === 1 && /^https?:\/\/\S+$/.test(line)) return `{${PRIMARY}-fg}{underline}${safe}{/underline}{/${PRIMARY}-fg}`;
    if (index === 0 || /^Verdict  |^\d+\. \[|^[ │]*[├└]─ |^   Suggestion$/.test(line)) return `{bold}${safe}{/bold}`;
    if (/^(GATES|FINDINGS|WALKTHROUGH)( · \d+)?$/.test(line)) return `{${PRIMARY}-fg}{bold}${safe}{/bold}{/${PRIMARY}-fg}`;
    if (/^  (PASS|FAIL)  /.test(line)) {
      const color = line.trimStart().startsWith("PASS") ? 28 : 124;
      return `{${color}-fg}${safe}{/${color}-fg}`;
    }
    return safe;
  }).join("\n");
}
