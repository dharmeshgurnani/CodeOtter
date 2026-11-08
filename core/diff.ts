// Diff parsing, dynamic context, compression, hunks and blast radius.
import { execFileSync } from "node:child_process";
import { REPO_RE } from "./config.ts";
import { ghAsync, isForgeRepo } from "./git.ts";
import type { Finding } from "./engines.ts";

// A changed file as gh (and the forge adapters) list it on a pull request.
export interface ChangedFile { path: string; additions: number; deletions: number; }
export interface OutsideCaller { symbol: string; file: string; line: number; snippet: string; }
export interface OutsideImpact { symbols: string[]; callers: OutsideCaller[]; outsideCallers: number; uniqueFiles: number; formatted: string; }
export interface BlastRadius { score: number; files: number; lines: number; dirs: number; hotspots: string[]; testFiles: number; outsideCallers: number; outsideFiles: number; }
// parseDiff: a hunk header with its body lines, and a file as header lines and hunks in order.
export interface DiffHunk { old: number; oldN: number; new: number; newN: number; heading: string; lines: string[]; }
export interface ParsedDiffFile { file: string; parts: (string | DiffHunk)[]; }
export interface DiffContextStats { extended: number; added: number; trimmed: number; }
export interface CompressedDiff { diff: string; compressed: boolean; omitted: string[]; partial?: string[]; deleted: string[]; deletionHunks: number; }
// splitHunks: one hunk of one file, as CodeReviewer reads it.
export interface Hunk { file: string; header: string; diff: string; }

export const HOTSPOTS: [string, RegExp][] = [
  ["migrations", /(^|\/)migrations\//i],
  ["auth / security", /auth|acl|permission|middleware|secret|token/i],
  ["payments / money", /payment|invoice|billing|stripe|fee/i],
  ["public API routes", /(^|\/)(api|routes)\//i],
  ["core domain", /\bcore\//],
  ["dependencies", /package\.json|pnpm-lock\.yaml|yarn\.lock|package-lock\.json|go\.sum|Cargo\.lock/],
  ["CI / deploy", /\.github\/|railway\.json|Dockerfile|docker-compose|\.gitlab-ci/],
];

function extractChangedSymbols(diff: string): string[] {
  const symbols = new Set<string>();
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

export async function sliceOutsideDiffImpact(repo: string, diff: string, changedFiles: string[] = []): Promise<OutsideImpact> {
  const symbols = extractChangedSymbols(diff);
  // The working directory is CodeOtter, not a checkout of a remote Forgejo/Gitea PR.
  if (isForgeRepo(repo)) return { symbols, callers: [], outsideCallers: 0, uniqueFiles: 0, formatted: "" };
  if (!symbols.length) return { symbols: [], callers: [], outsideCallers: 0, uniqueFiles: 0, formatted: "" };

  const changedSet = new Set(changedFiles.map((f) => f.replace(/\\/g, "/")));
  const callers: OutsideCaller[] = [];
  const excludeArgs = changedFiles.flatMap((f) => [":!" + f, ":!" + f.replace(/\\/g, "/")]);

  // 1. Local git grep (instant, zero-network)
  for (const sym of symbols) {
    try {
      const raw = execFileSync("git", ["grep", "-n", "-w", sym, "--", ".", ...excludeArgs], {
        encoding: "utf8",
        timeout: 4000,
        maxBuffer: 4 << 20,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const lines = raw.split("\n").filter(Boolean);
      for (const line of lines.slice(0, 5)) {
        const parts = line.split(":");
        if (parts.length >= 3) {
          const file = parts[0].replace(/\\/g, "/");
          const lineNum = parseInt(parts[1], 10);
          const snippet = parts.slice(2).join(":").trim();
          if (!changedSet.has(file) && !/\.(lock|map|min\.js|svg|png|json)$/i.test(file)) {
            callers.push({ symbol: sym, file, line: lineNum, snippet: snippet.slice(0, 140) });
          }
        }
      }
    } catch {}
    if (callers.length >= 12) break;
  }

  // 2. Remote GitHub code search fallback if no local git hits
  if (callers.length === 0 && repo && REPO_RE.test(repo)) {
    for (const sym of symbols.slice(0, 3)) {
      try {
        const raw = await ghAsync("api", `search/code?q=repo:${repo}+${encodeURIComponent(sym)}&per_page=5`).catch(() => "");
        if (raw) {
          const data = JSON.parse(raw) as { items?: { path: string }[] };
          for (const item of data.items || []) {
            const f = item.path;
            if (!changedSet.has(f) && !/\.(lock|map|min\.js|svg|png|json)$/i.test(f)) {
              callers.push({ symbol: sym, file: f, line: 1, snippet: `reference to ${sym}` });
            }
          }
        }
      } catch {}
      if (callers.length >= 10) break;
    }
  }

  const uniqueFiles = new Set(callers.map((c) => c.file));
  let formatted = "";
  if (callers.length > 0) {
    formatted = `Outside-Diff Call Graph Context (Smart Context - ${callers.length} outside call-site(s) across ${uniqueFiles.size} un-modified file(s)):\n` +
      `The following files outside this pull request call or reference symbols modified in the diff. MANDATORY: Verify contract compatibility (parameter orders/types, return object structure, newly thrown/raised exceptions) to prevent silent production regressions:\n` +
      callers.map((c) => `- [${c.file}:${c.line}] calls '${c.symbol}': \`${c.snippet}\``).join("\n");
  }

  return { symbols, callers, outsideCallers: callers.length, uniqueFiles: uniqueFiles.size, formatted };
}

export function blastRadius(files: ChangedFile[], outsideCallers = 0, outsideFiles = 0): BlastRadius {
  const lines = files.reduce((n, f) => n + f.additions + f.deletions, 0);
  const dirs = new Set(files.map((f) => f.path.split("/").slice(0, 3).join("/")));
  const hot = HOTSPOTS.filter(([, re]) => files.some((f) => re.test(f.path))).map(([n]) => n);
  const tests = files.filter((f) => /test|spec|__tests__/.test(f.path)).length;
  // Upgraded with real outside-diff call-graph fan-out (Smart Context impact slicing)
  const callerImpact = Math.min(25, outsideCallers * 4 + outsideFiles * 2);
  const score = Math.min(100, Math.min(30, files.length * 2.5) + Math.min(25, lines / 30) + Math.min(25, hot.length * 10) + callerImpact);
  return { score: Math.round(score), files: files.length, lines, dirs: dirs.size, hotspots: hot, testFiles: tests, outsideCallers, outsideFiles };
}

// <dynamic-context>
// Git gives every hunk 3 fixed context lines on each side. A reviewer needs the enclosing declaration above a change and
// little below it, so code hunks are extended upward to the nearest declaration (at most `before` lines, read from the
// head file) and trailing context is cut to `after` lines. Lines already shown by the previous hunk are never repeated.
const DECL_RES = [
  /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\b\s*\*?\s*([\w$]*)\s*\(/,
  /^\s*(?:export\s+)?(?:const|let|var)\s+([\w$]+)\s*=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*(?::[^=]+)?=>|[\w$]+\s*=>)/,
  /^\s*(?:(?:export|default|public|private|protected|internal|static|abstract|final|sealed|partial|open|data|pub(?:\([^)]*\))?)\s+)*(?:class|interface|trait|struct|enum|impl|module|namespace|object|type)\s+([\w$:]+)/,
  /^\s*(?:(?:pub(?:\([^)]*\))?|async|unsafe|const|extern|private|public|internal|override|suspend|static|inline)\s+)*(?:fn|func|fun|def)\s+(?:\([^)]*\)\s*)?([\w$!?.]+)/,
  /^\s*(?:(?:public|private|protected|internal|static|async|override|virtual|abstract|final|readonly|get|set)\s+)*(?:[\w$<>[\],.?*&]+\s+)?([\w$]+)\s*\([^;]*\)\s*(?:[:-]>?\s*[^;{]+|throws\s+[\w., ]+)?\s*\{\s*$/,
];
const NOT_DECL = new Set(["if", "for", "while", "switch", "catch", "with", "return", "else", "do", "try", "new", "throw", "await", "elif", "unless", "until"]);
const NON_CODE_RE = /\.(md|markdown|txt|rst|json|lock|svg|png|jpe?g|gif|ico|pdf|csv|tsv|ya?ml|toml|ini|map|snap)$|\.min\.(js|css)$/i;
function declName(line: string | undefined): string | null {
  for (const re of DECL_RES) {
    const m = String(line ?? "").match(re);
    if (m && !NOT_DECL.has(m[1])) return m[1] || "function";
  }
  return null;
}
// Unified diff -> [{ file, parts: [line | { old, oldN, new, newN, heading, lines }] }], CRLF normalised.
export function parseDiff(diff: string): ParsedDiffFile[] {
  const files: ParsedDiffFile[] = [];
  let f: ParsedDiffFile | null = null;
  let h: DiffHunk | null = null;
  for (const line of String(diff || "").replace(/\r\n?/g, "\n").split("\n")) {
    if (line.startsWith("diff --git ")) { h = null; f = { file: (line.match(/ b\/(.+)$/) || [])[1] || "", parts: [line] }; files.push(f); continue; }
    if (!f) { f = { file: "", parts: [] }; files.push(f); }
    const m = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/);
    if (m) { h = { old: +m[1], oldN: +(m[2] ?? 1), new: +m[3], newN: +(m[4] ?? 1), heading: m[5], lines: [] }; f.parts.push(h); continue; }
    if (h && /^[ +\-\\]/.test(line)) { h.lines.push(line); continue; }
    h = null;
    if (line.startsWith("+++ ") && !line.endsWith("/dev/null")) f.file = line.slice(4).replace(/^b\//, "").trim();
    f.parts.push(line);
  }
  return files;
}
const leadHasDecl = (h: DiffHunk): boolean => {
  const first = h.lines.findIndex((l) => l[0] === "+" || l[0] === "-");
  return h.lines.slice(0, first < 0 ? h.lines.length : first).some((l) => declName(l.slice(1)));
};
// Files whose hunks would gain from upward extension: code, not new, and no declaration in the leading context.
export const dynamicContextFiles = (parsed: ParsedDiffFile[]): string[] => [...new Set(parsed
  .filter((f) => f.file && !NON_CODE_RE.test(f.file) && f.parts.some((p) => typeof p === "object" && p.new > 1 && p.oldN > 0 && !leadHasDecl(p)))
  .map((f) => f.file))];
// `sources` maps path -> head file text. Returns the rewritten diff and counts.
export function extendDiffContext(diff: string, sources: Map<string, string> = new Map(), { before = 16, after = 1 }: { before?: number; after?: number } = {}): { diff: string; stats: DiffContextStats } {
  const parsed = parseDiff(diff);
  const stats: DiffContextStats = { extended: 0, added: 0, trimmed: 0 };
  const out: string[] = [];
  for (const f of parsed) {
    const code = f.file && !NON_CODE_RE.test(f.file);
    const source = sources.get(f.file);
    const text = code && typeof source === "string" ? source.replace(/\r\n?/g, "\n").split("\n") : null;
    let lastShown = 0;
    for (const p of f.parts) {
      if (typeof p === "string") { out.push(p); continue; }
      let { lines, old, oldN, new: start, newN } = p;
      if (code && lines.some((l) => l[0] === "+" || l[0] === "-")) {
        let tail = 0;
        while (tail < lines.length && lines[lines.length - 1 - tail][0] === " ") tail++;
        if (tail > after) {
          const cut = tail - after;
          lines = lines.slice(0, lines.length - cut);
          oldN -= cut; newN -= cut; stats.trimmed += cut;
        }
        // Only extend when the hunk's first context line matches the fetched file, so a stale ref never invents lines.
        if (text && before > 0 && start > 1 && oldN > 0 && !leadHasDecl(p) && (lines[0]?.[0] !== " " || lines[0].slice(1) === text[start - 1])) {
          for (let j = start - 2; j >= Math.max(lastShown, start - 1 - before); j--) {
            if (!declName(text[j])) continue;
            const extra = text.slice(j, start - 1).map((l) => ` ${l}`);
            lines = [...extra, ...lines];
            old -= extra.length; oldN += extra.length; start -= extra.length; newN += extra.length;
            stats.extended++; stats.added += extra.length;
            break;
          }
        }
      }
      out.push(`@@ -${old},${oldN} +${start},${newN} @@${p.heading}`, ...lines);
      lastShown = start + newN - 1;
    }
  }
  return { diff: out.join("\n"), stats };
}
// </dynamic-context>

// <diff-compression>
// A diff over budget is not cut at a character count. Files are ranked (main language first, then other code, then
// docs and config, then lockfiles and generated output), largest first within a rank, and added whole until the budget
// runs out; a file too big to fit shows its leading hunks, and files that do not fit at all are still named. Only when over budget, hunks that only delete lines are dropped and
// deleted files are listed by name.
const GENERATED_RE = /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|Cargo\.lock|go\.sum|poetry\.lock|composer\.lock|Gemfile\.lock)$|\.(lock|min\.js|min\.css|map|snap)$|(^|\/)(dist|build|vendor|node_modules)\//i;
const extOf = (p: string): string => (p.match(/\.([\w]+)$/) || [])[1]?.toLowerCase() || "";
export function compressDiff(diff: string, maxChars: number): CompressedDiff {
  diff = String(diff || "");
  if (diff.length <= maxChars) return { diff, compressed: false, omitted: [], deleted: [], deletionHunks: 0 };
  const files = parseDiff(diff).filter((f) => f.parts.length);
  let deletionHunks = 0;
  const deleted: string[] = [];
  interface Entry { name: string; head: string; blocks: string[]; text: string; added: number; removed: number; }
  const entries: Entry[] = [];
  for (const f of files) {
    const name = f.file || (f.parts.find((p): p is string => typeof p === "string" && p.startsWith("--- a/")) || "").slice(6);
    const hunks = f.parts.filter((p): p is DiffHunk => typeof p === "object");
    if (f.parts.some((p) => typeof p === "string" && (p.startsWith("deleted file mode") || p === "+++ /dev/null"))) { deleted.push(name); continue; }
    const kept = hunks.filter((h) => h.lines.some((l) => l[0] === "+"));
    deletionHunks += hunks.length - kept.length;
    const head = f.parts.filter((p): p is string => typeof p === "string");
    if (hunks.length && !kept.length) { deleted.push(`${name} (lines removed only)`); continue; }
    const blocks = kept.map((h) => [`@@ -${h.old},${h.oldN} +${h.new},${h.newN} @@${h.heading}`, ...h.lines].join("\n").trimEnd());
    const text = [...head, ...blocks].join("\n").trimEnd();
    const added = kept.reduce((n, h) => n + h.lines.filter((l) => l[0] === "+").length, 0);
    entries.push({ name, head: head.join("\n"), blocks, text, added, removed: kept.reduce((n, h) => n + h.lines.filter((l) => l[0] === "-").length, 0) });
  }
  const weight = new Map<string, number>();
  for (const e of entries) if (!NON_CODE_RE.test(e.name) && !GENERATED_RE.test(e.name)) weight.set(extOf(e.name), (weight.get(extOf(e.name)) || 0) + e.added);
  const main = [...weight].sort((a, b) => b[1] - a[1])[0]?.[0];
  const rank = (e: Entry): number => GENERATED_RE.test(e.name) ? 3 : NON_CODE_RE.test(e.name) ? 2 : extOf(e.name) === main ? 0 : 1;
  entries.sort((a, b) => rank(a) - rank(b) || b.text.length - a.text.length);
  // Room for the trailing file lists, bounded so they never crowd out the code.
  const listRoom = Math.min(Math.floor(maxChars * 0.15), 120 + 60 * (entries.length + deleted.length));
  const budget = maxChars - listRoom;
  const shown: string[] = [];
  const omitted: Entry[] = [];
  let used = 0;
  const partial: string[] = [];
  for (const e of entries) {
    if (used + e.text.length + 1 <= budget) { shown.push(e.text); used += e.text.length + 1; continue; }
    // Too big to fit whole: its leading hunks, up to half the budget, so one file cannot take all of it.
    const room = Math.min(budget - used, Math.floor(budget / 2)) - e.head.length - 80;
    let part = "";
    let n = 0;
    while (n < e.blocks.length && part.length + e.blocks[n].length + 1 <= room) part += `\n${e.blocks[n++]}`;
    if (!n) { omitted.push(e); continue; }
    const text = `${e.head}${part}\n(${e.blocks.length - n} more hunk(s) in ${e.name} not shown)`;
    shown.push(text); used += text.length + 1; partial.push(e.name);
  }
  // A single hunk larger than the whole budget still shows its start rather than nothing.
  if (!shown.length && omitted.length) { const e = omitted.shift()!; shown.push(`${e.text.slice(0, budget)}\n(${e.name} cut at the diff budget)`); }
  let tail = "";
  if (deleted.length) tail += `\n\nDeleted files:\n${deleted.join("\n")}`;
  if (omitted.length) tail += `\n\nAlso changed, not shown (over the diff budget):\n${omitted.map((e) => `${e.name} +${e.added} -${e.removed}`).join("\n")}`;
  if (deletionHunks) tail += `\n\n${deletionHunks} hunk(s) that only remove lines are not shown.`;
  const out = `${shown.join("\n")}${tail.length > listRoom ? `${tail.slice(0, listRoom - 20)}\n(list cut)` : tail}`;
  return { diff: out.slice(0, maxChars), compressed: true, omitted: omitted.map((e) => e.name), partial, deleted, deletionHunks };
}
// </diff-compression>

// <accepted>
// A suggestion counts as accepted when its code (compared line by line, ignoring indentation and blank lines) is in the
// file at the new head and was not at the previously reviewed commit. Both file versions are required.
const codeKey = (s: string | undefined): string => String(s || "").replace(/\r\n?/g, "\n").split("\n").map((l) => l.trim()).filter(Boolean).join("\n");
export function acceptedSuggestions(findings: Finding[] | null | undefined, before: Map<string, string>, after: Map<string, string>): string[] {
  return (findings || [])
    .filter((f) => f?.file && !f.dismissed && codeKey(f.suggestion).length >= 12)
    .filter((f) => {
      const a = after.get(f.file);
      const b = before.get(f.file);
      return typeof a === "string" && typeof b === "string" && codeKey(a).includes(codeKey(f.suggestion)) && !codeKey(b).includes(codeKey(f.suggestion));
    })
    .map((f) => `[${f.file}] ${String(f.title || "").trim()}`.slice(0, 300));
}
// </accepted>

// Unified diff -> [{ file, header, diff }] hunks, largest first, capped. CodeReviewer reads one hunk at a time (512 tokens).
export function splitHunks(diff: string, maxHunks = 40, maxChars = 2000): Hunk[] {
  const out: Hunk[] = [];
  let file = "";
  let cur: Hunk | null = null;
  const push = () => { if (cur && cur.diff.trim()) out.push(cur); cur = null; };
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git")) { push(); file = (line.match(/ b\/(.+)$/) || [])[1] || file; continue; }
    if (line.startsWith("+++ ")) { const target = line.slice(4).replace(/^b\//, ""); if (target !== "/dev/null") file = target || file; continue; }
    if (line.startsWith("--- ") || line.startsWith("index ") || line.startsWith("new file") || line.startsWith("deleted file") || line.startsWith("similarity") || line.startsWith("rename ")) continue;
    if (line.startsWith("@@")) { push(); cur = { file, header: line, diff: "" }; continue; }
    if (cur && cur.diff.length < maxChars) cur.diff += line + "\n";
  }
  push();
  return out.filter((h) => !/\.(lock|min\.js|map|snap)$/.test(h.file)).sort((a, b) => b.diff.length - a.diff.length).slice(0, maxHunks);
}
