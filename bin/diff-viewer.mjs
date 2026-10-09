import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { text } from "./review-output.mjs";
import wrapAnsi from "wrap-ansi";
import sliceAnsi from "slice-ansi";
import ansiRegex from "ansi-regex";
import { stripVTControlCharacters } from "node:util";

export function fitDiffOutput(output, width) {
  // Blessed understands SGR colors, but not cursor/erase commands from Delta.
  const colored = output.replace(ansiRegex(), sequence => /^\x1b\[[\d;]*m$/.test(sequence) ? sequence : "");
  const wrap = (value, columns) => wrapAnsi(value, Math.max(1, columns), { hard: true, wordWrap: false, trim: false });
  return colored.split("\n").map(line => {
    const gutter = /^([ \d]+│ )/.exec(stripVTControlCharacters(line))?.[1];
    if (!gutter || gutter.length >= width) return wrap(line, width);
    const prefix = sliceAnsi(line, 0, gutter.length);
    const code = sliceAnsi(line, gutter.length);
    const continuation = " ".repeat(gutter.length - 2) + "│ ";
    return wrap(code, width - gutter.length).split("\n")
      .map((part, index) => (index ? continuation : prefix) + part).join("\n");
  }).join("\n");
}

export function renderDiff(diff, width, signal) {
  const local = fileURLToPath(new URL(`../.local/tools/delta${process.platform === "win32" ? ".exe" : ""}`, import.meta.url));
  const binary = process.env.CODEOTTER_DELTA || (existsSync(local) ? local : "delta");
  const args = ["--no-gitconfig", "--paging=never", "--dark", "--true-color=never", "--line-numbers", "--keep-plus-minus-markers", "--line-fill-method=spaces", "--width", String(Math.max(1, width)), "--file-style", "130 bold", "--file-decoration-style", "130 ul", "--hunk-header-style", "130 line-number", "--hunk-header-decoration-style", "130 ul"];
  args.push("--line-numbers-left-format", "{nm:>4} ", "--line-numbers-right-format", "{np:>4} │ ");
  return new Promise((resolve, reject) => {
    const child = execFile(binary, args, { signal, windowsHide: true, timeout: 30000, maxBuffer: 24 * 1024 * 1024, env: { ...process.env, DELTA_FEATURES: "", NO_COLOR: "" } }, (error, stdout) => {
      if (error) return reject(new Error(error.code === "ENOENT" ? "Install git-delta (Windows: winget install dandavison.delta), or set CODEOTTER_DELTA to its executable." : `Diff renderer failed: ${error.message}`));
      resolve(fitDiffOutput(stdout, width));
    });
    child.stdin.on("error", () => {});
    // Repository contents never supply terminal control sequences to the renderer.
    child.stdin.end(text(diff));
  });
}
