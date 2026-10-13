import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/animate-ui/components/radix/sidebar";
import { updateSeo } from "@/lib/seo";
import { Button } from "@/components/ui/button";
import { Badge, DataTable } from "@/components/data-table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/animate-ui/components/animate/tooltip";
import { BookOpen } from "lucide-react";
import { AppSidebar } from "./app-sidebar";
const ReviewPage = lazy(() => import("./review-page").then((m) => ({ default: m.ReviewPage })));
import { SettingsPage } from "./settings-page";
import { HomePage } from "./home-page";
import { LoginPage, GitHubMark, ForgejoMark, GiteaMark } from "./login-page";
const OnboardingPage = lazy(() => import("./onboarding-page").then((m) => ({ default: m.OnboardingPage })));
import { FormSkeleton, ReviewSkeleton, TableSkeleton } from "@/components/skeletons";
import { ErrorBoundary } from "@/components/error-boundary";
import { Link } from "@/components/link";
import { sessionGet, sessionSet, storageGet, storageSet } from "@/lib/storage";
import { type Board, type Review, type User, forgeId, forgeLabel, repoFromUrl, repoLabel, VERDICT, effort, effortTone, tone } from "./types";

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

// The shared badge (components/data-table.tsx) under its older name; tone "ok" | "warn" | "bad", none = neutral.
export const Pill = ({ tone: t, children }: { tone?: string; children: React.ReactNode }) => (
  <Badge tone={t === "ok" || t === "warn" || t === "bad" ? t : "muted"}>{children}</Badge>
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
  const [org, setOrgState] = useState(() => storageGet("pr-scorer.org") ?? "");
  const orgRef = useRef(org);
  orgRef.current = org;
  const setOrg = (o: string) => { setOrgState(o); storageSet("pr-scorer.org", o); };
  // Signed-in user (session cookie). Login goes through the server's OAuth start endpoint.
  const [me, setMe] = useState<{ user: User | null; signInAvailable: boolean }>({ user: null, signInAvailable: false });
  const loadMe = () => api("/api/me").then(setMe).catch(() => {});
  const [loginError, setLoginError] = useState("");
  useEffect(() => {
    loadMe();
    const err = new URLSearchParams(location.search).get("login_error");
    if (err) { setLoginError(err.startsWith("Not invited") ? err : `Sign-in failed: ${err}`); go("/login", true); }
  }, []);
  // Signed in and on the login page: nothing to do there.
  useEffect(() => { if (path === "/login" && me.user) go("/", true); }, [path, me.user]);
  const login = (provider = "github") => {
    const back = sessionGet("pr-scorer.back") || "/";
    sessionSet("pr-scorer.back", null);
    return api(`/api/auth/start?provider=${encodeURIComponent(provider)}&back=${encodeURIComponent(back)}`)
      .then((d) => { location.href = d.url; })
      .catch((e) => setLoginError(e.message));
  };
  const logout = () => api("/api/auth/logout", { method: "POST" }).then(() => { loadMe(); load(); }).catch((e: Error) => setError(e.message));
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
      if (!alive) return;
      // The previous organization's repositories must not feed the sidebar once its load has failed.
      setBoard(null);
      if (e.login && path !== "/login") go("/login", true); else setError(e.message);
    });
    return () => { alive = false; };
  }, [org]);
  const scopedBoard = boardOrg === org ? board : null;

  const reviewUrl = (url: string) => `/review?pr=${encodeURIComponent(url)}`;
  useEffect(() => {
    if (["/settings/forgejo", "/settings/gitea"].includes(path)) go("/settings/git", true);
  }, [path]);
  const settingsPage = path.startsWith("/settings/") ? path.slice("/settings/".length) : "";
  // /repo/owner/name -> reviews for that repo, /repo/owner/name/open -> its open pull requests
  const repoParts = path.startsWith("/repo/") ? path.slice("/repo/".length).split("/") : [];
  const repoPage = repoParts.slice(0, 2).join("/");
  const repoView = repoParts[2] === "open" ? "open" : repoParts[2] === "settings" ? "settings" : "reviews";
  const repoViewTitle = repoView === "open" ? "Open pull requests" : repoView === "settings" ? "Repository settings" : "Reviews";
  const known = path === "/" || path === "/login" || path === "/onboarding" || path === "/review" || !!settingsPage || repoParts.length >= 2;
  useEffect(() => { if (!known) go("/", true); }, [known]);

  useEffect(() => {
    if (board?.onboardingNeeded && path !== "/onboarding" && path !== "/login" && !storageGet("pr-scorer.onboarding_done")) {
      go("/onboarding", true);
    }
  }, [board?.onboardingNeeded, path]);

  const prRef = query.get("pr") ?? "";
  const prRepo = query.get("repo") ?? "";
  useEffect(() => {
    if (path !== "/review") return;
    const owner = (prRepo || repoFromUrl(prRef, board?.forgeUrls)).split("/")[0];
    if (owner && owner !== org) setOrg(owner);
  }, [path, prRef, prRepo, board?.forgeUrls]);
  const title = settingsPage
    ? `${board?.settingsPages.find((p) => p.id === settingsPage)?.group === "workspace" ? "Workspace" : "System"} / ${board?.settingsPages.find((p) => p.id === settingsPage)?.title ?? settingsPage}`
    : path === "/review"
      ? `Reviews / #${query.get("pr")?.split("/").pop() ?? ""}`
      : repoPage
        ? `${repoLabel(repoPage)} / ${repoViewTitle}${repoView !== "settings" && scopedBoard ? ` · ${repoView === "open" ? scopedBoard.open.filter((p) => repoOf(p.url, scopedBoard.forgeUrls) === repoPage && !scopedBoard.reviewed.some((r) => r.pr.url === p.url)).length : scopedBoard.reviewed.filter((r) => repoOf(r.pr.url, scopedBoard.forgeUrls) === repoPage).length}` : ""}`
        : org ? `Home / ${repoLabel(org)}` : "Home";

  useEffect(() => {
    if (path === "/review") return; // ReviewPage sets rich PR-specific SEO metadata
    if (path === "/login") {
      updateSeo({
        title: "Sign in · CodeOtter",
        description: "Sign in to access CodeOtter AI pull request reviews, blast radius metrics, and merge gates.",
      });
    } else if (path === "/onboarding") {
      updateSeo({
        title: "Setup & Onboarding · CodeOtter",
        description: "Configure your primary Git provider, AI review engines, and onboard repositories.",
      });
    } else if (settingsPage) {
      const pageMeta = board?.settingsPages.find((p) => p.id === settingsPage);
      const section = pageMeta?.group === "workspace" ? "Workspace" : "System";
      const pageTitle = pageMeta?.title ?? settingsPage;
      updateSeo({
        title: `${pageTitle} — ${section} · CodeOtter`,
        description: `Manage ${pageTitle.toLowerCase()} configuration for ${repoLabel(org) || "your organization"} on CodeOtter.`,
      });
    } else if (repoPage) {
      updateSeo({
        title: `${repoLabel(repoPage)} — ${repoView === "reviews" ? "PR Reviews" : repoViewTitle} · CodeOtter`,
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
  if (path === "/onboarding") return <ErrorBoundary><Suspense fallback={<div className="p-8"><FormSkeleton sections={[3]} /></div>}><OnboardingPage onComplete={(targetOrg) => { if (targetOrg) setOrg(targetOrg); go("/"); load(); }} go={go} /></Suspense></ErrorBoundary>;
  return (
    <SidebarProvider defaultOpen={sidebarDefaultOpen()}>
      <AppSidebar update={board?.update} repositoriesLoaded={!!board} forgeUrls={board?.forgeUrls ?? {}} repos={board?.repos ?? []} org={org} setOrg={setOrg} route={path} settingsPages={board?.settingsPages ?? []} openCounts={openCounts(scopedBoard)} user={me.user} signInAvailable={me.signInAvailable} onLogin={() => { sessionSet("pr-scorer.back", location.pathname); go("/login"); }} onLogout={logout} go={go} />
      <SidebarInset className="min-w-0">
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3 text-base sm:px-6">
          <span className="flex min-w-0 items-center gap-2.5">
            <SidebarTrigger className="shrink-0" />
            <img src="/codeotter-icon.svg" alt="CodeOtter" className="size-6 rounded-sm shadow-xs shrink-0 cursor-pointer sm:hidden" onClick={() => go("/")} />
            <span className="truncate">{title}</span>
          </span>
          <span className="flex shrink-0 gap-2">
            {path === "/review" && prRef && /^https?:/.test(prRef) && (
              <Button asChild size="sm" className="sm:h-9 sm:px-4 sm:text-sm"><a href={prRef} target="_blank" rel="noreferrer">Open pull request</a></Button>
            )}
            <TooltipProvider>
              <Tooltip side="bottom">
                <TooltipTrigger asChild>
                  <Button asChild variant="ghost" size="icon" className="sm:size-9 size-8">
                    <a href="https://github.com/dharmeshgurnani/CodeOtter#readme" target="_blank" rel="noreferrer" aria-label="Documentation"><BookOpen /></a>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Documentation</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </span>
        </div>
        <div className="w-full px-4 py-4 sm:px-6 sm:py-6 lg:px-10 lg:py-7">
          {error && (
            <div className="mb-4 flex flex-wrap items-center gap-3 text-red-700">
              <span>{error}</span>
              <Button variant="outline" size="sm" onClick={() => load()}>Retry</Button>
            </div>
          )}
          {path === "/review" ? (
            <ErrorBoundary><Suspense fallback={<ReviewSkeleton />}><ReviewPage forgeUrls={board?.forgeUrls} org={org} pr={prRef} repo={prRepo} force={query.get("force") ?? ""} onDone={load} /></Suspense></ErrorBoundary>
          ) : settingsPage ? (
            <SettingsPage forgeUrls={board?.forgeUrls ?? {}} page={settingsPage} org={org} setOrg={setOrg} user={me.user} onLogin={() => { sessionSet("pr-scorer.back", location.pathname); go("/login"); }} onSaved={load} />
          ) : (
            <>
              {!repoPage ? (
                <HomePage go={go} version={version} org={org} />
              ) : repoView === "settings" ? (
                <SettingsPage key={repoPage} forgeUrls={board?.forgeUrls ?? {}} page="repo" repo={repoPage} org={org} setOrg={setOrg} user={me.user} onLogin={() => { sessionSet("pr-scorer.back", location.pathname); go("/login"); }} onSaved={load} />
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
  for (const p of board.open) if (!done.has(p.url)) out[repoOf(p.url, board?.forgeUrls)] = (out[repoOf(p.url, board?.forgeUrls)] ?? 0) + 1;
  return out;
};

// The pull request on its own forge (GitHub, Forgejo or Gitea), as that provider's mark at the end of a row.
function ProviderLink({ url, forgeUrls }: { url: string; forgeUrls?: Record<string, string> }) {
  const repo = repoFromUrl(url, forgeUrls);
  const id = forgeId(repo);
  const label = `Open on ${forgeLabel(repo)}`;
  return (
    <Button asChild variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-foreground">
      <a href={url} target="_blank" rel="noreferrer" aria-label={label} title={label}>
        {id === "forgejo" ? <ForgejoMark /> : id === "gitea" ? <GiteaMark /> : <GitHubMark />}
      </a>
    </Button>
  );
}

// "3d ago" style; the exact time is in the cell's title.
const ago = (iso: string) => {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  return s < 3600 ? `${Math.max(1, Math.round(s / 60))}m ago` : s < 86400 ? `${Math.round(s / 3600)}h ago` : s < 86400 * 30 ? `${Math.round(s / 86400)}d ago` : new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
};

// Reviewed pull requests, newest review first. On a repository page the repository is implied, so its name is only
// shown on mixed lists. The PR title is the one link to the review.
function ReviewedList({ board, go, reviewUrl, repo }: ListProps) {
  const rows = (board?.reviewed ?? []).filter((r) => !repo || repoOf(r.pr.url, board?.forgeUrls) === repo).sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  if (!board) return <TableSkeleton rows={4} widths={["w-3/4", "w-20", "w-16", "w-12", "w-12", "w-20"]} />;
  return (
    <DataTable
      columns={[
        { key: "pr", label: "Pull request" },
        { key: "author", label: "Author" },
        { key: "effort", label: "Effort", info: "Estimated review effort, from the blast radius and changed lines.\n1 Trivial\n2 Simple\n3 Moderate\n4 Complex\n5 Critical" },
        { key: "quality", label: "Quality", align: "right", info: "Higher is better." },
        { key: "blast", label: "Blast radius", align: "right", info: "How far the change reaches. Higher is riskier." },
        { key: "verdict", label: "Verdict" },
      ]}
      empty="No reviews yet."
      rows={rows.map((r: Review) => {
        const [vl, vt] = VERDICT[r.review.verdict] ?? VERDICT.comment;
        const e = effort(r.blast.score, r.blast.lines);
        return {
          id: r.pr.url,
          cells: {
            pr: (
              <Link className="group/pr hover:underline" path={reviewUrl(r.pr.url)} go={go}>
                <span className="text-muted-foreground">#{r.pr.number}</span> <span className="text-foreground group-hover/pr:text-brand">{r.pr.title}</span>
                {!repo && <> <Pill>{repoLabel(repoFromUrl(r.pr.url, board.forgeUrls))}</Pill></>}
              </Link>
            ),
            author: r.pr.author?.login || "",
            effort: <span title={e.label}><Pill tone={effortTone(e.n)}>{e.n}/5</Pill></span>,
            quality: <Pill tone={tone(r.review.scores.quality)}>{r.review.scores.quality}/100</Pill>,
            blast: <Pill tone={tone(r.blast.score, true)}>{r.blast.score}/100</Pill>,
            verdict: <Pill tone={vt}>{vl}</Pill>,
          },
          actions: <ProviderLink url={r.pr.url} forgeUrls={board.forgeUrls} />,
        };
      })}
    />
  );
}

function OpenList({ board, go, reviewUrl, repo }: ListProps) {
  const done = new Set(board?.reviewed.map((r) => r.pr.url));
  const rows = (board?.open ?? []).filter((p) => !done.has(p.url) && (!repo || repoOf(p.url, board?.forgeUrls) === repo));
  if (!board) return <TableSkeleton rows={4} widths={["w-3/4", "w-20", "w-16", "w-32", "w-16"]} />;
  return (
    <DataTable
      columns={[{ key: "pr", label: "Pull request" }, { key: "author", label: "Author" }, { key: "updated", label: "Updated" }, { key: "size", label: "Size", align: "right" }]}
      empty="Nothing waiting for review."
      rows={[...rows].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)).map((p) => ({
        id: p.url,
        cells: {
          pr: (
            <a className="group/pr hover:underline" href={p.url} target="_blank" rel="noreferrer">
              <span className="text-muted-foreground">#{p.number}</span> <span className="text-foreground group-hover/pr:text-brand">{p.title}</span>
              {!repo && <> <Pill>{repoLabel(repoFromUrl(p.url, board.forgeUrls))}</Pill></>}
            </a>
          ),
          author: p.author.login,
          updated: p.updatedAt ? <span className="whitespace-nowrap" title={new Date(p.updatedAt).toLocaleString()}>{ago(p.updatedAt)}</span> : "",
          size: <span className="whitespace-nowrap">{p.changedFiles} files <span className="text-green-700">+{p.additions}</span> <span className="text-red-700">-{p.deletions}</span></span>,
        },
        actions: <><Link className="text-brand" path={reviewUrl(p.url)} go={go}>Review →</Link><ProviderLink url={p.url} forgeUrls={board.forgeUrls} /></>,
      }))}
    />
  );
}
