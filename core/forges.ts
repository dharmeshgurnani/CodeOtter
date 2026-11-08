// Git server adapters for everything that is not GitHub (GitHub goes through the gh CLI in server.ts).
// One adapter per API family, each with the same methods, so server.ts never branches on the provider:
//   gitea        Forgejo and Gitea (/api/v1)
//   bitbucket    Bitbucket Cloud (api.bitbucket.org/2.0)
//   bitbucketdc  Bitbucket Data Center (<origin>/rest/api/latest)
//   azure        Azure DevOps Services (dev.azure.com/<org>/<project>/_apis/git)
// Repository ids are "<forge>~<native>"; the native part is owner/name, workspace/slug, PROJECT/slug or org/project/repo.
// Every method takes the full id and strips the prefix itself. Standard library and fetch only.
//
// Credentials only ever go to the operator-configured origin. Redirects are refused, except the one Bitbucket Cloud
// answers its pull request diff with, which is followed only while it stays on api.bitbucket.org.

import { createHmac, timingSafeEqual } from "node:crypto";

// ---------------------------------------------------------------------------------------------------------------------
// Types. The normalized shapes below are what every caller sees; the raw API shapes further down are what each server
// is documented to answer. Server JSON is untrusted: raw fields are optional unless the code already relies on them.
export type ForgeKind = "gitea" | "bitbucket" | "bitbucketdc" | "azure";
export type ForgeId = "forgejo" | "gitea" | "bitbucket" | "bitbucketdc" | "azure";
// One git server's settings (config.ts FORGES). `auth` is set by the adapter.
export interface ForgeConfig {
  kind: ForgeKind;
  label: string;
  url: string;
  token: string;
  pb?: string; // PocketBase OAuth2 provider used for sign-in
  signInLabel?: string;
  fixed?: boolean; // one public origin
  user?: string; // Bitbucket Cloud: account email for Basic auth
  orgs?: string[]; // Azure DevOps organizations to read
  auth?: () => string;
}
type AuthedConfig = ForgeConfig & { auth: () => string };
export type HttpError = Error & { status: number };
export interface ApiOptions {
  method?: string;
  body?: unknown;
  as?: "json" | "text" | "buffer";
  follow?: boolean;
  what?: string;
  raw?: boolean; // Forgejo/Gitea: answer as text
}
export interface PrFile { path: string; additions: number; deletions: number }
export interface PrCommit { oid: string; messageHeadline: string; messageBody: string; authors: { login: string }[]; committedDate: string }
export interface PrLabel { name: string }
// The normalized pull request (the shape `gh pr view --json` gives for GitHub).
export interface PullRequest {
  number: number;
  title: string;
  body: string;
  url: string;
  author: { login: string };
  updatedAt: string;
  baseRefName: string;
  headRefName: string;
  headRefOid: string;
  headRepo: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  state: string;
  isDraft: boolean;
  labels: PrLabel[];
  files: PrFile[];
  commits: PrCommit[];
}
interface PullRequestInput {
  number: number;
  title?: string;
  body?: string;
  url: string;
  author?: string;
  updatedAt?: string;
  baseRefName?: string;
  headRefName?: string;
  headRefOid?: string;
  headRepo: string;
  additions?: number;
  deletions?: number;
  changedFiles?: number;
  state?: string;
  isDraft?: boolean;
  labels?: PrLabel[];
  files?: PrFile[];
  commits?: PrCommit[];
}
// A top-level PR comment: what the marker upsert and the comment commands read.
export interface ForgeComment { id: number | string; body: string; created_at: string; prNumber: number; user: { id: number | string; login: string } }
interface CommentInput { id: number | string; body?: string; created_at?: string; prNumber?: number; userId?: number | string; login?: string }
export interface ForgeUser { id: number | string | undefined; login: string }
export interface ForgeIssue { number: number; title?: string; body?: string; state?: string; url: string; labels: string[] }
export interface BaseCommit { sha: string; message: string; author: string }
// A commit status, in GitHub's terms (state: success | failure | error | pending).
export interface CommitStatus { state: string; context: string; description?: string; target_url?: string }
export interface InlineComment { path: string; line: number; startLine?: number; body: string }
export type HookHeaders = Record<string, string | undefined>;
export interface HookMeta { event: string; delivery: string; signature: string | undefined }
export interface RoutedHook { repo: string; pr?: PullRequest; comment?: ForgeComment }
export interface FileDiffInput { oldPath: string; newPath: string; oldText: string | null; newText: string | null; binary?: boolean }
export type DiffOp = ["=" | "+" | "-", string];
// One adapter. Payload parameters (`normalize`, `hookBody`, `route`) take untrusted server JSON; each adapter declares
// the raw shape it reads.
export interface Forge {
  id: string;
  kind: ForgeKind;
  api<T = unknown>(path: string, opts?: ApiOptions): Promise<T>;
  list?<T = unknown>(path: string, max?: number): Promise<T[]>;
  normalize(p: unknown, repo: string, files?: PrFile[], commits?: PrCommit[]): PullRequest;
  prUrl(repo: string, n: number): string;
  issueUrl(repo: string, n: number): string;
  repoUrl(repo: string): string;
  parsePr(u: URL): { native: string; number: number } | null;
  parseRepo(rest: string): string | null;
  test(): Promise<string>;
  me(repo: string): Promise<ForgeUser | null>;
  listRepos(): Promise<string[]>;
  repoExists(repo: string): Promise<boolean>;
  pr(repo: string, n: number): Promise<PullRequest>;
  diff(repo: string, n: number): Promise<string>;
  openPrs(repo: string): Promise<PullRequest[]>;
  file(repo: string, path: string, ref?: string): Promise<string | null>;
  baseCommits(repo: string, branch: string, n?: number): Promise<BaseCommit[]>;
  compare(repo: string, from: string, to: string): Promise<string>;
  issue(repo: string, n: number): Promise<ForgeIssue | null>;
  status(repo: string, sha: string, s: CommitStatus, n?: number): Promise<unknown>;
  comments(repo: string, n: number): Promise<ForgeComment[]>;
  comment(repo: string, n: number, body: string): Promise<unknown>;
  editComment(repo: string, n: number, cid: number | string, body: string): Promise<unknown>;
  inline<C extends InlineComment>(repo: string, n: number, comments: C[], sha?: string): Promise<C[]>;
  singleLineSuggestions?: boolean;
  multiLineSuggestions?: boolean;
  setBody(repo: string, n: number, body: string): Promise<unknown>;
  commentsSince(repo: string, since: string): Promise<ForgeComment[]>;
  trusted(repo: string, c: ForgeComment): Promise<boolean>;
  react(repo: string, c: ForgeComment): Promise<unknown> | null;
  ensureHook(repo: string, url: string, secret: string): Promise<boolean>;
  removeHook(repo: string, url: string): Promise<void>;
  secretHeader?: string;
  hookMeta(h: HookHeaders): HookMeta;
  hookBody?(x: unknown): { event: string; delivery: string };
  route?(event: string, x: unknown): RoutedHook | null;
}

const enc = encodeURIComponent;
const encPath = (p: string) => String(p).split("/").map(enc).join("/");
const native = (repo: string) => String(repo).replace(/^[a-z]+~/, "");
const lines = (s: string | undefined) => String(s || "").split("\n");
const firstLine = (s: string | undefined) => lines(s)[0] || "";
const restLines = (s: string | undefined) => lines(s).slice(1).join("\n").trim();
const isSha = (s: string) => /^[0-9a-f]{40}$/i.test(String(s || ""));
const iso = (v: string | number | null | undefined) => (v === undefined || v === null || v === "" ? "" : new Date(typeof v === "number" ? v : String(v)).toISOString());
const safeFile = (p: string) => !!p && !String(p).split("/").some((s) => !s || s === "." || s === "..");
// The HTTP status an httpError() carries; anything else has none.
const statusOf = (e: unknown): number | undefined => (typeof e === "object" && e !== null && "status" in e && typeof e.status === "number" ? e.status : undefined);

export function httpError(label: string, method: string, what: string, status: number): HttpError {
  return Object.assign(new Error(`${label} ${method} ${what} failed (${status})`), { status });
}

// fetch with the forge's credentials. `as`: json | text | buffer. `follow`: same-origin redirects allowed (Bitbucket diff).
async function http(f: AuthedConfig, url: string, { method = "GET", body, as = "json", follow = false, what }: ApiOptions = {}): Promise<unknown> {
  const origin = new URL(url).origin;
  let res: Response;
  for (let hop = 0; ; hop++) {
    res = await fetch(url, {
      method,
      redirect: "manual",
      signal: AbortSignal.timeout(30000),
      headers: {
        authorization: f.auth(),
        accept: as === "json" ? "application/json" : "*/*",
        "user-agent": "CodeOtter",
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (res.status < 300 || res.status >= 400) break;
    const location = res.headers.get("location");
    const next = location ? new URL(location, url) : null;
    if (!follow || method !== "GET" || hop >= 3 || !next || next.origin !== origin) throw httpError(f.label, method, what || new URL(url).pathname, res.status);
    url = next.href;
  }
  if (!res.ok) throw httpError(f.label, method, what || new URL(url).pathname, res.status);
  // Azure DevOps answers a bad or expired token with 203 and a sign-in page: that is a 401
  if (res.status === 203) throw httpError(f.label, method, what || new URL(url).pathname, 401);
  if (res.status === 204) return null;
  if (as === "text") return res.text();
  if (as === "buffer") return Buffer.from(await res.arrayBuffer());
  const t = await res.text();
  return t ? JSON.parse(t) : null;
}
const orNull = <T>(p: Promise<T>): Promise<T | null> => p.catch((e: unknown) => { if (statusOf(e) === 404) return null; throw e; });

// ---------------------------------------------------------------------------------------------------------------------
// Line diff (Myers) and unified-diff text, for Azure DevOps (no diff endpoint) and Bitbucket Data Center (JSON diffs).
export function diffLines(a: string[], b: string[], maxD = 2000): DiffOp[] {
  let s = 0;
  while (s < a.length && s < b.length && a[s] === b[s]) s++;
  let ea = a.length, eb = b.length;
  while (ea > s && eb > s && a[ea - 1] === b[eb - 1]) { ea--; eb--; }
  const A = a.slice(s, ea), B = b.slice(s, eb);
  const mid = myers(A, B, maxD) || [...A.map((l): DiffOp => ["-", l]), ...B.map((l): DiffOp => ["+", l])];
  return [...a.slice(0, s).map((l): DiffOp => ["=", l]), ...mid, ...a.slice(ea).map((l): DiffOp => ["=", l])];
}
function myers(A: string[], B: string[], maxD: number): DiffOp[] | null {
  const N = A.length, M = B.length;
  if (!N) return B.map((l): DiffOp => ["+", l]);
  if (!M) return A.map((l): DiffOp => ["-", l]);
  const max = Math.min(N + M, maxD), off = max;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  for (let d = 0; d <= max; d++) {
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? v[off + k + 1] : v[off + k - 1] + 1;
      let y = x - k;
      while (x < N && y < M && A[x] === B[y]) { x++; y++; }
      v[off + k] = x;
      if (x >= N && y >= M) {
        trace.push(v.slice(off - d, off + d + 1));
        return backtrack(trace, A, B);
      }
    }
    trace.push(v.slice(off - d, off + d + 1));
  }
  return null;
}
function backtrack(trace: Int32Array[], A: string[], B: string[]): DiffOp[] {
  let x = A.length, y = B.length;
  const out: DiffOp[] = [];
  for (let d = trace.length - 1; d > 0; d--) {
    const prev = trace[d - 1];
    const get = (k: number) => prev[k + d - 1];
    const k = x - y;
    const down = k === -d || (k !== d && get(k - 1) < get(k + 1));
    const pk = down ? k + 1 : k - 1;
    const px = get(pk), py = px - pk;
    while (x > px && y > py) { out.push(["=", A[x - 1]]); x--; y--; }
    if (down) { out.push(["+", B[y - 1]]); y--; } else { out.push(["-", A[x - 1]]); x--; }
  }
  while (x > 0 && y > 0) { out.push(["=", A[x - 1]]); x--; y--; }
  return out.reverse();
}
function hunks(ops: DiffOp[], ctx = 3): string[] {
  const pos: [number, number][] = [];
  let ai = 0, bi = 0;
  for (const [t] of ops) { pos.push([ai, bi]); if (t !== "+") ai++; if (t !== "-") bi++; }
  const changes: number[] = [];
  ops.forEach((o, i) => { if (o[0] !== "=") changes.push(i); });
  if (!changes.length) return [];
  const groups: [number, number][] = [];
  let start = changes[0], end = changes[0];
  for (const c of changes.slice(1)) {
    if (c - end - 1 <= 2 * ctx) end = c;
    else { groups.push([start, end]); start = end = c; }
  }
  groups.push([start, end]);
  const out: string[] = [];
  for (const [s, e] of groups) {
    const from = Math.max(0, s - ctx), to = Math.min(ops.length - 1, e + ctx);
    const slice = ops.slice(from, to + 1);
    const [a0, b0] = pos[from];
    const al = slice.filter((o) => o[0] !== "+").length, bl = slice.filter((o) => o[0] !== "-").length;
    out.push(`@@ -${al ? a0 + 1 : a0},${al} +${bl ? b0 + 1 : b0},${bl} @@`, ...slice.map(([t, l]) => (t === "=" ? " " : t) + l));
  }
  return out;
}
const textLines = (t: string) => {
  const l = String(t).split("\n");
  if (l.at(-1) === "") l.pop();
  return l.map((x) => x.replace(/\r$/, ""));
};
// One file's section of a unified diff. oldText/newText null = the file does not exist on that side.
export function fileDiff({ oldPath, newPath, oldText, newText, binary = false }: FileDiffInput): string {
  const a = oldPath || newPath, b = newPath || oldPath;
  const head = [`diff --git a/${a} b/${b}`];
  if (oldText === null) head.push("new file mode 100644");
  if (newText === null) head.push("deleted file mode 100644");
  if (oldPath && newPath && oldPath !== newPath) head.push(`rename from ${oldPath}`, `rename to ${newPath}`);
  if (binary) return [...head, `Binary files ${oldText === null ? "/dev/null" : `a/${a}`} and ${newText === null ? "/dev/null" : `b/${b}`} differ`].join("\n");
  const body = hunks(diffLines(oldText === null ? [] : textLines(oldText), newText === null ? [] : textLines(newText)));
  if (!body.length) return head.length > 1 ? head.join("\n") : "";
  return [...head, `--- ${oldText === null ? "/dev/null" : `a/${a}`}`, `+++ ${newText === null ? "/dev/null" : `b/${b}`}`, ...body].join("\n");
}
// +/- line counts per file from unified diff text.
export function diffStats(diff: string): PrFile[] {
  const files = new Map<string, PrFile>();
  let cur: PrFile | null = null;
  for (const l of String(diff).split("\n")) {
    const m = l.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (m) { cur = { path: m[2], additions: 0, deletions: 0 }; files.set(cur.path, cur); continue; }
    if (!cur || l.startsWith("+++") || l.startsWith("---")) continue;
    if (l.startsWith("+")) cur.additions++;
    else if (l.startsWith("-")) cur.deletions++;
  }
  return [...files.values()];
}
const isBinary = (buf: Buffer) => buf.subarray(0, 8000).includes(0);

// ---------------------------------------------------------------------------------------------------------------------
// The normalized pull request every caller sees (the shape `gh pr view --json` gives for GitHub).
const pullRequest = (o: PullRequestInput): PullRequest => ({
  number: o.number, title: o.title || "", body: o.body || "", url: o.url,
  author: { login: o.author || "unknown" }, updatedAt: o.updatedAt || "",
  baseRefName: o.baseRefName || "", headRefName: o.headRefName || "", headRefOid: o.headRefOid || "", headRepo: o.headRepo,
  additions: o.additions ?? (o.files || []).reduce((n, f) => n + f.additions, 0),
  deletions: o.deletions ?? (o.files || []).reduce((n, f) => n + f.deletions, 0),
  changedFiles: o.changedFiles ?? (o.files || []).length,
  state: o.state || "OPEN", isDraft: !!o.isDraft, labels: o.labels || [], files: o.files || [], commits: o.commits || [],
});
const commit = (oid: string, message: string | undefined, login: string | undefined, date: string | undefined): PrCommit => ({ oid, messageHeadline: firstLine(message), messageBody: restLines(message), authors: [{ login: login || "" }], committedDate: date || "" });
// A top-level PR comment: what the marker upsert and the comment commands read.
const comment = (o: CommentInput): ForgeComment => ({ id: o.id, body: o.body || "", created_at: o.created_at || "", prNumber: o.prNumber || 0, user: { id: o.userId ?? "", login: o.login || "" } });
const STATE: Record<string, Record<string, string>> = {
  bitbucket: { success: "SUCCESSFUL", failure: "FAILED", error: "FAILED", pending: "INPROGRESS" },
  azure: { success: "succeeded", failure: "failed", error: "error", pending: "pending" },
};

// =====================================================================================================================
// Forgejo / Gitea
interface GiteaUser { id?: number; login?: string; username?: string }
interface GiteaLabel { name?: string }
interface GiteaPull {
  number: number; title?: string; body?: string; user?: GiteaUser; updated_at?: string;
  base?: { ref?: string }; head?: { ref?: string; sha?: string; repo?: { full_name?: string } };
  additions?: number; deletions?: number; changed_files?: number; merged?: boolean; state?: string; draft?: boolean; labels?: PrLabel[];
}
interface GiteaFile { filename: string; additions?: number; deletions?: number }
interface GiteaCommit { sha: string; commit?: { message?: string; author?: { name?: string; date?: string } }; author?: { login?: string } }
interface GiteaComment { id: number; body?: string; created_at?: string; html_url?: string; user?: GiteaUser }
interface GiteaContent { encoding?: string; content?: unknown }
interface GiteaIssue { number?: number; title?: string; body?: string; state?: string; labels?: GiteaLabel[] }
interface GiteaHook { id?: number; config?: { url?: string } }
function gitea(id: string, f: AuthedConfig): Forge {
  f.auth = () => `token ${f.token}`;
  const api = <T = unknown>(path: string, opts: ApiOptions = {}): Promise<T> => {
    if (!f.url) throw new Error(`Set the ${f.label} server under Admin / Git providers`);
    if (!/^(?:user$|(?:repos|user|users|orgs)\/)/.test(path) || path.split(/[/?]/).some((p) => p === "." || p === "..")) throw new Error("Invalid git server API path");
    if (!f.token) throw new Error(`Configure an access token in Admin / Git providers / ${f.label}`);
    return http(f, `${f.url}/api/v1/${path}`, { ...opts, as: opts.raw ? "text" : opts.as, what: path.split("?")[0] }) as Promise<T>;
  };
  const list = async <T = unknown>(path: string): Promise<T[]> => {
    const rows: T[] = [];
    for (let page = 1; page <= 1000; page++) {
      const batch = await api<T[]>(`${path}${path.includes("?") ? "&" : "?"}limit=50&page=${page}`);
      if (!Array.isArray(batch)) throw new Error("Invalid git server list response");
      if (!batch.length) return rows;
      rows.push(...batch);
    }
    throw new Error("Git server pagination limit exceeded");
  };
  const r = (repo: string) => `repos/${native(repo)}`;
  const normalize = (p: GiteaPull, repo: string, files?: PrFile[], commits?: PrCommit[]) => pullRequest({
    number: p.number, title: p.title, body: p.body, url: `${f.url}/${native(repo)}/pulls/${p.number}`,
    author: p.user?.login, updatedAt: p.updated_at,
    baseRefName: p.base?.ref, headRefName: p.head?.ref, headRefOid: p.head?.sha,
    // Fork head content lives in the fork, not in the base repository's branch namespace.
    headRepo: p.head?.repo?.full_name ? `${id}~${p.head.repo.full_name}` : repo,
    additions: p.additions, deletions: p.deletions, changedFiles: p.changed_files ?? files?.length,
    state: p.merged ? "MERGED" : String(p.state || "open").toUpperCase(), isDraft: !!p.draft, labels: p.labels || [], files, commits,
  });
  const toComment = (c: GiteaComment) => comment({ id: c.id, body: c.body, created_at: c.created_at, prNumber: Number((String(c.html_url || "").match(/\/pulls?\/([1-9]\d*)(?:#|$)/) || [])[1]) || 0, userId: c.user?.id, login: c.user?.login });
  return {
    id, kind: "gitea", api, list, normalize,
    prUrl: (repo, n) => `${f.url}/${native(repo)}/pulls/${n}`,
    issueUrl: (repo, n) => `${f.url}/${native(repo)}/issues/${n}`,
    repoUrl: (repo) => `${f.url}/${native(repo)}`,
    parsePr(u) {
      const m = u.pathname.match(/^\/([\w][\w.-]*\/[\w][\w.-]*)\/pulls\/([1-9]\d*)$/);
      return m ? { native: m[1], number: Number(m[2]) } : null;
    },
    parseRepo(rest) { return /^[\w][\w.-]*\/[\w][\w.-]*$/.test(rest) ? rest : null; },
    async test() {
      const rows = await api<unknown[]>("user/repos?limit=1");
      if (!Array.isArray(rows)) throw new Error("Invalid git server response");
      return `Connected to ${f.label}`;
    },
    me: async () => { const u = await api<GiteaUser | null>("user"); return { id: u?.id, login: u?.login || u?.username || "" }; },
    listRepos: async () => (await list<{ full_name: string }>("user/repos")).map((x) => `${id}~${x.full_name}`),
    repoExists: (repo) => api(r(repo)).then(() => true),
    async pr(repo, n) {
      const path = `${r(repo)}/pulls/${n}`;
      const [p, files, commits] = await Promise.all([api<GiteaPull>(path), list<GiteaFile>(`${path}/files`), list<GiteaCommit>(`${path}/commits`)]);
      if (commits.length && !commits.some((c) => c.sha === p.head?.sha)) throw new Error("The git server is updating this pull request after a push. Retry the review shortly.");
      return normalize(p, repo,
        files.map((x) => ({ path: x.filename, additions: Number(x.additions) || 0, deletions: Number(x.deletions) || 0 })),
        // newest first from the server; the incremental engine expects oldest first
        commits.reverse().map((c) => commit(c.sha, c.commit?.message, c.author?.login || c.commit?.author?.name, c.commit?.author?.date)));
    },
    diff: (repo, n) => api<string>(`${r(repo)}/pulls/${n}.diff`, { raw: true }),
    openPrs: async (repo) => (await list<GiteaPull>(`${r(repo)}/pulls?state=open`)).map((p) => normalize(p, repo)),
    async file(repo, path, ref = "") {
      if (!safeFile(path)) return null;
      const data = await orNull(api<GiteaContent | null>(`${r(repo)}/contents/${encPath(path)}${ref ? `?ref=${enc(ref)}` : ""}`));
      if (!data) return null;
      if (data.encoding !== "base64" || typeof data.content !== "string") throw new Error("Invalid git server file content");
      return Buffer.from(data.content, "base64").toString("utf8");
    },
    async baseCommits(repo, branch, n = 8) {
      const rows = await api<GiteaCommit[]>(`${r(repo)}/commits?sha=${enc(branch)}&limit=${n}`);
      return (Array.isArray(rows) ? rows : []).map((c) => ({ sha: String(c.sha || "").slice(0, 7), message: firstLine(c.commit?.message).trim(), author: c.author?.login || c.commit?.author?.name || "" }));
    },
    async compare(repo, from, to) {
      const cmp = await api<{ files?: { filename?: string; patch?: string }[] } | null>(`${r(repo)}/compare/${enc(from)}...${enc(to)}`);
      return (cmp?.files || []).filter((x) => x?.filename && x?.patch).map((x) => `diff --git a/${x.filename} b/${x.filename}\n--- a/${x.filename}\n+++ b/${x.filename}\n${x.patch}`).join("\n\n");
    },
    async issue(repo, n) {
      const i = await orNull(api<GiteaIssue | null>(`${r(repo)}/issues/${n}`));
      return i?.number ? { number: i.number, title: i.title, body: i.body, state: i.state, url: `${f.url}/${native(repo)}/issues/${n}`, labels: (i.labels || []).map((l) => l?.name || String(l)) } : null;
    },
    status: (repo, sha, s) => api(`${r(repo)}/statuses/${sha}`, { method: "POST", body: s }),
    comments: async (repo, n) => (await api<GiteaComment[] | null>(`${r(repo)}/issues/${n}/comments`) || []).map(toComment), // ignores page/limit
    comment: (repo, n, body) => api(`${r(repo)}/issues/${n}/comments`, { method: "POST", body: { body } }),
    editComment: (repo, _n, cid, body) => api(`${r(repo)}/issues/comments/${Number(cid)}`, { method: "PATCH", body: { body } }),
    // One review with every comment; a line outside the diff fails the whole review (400/422), so all fall back.
    async inline(repo, n, list0, sha) {
      try {
        await api(`${r(repo)}/pulls/${n}/reviews`, { method: "POST", body: {
          event: "COMMENT", body: "CodeOtter inline suggestions", ...(sha ? { commit_id: sha } : {}),
          comments: list0.map((c) => ({ path: c.path, new_position: c.line, old_position: 0, body: c.body })),
        } });
        return [];
      } catch (e) {
        if (![400, 422].includes(statusOf(e) ?? 0)) throw e;
        return list0;
      }
    },
    singleLineSuggestions: true,
    setBody: (repo, n, body) => api(`${r(repo)}/pulls/${n}`, { method: "PATCH", body: { body } }),
    commentsSince: async (repo, since) => (await api<GiteaComment[] | null>(`${r(repo)}/issues/comments?since=${enc(since)}&limit=50`) || []).map(toComment),
    async trusted(repo, c) {
      const login = String(c.user?.login || "");
      if (!/^[\w][\w.-]*$/.test(login)) return false;
      const p = await orNull(api<{ permission?: string } | null>(`${r(repo)}/collaborators/${enc(login)}/permission`)).catch((e: unknown) => { if (statusOf(e) === 403) return null; throw e; });
      return ["owner", "admin", "write"].includes(String(p?.permission || "").toLowerCase());
    },
    react: (repo, c) => (Number.isSafeInteger(Number(c.id)) ? api(`${r(repo)}/issues/comments/${Number(c.id)}/reactions`, { method: "POST", body: { content: "eyes" } }) : null),
    async ensureHook(repo, url, secret) {
      const hooks = await api<GiteaHook[] | null>(`${r(repo)}/hooks`);
      if ((Array.isArray(hooks) ? hooks : []).some((h) => h?.config?.url === url)) return false;
      await api(`${r(repo)}/hooks`, { method: "POST", body: { type: "gitea", active: true, events: ["pull_request", "issue_comment", "pull_request_comment"], config: { url, content_type: "json", secret } } });
      return true;
    },
    async removeHook(repo, url) {
      const hooks = await api<GiteaHook[] | null>(`${r(repo)}/hooks`).catch((): GiteaHook[] => []);
      for (const h of Array.isArray(hooks) ? hooks : []) if (h?.config?.url === url && Number.isSafeInteger(Number(h.id))) await api(`${r(repo)}/hooks/${Number(h.id)}`, { method: "DELETE" }).catch(() => {});
    },
    hookMeta: (h) => ({ event: String(h[`x-${id}-event`] || h["x-gitea-event"] || ""), delivery: String(h[`x-${id}-delivery`] || h["x-gitea-delivery"] || ""), signature: h[`x-${id}-signature`] || h["x-gitea-signature"] }),
  };
}

// =====================================================================================================================
// Bitbucket Cloud. An Atlassian API token with the account email (Basic), or a workspace/repository access token (Bearer).
const BB_API = "https://api.bitbucket.org/2.0";
interface BbUser { nickname?: string; username?: string; display_name?: string; account_id?: string; uuid?: string }
interface BbRepoRef { links?: { html?: { href?: string } }; full_name?: string }
interface BbPull {
  id: number; title?: string; description?: string; summary?: { raw?: string }; author?: BbUser; updated_on?: string;
  destination?: { branch?: { name?: string }; repository?: BbRepoRef };
  source?: { branch?: { name?: string }; repository?: BbRepoRef; commit?: { hash?: string } };
  state?: string; draft?: boolean;
}
interface BbPage<T> { values?: T[]; next?: string }
interface BbDiffstat { new?: { path?: string }; old?: { path?: string }; lines_added?: number; lines_removed?: number }
interface BbCommit { hash: string; message?: string; author?: { user?: BbUser; raw?: string }; date?: string }
interface BbComment { id: number; content?: { raw?: string }; created_on?: string; user?: BbUser; inline?: unknown; parent?: unknown; deleted?: boolean }
interface BbRepo { mainbranch?: { name?: string }; workspace?: { slug?: string }; full_name?: string; slug?: string }
interface BbIssue { id?: number; title?: string; content?: { raw?: string }; state?: string; links?: { html?: { href?: string } }; kind?: string; priority?: string }
interface BbHook { url?: string; uuid: string }
interface BbEvent { pullrequest?: BbPull; repository?: BbRepoRef; comment?: BbComment }
function bitbucket(id: string, f: AuthedConfig): Forge {
  f.auth = () => (f.user ? `Basic ${Buffer.from(`${f.user}:${f.token}`).toString("base64")}` : `Bearer ${f.token}`);
  const api = <T = unknown>(path: string, opts: ApiOptions = {}): Promise<T> => {
    if (!f.token) throw new Error(`Configure an access token in Admin / Git providers / ${f.label}`);
    if (path.split(/[/?]/).some((p) => p === "." || p === "..")) throw new Error("Invalid git server API path");
    return http(f, `${BB_API}/${path}`, { ...opts, what: path.split("?")[0] }) as Promise<T>;
  };
  // Paged lists follow `next`, which must stay on the API origin.
  const list = async <T = unknown>(path: string, max = 2000): Promise<T[]> => {
    const rows: T[] = [];
    let url = `${BB_API}/${path}${path.includes("?") ? "&" : "?"}pagelen=50`;
    while (url && rows.length < max) {
      if (!url.startsWith(`${BB_API}/`)) throw new Error("Invalid Bitbucket page link");
      // a pull request's diffstat answers with a redirect to the repository diffstat; same origin only
      const page = await http(f, url, { what: path.split("?")[0], follow: true }) as BbPage<T> | null;
      rows.push(...(page?.values || []));
      url = page?.next || "";
    }
    return rows;
  };
  const r = (repo: string) => `repositories/${native(repo).split("/").map(enc).join("/")}`;
  const nativeOf = (repository: BbRepoRef | undefined) => {
    const href = repository?.links?.html?.href || "";
    const m = href.match(/^https:\/\/bitbucket\.org\/([\w][\w.-]*\/[\w][\w.-]*)\/?$/);
    return m ? m[1] : String(repository?.full_name || "");
  };
  const login = (u: BbUser | null | undefined) => u?.nickname || u?.username || u?.display_name || "";
  const normalize = (p: BbPull, repo: string, files?: PrFile[], commits?: PrCommit[]) => {
    const src = nativeOf(p.source?.repository);
    return pullRequest({
      number: p.id, title: p.title, body: p.description || p.summary?.raw, url: `https://bitbucket.org/${native(repo)}/pull-requests/${p.id}`,
      author: login(p.author), updatedAt: p.updated_on,
      baseRefName: p.destination?.branch?.name, headRefName: p.source?.branch?.name,
      // the PR object carries a 12-character hash; the commit list has the full one
      headRefOid: commits?.length ? commits.at(-1)?.oid : p.source?.commit?.hash,
      headRepo: src && src !== native(repo) ? `${id}~${src}` : repo,
      files, commits, state: ({ OPEN: "OPEN", MERGED: "MERGED", DECLINED: "CLOSED", SUPERSEDED: "CLOSED" } as Record<string, string>)[String(p.state)] || String(p.state || "OPEN"), isDraft: !!p.draft,
    });
  };
  const toComment = (c: BbComment, n: number) => comment({ id: c.id, body: c.content?.raw, created_at: c.created_on, prNumber: n, userId: c.user?.account_id || c.user?.uuid, login: login(c.user) });
  const topLevel = (c: BbComment) => !c.inline && !c.parent && !c.deleted;
  return {
    id, kind: "bitbucket", api, list, normalize,
    prUrl: (repo, n) => `https://bitbucket.org/${native(repo)}/pull-requests/${n}`,
    issueUrl: (repo, n) => `https://bitbucket.org/${native(repo)}/issues/${n}`,
    repoUrl: (repo) => `https://bitbucket.org/${native(repo)}`,
    parsePr(u) {
      const m = u.pathname.match(/^\/([\w][\w.-]*\/[\w][\w.-]*)\/pull-requests\/([1-9]\d*)$/);
      return m ? { native: m[1], number: Number(m[2]) } : null;
    },
    parseRepo(rest) { const m = rest.match(/^([\w][\w.-]*\/[\w][\w.-]*)(?:\/(?:src|branches|pull-requests)(?:\/.*)?)?$/); return m ? m[1] : null; },
    async test() {
      if (f.user) { const u = await api<BbUser>("user"); return `Connected to Bitbucket as ${login(u) || "user"}`; }
      await api("repositories?role=member&pagelen=1");
      return "Connected to Bitbucket";
    },
    me: async () => { const u = await orNull(api<BbUser | null>("user")).catch(() => null); return u ? { id: u.account_id || u.uuid, login: login(u) } : null; },
    listRepos: async () => (await list<BbRepo>("repositories?role=member")).map((x) => `${id}~${x.workspace?.slug || String(x.full_name).split("/")[0]}/${x.slug}`),
    repoExists: (repo) => api(r(repo)).then(() => true),
    async pr(repo, n) {
      const path = `${r(repo)}/pullrequests/${n}`;
      const [p, stat, commits] = await Promise.all([api<BbPull>(path), list<BbDiffstat>(`${path}/diffstat`), list<BbCommit>(`${path}/commits`, 500)]);
      const files = stat.map((s) => ({ path: s.new?.path || s.old?.path || "", additions: Number(s.lines_added) || 0, deletions: Number(s.lines_removed) || 0 })).filter((x) => x.path);
      return normalize(p, repo, files, commits.reverse().map((c) => commit(c.hash, c.message, login(c.author?.user) || String(c.author?.raw || "").replace(/\s*<.*>$/, ""), c.date)));
    },
    diff: (repo, n) => api<string>(`${r(repo)}/pullrequests/${n}/diff`, { as: "text", follow: true }),
    openPrs: async (repo) => (await list<BbPull>(`${r(repo)}/pullrequests?state=OPEN`, 200)).map((p) => normalize(p, repo)),
    async file(repo, path, ref = "") {
      if (!safeFile(path)) return null;
      const at = ref || (await api<BbRepo>(r(repo))).mainbranch?.name;
      if (!at || /[\s?#]/.test(at)) return null;
      return orNull(api<string>(`${r(repo)}/src/${enc(at)}/${encPath(path)}`, { as: "text" }));
    },
    async baseCommits(repo, branch, n = 8) {
      const page = await api<BbPage<BbCommit> | null>(`${r(repo)}/commits?include=${enc(branch)}&pagelen=${n}`);
      return (page?.values || []).map((c) => ({ sha: String(c.hash || "").slice(0, 7), message: firstLine(c.message).trim(), author: login(c.author?.user) || String(c.author?.raw || "").replace(/\s*<.*>$/, "") }));
    },
    // "a..b" is what a has that b lacks, from their merge base
    compare: (repo, from, to) => api<string>(`${r(repo)}/diff/${enc(to)}..${enc(from)}`, { as: "text" }),
    async issue(repo, n) {
      const i = await orNull(api<BbIssue | null>(`${r(repo)}/issues/${n}`)).catch((e: unknown) => { if (statusOf(e) === 403) return null; throw e; });
      return i?.id ? { number: i.id, title: i.title, body: i.content?.raw, state: i.state, url: i.links?.html?.href || `https://bitbucket.org/${native(repo)}/issues/${n}`, labels: [i.kind, i.priority].filter((x): x is string => Boolean(x)) } : null;
    },
    status: (repo, sha, s) => api(`${r(repo)}/commit/${enc(sha)}/statuses/build`, { method: "POST", body: { key: s.context.replace(/[^\w-]/g, "-").slice(0, 40), name: s.context, state: STATE.bitbucket[s.state] || "FAILED", description: s.description, url: s.target_url } }),
    comments: async (repo, n) => (await list<BbComment>(`${r(repo)}/pullrequests/${n}/comments`)).filter(topLevel).map((c) => toComment(c, n)),
    comment: (repo, n, body) => api(`${r(repo)}/pullrequests/${n}/comments`, { method: "POST", body: { content: { raw: body } } }),
    editComment: (repo, n, cid, body) => api(`${r(repo)}/pullrequests/${n}/comments/${Number(cid)}`, { method: "PUT", body: { content: { raw: body } } }),
    // One comment per line; any the server cannot anchor are returned for the fallback comment.
    async inline(repo, n, list0) {
      const failed: typeof list0 = [];
      for (const c of list0) {
        try {
          await api(`${r(repo)}/pullrequests/${n}/comments`, { method: "POST", body: { content: { raw: c.body }, inline: { path: c.path, to: c.line } } });
        } catch (e) {
          if (![400, 422].includes(statusOf(e) ?? 0)) throw e;
          failed.push(c);
        }
      }
      return failed;
    },
    async setBody(repo, n, body) {
      const p = await api<BbPull>(`${r(repo)}/pullrequests/${n}`);
      return api(`${r(repo)}/pullrequests/${n}`, { method: "PUT", body: { title: p.title, description: body } });
    },
    // No repository-wide comment feed: the open pull requests updated since, then their comments since.
    async commentsSince(repo, since) {
      const q = enc(`state="OPEN" AND updated_on>${new Date(since).toISOString()}`);
      const prs = await list<BbPull>(`${r(repo)}/pullrequests?q=${q}&sort=-updated_on`, 30);
      const out: ForgeComment[] = [];
      for (const p of prs) {
        const cs = await list<BbComment>(`${r(repo)}/pullrequests/${p.id}/comments?q=${enc(`created_on>${new Date(since).toISOString()}`)}`, 200);
        out.push(...cs.filter((c) => !c.deleted).map((c) => toComment(c, p.id)));
      }
      return out;
    },
    // Write access on the repository. Reading another user's permission needs an admin token; without it nobody is trusted.
    async trusted(repo, c) {
      const who = String(c.user?.id || "");
      if (!who || /[/?#\s]/.test(who)) return false;
      const p = await api<{ permission?: string } | null>(`${r(repo)}/permissions-config/users/${enc(who)}`).catch((e: unknown) => { if ([401, 403, 404].includes(statusOf(e) ?? 0)) return null; throw e; });
      return ["admin", "write"].includes(String(p?.permission || ""));
    },
    react: () => null,
    async ensureHook(repo, url, secret) {
      const hooks = await list<BbHook>(`${r(repo)}/hooks`);
      if (hooks.some((h) => h?.url === url)) return false;
      await api(`${r(repo)}/hooks`, { method: "POST", body: { description: "CodeOtter", url, active: true, secret, events: ["pullrequest:created", "pullrequest:updated", "pullrequest:push", "pullrequest:comment_created"] } });
      return true;
    },
    async removeHook(repo, url) {
      const hooks = await list<BbHook>(`${r(repo)}/hooks`).catch((): BbHook[] => []);
      for (const h of hooks) if (h?.url === url && /^\{[0-9a-f-]+\}$/i.test(String(h.uuid || ""))) await api(`${r(repo)}/hooks/${enc(h.uuid)}`, { method: "DELETE" }).catch(() => {});
    },
    hookMeta: (h) => ({ event: String(h["x-event-key"] || ""), delivery: String(h["x-request-uuid"] || ""), signature: h["x-hub-signature"] }),
    // -> { repo, pr } | { repo, comment } | null
    route(event: string, x: BbEvent | null | undefined) {
      const p = x?.pullrequest;
      if (!p) return null;
      const repo = `${id}~${nativeOf(p.destination?.repository || x.repository)}`;
      // pushes to the source branch arrive as pullrequest:push, edits as pullrequest:updated
      if (["pullrequest:created", "pullrequest:updated", "pullrequest:push"].includes(event)) return p.state === "OPEN" ? { repo, pr: normalize(p, repo) } : null;
      if (event === "pullrequest:comment_created" && x.comment && !x.comment.deleted) return { repo, comment: toComment(x.comment, p.id) };
      return null;
    },
  };
}

// =====================================================================================================================
// Bitbucket Data Center. An HTTP access token (Bearer).
interface DcUser { slug?: string; name?: string; id?: number }
interface DcRepoRef { project?: { key?: string; type?: string }; slug?: string }
interface DcPull {
  id: number; title?: string; description?: string; author?: { user?: DcUser }; updatedDate?: number;
  toRef?: { displayId?: string; repository?: DcRepoRef };
  fromRef?: { displayId?: string; latestCommit?: string; repository?: DcRepoRef };
  state?: string; draft?: boolean; version?: number;
}
interface DcPage<T> { values?: T[]; isLastPage?: boolean; nextPageStart: number }
interface DcComment { id: number; text?: string; createdDate?: number; author?: DcUser; version?: number }
interface DcActivity { action?: string; comment?: DcComment; commentAnchor?: unknown }
interface DcCommit { id: string; message?: string; author?: DcUser; authorTimestamp?: number }
interface DcSegment { type?: string; lines?: { line: string }[] }
interface DcHunk { sourceLine: number; sourceSpan: number; destinationLine: number; destinationSpan: number; segments?: DcSegment[] }
interface DcFileDiff { source?: { toString?: string }; destination?: { toString?: string }; binary?: boolean; hunks?: DcHunk[] }
interface DcDiff { diffs?: DcFileDiff[] }
interface DcHook { url?: string; id?: number }
interface DcEvent { pullRequest?: DcPull; comment?: DcComment; commentParentId?: number }
function bitbucketdc(id: string, f: AuthedConfig): Forge {
  f.auth = () => `Bearer ${f.token}`;
  const api = <T = unknown>(path: string, opts: ApiOptions = {}): Promise<T> => {
    if (!f.url) throw new Error(`Set the ${f.label} server under Admin / Git providers`);
    if (!f.token) throw new Error(`Configure an access token in Admin / Git providers / ${f.label}`);
    if (path.split(/[/?]/).some((p) => p === "." || p === "..")) throw new Error("Invalid git server API path");
    return http(f, `${f.url}/rest/${path.startsWith("build-status/") ? "" : "api/latest/"}${path}`, { ...opts, what: path.split("?")[0] }) as Promise<T>;
  };
  const list = async <T = unknown>(path: string, max = 2000): Promise<T[]> => {
    const rows: T[] = [];
    for (let start = 0; rows.length < max;) {
      const page = await api<DcPage<T> | null>(`${path}${path.includes("?") ? "&" : "?"}limit=100&start=${start}`);
      rows.push(...(page?.values || []));
      if (page?.isLastPage !== false || !Number.isSafeInteger(page.nextPageStart)) break;
      start = page.nextPageStart;
    }
    return rows;
  };
  const r = (repo: string) => { const [key, slug] = native(repo).split("/"); return `projects/${enc(key)}/repos/${enc(slug)}`; };
  const nativeOf = (repository: DcRepoRef | undefined) => `${repository?.project?.key || ""}/${repository?.slug || ""}`;
  const login = (u: DcUser | undefined) => u?.slug || u?.name || "";
  const toComment = (c: DcComment, n: number) => comment({ id: c.id, body: c.text, created_at: iso(c.createdDate), prNumber: n, userId: c.author?.id, login: login(c.author) });
  const normalize = (p: DcPull, repo: string, files?: PrFile[], commits?: PrCommit[]) => {
    const src = nativeOf(p.fromRef?.repository);
    return pullRequest({
      number: p.id, title: p.title, body: p.description, url: `${f.url}/projects/${native(repo).split("/")[0]}/repos/${native(repo).split("/")[1]}/pull-requests/${p.id}`,
      author: login(p.author?.user), updatedAt: iso(p.updatedDate),
      baseRefName: p.toRef?.displayId, headRefName: p.fromRef?.displayId, headRefOid: p.fromRef?.latestCommit,
      headRepo: src !== "/" && src !== native(repo) ? `${id}~${src}` : repo,
      files, commits, state: ({ OPEN: "OPEN", MERGED: "MERGED", DECLINED: "CLOSED" } as Record<string, string>)[String(p.state)] || String(p.state || "OPEN"), isDraft: !!p.draft,
    });
  };
  // JSON diff -> unified text
  const unified = (d: DcDiff | null) => (d?.diffs || []).map((x) => {
    const a = x.source?.toString || "", b = x.destination?.toString || "";
    const head = [`diff --git a/${a || b} b/${b || a}`, ...(!a ? ["new file mode 100644"] : []), ...(!b ? ["deleted file mode 100644"] : [])];
    if (x.binary) return [...head, `Binary files ${a ? `a/${a}` : "/dev/null"} and ${b ? `b/${b}` : "/dev/null"} differ`].join("\n");
    const body = (x.hunks || []).flatMap((h) => [
      `@@ -${h.sourceLine},${h.sourceSpan} +${h.destinationLine},${h.destinationSpan} @@`,
      ...(h.segments || []).flatMap((s) => (s.lines || []).map((l) => (({ ADDED: "+", REMOVED: "-" } as Record<string, string>)[String(s.type)] || " ") + l.line)),
    ]);
    return body.length ? [...head, `--- ${a ? `a/${a}` : "/dev/null"}`, `+++ ${b ? `b/${b}` : "/dev/null"}`, ...body].join("\n") : head.join("\n");
  }).join("\n");
  const prDiff = async (repo: string, n: number) => unified(await api<DcDiff | null>(`${r(repo)}/pull-requests/${n}/diff?contextLines=3&withComments=false`));
  const comments = async (repo: string, n: number) => (await list<DcActivity>(`${r(repo)}/pull-requests/${n}/activities`, 1000))
    .filter((a): a is DcActivity & { comment: DcComment } => a.action === "COMMENTED" && !!a.comment && !a.commentAnchor).map((a) => toComment(a.comment, n));
  return {
    id, kind: "bitbucketdc", api, list, normalize,
    prUrl: (repo, n) => `${f.url}/projects/${native(repo).split("/")[0]}/repos/${native(repo).split("/")[1]}/pull-requests/${n}`,
    issueUrl: () => "",
    repoUrl: (repo) => `${f.url}/projects/${native(repo).split("/")[0]}/repos/${native(repo).split("/")[1]}`,
    parsePr(u) {
      const m = u.pathname.match(/^\/projects\/([\w][\w.-]*)\/repos\/([\w][\w.-]*)\/pull-requests\/([1-9]\d*)$/);
      return m ? { native: `${m[1]}/${m[2]}`, number: Number(m[3]) } : null;
    },
    parseRepo(rest) { const m = rest.match(/^projects\/([\w][\w.-]*)\/repos\/([\w][\w.-]*)(?:\/.*)?$/); return m ? `${m[1]}/${m[2]}` : /^[\w][\w.-]*\/[\w][\w.-]*$/.test(rest) ? rest : null; },
    async test() { await api("repos?limit=1"); return `Connected to ${f.label}`; },
    me: async () => null, // comments are matched by the CodeOtter marker alone
    listRepos: async () => (await list<DcRepoRef>("repos")).filter((x) => x.project?.type !== "PERSONAL").map((x) => `${id}~${nativeOf(x)}`),
    repoExists: (repo) => api(r(repo)).then(() => true),
    async pr(repo, n) {
      const path = `${r(repo)}/pull-requests/${n}`;
      const [p, diff, commits] = await Promise.all([api<DcPull>(path), prDiff(repo, n), list<DcCommit>(`${path}/commits`, 500)]);
      return normalize(p, repo, diffStats(diff), commits.reverse().map((c) => commit(c.id, c.message, login(c.author) || c.author?.name, iso(c.authorTimestamp))));
    },
    diff: prDiff,
    openPrs: async (repo) => (await list<DcPull>(`${r(repo)}/pull-requests?state=OPEN`, 200)).map((p) => normalize(p, repo)),
    async file(repo, path, ref = "") {
      if (!safeFile(path)) return null;
      return orNull(api<string>(`${r(repo)}/raw/${encPath(path)}${ref ? `?at=${enc(ref)}` : ""}`, { as: "text" }));
    },
    async baseCommits(repo, branch, n = 8) {
      const page = await api<DcPage<DcCommit> | null>(`${r(repo)}/commits?until=${enc(branch)}&limit=${n}`);
      return (page?.values || []).map((c) => ({ sha: String(c.id || "").slice(0, 7), message: firstLine(c.message).trim(), author: login(c.author) || c.author?.name || "" }));
    },
    compare: async (repo, from, to) => unified(await api<DcDiff | null>(`${r(repo)}/compare/diff?from=${enc(to)}&to=${enc(from)}&contextLines=3`)),
    issue: async () => null, // issues live in Jira
    status: (_repo, sha, s) => api(`build-status/1.0/commits/${enc(sha)}`, { method: "POST", body: { state: STATE.bitbucket[s.state] || "FAILED", key: s.context, name: s.context, url: s.target_url, description: s.description } }),
    comments,
    comment: (repo, n, body) => api(`${r(repo)}/pull-requests/${n}/comments`, { method: "POST", body: { text: body } }),
    async editComment(repo, n, cid, body) {
      const c = await api<DcComment>(`${r(repo)}/pull-requests/${n}/comments/${Number(cid)}`);
      return api(`${r(repo)}/pull-requests/${n}/comments/${Number(cid)}`, { method: "PUT", body: { text: body, version: c.version } });
    },
    async inline(repo, n, list0) {
      const failed: typeof list0 = [];
      for (const c of list0) {
        let ok = false;
        // the server wants to know whether the line was added or is context; try both
        for (const lineType of ["ADDED", "CONTEXT"]) {
          try {
            await api(`${r(repo)}/pull-requests/${n}/comments`, { method: "POST", body: { text: c.body, anchor: { path: c.path, line: c.line, lineType, fileType: "TO", diffType: "EFFECTIVE" } } });
            ok = true;
            break;
          } catch (e) {
            if (![400, 409, 422].includes(statusOf(e) ?? 0)) throw e;
          }
        }
        if (!ok) failed.push(c);
      }
      return failed;
    },
    async setBody(repo, n, body) {
      const p = await api<DcPull>(`${r(repo)}/pull-requests/${n}`);
      return api(`${r(repo)}/pull-requests/${n}`, { method: "PUT", body: { version: p.version, title: p.title, description: body } });
    },
    async commentsSince(repo, since) {
      const t = Date.parse(since);
      const prs = (await list<DcPull>(`${r(repo)}/pull-requests?state=OPEN&order=NEWEST`, 100)).filter((p) => Number(p.updatedDate) > t).slice(0, 30);
      const out: ForgeComment[] = [];
      for (const p of prs) out.push(...(await comments(repo, p.id)).filter((c) => Date.parse(c.created_at) > t));
      return out;
    },
    // A direct user grant on the repository or its project. Group grants are not resolved: those users are not trusted.
    async trusted(repo, c) {
      const who = String(c.user?.login || "");
      if (!/^[\w][\w.@+-]*$/.test(who)) return false;
      const [key] = native(repo).split("/");
      const grant = async (path: string, ok: string[]) => {
        const rows = await list<{ user?: DcUser; permission: string }>(`${path}/permissions/users?filter=${enc(who)}`, 100).catch((e: unknown) => { if ([401, 403, 404].includes(statusOf(e) ?? 0)) return []; throw e; });
        return rows.some((x) => login(x.user) === who && ok.includes(x.permission));
      };
      return (await grant(r(repo), ["REPO_WRITE", "REPO_ADMIN"])) || grant(`projects/${enc(key)}`, ["PROJECT_WRITE", "PROJECT_ADMIN"]);
    },
    react: () => null,
    async ensureHook(repo, url, secret) {
      const hooks = await list<DcHook>(`${r(repo)}/webhooks`, 200);
      if (hooks.some((h) => h?.url === url)) return false;
      await api(`${r(repo)}/webhooks`, { method: "POST", body: { name: "CodeOtter", url, active: true, events: ["pr:opened", "pr:from_ref_updated", "pr:comment:added"], configuration: { secret } } });
      return true;
    },
    async removeHook(repo, url) {
      const hooks = await list<DcHook>(`${r(repo)}/webhooks`, 200).catch((): DcHook[] => []);
      for (const h of hooks) if (h?.url === url && Number.isSafeInteger(Number(h.id))) await api(`${r(repo)}/webhooks/${Number(h.id)}`, { method: "DELETE" }).catch(() => {});
    },
    hookMeta: (h) => ({ event: String(h["x-event-key"] || ""), delivery: String(h["x-request-id"] || ""), signature: h["x-hub-signature"] }),
    route(event: string, x: DcEvent | null | undefined) {
      const p = x?.pullRequest;
      if (!p) return null;
      const repo = `${id}~${nativeOf(p.toRef?.repository)}`;
      if (event === "pr:opened" || event === "pr:from_ref_updated") return p.state === "OPEN" ? { repo, pr: normalize(p, repo) } : null;
      if (event === "pr:comment:added" && x.comment && !x.commentParentId) return { repo, comment: toComment(x.comment, p.id) };
      return null;
    },
  };
}

// =====================================================================================================================
// Azure DevOps Services. A personal access token (Basic, empty user) and the organizations it may read.
// Azure has no unified-diff endpoint: the diff is built here from the blobs of each changed file.
const AZ = "https://dev.azure.com";
const AZ_SEG = /^[\w](?:[\w. -]*[\w.-])?$/;
export const AZURE_MAX_DESCRIPTION = 4000;
interface AzIdentity { uniqueName?: string; displayName?: string; id?: string }
interface AzRepoRef { webUrl?: string; remoteUrl?: string }
interface AzPull {
  pullRequestId: number; title?: string; description?: string; createdBy?: AzIdentity; closedDate?: string; creationDate?: string;
  targetRefName?: string; sourceRefName?: string; lastMergeSourceCommit?: { commitId?: string };
  forkSource?: { repository?: AzRepoRef }; repository?: AzRepoRef; status?: string; isDraft?: boolean;
  labels?: { name: string; active?: boolean }[];
}
interface AzList<T> { value?: T[] }
interface AzIteration { id: number; sourceRefCommit?: { commitId?: string } }
interface AzChange {
  changeType?: string; originalPath?: string; sourceServerItem?: string;
  item?: { path?: string; isFolder?: boolean; gitObjectType?: string; objectId?: string; originalObjectId?: string };
}
interface AzCommit { commitId: string; comment?: string; author?: { name?: string; date?: string } }
interface AzComment {
  id: number; parentCommentId?: number; isDeleted?: boolean; commentType?: string; content?: string; publishedDate: string;
  author?: AzIdentity; _links?: { threads?: { href?: string } };
}
interface AzThread { id: number; isDeleted?: boolean; threadContext?: unknown; comments?: AzComment[] }
interface AzGitRepo { id?: string; name: string; isDisabled?: boolean; project: { id?: string; name: string } }
interface AzWorkItem { id: number; fields?: { "System.Title"?: string; "System.Description"?: string; "System.State"?: string; "System.Tags"?: string } }
interface AzSubscription { id?: string; eventType?: string; consumerInputs?: { url?: string }; publisherInputs?: { repository?: string } }
interface AzEvent { eventType?: string; id?: string; notificationId?: number; resource?: AzPull & { pullRequest?: AzPull; comment?: AzComment } }
interface BlobRead { text: string | null; binary?: boolean }
function azure(id: string, f: AuthedConfig): Forge {
  f.auth = () => `Basic ${Buffer.from(`:${f.token}`).toString("base64")}`;
  const parts = (repo: string) => native(repo).split("/");
  // path under dev.azure.com/<org>/..., with api-version added
  const api = <T = unknown>(path: string, opts: ApiOptions = {}): Promise<T> => {
    if (!f.token) throw new Error(`Configure an access token in Admin / Git providers / ${f.label}`);
    if (path.split(/[/?]/).some((p) => p === "." || p === "..")) throw new Error("Invalid git server API path");
    // a path that names its own api-version keeps it (connectionData only exists as a preview)
    return http(f, path.includes("api-version=") ? `${AZ}/${path}` : `${AZ}/${path}${path.includes("?") ? "&" : "?"}api-version=7.1`, { ...opts, what: path.split("?")[0] }) as Promise<T>;
  };
  const g = (repo: string) => { const [org, project, name] = parts(repo); return `${enc(org)}/${enc(project)}/_apis/git/repositories/${enc(name)}`; };
  const web = (repo: string) => { const [org, project, name] = parts(repo); return `${AZ}/${enc(org)}/${enc(project)}/_git/${enc(name)}`; };
  // org/project/repo from a repository's webUrl or remoteUrl: dev.azure.com/<org>/<project>/_git/<repo> (remoteUrl may
  // carry "<org>@"), or the older <org>.visualstudio.com/[DefaultCollection/]<project>/_git/<repo>
  const nativeOfWeb = (href: string | undefined) => {
    const s = String(href || "");
    const m = s.match(/^https:\/\/(?:[^@/]+@)?dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\/([^/?#]+)/)
      || s.match(/^https:\/\/([\w-]+)\.visualstudio\.com\/(?:DefaultCollection\/)?([^/]+)\/_git\/([^/?#]+)/);
    if (!m) return "";
    try {
      const [org, project, name] = m.slice(1, 4).map((x) => decodeURIComponent(x));
      return [org, project, name].every((x) => AZ_SEG.test(x)) ? `${org}/${project}/${name}` : "";
    } catch { return ""; }
  };
  const repoOfPayload = (r: AzRepoRef | undefined) => nativeOfWeb(r?.webUrl) || nativeOfWeb(r?.remoteUrl);
  const branch = (ref: string | undefined) => String(ref || "").replace(/^refs\/heads\//, "");
  const login = (u: AzIdentity | undefined) => u?.uniqueName || u?.displayName || "";
  const normalize = (p: AzPull, repo: string, files?: PrFile[], commits?: PrCommit[]) => {
    const fork = repoOfPayload(p.forkSource?.repository);
    return pullRequest({
      number: p.pullRequestId, title: p.title, body: p.description, url: `${web(repo)}/pullrequest/${p.pullRequestId}`,
      author: login(p.createdBy), updatedAt: p.closedDate || p.creationDate,
      baseRefName: branch(p.targetRefName), headRefName: branch(p.sourceRefName), headRefOid: p.lastMergeSourceCommit?.commitId,
      headRepo: fork ? `${id}~${fork}` : repo,
      files, commits, state: ({ active: "OPEN", completed: "MERGED", abandoned: "CLOSED" } as Record<string, string>)[String(p.status)] || "OPEN", isDraft: !!p.isDraft,
      labels: (p.labels || []).filter((l) => l.active !== false).map((l) => ({ name: l.name })),
    });
  };
  // One top-level thread comment; its id is "<thread>:<comment>" so it can be edited later.
  const toComment = (t: number, c: AzComment, n: number) => comment({ id: `${t}:${c.id}`, body: c.content, created_at: c.publishedDate, prNumber: n, userId: c.author?.id, login: login(c.author) });
  const blob = async (repo: string, objectId: string | undefined): Promise<BlobRead> => {
    if (!/^[0-9a-f]{40}$/i.test(String(objectId || ""))) return { text: null, binary: false };
    const buf = await api<Buffer>(`${g(repo)}/blobs/${objectId}?$format=octetstream`, { as: "buffer" });
    if (buf.length > 1e6 || isBinary(buf)) return { text: "", binary: true };
    return { text: buf.toString("utf8"), binary: false };
  };
  // Unified diff from change entries: [{ path, originalPath, changeType, objectId, originalObjectId }]
  const build = async (repo: string, entries: AzChange[], max = 300) => {
    const out: string[] = [];
    for (const e of entries.slice(0, max)) {
      const type = String(e.changeType || "");
      const path = String(e.item?.path || "").replace(/^\//, "");
      if (!path || e.item?.isFolder || e.item?.gitObjectType === "tree") continue;
      const oldPath = String(e.originalPath || e.sourceServerItem || e.item?.path || "").replace(/^\//, "");
      const added = /\badd\b/.test(type), deleted = /\bdelete\b/.test(type);
      const [a, b] = await Promise.all([added ? ({ text: null } as BlobRead) : blob(repo, e.item?.originalObjectId), deleted ? ({ text: null } as BlobRead) : blob(repo, e.item?.objectId)]);
      const section = fileDiff({ oldPath: added ? "" : oldPath, newPath: deleted ? "" : path, oldText: added ? null : a.text ?? "", newText: deleted ? null : b.text ?? "", binary: a.binary || b.binary });
      if (section) out.push(section);
    }
    return out.join("\n");
  };
  const lastIteration = async (repo: string, n: number) => {
    const its = (await api<AzList<AzIteration> | null>(`${g(repo)}/pullRequests/${n}/iterations`))?.value || [];
    return its.reduce<AzIteration | null>((m, x) => (!m || x.id > m.id ? x : m), null);
  };
  const changes = async (repo: string, n: number, it: AzIteration) => {
    const out: AzChange[] = [];
    for (let skip = 0; skip < 5000; skip += 1000) {
      const page = await api<{ changeEntries?: AzChange[] } | null>(`${g(repo)}/pullRequests/${n}/iterations/${it.id}/changes?$top=1000&$skip=${skip}&$compareTo=0`);
      const rows = page?.changeEntries || [];
      out.push(...rows);
      if (rows.length < 1000) break;
    }
    return out;
  };
  // A review reads the PR and then its diff; building the diff costs two blob reads per file, so it is kept per head.
  const diffs = new Map<string, Promise<string>>();
  const prDiff = async (repo: string, n: number, it0?: AzIteration | null) => {
    const it = it0 || (await lastIteration(repo, n));
    if (!it) return "";
    const key = `${repo}#${n}@${it.sourceRefCommit?.commitId || it.id}`;
    if (!diffs.has(key)) {
      diffs.set(key, build(repo, await changes(repo, n, it)));
      if (diffs.size > 20) diffs.delete(diffs.keys().next().value!); // over 20 entries: the first key exists
    }
    return diffs.get(key)!.catch((e: unknown) => { diffs.delete(key); throw e; }); // set just above
  };
  const threads = async (repo: string, n: number) => (await api<AzList<AzThread> | null>(`${g(repo)}/pullRequests/${n}/threads`))?.value || [];
  const comments = async (repo: string, n: number) => (await threads(repo, n))
    .filter((t): t is AzThread & { comments: AzComment[] } => !t.isDeleted && !t.threadContext && !!t.comments?.length)
    .map((t) => { const c = t.comments.find((x) => !x.parentCommentId) || t.comments[0]; return c.isDeleted || c.commentType === "system" ? null : toComment(t.id, c, n); })
    .filter((c): c is ForgeComment => Boolean(c));
  const ids = async (repo: string) => { const x = await api<AzGitRepo>(g(repo)); return { repositoryId: x.id, projectId: x.project?.id }; };
  const EVENTS = ["git.pullrequest.created", "git.pullrequest.updated", "ms.vss-code.git-pullrequest-comment-event"];
  return {
    id, kind: "azure", api, normalize,
    prUrl: (repo, n) => `${web(repo)}/pullrequest/${n}`,
    issueUrl: (repo, n) => { const [org, project] = parts(repo); return `${AZ}/${enc(org)}/${enc(project)}/_workitems/edit/${n}`; },
    repoUrl: web,
    parsePr(u) {
      const m = u.pathname.match(/^\/([^/]+)\/([^/]+)\/_git\/([^/]+)\/pullrequest\/([1-9]\d*)$/);
      if (!m) return null;
      const segs = m.slice(1, 4).map((s) => { try { return decodeURIComponent(s); } catch { return ""; } });
      if (!segs.every((s) => AZ_SEG.test(s)) || segs.map(enc).join("/") !== m.slice(1, 4).join("/")) return null;
      return { native: segs.join("/"), number: Number(m[4]) };
    },
    parseRepo(rest) {
      const m = rest.match(/^([^/]+)\/([^/]+)\/_git\/([^/?#]+)(?:[/?].*)?$/) || rest.match(/^([^/]+)\/([^/]+)\/([^/]+)$/);
      if (!m) return null;
      const segs = m.slice(1, 4).map((s) => { try { return decodeURIComponent(s); } catch { return ""; } });
      return segs.every((s) => AZ_SEG.test(s)) ? segs.join("/") : null;
    },
    async test() {
      if (!f.orgs?.length) throw new Error("Add the Azure DevOps organizations to read");
      for (const org of f.orgs) await api(`${enc(org)}/_apis/projects?$top=1`);
      return `Connected to Azure DevOps (${f.orgs.join(", ")})`;
    },
    me: async (repo) => { const d = await api<{ authenticatedUser?: { id?: string } } | null>(`${enc(parts(repo)[0])}/_apis/connectionData?api-version=7.1-preview`).catch(() => null); return d?.authenticatedUser ? { id: d.authenticatedUser.id, login: "" } : null; },
    async listRepos() {
      const out: string[] = [];
      for (const org of f.orgs || []) {
        for (const x of (await api<AzList<AzGitRepo> | null>(`${enc(org)}/_apis/git/repositories`))?.value || []) {
          if (!x.isDisabled && AZ_SEG.test(x.project?.name || "") && AZ_SEG.test(x.name || "")) out.push(`${id}~${org}/${x.project.name}/${x.name}`);
        }
      }
      return out;
    },
    repoExists: (repo) => api(g(repo)).then(() => true),
    async pr(repo, n) {
      const [p, it, cs] = await Promise.all([api<AzPull>(`${g(repo)}/pullrequests/${n}`), lastIteration(repo, n), api<AzList<AzCommit> | null>(`${g(repo)}/pullRequests/${n}/commits?$top=500`)]);
      const commits = (cs?.value || []).reverse().map((c) => commit(c.commitId, c.comment, c.author?.name, c.author?.date));
      if (commits.length && p.lastMergeSourceCommit?.commitId && commits.at(-1)?.oid !== p.lastMergeSourceCommit.commitId) throw new Error("Azure DevOps is updating this pull request after a push. Retry the review shortly.");
      return normalize(p, repo, diffStats(await prDiff(repo, n, it)), commits);
    },
    diff: (repo, n) => prDiff(repo, n),
    openPrs: async (repo) => ((await api<AzList<AzPull> | null>(`${g(repo)}/pullrequests?searchCriteria.status=active&$top=200`))?.value || []).map((p) => normalize(p, repo)),
    async file(repo, path, ref = "") {
      if (!safeFile(path)) return null;
      const version = ref ? `&versionDescriptor.version=${enc(ref)}&versionDescriptor.versionType=${isSha(ref) ? "commit" : "branch"}` : "";
      const item = await orNull(api<{ content?: unknown } | null>(`${g(repo)}/items?path=${enc(`/${path}`)}&includeContent=true${version}`));
      return item && typeof item.content === "string" ? item.content : null;
    },
    async baseCommits(repo, b, n = 8) {
      const rows = (await api<AzList<AzCommit> | null>(`${g(repo)}/commits?searchCriteria.itemVersion.version=${enc(b)}&searchCriteria.$top=${n}`))?.value || [];
      return rows.map((c) => ({ sha: String(c.commitId || "").slice(0, 7), message: firstLine(c.comment).trim(), author: c.author?.name || "" }));
    },
    async compare(repo, from, to) {
      const d = await api<{ changes?: AzChange[] } | null>(`${g(repo)}/diffs/commits?baseVersion=${enc(from)}&baseVersionType=commit&targetVersion=${enc(to)}&targetVersionType=commit&diffCommonCommit=true&$top=1000`);
      // the diffs endpoint lists items with objectIds; the changes shape matches the iteration one
      return build(repo, (d?.changes || []).map((c) => ({ ...c, item: { ...c.item } })));
    },
    async issue(repo, n) {
      const [org, project] = parts(repo);
      const w = await orNull(api<AzWorkItem | null>(`${enc(org)}/${enc(project)}/_apis/wit/workitems/${n}`)).catch((e: unknown) => { if (statusOf(e) === 403) return null; throw e; });
      const x = w?.fields;
      if (!x) return null;
      const text = String(x["System.Description"] || "").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
      return { number: w.id, title: x["System.Title"], body: text, state: x["System.State"], url: `${AZ}/${enc(org)}/${enc(project)}/_workitems/edit/${n}`, labels: String(x["System.Tags"] || "").split(";").map((t) => t.trim()).filter(Boolean) };
    },
    // A pull request status (what branch policies read) when the PR is known, else a commit status.
    async status(repo, sha, s, n) {
      const [genre, ...name] = s.context.split("/");
      const body = { state: STATE.azure[s.state] || "error", description: s.description, targetUrl: s.target_url, context: { genre: name.length ? genre : "codeotter", name: name.join("/") || genre } };
      if (n) {
        const it = await lastIteration(repo, n);
        return api(`${g(repo)}/pullRequests/${n}/statuses`, { method: "POST", body: { ...body, ...(it ? { iterationId: it.id } : {}) } });
      }
      return api(`${g(repo)}/commits/${enc(sha)}/statuses`, { method: "POST", body });
    },
    comments,
    // closed: an informational thread must not block a "resolve all comments" policy
    comment: (repo, n, body) => api(`${g(repo)}/pullRequests/${n}/threads`, { method: "POST", body: { comments: [{ parentCommentId: 0, content: body, commentType: 1 }], status: "closed" } }),
    editComment(repo, n, cid, body) {
      const [t, c] = String(cid).split(":").map(Number);
      if (!Number.isSafeInteger(t) || !Number.isSafeInteger(c)) throw new Error("Invalid Azure DevOps comment id");
      return api(`${g(repo)}/pullRequests/${n}/threads/${t}/comments/${c}`, { method: "PATCH", body: { content: body } });
    },
    async inline(repo, n, list0) {
      const failed: typeof list0 = [];
      for (const c of list0) {
        try {
          await api(`${g(repo)}/pullRequests/${n}/threads`, { method: "POST", body: {
            comments: [{ parentCommentId: 0, content: c.body, commentType: 1 }], status: "active",
            threadContext: { filePath: `/${c.path}`, rightFileStart: { line: c.startLine || c.line, offset: 1 }, rightFileEnd: { line: c.line, offset: 1 } },
          } });
        } catch (e) {
          if (![400, 422].includes(statusOf(e) ?? 0)) throw e;
          failed.push(c);
        }
      }
      return failed;
    },
    multiLineSuggestions: true,
    async setBody(repo, n, body) {
      if (body.length > AZURE_MAX_DESCRIPTION) throw new Error(`Azure DevOps limits a pull request description to ${AZURE_MAX_DESCRIPTION} characters (this one is ${body.length})`);
      return api(`${g(repo)}/pullrequests/${n}`, { method: "PATCH", body: { description: body } });
    },
    async commentsSince(repo, since) {
      const t = Date.parse(since);
      const prs = ((await api<AzList<AzPull> | null>(`${g(repo)}/pullrequests?searchCriteria.status=active&$top=100`))?.value || []).slice(0, 30);
      const out: ForgeComment[] = [];
      for (const p of prs) {
        for (const th of await threads(repo, p.pullRequestId)) {
          if (th.isDeleted) continue;
          for (const c of th.comments || []) if (!c.isDeleted && c.commentType !== "system" && Date.parse(c.publishedDate) > t) out.push(toComment(th.id, c, p.pullRequestId));
        }
      }
      return out;
    },
    // Only members can comment on a private project's pull requests; public projects take commands from nobody.
    async trusted(repo) {
      const [org, project] = parts(repo);
      const p = await api<{ visibility?: string } | null>(`${enc(org)}/_apis/projects/${enc(project)}`).catch((e: unknown) => { if ([401, 403, 404].includes(statusOf(e) ?? 0)) return null; throw e; });
      return p?.visibility === "private";
    },
    react: () => null,
    // Service hook subscriptions, one per event, recognised by URL and repository. Azure cannot sign a delivery: the
    // secret travels in a header (X-CodeOtter-Secret) and is compared in constant time.
    async ensureHook(repo, url, secret) {
      const [org] = parts(repo);
      const { repositoryId, projectId } = await ids(repo);
      const subs = (await api<AzList<AzSubscription> | null>(`${enc(org)}/_apis/hooks/subscriptions`))?.value || [];
      const mine = subs.filter((s) => s.consumerInputs?.url === url && s.publisherInputs?.repository === repositoryId);
      let added = false;
      for (const eventType of EVENTS.filter((e) => !mine.some((s) => s.eventType === e))) {
        await api(`${enc(org)}/_apis/hooks/subscriptions`, { method: "POST", body: {
          publisherId: "tfs", eventType, resourceVersion: eventType.startsWith("ms.vss-code.") ? "1.0-preview.1" : "1.0", consumerId: "webHooks", consumerActionId: "httpRequest",
          publisherInputs: { projectId, repository: repositoryId },
          consumerInputs: { url, httpHeaders: `X-CodeOtter-Secret:${secret}`, resourceDetailsToSend: "all", messagesToSend: "none", detailedMessagesToSend: "none" },
        } });
        added = true;
      }
      return added;
    },
    async removeHook(repo, url) {
      const [org] = parts(repo);
      const { repositoryId } = await ids(repo).catch((): { repositoryId?: string } => ({}));
      if (!repositoryId) return;
      const subs = (await api<AzList<AzSubscription> | null>(`${enc(org)}/_apis/hooks/subscriptions`).catch(() => null))?.value || [];
      for (const s of subs) if (s.consumerInputs?.url === url && s.publisherInputs?.repository === repositoryId && /^[0-9a-f-]{36}$/i.test(String(s.id))) await api(`${enc(org)}/_apis/hooks/subscriptions/${s.id}`, { method: "DELETE" }).catch(() => {});
    },
    secretHeader: "x-codeotter-secret",
    hookMeta: () => ({ event: "", delivery: "", signature: "" }), // both come from the body
    hookBody: (x: AzEvent | null | undefined) => ({ event: String(x?.eventType || ""), delivery: String(x?.id || x?.notificationId || "") }),
    route(event: string, x: AzEvent | null | undefined) {
      const res = x?.resource;
      if (event === "git.pullrequest.created" || event === "git.pullrequest.updated") {
        const repo = `${id}~${repoOfPayload(res?.repository)}`;
        return res?.pullRequestId && res.status === "active" && repo !== `${id}~` ? { repo, pr: normalize(res, repo) } : null;
      }
      if (event === "ms.vss-code.git-pullrequest-comment-event") {
        const p = res?.pullRequest, c = res?.comment;
        const repo = `${id}~${repoOfPayload(p?.repository)}`;
        const thread = Number((String(c?._links?.threads?.href || "").match(/\/threads\/(\d+)/) || [])[1]);
        if (!p?.pullRequestId || !c?.id || !thread || repo === `${id}~` || c.commentType === "system") return null;
        return { repo, comment: toComment(thread, c, p.pullRequestId) };
      }
      return null;
    },
  };
}

// =====================================================================================================================
// A pull request URL's repository id, given the configured origins (provider id -> origin). For clients that only hold
// the board's forgeUrls (the TUI); web/src/types.ts carries the same rules.
export function repoFromUrl(url: string, origins: Record<string, string> = {}): string {
  try {
    const u = new URL(url);
    const id = Object.keys(origins).find((k) => origins[k] && origins[k] === u.origin);
    if (u.origin !== "https://github.com" && !id) return "";
    const seg = u.pathname.split("/").slice(1);
    if (id === "bitbucketdc") return seg[0] === "projects" && seg[2] === "repos" ? `${id}~${seg[1]}/${seg[3]}` : "";
    if (id === "azure") return seg[2] === "_git" ? `${id}~${[seg[0], seg[1], seg[3]].map(decodeURIComponent).join("/")}` : "";
    return `${id ? `${id}~` : ""}${seg.slice(0, 2).join("/")}`;
  } catch { return ""; }
}

const KINDS: Record<ForgeKind, (id: string, f: AuthedConfig) => Forge> = { gitea, bitbucket, bitbucketdc, azure };
// Each adapter sets f.auth on entry, before anything calls http().
export const makeForge = (id: string, f: ForgeConfig): Forge => KINDS[f.kind](id, f as AuthedConfig);
// Shared-secret header check (Azure): constant time, never a prefix or empty match.
export function secretMatches(secret: unknown, given: unknown): boolean {
  if (!secret || !given) return false;
  const a = createHmac("sha256", "codeotter").update(String(secret)).digest(), b = createHmac("sha256", "codeotter").update(String(given)).digest();
  return timingSafeEqual(a, b);
}
export { AZ_SEG };
