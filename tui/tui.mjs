import blessed from "blessed";
import { panelStyle, terminal } from "./tui-theme.mjs";
import { basename } from "node:path";
import { createWorkspace, reviewSections } from "./workspace.mjs";
import { text } from "./review-output.mjs";
import { createTuiHeader, HEADER_HEIGHT } from "./tui-header.mjs";

// Only the interactive entry point imports Blessed. CI and MCP remain plain stdio.
export async function startTui(flags = {}, { screen: suppliedScreen, workspace = createWorkspace(flags) } = {}) {
  if (!flags.local) {
    const { startRepositoryTui } = await import("./repository-tui.mjs");
    return startRepositoryTui(flags, { screen: suppliedScreen });
  }
  const screen = suppliedScreen || blessed.screen({ terminal, smartCSR: true, title: "CodeOtter", fullUnicode: true, ignoreLocked: ["C-c"] });
  const header = createTuiHeader(screen, "local");
  const nav = blessed.list({ parent: screen, top: HEADER_HEIGHT, bottom: 0, width: 24, border: "line", label: " Workspace ", keys: true, vi: true, mouse: true, style: panelStyle(), tags: false, scrollable: true });
  const detail = blessed.box({ parent: screen, top: HEADER_HEIGHT, left: 24, right: 0, bottom: 0, border: "line", label: " Diff ", keys: true, vi: true, mouse: true, scrollable: true, alwaysScroll: true, scrollbar: { ch: "|" }, padding: { left: 1, right: 1 }, style: panelStyle(), tags: false });
  let actions = [];
  let active = null;
  let controller = null;
  let modal = null;
  let closed = false;
  let status = "Ready";
  const done = new Promise(resolve => screen.once("destroy", resolve));

  function render() {
    if (closed) return;
    header.update(`${basename(process.cwd())} · ${workspace.snapshot?.source || "Workspace"}`, status);
    nav.top = detail.top = header.height;
    const narrow = screen.width < 72;
    nav.width = narrow ? 19 : 24;
    detail.left = narrow ? 19 : 24;
    screen.render();
  }
  function show(label, content) {
    detail.setLabel(` ${text(label)} `);
    detail.setContent(text(content));
    detail.setScroll(0);
    render();
  }
  function rebuild() {
    actions = [{ label: "All changes", run: () => show("Diff", workspace.snapshot?.diff || "No changes. Press s to choose staged changes or a base branch.") }];
    for (const file of workspace.snapshot?.files || []) {
      actions.push({ label: `+${file.additions} -${file.deletions} ${file.path}`, run: () => {
        const blocks = workspace.snapshot.diff.split(/(?=^diff --git )/m);
        show(file.path, blocks.filter(block => block.split("\n")[0].endsWith(` b/${file.path}`)).join("\n") || "Diff unavailable.");
      } });
    }
    for (const [label, content] of Object.entries(reviewSections(active))) actions.push({ label, run: () => show(label, content) });
    actions.push({ label: "Run review", run: () => run("review") }, { label: "Ask", run: ask }, { label: "Draft tools", run: tools }, { label: "Session history", run: history });
    nav.setItems(actions.map(a => text(a.label)));
    render();
  }
  function closeModal() {
    modal?.destroy(); modal = null; nav.focus(); render();
  }
  function choose(label, items, select) {
    if (controller || modal) return;
    modal = blessed.list({ parent: screen, top: "center", left: "center", width: "85%", height: Math.min(items.length + 2, Math.max(5, screen.height - 4)), border: "line", label: ` ${label} · Esc back `, keys: true, vi: true, mouse: true, style: panelStyle(), tags: false, items: items.map(i => text(i.label)) });
    modal.on("select", (_, index) => { closeModal(); select(items[index]); });
    modal.key("escape", closeModal);
    modal.focus(); render();
  }
  function prompt(label, initial, submit) {
    if (controller || modal) return;
    modal = blessed.prompt({ parent: screen, top: "center", left: "center", width: "90%", height: 8, border: "line", style: panelStyle(), tags: false });
    modal.input(label, initial, (error, value) => {
      closeModal();
      if (!error && value?.trim()) submit(value.trim());
    });
    render();
  }
  async function run(kind, question = "") {
    if (controller || modal) return;
    controller = new AbortController();
    status = `${kind}: working · Esc cancels`;
    show(kind, "------------------------------\n----------\n\n----------------------\n------------------------------");
    try {
      active = await workspace.run(kind, question, controller.signal);
      if (closed) return;
      rebuild();
      const [label, content] = Object.entries(reviewSections(active))[0];
      show(label, content);
      status = `${kind} complete · e Export · h History`;
    } catch (error) {
      if (!closed) {
        status = controller.signal.aborted ? "Cancelled" : `${kind} failed`;
        show(status, controller.signal.aborted ? "Request cancelled. Previous results remain in session history." : error.message);
      }
    } finally {
      controller = null; render();
    }
  }
  function refresh(next = {}) {
    try {
      workspace.refresh(next);
      active = null;
      rebuild(); actions[0].run();
      status = "Ready";
    } catch (error) { show("Error", error.message); }
    render();
  }
  function source() {
    choose("Source", [
      { label: "Unstaged changes", options: { staged: false, base: null, diffFile: null } },
      { label: "Staged changes", options: { staged: true, base: null, diffFile: null } },
      { label: "Compare against branch", branch: true },
      { label: "Read patch file", file: true },
    ], item => {
      if (item.branch) prompt("Base branch", "main", base => refresh({ base, staged: false, diffFile: null }));
      else if (item.file) prompt("Patch file", "", diffFile => refresh({ diffFile, base: null, staged: false }));
      else refresh(item.options);
    });
  }
  function ask() { prompt("Ask about these changes", "", question => run("ask", question)); }
  function tools() {
    choose("Draft tools", ["describe", "improve", "docs", "changelog"].map(kind => ({ label: kind })), item => run(item.label));
  }
  function history() {
    if (!workspace.history.length) { show("History", "No results in this session."); return; }
    choose("Session history", workspace.history.map(entry => ({ label: `${entry.createdAt.slice(11, 19)} ${entry.kind} · ${entry.source}`, entry })), item => {
      active = item.entry; rebuild();
      const [label, content] = Object.entries(reviewSections(active))[0]; show(label, content);
    });
  }
  function model() {
    choose("Model settings (session only)", ["Provider", "Model", "Base URL", "Review title", "Review description"].map(label => ({ label })), ({ label }) => {
      const key = { Provider: "provider", Model: "model", "Base URL": "baseUrl", "Review title": "title", "Review description": "body" }[label];
      prompt(label, workspace.config[key] || "", value => {
        // Changing provider clears the previous model and endpoint overrides.
        workspace.configure(key === "provider" ? { provider: value, model: null, baseUrl: null } : { [key]: value }); render();
      });
    });
  }
  function quit() { closed = true; controller?.abort(); modal?.destroy(); screen.destroy(); }
  nav.on("select", (_, index) => { if (!controller && !modal) actions[index]?.run(); });
  screen.key("C-c", quit);
  screen.key("escape", () => { if (!modal && controller) controller.abort(); });
  const bindings = {
    q: quit, r: () => run("review"), s: source, a: ask, t: tools, h: history, m: model,
    e: () => active ? prompt("Export JSON (new file)", `codeotter-${Date.now()}.json`, filename => {
      try { status = `Exported ${workspace.export(active, filename)}`; } catch (error) { status = error.message; } render();
    }) : show("Export", "Run a review or tool first."),
    g: () => refresh(),
    "?": () => show("Keys", "r  Review current source\ns  Choose unstaged / staged / base branch / patch\ng  Refresh diff\na  Ask about current diff\nt  Describe / Improve / Docs / Changelog drafts\nm  Provider, model, endpoint, review title/description\nh  Session history (last 20 results)\ne  Export selected result as JSON (never overwrites)\nTab  Switch focus\nArrows / j,k / PgUp,PgDn  Navigate or scroll\nEsc  Cancel request or close menu\nq / Ctrl-C  Quit\n\nLocal workspace only. Untracked files are not in git diff.\nTools produce drafts; no files or PRs are changed.\nAPI keys come from your environment or --key.\nThe web app provides organization and account administration."),
  };
  for (const [key, action] of Object.entries(bindings)) screen.key(key, () => { if (!modal && !controller) action(); });
  screen.key("q", () => { if (controller && !modal) quit(); });
  screen.key("tab", () => { if (!modal) { (screen.focused === nav ? detail : nav).focus(); render(); } });
  detail.key(["pageup", "pagedown"], (_, key) => { detail.scroll((key.name === "pageup" ? -1 : 1) * Math.max(1, detail.height - 3)); render(); });
  screen.on("resize", render);
  nav.focus(); refresh();
  await done;
}
