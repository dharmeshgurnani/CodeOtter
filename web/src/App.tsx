import { useEffect, useState } from "react";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/animate-ui/components/radix/sidebar";
import { Button } from "@/components/ui/button";
import { AppSidebar } from "./app-sidebar";
import { ReviewPage } from "./review-page";
import { type Board, type Review, VERDICT, effort, tone } from "./types";

const useRoute = () => {
  const [route, setRoute] = useState(location.pathname + location.search);
  useEffect(() => {
    const on = () => setRoute(location.pathname + location.search);
    addEventListener("popstate", on);
    return () => removeEventListener("popstate", on);
  }, []);
  const go = (path: string) => {
    history.pushState(null, "", path);
    setRoute(path);
  };
  return { path: route.split("?")[0], query: new URLSearchParams(route.split("?")[1]), go };
};

export const Pill = ({ tone: t, children }: { tone?: string; children: React.ReactNode }) => {
  const c = { ok: "bg-green-100 text-green-800", warn: "bg-amber-100 text-amber-800", bad: "bg-red-100 text-red-800" }[t ?? ""] ?? "bg-neutral-200 text-neutral-700";
  return <span className={`inline-block rounded-md px-2 py-px text-xs align-middle ${c}`}>{children}</span>;
};

const Table = ({ head, children }: { head: string[]; children: React.ReactNode }) => (
  <div className="rounded-[10px] border border-border overflow-hidden">
    <table className="w-full border-collapse">
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
const Td = ({ children, className = "" }: { children: React.ReactNode; className?: string }) => <td className={`px-4 py-3 border-t border-border text-[15px] align-top ${className}`}>{children}</td>;

export default function App() {
  const { path, query, go } = useRoute();
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState("");
  const load = () => fetch("/api/reviews").then((r) => r.json()).then(setBoard).catch((e) => setError(String(e)));
  useEffect(() => { load(); }, []);

  const reviewUrl = (url: string) => `/review?pr=${encodeURIComponent(url)}`;
  const titles: Record<string, string> = { "/": "Reviews", "/open": "Open pull requests", "/review": `Reviews / #${query.get("pr")?.split("/").pop() ?? ""}`, "/settings": "Settings" };
  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const pr = new FormData(e.currentTarget).get("pr")?.toString().trim();
    if (pr) go(`/review?pr=${encodeURIComponent(pr)}`);
  };

  return (
    <SidebarProvider>
      <AppSidebar repo={board?.repo ?? ""} route={path} openCount={board?.open.filter((p) => !board.reviewed.some((r) => r.pr.url === p.url)).length ?? 0} go={go} />
      <SidebarInset>
        <div className="flex items-center justify-between border-b border-border px-6 py-3 text-base">
          <span className="flex items-center gap-3"><SidebarTrigger />{titles[path] ?? "Reviews"}</span>
          <span className="flex gap-2.5">
            {path === "/review" && (
              <>
                <Button variant="outline" onClick={() => go(`/review?pr=${encodeURIComponent(query.get("pr") ?? "")}&force=1`)}>Re-review</Button>
                <Button asChild><a href={query.get("pr") ?? "#"} target="_blank" rel="noreferrer">Open in GitHub</a></Button>
              </>
            )}
            {path !== "/review" && <Button form="review-form" type="submit">Review pull request</Button>}
          </span>
        </div>
        <div className="mx-auto w-full max-w-[1220px] px-10 py-7">
          {error && <p className="text-red-700">{error}</p>}
          {path === "/review" ? (
            <ReviewPage pr={query.get("pr") ?? ""} force={query.has("force")} onDone={load} />
          ) : path === "/settings" ? (
            <Settings board={board} />
          ) : (
            <>
              <p className="text-[15px] text-neutral-800 mb-4">Pull requests reviewed for quality, blast radius and actionable comments.</p>
              <form id="review-form" onSubmit={submit} className="mb-4">
                <input name="pr" autoFocus placeholder={`Paste a pull request URL or number in ${board?.repo ?? ""}`} className="w-full max-w-[420px] rounded-lg border border-border px-3 py-2 text-[15px] outline-none focus:ring-2 focus:ring-black" />
              </form>
              {path === "/open" ? (
                <OpenList board={board} go={go} reviewUrl={reviewUrl} />
              ) : (
                <ReviewedList board={board} go={go} reviewUrl={reviewUrl} />
              )}
            </>
          )}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}

type ListProps = { board: Board | null; go: (p: string) => void; reviewUrl: (u: string) => string };

function ReviewedList({ board, go, reviewUrl }: ListProps) {
  const rows = board?.reviewed ?? [];
  return (
    <Table head={["Pull request", "Review effort", "Quality", "Blast radius", ""]}>
      {rows.length === 0 && <tr><Td className="text-muted-foreground">{board ? "No reviews yet." : "Loading…"}</Td></tr>}
      {rows.map((r: Review) => {
        const [vl, vt] = VERDICT[r.review.verdict] ?? VERDICT.comment;
        const e = effort(r.blast.score, r.blast.lines);
        const repo = r.pr.url.split("/").slice(3, 5).join("/");
        return (
          <tr key={r.pr.url}>
            <Td><a className="text-brand hover:underline cursor-pointer" onClick={() => go(reviewUrl(r.pr.url))}>#{r.pr.number}</a> {r.pr.title} <Pill>{repo}</Pill></Td>
            <Td>🎯 {e.n} ({e.label})</Td>
            <Td><Pill tone={tone(r.review.scores.quality)}>{r.review.scores.quality}</Pill></Td>
            <Td><Pill tone={tone(r.blast.score, true)}>{r.blast.score}</Pill></Td>
            <Td className="text-right whitespace-nowrap"><Pill tone={vt}>{vl}</Pill> <a className="text-brand hover:underline cursor-pointer ml-3" onClick={() => go(reviewUrl(r.pr.url))}>Review details →</a></Td>
          </tr>
        );
      })}
    </Table>
  );
}

function OpenList({ board, go, reviewUrl }: ListProps) {
  const done = new Set(board?.reviewed.map((r) => r.pr.url));
  const rows = (board?.open ?? []).filter((p) => !done.has(p.url));
  return (
    <Table head={["Pull request", "Author", "Size", ""]}>
      {rows.length === 0 && <tr><Td className="text-muted-foreground">{board ? "Nothing waiting for review." : "Loading…"}</Td></tr>}
      {rows.map((p) => (
        <tr key={p.url}>
          <Td><a className="text-brand hover:underline" href={p.url} target="_blank" rel="noreferrer">#{p.number}</a> {p.title}</Td>
          <Td>{p.author.login}</Td>
          <Td>{p.changedFiles} files <span className="text-green-700">+{p.additions}</span> <span className="text-red-700">-{p.deletions}</span></Td>
          <Td className="text-right"><a className="text-brand hover:underline cursor-pointer" onClick={() => go(reviewUrl(p.url))}>Review →</a></Td>
        </tr>
      ))}
    </Table>
  );
}

function Settings({ board }: { board: Board | null }) {
  const rows: [string, string, string][] = [
    ["Repository", board?.repo ?? "", "REPO"],
    ["Model", board?.model ?? "", "LLM_MODEL"],
    ["Endpoint", board?.baseUrl ?? "", "LLM_BASE_URL"],
    ["API key", "read from LLM_API_KEY, else the pi CLI's MiniMax key", "LLM_API_KEY"],
  ];
  return (
    <>
      <p className="text-[15px] text-neutral-800 mb-4">Runtime configuration. Change a value by restarting the server with the environment variable set.</p>
      <Table head={["Setting", "Value", "Environment variable"]}>
        {rows.map(([k, v, env]) => (
          <tr key={k}><Td>{k}</Td><Td>{v}</Td><Td><code className="rounded bg-neutral-100 px-1.5 text-xs">{env}</code></Td></tr>
        ))}
      </Table>
    </>
  );
}
