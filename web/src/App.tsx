import { useEffect, useRef, useState } from "react";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/animate-ui/components/radix/sidebar";
import { updateSeo } from "@/lib/seo";
import { Button } from "@/components/ui/button";
import { AppSidebar } from "./app-sidebar";
import { ReviewPage } from "./review-page";
import { SettingsPage } from "./settings-page";
import { HomePage } from "./home-page";
import { LoginPage } from "./login-page";
import { TableSkeleton } from "@/components/skeletons";
import { Link } from "@/components/link";
import { type Board, type Review, type User, repoFromUrl, repoLabel, VERDICT, effort, tone } from "./types";

const useRoute = () => {
  const [route, setRoute] = useState(location.pathname + location.search);
  useEffect(() => {
    const on = () => setRoute(location.pathname + location.search);
    addEventListener("popstate", on);
    return () => removeEventListener("popstate", on);
  }, []);
  const go = (path: string, replace = false) => {
    if (path === location.pathname + location.search && !replace) return;
    history[replace ? "replaceState" : "pushState"](null, "", path);
    setRoute(path);
    scrollTo(0, 0);
  };
  return { path: route.split("?")[0], query: new URLSearchParams(route.split("?")[1]), go };
};

// The sidebar provider writes its open/closed state to a cookie but only reads `defaultOpen`; feed it back so a refresh keeps the state.
const sidebarDefaultOpen = () => !/(?:^|;\s*)sidebar_state=false(?:;|$)/.test(document.cookie);

export const Pill = ({ tone: t, children }: { tone?: string; children: React.ReactNode }) => {
  const c = { ok: "bg-green-100 text-green-800", warn: "bg-amber-100 text-amber-800", bad: "bg-red-100 text-red-800" }[t ?? ""] ?? "bg-neutral-200 text-neutral-700";
  return <span className={`inline-block rounded-md px-2 py-px text-xs align-middle ${c}`}>{children}</span>;
};

const Table = ({ head, children }: { head: string[]; children: React.ReactNode }) => (
  <div className="rounded-[10px] border border-border overflow-x-auto">
    <table className="responsive-table w-full border-collapse">
      <thead>
        <tr>
          {head.map((h, i) => (
            <th key={i} className="bg-[#efefef] text-left font-medium text-neutral-700 px-4 py-2.5 text-sm">{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  </div>
);
const Td = ({ children, className = "", colSpan, label }: { children: React.ReactNode; className?: string; colSpan?: number; label?: string }) => (
  <td colSpan={colSpan} data-label={label} className={`px-4 py-3 border-t border-border text-[15px] align-top ${className}`}>{children}</td>
);
// One shape for every API response: JSON on success, {error} on failure; a 403 with login:true means "go sign in".
const api = async (path: string, init?: RequestInit) => {
  const r = await fetch(path, init);
  const d = await r.json().catch(() => ({ error: `${r.status} ${r.statusText}` }));
  if (!r.ok) throw Object.assign(new Error(d.error || `${r.status}`), { status: r.status, login: !!d.login });
  return d;
};

export default function App() {
  const { path, query, go } = useRoute();
  const [board, setBoard] = useState<Board | null>(null);
  const [boardOrg, setBoardOrg] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  // Active organization scopes the pages (home, sidebar). Remembered across refreshes.
  const [org, setOrgState] = useState(() => localStorage.getItem("pr-scorer.org") ?? "");
  const orgRef = useRef(org);
  orgRef.current = org;
  const setOrg = (o: string) => { setOrgState(o); localStorage.setItem("pr-scorer.org", o); };
  // Signed-in user (session cookie). Login goes through the server's OAuth start endpoint.
  const [me, setMe] = useState<{ user: User | null; signInAvailable: boolean }>({ user: null, signInAvailable: false });
  const loadMe = () => api("/api/me").then(setMe).catch(() => {});
  const [loginError, setLoginError] = useState("");
  useEffect(() => {
    loadMe();
    const err = new URLSearchParams(location.search).get("login_error");
    if (err) { setLoginError(`Sign-in failed: ${err}`); go("/login", true); }
  }, []);
  // Signed in and on the login page: nothing to do there.
  useEffect(() => { if (path === "/login" && me.user) go("/", true); }, [path, me.user]);
  const login = (provider = "github") => {
    const back = sessionStorage.getItem("pr-scorer.back") || "/";
    sessionStorage.removeItem("pr-scorer.back");
    return api(`/api/auth/start?provider=${encodeURIComponent(provider)}&back=${encodeURIComponent(back)}`)
      .then((d) => { location.href = d.url; })
      .catch((e) => setLoginError(e.message));
  };
  const logout = () => fetch("/api/auth/logout", { method: "POST" }).then(() => { loadMe(); load(); });
  const load = () =>
    api(`/api/reviews?org=${encodeURIComponent(org)}`)
      .then((b: Board) => { if (orgRef.current === org) { setBoard(b); setBoardOrg(org); setError(""); setVersion((v) => v + 1); } })
      .catch((e) => { if (e.login && path !== "/login") go("/login", true); else setError(e.message); });
  useEffect(() => {
    let alive = true;
    setBoardOrg(null);
    api(`/api/reviews?org=${encodeURIComponent(org)}`).then((b: Board) => {
      if (alive) { setBoard(b); setBoardOrg(org); setError(""); }
    }).catch((e) => {
      if (alive) { if (e.login && path !== "/login") go("/login", true); else setError(e.message); }
    });
    return () => { alive = false; };
  }, [org]);
  const scopedBoard = boardOrg === org ? board : null;

  const reviewUrl = (url: string) => `/review?pr=${encodeURIComponent(url)}`;
  const settingsPage = path.startsWith("/settings/") ? path.slice("/settings/".length) : "";
  // /repo/owner/name -> reviews for that repo, /repo/owner/name/open -> its open pull requests
  const repoParts = path.startsWith("/repo/") ? path.slice("/repo/".length).split("/") : [];
  const repoPage = repoParts.slice(0, 2).join("/");
  const repoView = repoParts[2] === "open" ? "open" : "reviews";
  const known = path === "/" || path === "/login" || path === "/review" || !!settingsPage || repoParts.length >= 2;
  useEffect(() => { if (!known) go("/", true); }, [known]);
  const prRef = query.get("pr") ?? "";
  const prRepo = query.get("repo") ?? "";
  useEffect(() => {
    if (path !== "/review") return;
    const owner = (prRepo || repoFromUrl(prRef)).split("/")[0];
    if (owner && owner !== org) setOrg(owner);
  }, [path, prRef, prRepo]);
  const title = settingsPage
    ? `${board?.settingsPages.find((p) => p.id === settingsPage)?.group === "admin" ? "Admin" : "Settings"} / ${board?.settingsPages.find((p) => p.id === settingsPage)?.title ?? settingsPage}`
    : path === "/review"
      ? `Reviews / #${query.get("pr")?.split("/").pop() ?? ""}`
      : repoPage
        ? `${repoLabel(repoPage)} / ${repoView === "open" ? "Open pull requests" : "Reviews"}`
        : org ? `Home / ${repoLabel(org)}` : "Home";

  useEffect(() => {
    if (path === "/review") return; // ReviewPage sets rich PR-specific SEO metadata
    if (path === "/login") {
      updateSeo({
        title: "Sign in · CodeOtter",
        description: "Sign in to access CodeOtter AI pull request reviews, blast radius metrics, and merge gates.",
      });
    } else if (settingsPage) {
      const pageMeta = board?.settingsPages.find((p) => p.id === settingsPage);
      const section = pageMeta?.group === "admin" ? "Admin" : "Settings";
      const pageTitle = pageMeta?.title ?? settingsPage;
      updateSeo({
        title: `${pageTitle} — ${section} · CodeOtter`,
        description: `Manage ${pageTitle.toLowerCase()} configuration for ${repoLabel(org) || "your organization"} on CodeOtter.`,
      });
    } else if (repoPage) {
      updateSeo({
        title: `${repoLabel(repoPage)} — ${repoView === "open" ? "Open Pull Requests" : "PR Reviews"} · CodeOtter`,
        description:
          repoView === "open"
            ? `Open pull requests waiting for AI code review in ${repoPage} on CodeOtter.`
            : `Completed AI pull request reviews, quality scores, and blast radius assessments for ${repoPage} on CodeOtter.`,
      });
    } else {
      updateSeo({
        title: org ? `${repoLabel(org)} Dashboard — CodeOtter` : "CodeOtter — AI Pull Request Review, Blast Radius & Merge Gates",
        description: org
          ? `AI pull request review dashboard, quality scores, and pre-merge safety gates for ${org} repositories on CodeOtter.`
          : "Automated AI pull request reviews, calibrated quality & blast-radius scores, repository guideline enforcement (AGENTS.md / CLAUDE.md), and pre-merge safety gates.",
      });
    }
  }, [path, settingsPage, repoPage, repoView, org, board]);

  if (path === "/login") return <LoginPage error={loginError} onLogin={login} go={go} />;
  return (
    <SidebarProvider defaultOpen={sidebarDefaultOpen()}>
      <AppSidebar repositoriesLoaded={!!board} forgejoUrl={board?.forgejoUrl ?? ""} repos={board?.repos ?? []} org={org} setOrg={setOrg} route={path} settingsPages={board?.settingsPages ?? []} openCounts={openCounts(scopedBoard)} user={me.user} signInAvailable={me.signInAvailable} onLogin={() => { sessionStorage.setItem("pr-scorer.back", location.pathname); go("/login"); }} onLogout={logout} go={go} />
      <SidebarInset className="min-w-0">
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3 text-base sm:px-6">
          <span className="flex min-w-0 items-center gap-2.5">
            <SidebarTrigger className="shrink-0" />
            <img src="/codeotter-icon.svg" alt="CodeOtter" className="size-6 rounded-md shadow-xs shrink-0 cursor-pointer sm:hidden" onClick={() => go("/")} />
            <span className="truncate">{title}</span>
          </span>
          <span className="flex shrink-0 gap-2">
            {path === "/review" && prRef && /^https?:/.test(prRef) && (
              <Button asChild size="sm" className="sm:h-9 sm:px-4 sm:text-sm"><a href={prRef} target="_blank" rel="noreferrer">Open pull request</a></Button>
            )}
          </span>
        </div>
        <div className="w-full px-4 py-4 sm:px-6 sm:py-6 lg:px-10 lg:py-7">
          {error && <p className="text-red-700">{error}</p>}
          {path === "/review" ? (
            <ReviewPage org={org} pr={prRef} repo={prRepo} force={query.get("force") ?? ""} onDone={load} />
          ) : settingsPage ? (
            <SettingsPage forgejoUrl={board?.forgejoUrl ?? ""} page={settingsPage} org={org} setOrg={setOrg} user={me.user} onLogin={() => { sessionStorage.setItem("pr-scorer.back", location.pathname); go("/login"); }} onSaved={load} />
          ) : (
            <>
              {!repoPage ? (
                <HomePage go={go} version={version} org={org} />
              ) : repoView === "open" ? (
                <OpenList board={scopedBoard} go={go} reviewUrl={reviewUrl} repo={repoPage} />
              ) : (
                <ReviewedList board={scopedBoard} go={go} reviewUrl={reviewUrl} repo={repoPage} />
              )}
            </>
          )}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}

type ListProps = { board: Board | null; go: (p: string) => void; reviewUrl: (u: string) => string; repo?: string };
const repoOf = repoFromUrl;
// open PRs not yet reviewed, per repository, for the sidebar badges
const openCounts = (board: Board | null) => {
  const out: Record<string, number> = {};
  if (!board) return out;
  const done = new Set(board.reviewed.map((r) => r.pr.url));
  for (const p of board.open) if (!done.has(p.url)) out[repoOf(p.url)] = (out[repoOf(p.url)] ?? 0) + 1;
  return out;
};

function ReviewedList({ board, go, reviewUrl, repo }: ListProps) {
  const rows = (board?.reviewed ?? []).filter((r) => !repo || repoOf(r.pr.url) === repo);
  if (!board) return <TableSkeleton rows={4} widths={["w-3/4", "w-24", "w-8", "w-8", "w-40"]} />;
  return (
    <Table head={["Pull request", "Review effort", "Quality", "Blast radius", ""]}>
      {rows.length === 0 && <tr><Td colSpan={5} className="text-muted-foreground">No reviews yet.</Td></tr>}
      {rows.map((r: Review) => {
        const [vl, vt] = VERDICT[r.review.verdict] ?? VERDICT.comment;
        const e = effort(r.blast.score, r.blast.lines);
        const repo = repoFromUrl(r.pr.url);
        return (
          <tr key={r.pr.url}>
            <Td><Link className="text-brand" path={reviewUrl(r.pr.url)} go={go}>#{r.pr.number}</Link> {r.pr.title} <Pill>{repoLabel(repo)}</Pill></Td>
            <Td label="Review effort">🎯 {e.n} ({e.label})</Td>
            <Td label="Quality"><Pill tone={tone(r.review.scores.quality)}>{r.review.scores.quality}</Pill></Td>
            <Td label="Blast radius"><Pill tone={tone(r.blast.score, true)}>{r.blast.score}</Pill></Td>
            <Td className="sm:text-right whitespace-nowrap"><Pill tone={vt}>{vl}</Pill> <Link className="text-brand ml-3" path={reviewUrl(r.pr.url)} go={go}>Review details →</Link></Td>
          </tr>
        );
      })}
    </Table>
  );
}

function OpenList({ board, go, reviewUrl, repo }: ListProps) {
  const done = new Set(board?.reviewed.map((r) => r.pr.url));
  const rows = (board?.open ?? []).filter((p) => !done.has(p.url) && (!repo || repoOf(p.url) === repo));
  if (!board) return <TableSkeleton rows={4} widths={["w-3/4", "w-20", "w-32", "w-16"]} />;
  return (
    <Table head={["Pull request", "Author", "Size", ""]}>
      {rows.length === 0 && <tr><Td colSpan={4} className="text-muted-foreground">Nothing waiting for review.</Td></tr>}
      {rows.map((p) => (
        <tr key={p.url}>
          <Td><a className="text-brand hover:underline" href={p.url} target="_blank" rel="noreferrer">#{p.number}</a> {p.title}</Td>
          <Td label="Author">{p.author.login}</Td>
          <Td label="Size">{p.changedFiles} files <span className="text-green-700">+{p.additions}</span> <span className="text-red-700">-{p.deletions}</span></Td>
          <Td className="sm:text-right"><Link className="text-brand" path={reviewUrl(p.url)} go={go}>Review →</Link></Td>
        </tr>
      ))}
    </Table>
  );
}
