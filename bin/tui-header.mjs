import blessed from "blessed";
import { readFileSync } from "node:fs";
import { text } from "./review-output.mjs";
import { attachTerminalIcon } from "./terminal-icon.mjs";
import { PRIMARY, applyBrandColor } from "./tui-theme.mjs";

const version = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
export const HEADER_HEIGHT = 7;

// Blessed's Unicode tables predate the otter emoji. Reserve both display cells
// in content layout and cursor output, otherwise the entire title row drifts.
if (blessed.unicode.charWidth("🦦") !== 2) {
  const charWidth = blessed.unicode.charWidth;
  blessed.unicode.charWidth = (value, index = 0) =>
    (typeof value === "number" ? value : value.codePointAt(index)) === 0x1f9a6 ? 2 : charWidth(value, index);
  blessed.unicode.chars.all = new RegExp(`(${blessed.unicode.chars.all.source}|🦦)`, "g");
}

// Standard terminal colors keep metadata readable on Windows' 16-color palette.
// The favicon occupies three rows; unsupported terminals retain the native emoji.
export function createTuiHeader(screen, mode = "repositories") {
  applyBrandColor(screen);
  const local = mode === "local";
  const height = local ? 7 : 6;
  const header = blessed.box({ parent: screen, top: 0, height });
  const label = (options) => blessed.box({ parent: header, height: 1, wrap: false, style: { fg: "white" }, ...options });
  const icon = label({ top: 0, left: 2, width: 6, height: 3, align: "center", content: "🦦" });
  attachTerminalIcon(screen, icon);
  const identity = blessed.box({ parent: header, top: 0, left: 10, right: 2, height: 3 });
  label({ parent: identity, top: 0, left: 0, width: 24, tags: true, content: `{bold}CodeOtter{/bold}  v${version}` });
  const status = label({ top: 0, left: 36, right: 2, align: "right" });
  const context = label({ parent: identity, top: 1, left: 0, right: 0 });
  const key = (name, action) => `{${PRIMARY}-fg}{bold}${name}{/bold}{/${PRIMARY}-fg} ${action}`;
  label({ top: 3, left: 2, right: 2, tags: true, content: local
    ? [key("r", "Review"), key("s", "Source"), key("a", "Ask"), key("t", "Tools"), key("?", "Help")].join("  ")
    : [key("r", "Review"), key("g", "Refresh"), key("Esc", "Stop"), key("q/Ctrl+C", "Quit")].join("  ") });
  label({ top: 4, left: 2, right: 2, content: `${local ? "Tab Focus" : "Tab/Shift+Tab Focus"} · ↑↓ Move · Enter Select · PgUp/PgDn Scroll` });
  if (local) label({ top: 5, left: 2, right: 2, tags: true, content: [key("m", "Settings"), key("e", "Export"), key("Esc", "Cancel"), key("q", "Quit")].join("  ") });
  const divider = label({ top: height - 1, left: 1, right: 1 });
  return {
    get height() { return height; },
    update(contextLabel, statusLabel = "") {
      context.setContent(text(contextLabel));
      status.setContent(text(statusLabel));
      status.style.fg = /error|failed|could not/i.test(statusLabel) ? "red" : /working|calculating|reading/i.test(statusLabel) ? PRIMARY : "white";
      divider.setContent("─".repeat(Math.max(0, screen.width - 2)));
    },
  };
}
