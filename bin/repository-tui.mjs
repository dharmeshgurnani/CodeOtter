import blessed from "blessed";
import { copyText } from "./clipboard.mjs";
import { renderDiff } from "./diff-viewer.mjs";
import { formatDetailText, openPrLink } from "./tui-details.mjs";
import { panelStyle, terminal, PRIMARY, SELECTION, colorScores } from "./tui-theme.mjs";
import { createRepositoryClient, repositoryRows, reviewComplete, repositoryReviewSections, repositoryReviewSkeleton } from "./repositories.mjs";
import { text } from "./review-output.mjs";
import { createTuiHeader, HEADER_HEIGHT } from "./tui-header.mjs";

export async function startRepositoryTui(_flags = {}, { screen: provided, client: providedClient, clipboard = copyText, openLink = openPrLink, diffRenderer = renderDiff } = {}) {
  const client = providedClient || createRepositoryClient();
  const screen = provided || blessed.screen({ terminal, smartCSR: true, title: "CodeOtter · Repositories", fullUnicode: true, ignoreLocked: ["C-c"] });
  const header = createTuiHeader(screen);
  const repos = blessed.list({ parent: screen, top: HEADER_HEIGHT, bottom: 0, width: "30%", border: "line", label: " Repositories ", keys: true, vi: true, mouse: true, style: panelStyle() });
  const prs = blessed.list({ parent: screen, top: HEADER_HEIGHT, left: "30%", right: 0, height: 7, border: "line", label: " Pull requests · score ", keys: true, vi: true, mouse: true, style: panelStyle() });
  const reviewPane = (label, interactive = false) => blessed.box({ parent: screen, left: "30%", right: 0, bottom: 0, border: "line", label: ` ${label} `, padding: { left: 1, right: 1 }, keys: interactive, vi: interactive, mouse: interactive, scrollable: true, alwaysScroll: true, scrollbar: interactive ? { ch: "█" } : undefined, track: interactive ? { ch: "│" } : undefined, style: { ...panelStyle(), scrollbar: { fg: SELECTION }, track: { fg: PRIMARY } } });
  const scores = reviewPane("Scores");
  scores.parseTags = true;
  const summary = reviewPane("Summary");
  const detail = reviewPane("", true);
  detail.parseTags = true;
  let detailText = "";
  let scoreText = "";
  let changesMode = false;
  let diffRequest;
  let diffKey = "";
  let cachedDiff;
  function setDetails(content) {
    detail.parseTags = true;
    detail.wrap = true;
    detailText = text(content);
    detail.setContent(formatDetailText(detailText));
  }
  const copy = blessed.button({ parent: screen, right: 2, width: 22, height: 1, content: " Copy as prompt · c ", mouse: true, keys: false, style: { fg: () => detail.focused ? SELECTION : "white", bold: true } });
  const tabStyle = active => ({ fg: () => active() && detail.focused ? SELECTION : "white", bold: active, underline: active });
  const reviewTab = blessed.button({ parent: screen, width: 10, height: 1, content: " Review ", mouse: true, keys: false, style: tabStyle(() => !changesMode) });
  const changesTab = blessed.button({ parent: screen, width: 11, height: 1, content: " Changes ", mouse: true, keys: false, style: tabStyle(() => changesMode) });
  let board = { repos: [], reviewed: [], open: [] };
  let repo = "";
  let tree = [];
  const collapsed = new Set();
  let rows = [];
  let selected = 0;
  let updatingRows = false;
  let request = null;
  let closed = false;
  let status = "Reading repositories…";
  const done = new Promise(resolve => screen.once("destroy", resolve));
  function showTree(target) {
    const groups = new Map();
    for (const id of board.repos) {
      const [org, name] = id.split("/");
      if (!groups.has(org)) groups.set(org, []);
      groups.get(org).push({ id, org, name });
    }
    tree = [];
    for (const [org, children] of groups) {
      const [provider, owner] = org.split("~");
      const label = owner ? `${owner} · ${provider}` : org;
      tree.push({ id: org, org, group: true, label: `${collapsed.has(org) ? "▸" : "▾"} ${label}` });
      if (!collapsed.has(org)) children.forEach((child, index) => tree.push({ ...child, label: `  ${index === children.length - 1 ? "└─" : "├─"} ${child.name}` }));
    }
    repos.setItems(tree.map(row => text(row.label)));
    repos.select(Math.max(0, tree.findIndex(row => row.id === target)));
  }
  function toggleGroup(row, collapse = !collapsed.has(row.org)) {
    if (collapse) collapsed.add(row.org); else collapsed.delete(row.org);
    showTree(row.org);
    render();
  }
  function render() {
    if (closed) return;
    header.update(`${repo || client.origin} · ${board.repos.length} repos · ${rows.filter(row => reviewComplete(row.record)).length}/${rows.length} reviewed`, status);
    repos.top = prs.top = header.height;
    prs.height = screen.height < 24 ? 3 : screen.height < 26 ? 5 : 7;
    const top = header.height + prs.height;
    const overviewHeight = Math.max(8, Math.min(10, screen.height - top - 5));
    const left = Math.floor(screen.width * 0.3);
    const scoreWidth = Math.min(32, Math.max(24, Math.floor((screen.width - left) / 2)));
    scores.top = summary.top = top;
    scores.height = summary.height = overviewHeight;
    scores.width = scoreWidth;
    const labels = { quality: "Quality", correctness_risk: "Risk", test_coverage: "Tests", readability: "Readability", pr_hygiene: "PR hygiene", blast_radius: "Blast radius" };
    const formattedScores = colorScores(scoreText);
    scores.setContent(scoreWidth < 30 ? formattedScores.replace(/^(\w+)\s+/gm, (match, key) => labels[key] ? labels[key].padEnd(13) : match) : formattedScores);
    summary.left = left + scoreWidth;
    detail.top = top + overviewHeight;
    copy.top = detail.top;
    copy.hidden = !rows[selected];
    const compact = screen.width - left < 50;
    copy.width = compact ? 10 : 22;
    copy.setContent(compact ? " Copy · c " : changesMode ? " Copy diff · c " : " Copy as prompt · c ");
    reviewTab.top = changesTab.top = detail.top;
    reviewTab.left = left + 2;
    changesTab.left = left + 12;
    screen.render();
  }
  function showReview(reset = false) {
    const sections = repositoryReviewSections(rows[selected]);
    scoreText = sections.scores;
    summary.setContent(sections.summary);
    if (changesMode) void updateChanges();
    else setDetails(sections.details);
    if (reset) for (const pane of [scores, summary, detail]) pane.setScroll(0);
  }
  function skeleton() {
    resetChanges();
    const sections = repositoryReviewSkeleton();
    scoreText = sections.scores;
    summary.setContent(sections.summary);
    setDetails(sections.details);
    for (const pane of [scores, summary, detail]) pane.setScroll(0);
    render();
  }
  function showRows(reset = false) {
    if (closed) return;
    const previous = selected;
    updatingRows = true;
    prs.setItems(rows.map(row => text(`#${row.pr.number}  ${row.error ? "ERROR" : row.record?.pending ? "…" : reviewComplete(row.record) ? row.record.review.scores.quality : "---"}  ${row.pr.title}`)));
    selected = Math.min(previous, Math.max(0, rows.length - 1));
    prs.select(selected);
    updatingRows = false;
    showReview(reset);
    render();
  }
  function begin() {
    request?.abort();
    request = new AbortController();
    return request;
  }
  const current = controller => !closed && request === controller && !controller.signal.aborted;
  async function calculate(controller, targets, force = false) {
    for (const row of targets) {
      if (!current(controller)) return;
      status = `Calculating #${row.pr.number}`;
      delete row.error; showRows();
      try {
        row.record = await client.review(repo, { ...row, origins: board.forgeUrls }, {
          signal: controller.signal, force,
          onProgress(record) {
            if (!current(controller)) return;
            row.record = record;
            board.reviewed = [...board.reviewed.filter(r => r.pr.url !== row.pr.url), record];
            showRows();
          },
        });
      } catch (error) {
        if (!current(controller)) return;
        row.error = error.message;
      }
      showRows();
    }
    if (current(controller)) {
      status = rows.some(row => row.error) ? "Review errors · r Retry" : "Ready";
      render();
    }
  }
  async function selectRepo(nextRepo) {
    if (!nextRepo) return;
    const controller = begin();
    repo = nextRepo;
    rows = []; selected = 0;
    status = `Reading ${repo}…`;
    prs.setItems([]);
    skeleton();
    try {
      const data = await client.board(nextRepo.split("/")[0], controller.signal);
      if (!current(controller)) return;
      board = data;
      rows = repositoryRows(board, nextRepo);
      showRows(true);
      // The catalog spans owners; review data and calculation stay scoped to this repository.
      void calculate(controller, rows.filter(row => !reviewComplete(row.record)));
    } catch (error) {
      if (current(controller)) { status = "Could not read repository · g Retry"; setDetails(error.message); render(); }
    }
  }
  async function load() {
    const previousRepo = repo;
    const controller = begin();
    status = "Reading repositories…";
    repo = ""; rows = []; board = { repos: [], reviewed: [], open: [] };
    repos.setItems([]); prs.setItems([]);
    skeleton();
    try {
      const data = await client.board("", controller.signal);
      if (!current(controller)) return;
      board = data;
      if (board.repos.length) {
        const nextRepo = board.repos.includes(previousRepo) ? previousRepo : board.repos[0];
        collapsed.delete(nextRepo.split("/")[0]);
        showTree(nextRepo); void selectRepo(nextRepo);
      }
      else { status = "No connected repositories"; scoreText = ""; summary.setContent(""); setDetails("Add repositories in the web app: Settings → Repositories."); render(); }
    } catch (error) {
      if (current(controller)) { status = "Could not read repositories · g Retry"; setDetails(error.message); render(); }
    }
  }
  function quit() { closed = true; request?.abort(); diffRequest?.abort(); screen.destroy(); }
  async function copyDetails() {
    if (!rows[selected]) return;
    if (changesMode && !detailText) { status = "No diff available to copy"; render(); return; }
    try { status = await clipboard(detailText, screen.program) || "Copied"; }
    catch { status = "Could not copy to clipboard"; }
    render();
  }
  copy.on("press", () => { detail.focus(); void copyDetails(); });
  function resetChanges() {
    changesMode = false; diffRequest?.abort(); diffKey = ""; cachedDiff = undefined;
    copy.setContent(" Copy as prompt · c ");
  }
  async function updateChanges() {
    const row = rows[selected];
    if (!row || !changesMode || closed) return;
    const width = Math.max(1, detail.width - detail.iwidth - 1);
    const key = `${repo}:${row.pr.url}:${width}`;
    if (key === diffKey) return;
    diffKey = key; diffRequest?.abort();
    const controller = diffRequest = new AbortController();
    detail.parseTags = false; detail.wrap = false; detailText = "";
    detail.setContent("Files  ░░░░░░░░░░░░░░░░░░\n\n  ░░  ░░░░░░░░░░░░░░░░░░░░░░\n  ░░  ░░░░░░░░░░░░░░░░");
    detail.setScroll(0); render();
    try {
      const raw = cachedDiff?.url === row.pr.url ? cachedDiff.raw : text(await client.diff(repo, row.pr, controller.signal));
      if (controller.signal.aborted || closed) return;
      cachedDiff = { url: row.pr.url, raw };
      const output = raw ? await diffRenderer(raw, width, controller.signal) : "No diff returned for this pull request.";
      if (controller.signal.aborted || closed) return;
      detailText = raw; detail.setContent(output); render();
    } catch (error) {
      if (!controller.signal.aborted && !closed) { detail.setContent(text(error.message)); diffKey = ""; render(); }
    }
  }
  function openChanges() {
    if (!rows[selected]) return;
    if (changesMode) { resetChanges(); showReview(true); render(); return; }
    changesMode = true;
    copy.setContent(" Copy diff · c ");
    void updateChanges();
  }
  reviewTab.on("press", () => { detail.focus(); if (changesMode) openChanges(); else render(); });
  changesTab.on("press", () => { detail.focus(); if (!changesMode) openChanges(); else render(); });
  detail.key(["left", "right"], (_, key) => {
    if ((key.name === "right") !== changesMode) openChanges();
  });
  async function openSelectedPr() {
    const url = rows[selected]?.pr.url;
    if (!url) return;
    try { await openLink(url); }
    catch { status = "Could not open PR link"; render(); }
  }
  detail.on("click", data => {
    if (changesMode || !detail.lpos || !data) return;
    const line = data.y - detail.lpos.yi - detail.itop + detail.childBase;
    const column = data.x - detail.lpos.xi - detail.ileft;
    const visible = text(detail._clines?.[line] || "");
    if (detail._clines?.rtof?.[line] === 1 && column >= 0 && column < visible.trimEnd().length) void openSelectedPr();
  });
  detail.key("o", () => void openSelectedPr());
  repos.on("select", (_, index) => {
    const row = tree[index];
    if (row?.group) toggleGroup(row);
    else if (row) void selectRepo(row.id);
  });
  repos.key("left", () => {
    const row = tree[repos.selected];
    if (!row) return;
    if (row.group) toggleGroup(row, true);
    else { repos.select(tree.findIndex(parent => parent.id === row.org)); render(); }
  });
  repos.key("right", () => {
    const row = tree[repos.selected];
    if (!row?.group) return;
    if (collapsed.has(row.org)) toggleGroup(row, false);
    else { repos.select(Math.min(repos.selected + 1, tree.length - 1)); render(); }
  });
  prs.on("select item", (_, index) => {
    if (updatingRows || !rows[index]) return;
    selected = index;
    showReview(true);
    render();
  });
  prs.on("select", () => { detail.focus(); render(); });
  screen.key("C-c", quit);
  const bindings = {
    q: quit, g: () => void load(), c: () => void copyDetails(), d: openChanges,
    r: () => { if (rows[selected]) void calculate(begin(), [rows[selected]], true); },
    escape: () => { if (changesMode) { openChanges(); return; } request?.abort(); status = "Queue stopped · current review may finish · g Refresh"; render(); },
    tab: () => {
      if (screen.focused === repos) prs.focus();
      else if (screen.focused === prs) {
        if (changesMode) { resetChanges(); showReview(true); }
        detail.focus();
      } else if (screen.focused === detail && !changesMode && rows[selected]) openChanges();
      else repos.focus();
      render();
    },
    "S-tab": () => {
      if (screen.focused === repos) {
        detail.focus();
        if (!changesMode && rows[selected]) openChanges();
      } else if (screen.focused === prs) repos.focus();
      else if (screen.focused === detail && changesMode) openChanges();
      else prs.focus();
      render();
    },
  };
  for (const [key, action] of Object.entries(bindings)) screen.key(key, action);
  detail.key(["pageup", "pagedown"], (_, key) => { detail.scroll((key.name === "pageup" ? -1 : 1) * Math.max(1, detail.height - 3)); render(); });
  screen.on("resize", () => { render(); if (changesMode) void updateChanges(); });
  repos.focus(); void load();
  await done;
}
