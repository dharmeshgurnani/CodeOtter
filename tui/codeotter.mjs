#!/usr/bin/env node
// 🦦 CodeOtter CLI — Autonomous Dual-Engine AI Code Review, Scoring Gauges & Pre-Merge Gate Enforcement.
// Reviews run through core/server.mjs (same engines and rules as the web app). Blessed is lazy-loaded only for the TUI.

import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, realpathSync } from "node:fs";
import { join } from "node:path";
import readline from "node:readline";
import { pathToFileURL } from "node:url";
import { text } from "./review-output.mjs";

// An explicit installation must not inherit another checkout's .env credentials.
const envFiles = process.env.CODEOTTER_HOME
  ? [join(process.env.CODEOTTER_HOME, ".env")]
  : [join(process.cwd(), ".env"), join(import.meta.dirname, "..", ".env")];
for (const envFile of envFiles) {
  if (existsSync(envFile) && typeof process.loadEnvFile === "function") {
    try { process.loadEnvFile(envFile); } catch {}
  }
}

const VERSION = JSON.parse(readFileSync(join(import.meta.dirname, "..", "package.json"), "utf8")).version;

// --- ANSI Colors & Formatting Helpers ---
const isTTY = process.stdout.isTTY && !process.env.NO_COLOR;
const c = {
  reset: isTTY ? "\x1b[0m" : "",
  bold: isTTY ? "\x1b[1m" : "",
  dim: isTTY ? "\x1b[2m" : "",
  underline: isTTY ? "\x1b[4m" : "",
  red: isTTY ? "\x1b[31m" : "",
  green: isTTY ? "\x1b[32m" : "",
  yellow: isTTY ? "\x1b[33m" : "",
  blue: isTTY ? "\x1b[34m" : "",
  magenta: isTTY ? "\x1b[35m" : "",
  cyan: isTTY ? "\x1b[36m" : "",
  white: isTTY ? "\x1b[37m" : "",
  bgRed: isTTY ? "\x1b[41m" : "",
  bgGreen: isTTY ? "\x1b[42m" : "",
  bgYellow: isTTY ? "\x1b[43m" : "",
  bgBlue: isTTY ? "\x1b[44m" : "",
  gray: isTTY ? "\x1b[90m" : "",
};

function scoreColor(score, isRisk = false) {
  const s = Number(score) || 0;
  if (isRisk) {
    if (s <= 30) return c.green;
    if (s <= 60) return c.yellow;
    return c.red;
  }
  if (s >= 75) return c.green;
  if (s >= 50) return c.yellow;
  return c.red;
}

function renderGauge(score, max = 100, width = 16, isRisk = false) {
  const s = Math.max(0, Math.min(max, Number(score) || 0));
  const filled = Math.round((s / max) * width);
  const empty = width - filled;
  const bar = "█".repeat(filled) + "░".repeat(empty);
  const color = scoreColor(s, isRisk);
  return `${color}${bar}${c.reset} ${c.bold}${String(s).padStart(3)}/100${c.reset}`;
}

const S1_SCORES = {
  quality: ["Broken or wrong", "Works but sloppy", "Acceptable", "Clean and idiomatic", "Exemplary"],
  correctness_risk: ["No realistic way to break anything", "Low risk", "Moderate risk of regressions", "High risk of regressions", "Very likely to break production"],
  test_coverage: ["No tests for the change", "Minimal tests", "Partial coverage", "Good coverage", "Thorough coverage"],
  readability: ["Hard to follow", "Below average", "Readable", "Clear", "Very clear"],
  pr_hygiene: ["Unclear title and description, mixed concerns", "Weak description or scope", "Adequate", "Well described and focused", "Exemplary title, description and scope"],
  blast_radius: ["Isolated change with no downstream effect", "Small local impact", "Moderate impact on nearby modules", "Wide impact across several areas", "System-wide or critical-path impact"],
};

const S1_GATES = [
  { id: "title", label: "Title check", q: "The pull request title accurately describes the change.", risk: false },
  { id: "description", label: "Description check", q: "The pull request description explains what changed and why.", risk: false },
  { id: "security", label: "Security", q: "The change introduces a security risk (injection, auth bypass, secrets, unsafe deserialisation, SSRF, XSS).", risk: true },
  { id: "complexity", label: "Complexity", q: "The change is more complex than the problem requires.", risk: true },
  { id: "tests", label: "Tests", q: "The change is adequately covered by tests for its risk.", risk: false },
  { id: "docs", label: "Documentation", q: "Documentation is updated wherever behaviour visible to users or developers changed.", risk: false },
  { id: "scope", label: "Scope", q: "The pull request does one focused thing.", risk: false },
  { id: "guidelines", label: "Repository guidelines", q: "The change violates the repository's review guidelines.", risk: true, needsGuide: true },
];

const HOTSPOTS = [
  ["auth", /auth|login|session|jwt|oauth|permission|credential|password/i],
  ["crypto", /crypto|cipher|secret|token|signing|hash/i],
  ["payment", /billing|stripe|payment|invoice|checkout|price/i],
  ["migration", /migration|schema|db\/migrate|alembic|prisma\/schema/i],
  ["security", /sanitize|csrf|cors|policy|rate[-_]?limit|firewall/i],
  ["infra", /docker|k8s|kubernetes|terraform|helm|workflow|\.github\//i],
  ["lockfile", /package-lock\.json|pnpm-lock\.yaml|yarn\.lock|Cargo\.lock|Gemfile\.lock/i],
];

// --- Git & Diff Utilities ---
function isGitRepo() {
  try {
    execFileSync("git", ["rev-parse", "--is-inside-work-tree"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function getRepoRoot() {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch {
    return process.cwd();
  }
}

function getLocalGuidelines(repoRoot = getRepoRoot()) {
  const guides = [];
  for (const filename of ["AGENTS.md", "CLAUDE.md"]) {
    const fullPath = join(repoRoot, filename);
    if (existsSync(fullPath)) {
      try {
        const content = readFileSync(fullPath, "utf8").trim();
        if (content) guides.push(`--- ${filename} ---\n${content}`);
      } catch {}
    }
  }
  return guides.length ? guides.join("\n\n") : null;
}

function getGitDiff(options = {}) {
  const args = ["diff", "--no-color", "--no-ext-diff", "--no-textconv"];
  if (options.staged) {
    args.push("--cached");
  } else if (options.base) {
    const base = execFileSync("git", ["rev-parse", "--verify", "--end-of-options", `${options.base}^{commit}`], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    args.push(`${base}...HEAD`);
  }
  if (options.files && options.files.length) {
    args.push("--", ...options.files);
  }
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 10 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
}

function parseDiff(diffText) {
  const files = [];
  let currentFile = null;
  const lines = diffText.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("diff --git ")) {
      const match = line.match(/diff --git a\/(.+?) b\/(.+)/);
      if (match) {
        currentFile = { path: match[2], additions: 0, deletions: 0 };
        files.push(currentFile);
      }
    } else if (currentFile) {
      if (line.startsWith("+++ ") || line.startsWith("--- ")) {
        continue;
      }
      if (line.startsWith("+")) {
        currentFile.additions++;
      } else if (line.startsWith("-")) {
        currentFile.deletions++;
      }
    }
  }
  return files;
}

function computeBlastRadius(files, outsideCallers = 0, outsideFiles = 0) {
  const lines = files.reduce((n, f) => n + f.additions + f.deletions, 0);
  const dirs = new Set(files.map((f) => f.path.split("/").slice(0, 3).join("/")));
  const hot = HOTSPOTS.filter(([, re]) => files.some((f) => re.test(f.path))).map(([n]) => n);
  const tests = files.filter((f) => /test|spec|__tests__/.test(f.path)).length;
  return {
    files: files.length,
    lines,
    dirs: dirs.size,
    hotspots: hot,
    testFiles: tests,
    outsideCallers,
    outsideFiles,
  };
}

// Smart Context: Extract exported symbols and trace callers outside diff
function extractSymbolsFromDiff(diffText) {
  const symbols = new Set();
  const exportPattern = /(?:export\s+(?:async\s+)?function\s+([a-zA-Z0-9_$]+)|export\s+(?:const|let|var)\s+([a-zA-Z0-9_$]+)|export\s+class\s+([a-zA-Z0-9_$]+)|export\s+type\s+([a-zA-Z0-9_$]+)|export\s+interface\s+([a-zA-Z0-9_$]+)|def\s+([a-zA-Z0-9_]+)|class\s+([a-zA-Z0-9_]+)|func\s+(?:\([^\)]+\)\s+)?([a-zA-Z0-9_]+))/g;
  let m;
  while ((m = exportPattern.exec(diffText)) !== null) {
    const name = m[1] || m[2] || m[3] || m[4] || m[5] || m[6] || m[7] || m[8];
    if (name && name.length > 2 && !["default", "export", "async", "const", "class"].includes(name)) {
      symbols.add(name);
    }
  }
  return Array.from(symbols).slice(0, 15);
}

function findOutsideImpact(symbols, modifiedFiles, repoRoot = getRepoRoot()) {
  if (!symbols.length || !isGitRepo()) return { outsideCallers: 0, uniqueFiles: 0, callers: [] };
  const callers = [];
  const modifiedSet = new Set(modifiedFiles.map((f) => f.path.replace(/\\/g, "/")));

  for (const sym of symbols) {
    try {
      const grepOut = execFileSync("git", ["grep", "-n", "-w", sym], { cwd: repoRoot, encoding: "utf8", maxBuffer: 1024 * 1024 });
      for (const line of grepOut.split("\n")) {
        if (!line.trim()) continue;
        const [file, lineNum, ...codeParts] = line.split(":");
        const normFile = (file || "").replace(/\\/g, "/");
        if (normFile && !modifiedSet.has(normFile) && !/test|spec|__tests__/.test(normFile)) {
          callers.push({ file: normFile, line: lineNum, symbol: sym, code: codeParts.join(":").trim() });
          if (callers.length >= 20) break;
        }
      }
    } catch {}
    if (callers.length >= 20) break;
  }

  const uniqueFiles = new Set(callers.map((c) => c.file)).size;
  return { outsideCallers: callers.length, uniqueFiles, callers };
}

// --- LLM Model & Provider Dispatcher ---
function resolveProvider(flags = {}) {
  if (flags.provider) return flags.provider;
  if (flags.model?.includes("claude") || process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (flags.model?.includes("gpt") || process.env.OPENAI_API_KEY) return "openai";
  if (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY) return "gemini";
  if (process.env.MINIMAX_API_KEY) return "minimax";
  if (process.env.OPENROUTER_API_KEY) return "openrouter";
  if (process.env.GROQ_API_KEY) return "groq";
  if (process.env.DEEPSEEK_API_KEY) return "deepseek";
  return "ollama";
}

function resolveModelConfig(flags = {}) {
  const provider = resolveProvider(flags);
  let baseUrl = flags.baseUrl || "";
  let apiKey = flags.key || "";
  let model = flags.model || "";

  switch (provider) {
    case "anthropic":
      baseUrl = baseUrl || "https://api.anthropic.com";
      apiKey = apiKey || process.env.ANTHROPIC_API_KEY || "";
      model = model || "claude-3-5-sonnet-latest";
      break;
    case "openai":
      baseUrl = baseUrl || "https://api.openai.com/v1";
      apiKey = apiKey || process.env.OPENAI_API_KEY || "";
      model = model || "gpt-4o";
      break;
    case "gemini":
      baseUrl = baseUrl || "https://generativelanguage.googleapis.com/v1beta/openai";
      apiKey = apiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
      model = model || "gemini-2.5-flash";
      break;
    case "openrouter":
      baseUrl = baseUrl || "https://openrouter.ai/api/v1";
      apiKey = apiKey || process.env.OPENROUTER_API_KEY || "";
      model = model || "anthropic/claude-3.5-sonnet";
      break;
    case "minimax":
      baseUrl = baseUrl || "https://api.minimax.io/v1";
      apiKey = apiKey || process.env.MINIMAX_API_KEY || "";
      model = model || "MiniMax-M2.5";
      break;
    case "groq":
      baseUrl = baseUrl || "https://api.groq.com/openai/v1";
      apiKey = apiKey || process.env.GROQ_API_KEY || "";
      model = model || "llama-3.3-70b-versatile";
      break;
    case "deepseek":
      baseUrl = baseUrl || "https://api.deepseek.com/v1";
      apiKey = apiKey || process.env.DEEPSEEK_API_KEY || "";
      model = model || "deepseek-chat";
      break;
    case "ollama":
      baseUrl = baseUrl || process.env.OLLAMA_HOST || "http://localhost:11434/v1";
      apiKey = apiKey || "ollama";
      model = model || "qwen2.5-coder:latest";
      break;
    default:
      baseUrl = baseUrl || "http://localhost:11434/v1";
      apiKey = apiKey || "";
      model = model || "default";
      break;
  }

  return { provider, baseUrl, apiKey, model };
}

async function requestLlm(prompt, config, signal) {
  const { provider, baseUrl, apiKey, model } = config;

  try {
    if (provider === "anthropic") {
      const url = `${baseUrl.replace(/\/+$/, "")}/v1/messages`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens: 16000,
          messages: [{ role: "user", content: prompt }],
        }),
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(180000)]) : AbortSignal.timeout(180000),
      });
      if (!res.ok) throw new Error(`Anthropic error (${res.status}): ${(await res.text()).slice(0, 300)}`);
      const data = await res.json();
      return data.content?.filter((b) => b.type === "text").map((b) => b.text).join("") || "";
    }

    // OpenAI-compatible Chat Completions
    const url = `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
    const headers = { "content-type": "application/json" };
    if (apiKey && apiKey !== "ollama") headers.authorization = `Bearer ${apiKey}`;

    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.1,
      }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(180000)]) : AbortSignal.timeout(180000),
    });

    if (!res.ok) throw new Error(`${provider} error (${res.status}): ${(await res.text()).slice(0, 300)}`);
    const data = await res.json();
    return data.choices?.[0]?.message?.content || "";
  } catch (err) {
    if (err.cause?.code === "ECONNREFUSED" || err.message?.includes("fetch failed")) {
      throw new Error(
        `Cannot connect to model provider '${provider}' at ${baseUrl}.\n` +
        `  • Provide an API key via environment variable (e.g. OPENAI_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY)\n` +
        `  • Or specify flags: --provider <name> --model <model> --key <api_key>\n` +
        `  • Or start a local Ollama instance on http://localhost:11434`
      );
    }
    throw err;
  }
}

// --- Review Engine: the server's engines, so System One owns scores and gates when it is configured ---
const SEVERITY = { high: "critical", medium: "warning", low: "suggestion", nit: "note" };
async function runReview(diff, options = {}) {
  const { files = parseDiff(diff), title = "Local Workspace Review", body = "", guide = getLocalGuidelines() } = options;
  // Explicit flags pick the language model; otherwise the installation's configured engines are used.
  const explicit = options.provider || options.model || options.baseUrl || options.key;
  const { reviewDiff } = await import("../core/server.mjs");
  const r = await reviewDiff({ title, body, diff, files, guide, llm: explicit ? resolveModelConfig(options) : null, signal: options.signal || null });
  const symbols = extractSymbolsFromDiff(diff);
  const outsideImpact = findOutsideImpact(symbols, files);
  return {
    ...r,
    blast: { ...r.blast, outsideCallers: outsideImpact.outsideCallers, outsideFiles: outsideImpact.uniqueFiles },
    outsideImpact,
    gates: r.gates.map((g) => ({ id: g.id, label: g.label, pass: !!g.pass, explanation: g.explanation || (typeof g.yes === "number" ? `${Math.round(g.yes * 100)}% yes` : "") })),
    findings: r.findings.map((f) => ({
      file: text(f.file), line: Number.isInteger(f.line) && f.line > 0 ? f.line : null,
      severity: SEVERITY[f.severity] || (["critical", "warning", "suggestion", "note"].includes(f.severity) ? f.severity : "note"),
      title: text(f.title), detail: text(f.detail), suggestion: text(f.suggestion),
    })),
  };
}

// --- Terminal UI Formatter ---
function renderScorecard(result) {
  const { scores, blast, gates, summary, walkthrough, findings } = result;

  console.log(`\n${c.bold}${c.cyan}🦦 CodeOtter Review${c.reset}\n`);

  // Scores Table
  console.log(`${c.bold}┌─ Quality & Risk Scores ─────────────────────────────┐${c.reset}`);
  console.log(`│ Quality Score:       ${renderGauge(scores.quality)} │`);
  console.log(`│ Blast Radius:        ${renderGauge(blast.score, 100, 16, true)} │`);
  console.log(`│ Correctness Risk:    ${renderGauge(scores.correctness_risk, 100, 16, true)} │`);
  console.log(`│ Test Coverage:       ${renderGauge(scores.test_coverage)} │`);
  console.log(`│ Readability:         ${renderGauge(scores.readability)} │`);
  console.log(`│ PR Hygiene:          ${renderGauge(scores.pr_hygiene)} │`);
  console.log(`${c.bold}└─────────────────────────────────────────────────────┘${c.reset}\n`);

  // Pre-Merge Gates
  if (gates && gates.length) {
    console.log(`${c.bold}🛡️  Pre-Merge Safety Gates:${c.reset}`);
    for (const g of gates) {
      const icon = g.pass ? `${c.green}✅ PASSED${c.reset}` : `${c.red}❌ FAILED${c.reset}`;
      console.log(`  ${icon}  ${c.bold}${g.label.padEnd(22)}${c.reset} ${c.dim}${g.explanation || ""}${c.reset}`);
    }
    console.log();
  }

  // Summary
  if (summary) {
    console.log(`${c.bold}📝 Summary:${c.reset}`);
    console.log(`  ${summary}\n`);
  }

  // Walkthrough
  if (walkthrough && walkthrough.length) {
    console.log(`${c.bold}📂 File Walkthrough (${walkthrough.length} files):${c.reset}`);
    for (const w of walkthrough) {
      console.log(`  • ${c.cyan}${w.file}${c.reset}: ${c.dim}${w.change}${c.reset}`);
    }
    console.log();
  }

  // Findings
  if (findings && findings.length) {
    console.log(`${c.bold}🔍 Review Findings (${findings.length}):${c.reset}\n`);
    for (const f of findings) {
      const sevColors = {
        critical: `${c.bgRed}${c.white}${c.bold} CRITICAL ${c.reset}`,
        warning: `${c.bgYellow}${c.white}${c.bold} WARNING ${c.reset}`,
        suggestion: `${c.bgBlue}${c.white}${c.bold} SUGGESTION ${c.reset}`,
        note: `${c.gray}${c.bold} NOTE ${c.reset}`,
      };
      const badge = sevColors[f.severity] || sevColors.note;
      const loc = f.file ? `${c.underline}${f.file}${f.line ? `:${f.line}` : ""}${c.reset}` : "";

      console.log(`  ${badge} ${c.bold}${f.title}${c.reset} ${c.dim}(${loc})${c.reset}`);
      if (f.detail) console.log(`  ${c.dim}${f.detail}${c.reset}`);
      if (f.suggestion) {
        console.log(`\n  ${c.green}+ Suggested fix:${c.reset}`);
        console.log(f.suggestion.split("\n").map((l) => `    ${c.green}${l}${c.reset}`).join("\n"));
      }
      console.log();
    }
  } else {
    console.log(`${c.green}✨ No defects or risks found in this diff! Clean changes.${c.reset}\n`);
  }
}

// --- GitHub/Forge PR Comment Formatter ---
function formatMarkdownComment(result, prUrl = "") {
  const { scores, blast, gates, summary, walkthrough, findings } = result;
  const lines = [
    `<!-- codeotter:scores -->`,
    `### 🦦 CodeOtter — AI Review & Scorecard`,
    "",
    `| Metric | Score | Assessment |`,
    `| :--- | :---: | :--- |`,
    `| **Quality** | **${scores.quality}** / 100 | ${S1_SCORES.quality[Math.min(4, Math.round(scores.quality / 25))]} |`,
    `| **Blast Radius** | **${blast.score}** / 100 | ${S1_SCORES.blast_radius[Math.min(4, Math.round(blast.score / 25))]} |`,
    `| **Correctness Risk** | **${scores.correctness_risk}** / 100 | ${S1_SCORES.correctness_risk[Math.min(4, Math.round(scores.correctness_risk / 25))]} |`,
    `| **Test Coverage** | **${scores.test_coverage}** / 100 | ${S1_SCORES.test_coverage[Math.min(4, Math.round(scores.test_coverage / 25))]} |`,
    `| **Readability** | **${scores.readability}** / 100 | ${S1_SCORES.readability[Math.min(4, Math.round(scores.readability / 25))]} |`,
    `| **PR Hygiene** | **${scores.pr_hygiene}** / 100 | ${S1_SCORES.pr_hygiene[Math.min(4, Math.round(scores.pr_hygiene / 25))]} |`,
    "",
  ];

  if (gates && gates.length) {
    lines.push("#### 🛡️ Pre-Merge Gate Status", "| Gate | Status | Details |", "| :--- | :---: | :--- |");
    for (const g of gates) {
      lines.push(`| **${g.label}** | ${g.pass ? "✅ Passed" : "❌ Failed"} | ${g.explanation || ""} |`);
    }
    lines.push("");
  }

  if (summary) {
    lines.push("#### 📝 Summary", summary, "");
  }

  if (findings && findings.length) {
    lines.push(`#### 🔍 Key Findings (${findings.length})`);
    for (const f of findings) {
      lines.push(`- **[${(f.severity || "note").toUpperCase()}]** \`${f.file}${f.line ? `:${f.line}` : ""}\`: **${f.title}**`);
      if (f.detail) lines.push(`  ${f.detail}`);
      if (f.suggestion) {
        lines.push("  ```suggestion", f.suggestion, "  ```");
      }
    }
    lines.push("");
  }

  lines.push("---", "*Generated autonomously by [CodeOtter](https://github.com/dharmeshgurnani/CodeOtter)*");
  return lines.join("\n");
}

// --- MCP (Model Context Protocol) Server Mode ---
function startMcpServer() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });

  function send(response) {
    process.stdout.write(JSON.stringify(response) + "\n");
  }

  rl.on("line", async (line) => {
    if (!line.trim()) return;
    let req;
    try {
      req = JSON.parse(line);
    } catch {
      return;
    }

    const { id, method, params } = req;

    if (method === "initialize") {
      return send({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "codeotter-mcp", version: VERSION },
        },
      });
    }

    if (method === "tools/list") {
      return send({
        jsonrpc: "2.0",
        id,
        result: {
          tools: [
            {
              name: "codeotter_review_diff",
              description: "Review a git diff or pull request with CodeOtter's engines: System One scores and gates when configured, language-model findings with a self-check.",
              inputSchema: {
                type: "object",
                properties: {
                  diff: { type: "string", description: "Git diff content" },
                  title: { type: "string", description: "PR or change title" },
                  body: { type: "string", description: "PR or change description" },
                },
                required: ["diff"],
              },
            },
            {
              name: "codeotter_get_gates",
              description: "List the standard CodeOtter pre-merge gates and scoring rubrics.",
              inputSchema: { type: "object", properties: {} },
            },
          ],
        },
      });
    }

    if (method === "tools/call") {
      const { name, arguments: args } = params || {};
      if (name === "codeotter_review_diff") {
        try {
          const res = await runReview(args.diff, { title: args.title, body: args.body });
          return send({
            jsonrpc: "2.0",
            id,
            result: { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] },
          });
        } catch (err) {
          return send({ jsonrpc: "2.0", id, error: { code: -32603, message: err.message } });
        }
      }
      if (name === "codeotter_get_gates") {
        return send({
          jsonrpc: "2.0",
          id,
          result: { content: [{ type: "text", text: JSON.stringify({ gates: S1_GATES, rubrics: S1_SCORES }, null, 2) }] },
        });
      }
    }

    // Default Ping or unsupported notification
    if (id !== undefined) {
      send({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } });
    }
  });
}

// --- CLI Entry Point & Flag Parser ---
function printHelp() {
  console.log(`
${c.bold}${c.cyan}🦦 CodeOtter CLI${c.reset} v${VERSION}
Autonomous Dual-Engine AI Code Review, Scoring Gauges & Pre-Merge Gate Enforcement.

${c.bold}USAGE:${c.reset}
  codeotter [command] [options]

${c.bold}COMMANDS:${c.reset}
  tui                 Connected repositories, scores and summaries (terminal default)
  review              Review local git diff (default outside a terminal)
  pr <url-or-number>  Review and score a GitHub / Forgejo / Gitea Pull Request
  ci                  Run automated CI gate checks with merge blocker exit codes
  mcp                 Start Model Context Protocol (MCP) server over stdio
  help                Show this help message

${c.bold}OPTIONS:${c.reset}
  --local            Use the standalone local-diff TUI instead
  -s, --staged        Review staged git changes (git diff --cached)
  -b, --base <branch> Review changes compared against base branch (e.g. main, master)
  --diff <file>       Read diff from file or standard input (-)
  --files <paths...>  Limit review to specific files
  --model <name>      Override model (e.g. gpt-4o, claude-3-5-sonnet, qwen2.5-coder)
  --provider <name>   Override provider (anthropic, openai, gemini, ollama, groq, etc.)
  --base-url <url>    Override the model API endpoint
  --key <api-key>     Override the provider API key (or use its environment variable)
  --fail-on-gate      Exit with code 1 if any pre-merge gate fails (CI mode)
  --min-score <n>     Exit with code 1 if Quality score is less than <n> (default: 60)
  --post-comment      Post / update review scorecard comment on the Pull Request
  --json              Output raw JSON review payload
  -v, --version       Show version
  -h, --help          Show this help message
`);
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("-h") || argv.includes("--help") || argv[0] === "help") {
    printHelp();
    return;
  }
  if (argv.includes("-v") || argv.includes("--version")) {
    console.log(`codeotter v${VERSION}`);
    return;
  }

  const command = argv[0] && !argv[0].startsWith("-") ? argv[0] : "review";
  const flags = {
    local: argv.includes("--local"),
    staged: argv.includes("-s") || argv.includes("--staged"),
    base: argv.includes("-b") ? argv[argv.indexOf("-b") + 1] : argv.includes("--base") ? argv[argv.indexOf("--base") + 1] : null,
    model: argv.includes("--model") ? argv[argv.indexOf("--model") + 1] : null,
    provider: argv.includes("--provider") ? argv[argv.indexOf("--provider") + 1] : null,
    key: argv.includes("--key") ? argv[argv.indexOf("--key") + 1] : null,
    baseUrl: argv.includes("--base-url") ? argv[argv.indexOf("--base-url") + 1] : null,
    failOnGate: argv.includes("--fail-on-gate"),
    minScore: argv.includes("--min-score") ? Number(argv[argv.indexOf("--min-score") + 1]) : 60,
    postComment: argv.includes("--post-comment"),
    json: argv.includes("--json"),
    diffFile: argv.includes("--diff") ? argv[argv.indexOf("--diff") + 1] : null,
  };

  if (command === "tui" || (!argv.length && process.stdin.isTTY && process.stdout.isTTY)) {
    if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("The TUI requires an interactive terminal. Use review --json for automation.");
    if (flags.diffFile === "-") throw new Error("Use --diff <file> in the TUI; stdin is reserved for keyboard input.");
    const { startTui } = await import("./tui.mjs");
    await startTui(flags);
    // A local review may still have model requests in flight when the user quits.
    // Exit hooks terminate owned model runtimes; shared PocketBase stays running.
    if (!flags.local) process.exit(0);
    return;
  }

  if (command === "mcp") {
    startMcpServer();
    return;
  }

  if (command === "review" || command === "ci" || command === "diff") {
    let diff = "";
    if (flags.diffFile) {
      diff = flags.diffFile === "-" ? readFileSync(0, "utf8") : readFileSync(flags.diffFile, "utf8");
    } else {
      if (!isGitRepo()) {
        console.error(`${c.red}Error: Not a git repository. Run inside a git repo or supply diff via --diff <file>.${c.reset}`);
        process.exit(1);
      }
      diff = getGitDiff({ staged: flags.staged, base: flags.base });
    }

    if (!diff.trim()) {
      console.log(`${c.yellow}No changes detected in diff.${c.reset} Try ${c.bold}codeotter --staged${c.reset} or ${c.bold}codeotter --base main${c.reset}`);
      return;
    }

    if (!flags.json) {
      const modeDesc = flags.staged ? "staged changes" : flags.base ? `changes against ${flags.base}` : "working tree changes";
      console.log(`${c.dim}🦦 Analyzing ${modeDesc}...${c.reset}`);
    }

    try {
      const result = await runReview(diff, { ...flags, title: `Workspace Changes (${flags.staged ? "staged" : "unstaged"})` });

      if (flags.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        renderScorecard(result);
      }

      // CI gate enforcement
      if (flags.failOnGate || command === "ci") {
        const failedGates = result.gates.filter((g) => !g.pass);
        const lowScore = result.scores.quality < flags.minScore;

        if (failedGates.length > 0 || lowScore) {
          if (!flags.json) {
            console.error(`${c.red}${c.bold}❌ CI Merge Gate Check Failed:${c.reset}`);
            if (lowScore) console.error(`  • Quality score (${result.scores.quality}) is below minimum threshold (${flags.minScore})`);
            for (const g of failedGates) console.error(`  • Gate failed: ${g.label} (${g.explanation})`);
          }
          process.exitCode = 1;
          return;
        }
      }
    } catch (err) {
      console.error(`${c.red}Review failed: ${err.message}${c.reset}`);
      process.exit(1);
    }
    return;
  }

  if (command === "pr") {
    const prRef = argv[1];
    if (!prRef) {
      console.error(`${c.red}Error: Please specify a PR URL or PR number. Example: codeotter pr 42${c.reset}`);
      process.exit(1);
    }

    console.log(`${c.dim}🦦 Fetching PR #${prRef}...${c.reset}`);
    try {
      const prJson = execFileSync("gh", ["pr", "view", prRef, "--json", "number,title,body,files,headRefName,baseRefName,url"], { encoding: "utf8" });
      const pr = JSON.parse(prJson);
      const diff = execFileSync("gh", ["pr", "diff", prRef], { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });

      const result = await runReview(diff, { ...flags, title: `PR #${pr.number}: ${pr.title}`, body: pr.body });

      if (flags.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        renderScorecard(result);
      }

      if (flags.postComment) {
        const markdown = formatMarkdownComment(result, pr.url);
        execFileSync("gh", ["pr", "comment", prRef, "--body", markdown], { stdio: "inherit" });
        console.log(`${c.green}✅ Posted scorecard comment to PR #${pr.number}${c.reset}`);
      }
    } catch (err) {
      console.error(`${c.red}Failed to review PR: ${err.message}${c.reset}`);
      process.exit(1);
    }
    return;
  }

  printHelp();
}

export { getGitDiff, parseDiff, getLocalGuidelines, getRepoRoot, resolveModelConfig, requestLlm, runReview };

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) main().catch((err) => {
  console.error(`${c.red}Fatal: ${err.message}${c.reset}`);
  process.exit(1);
});
