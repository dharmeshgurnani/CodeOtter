// Sign-in providers, git connections and SETTINGS_PAGES: every settings page as JSON.
import { randomBytes } from "node:crypto";
import { existsSync, rmSync } from "node:fs";
import { APP_URL, FORGE_API, FORGE_IDS, forgeOrigin, FORGES, REPO_RE } from "./config.ts";
import { contextNote, listModels, LOCAL, LOCAL_LLM, LOCAL_S1, modelCache, modelIcon, modelPath, modelReady, providerIcon, PROVIDERS, runtimeAssets, runtimeBin, RUNTIMES, S1_PROVIDERS } from "./providers.ts";
import { downloadModel, downloads, ensureRuntime, findPython, localStatus, sidecars, stopSidecar, venvPython } from "./local-models.ts";
import { PB_URL, store } from "./store.ts";
import { applyGithubToken, cleanRepo, forgeApi, forgeId, forgeOf, ghAsync, isForgeRepo, nativeRepo, repoLabel, repos, repositoryChoices } from "./git.ts";
import { askModel, askSystemOne, llmConfig, s1Config } from "./models.ts";
import { getRepoAccepted, getRepoLearnings, guideCache, guideFiles, normalizeLearningList, normalizeReview, REVIEW_DEFAULTS, reviewConfig } from "./context.ts";
import { triageConfig } from "./review.ts";
import { actionSecret, describeDelivery, forwarderStatus, LOCAL_APP_URL, reposChanged, syncForwarders, webhookUrl } from "./queue.ts";
import { repoOf } from "./views.ts";
import { accessQueue, allowed, effectiveRole, isRole, onboardedRepo, ROLES, userView } from "./access.ts";
import type { Access, Role, SessionUser } from "./access.ts";
import type { Cell, CellObject, Tone } from "./views.ts";
import type { OAuthProviderConfig } from "./store.ts";
import type { ProviderDef } from "./providers.ts";
import type { LocalModel } from "./local-models.ts";
import type { ReviewSettings } from "./context.ts";

// Page JSON drawn by web/src/components/json-form.tsx (Field, Section, Action, Row there).
export type Option = { value: string | number; label: string; icon?: string };
export type FieldType = "text" | "password" | "select" | "multiselect" | "combo" | "picker" | "number" | "range" | "checkbox" | "readonly" | "list" | "table";
export type Field = {
  key: string;
  label: string;
  type: FieldType;
  columns?: { key: string; label: string }[];
  hint?: string;
  text?: string;
  placeholder?: string;
  options?: Option[];
  optionsBy?: { field: string; map: Record<string, (string | Option)[]> };
  defaultBy?: { field: string; map: Record<string, string> };
  hideWhen?: { field: string; in: string[] };
  link?: { label: string; url: string };
  linkBy?: { field: string; map: Record<string, { label: string; url: string }> };
  infoBy?: { field: string; map: Record<string, string> };
  min?: number;
  max?: number;
  step?: number;
};
export type Action = { id: string; label: string; variant?: "default" | "outline"; disabled?: boolean; icon?: string; iconOnly?: boolean; loading?: boolean; danger?: boolean };
export type RowSettings = { title?: string; description?: string; fields: Field[]; values: Record<string, unknown> };
export type Row = { id: string; label: string; cells: Record<string, Cell>; actions?: Action[]; settings?: RowSettings; toggle?: boolean; toggleDisabled?: boolean; state?: string };
export type Section = { id: string; title: string; description?: string; fields: Field[]; actions?: Action[]; poll?: number };
export type PageData = { sections: Section[]; values: Record<string, Record<string, unknown>> };
export type SettingsGroup = "workspace" | "admin" | "repo";
// ?org= and ?repo= of the request.
export type PageScope = { org?: string; repo?: string };
// A request body: untrusted JSON, read through rec() / arr() and String() / Number() / !!.
export type Body = Record<string, unknown>;
export type CookieWriter = { setCookie(name: string, value: string, maxAgeSeconds: number): void };
export type ActionResult = { message: string } | { submit: { url: string; fields: Record<string, string> } };
export type PageAction = (body: Body, http: CookieWriter) => Promise<ActionResult>;
export interface SettingsPage {
  title: string;
  group: SettingsGroup;
  access: Access;
  load(scope?: PageScope, user?: SessionUser | null): Promise<PageData>;
  save(body: Body, scope?: PageScope): Promise<void>;
  test?(): Promise<{ ok: boolean; reply: string; ms?: number }>;
  actions?: Record<string, PageAction>;
}
export type LoginProvider = { label: string; pb: string };
export interface OAuthFlow { provider: string; state?: string; codeVerifier?: string; back: string; expires: number }
export interface ForgeConnection { save(body: Body): Promise<void>; test(): Promise<{ ok: boolean; reply: string }> }
const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
// A body field read as an object (anything else has no fields) or as a list.
const rec = (x: unknown): Record<string, unknown> => (isObj(x) ? x : {});
const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
// The table row the UI marked as edited, if any.
const editedRow = (table: unknown, ok: (r: Record<string, unknown>) => boolean) => arr(rec(table).rows).find((r): r is Record<string, unknown> => isObj(r) && !!r.edited && ok(r));

// Settings are schema-driven: each page is { title, load() -> { sections, values }, save(body), test?() }.
// The server describes sections and fields as JSON; the UI has one generic renderer and a sidebar link per page.
// Field types: select, combo (select + free text), text, password, number, range, checkbox, readonly.
const mask = (secret: string | undefined) => (secret ? `\u2022\u2022\u2022\u2022${secret.slice(-4)}` : "");
const byProvider = <T>(pick: (x: ProviderDef) => T) => Object.fromEntries(Object.entries(PROVIDERS).map(([k, x]) => [k, pick(x)]));
// Sign-in providers: GitHub plus every git server PocketBase has an OAuth2 provider for (Azure DevOps signs in through
// Microsoft Entra ID, so its row is "Microsoft"; Bitbucket Data Center has no sign-in).
export const LOGIN_PROVIDERS: Record<string, LoginProvider> = {
  github: { label: "GitHub", pb: "github" },
  ...Object.fromEntries(FORGE_IDS.filter((id) => FORGES[id].pb).map((id) => [id, { label: FORGES[id].signInLabel || FORGES[id].label, pb: FORGES[id].pb || "" }])),
};
export const oauthFlows = new Map<string, OAuthFlow>();
// Microsoft Entra ID sign-in is pinned to one tenant: its users' email addresses are then set by that directory's admins,
// which is what lets an invite match them by email. The multi-tenant endpoints are refused.
const ENTRA = "https://login.microsoftonline.com";
export const ENTRA_TENANT_RE = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+)$/i;
export const entraTenant = (p: { authURL?: string } | null | undefined) => (String(p?.authURL || "").match(/^https:\/\/login\.microsoftonline\.com\/([^/]+)\/oauth2\//) || [])[1] || "";
const OAUTH_APP_LINKS: Record<string, string> = {
  github: "https://github.com/settings/developers",
  bitbucket: "https://support.atlassian.com/bitbucket-cloud/docs/use-oauth-on-bitbucket-cloud/",
  microsoft: "https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade",
};
// The PocketBase OAuth2 provider entry for a sign-in row. GitHub and Bitbucket use PocketBase's built-in endpoints;
// Forgejo and Gitea point at their configured server; Microsoft at the one tenant.
export function oauthProvider(id: string, current: Partial<OAuthProviderConfig> | undefined, clientId: unknown, clientSecret: unknown, tenant: unknown = ""): OAuthProviderConfig {
  const spec = LOGIN_PROVIDERS[id];
  const base = { ...current, name: spec.pb, clientId: String(clientId || "").trim(), ...(clientSecret ? { clientSecret: String(clientSecret) } : {}) };
  if (spec.pb === "github" || spec.pb === "bitbucket") return base;
  if (spec.pb === "microsoft") {
    const t = String(tenant || "").trim().toLowerCase();
    if (!ENTRA_TENANT_RE.test(t)) throw new Error("Set the Microsoft Entra tenant: its domain (contoso.onmicrosoft.com) or tenant ID");
    return { ...base, displayName: spec.label, authURL: `${ENTRA}/${t}/oauth2/v2.0/authorize`, tokenURL: `${ENTRA}/${t}/oauth2/v2.0/token` };
  }
  const url = FORGES[id].url;
  if (!url) throw new Error(`Set the ${spec.label} server under Admin / Git providers first`);
  return { ...base, displayName: spec.label, pkce: true,
    authURL: `${url}/login/oauth/authorize`, tokenURL: `${url}/login/oauth/access_token`, userInfoURL: id === "gitea" ? `${url}/api/v1/user` : `${url}/login/oauth/userinfo` };
}
export const AZURE_ORG_RE = /^[\w][\w.-]*$/;
export const FORGE_CONNECTIONS: Record<string, ForgeConnection> = Object.fromEntries(Object.entries(FORGES).map(([id, f]): [string, ForgeConnection] => [id, {
    async save(body) {
      if (!body[id]) return;
      const v = rec(body[id]);
      // Bitbucket Cloud and Azure DevOps have one public origin: their row saves credentials (and Azure's organizations).
      if (f.fixed) {
        const token = String(v.token || "").trim() || f.token;
        const next: { url: string; token: string; user?: string; orgs?: string[] } = { url: f.url, token };
        if (f.kind === "bitbucket") {
          next.user = String(v.user ?? f.user ?? "").trim();
          if (/[:\s]/.test(next.user)) throw new Error("Bitbucket account email must not contain spaces or a colon");
        }
        if (f.kind === "azure") {
          next.orgs = [...new Set((Array.isArray(v.orgs) ? v.orgs : String(v.orgs ?? (f.orgs || []).join(",")).split(/[\s,]+/)).map((x: unknown) => String(x).trim()).filter(Boolean))];
          for (const o of next.orgs) if (!AZURE_ORG_RE.test(o)) throw new Error(`Not an Azure DevOps organization name: ${o}`);
        }
        await store.setSetting(id, next);
        Object.assign(f, next);
        guideCache.clear();
        return;
      }
      const nextUrl = forgeOrigin(v.url);
      if (nextUrl && Object.entries(FORGES).some(([other, value]) => other !== id && value.url === nextUrl)) throw new Error("Each provider must use a separate server origin");
      if (nextUrl !== f.url) {
        const linked = (await repos()).some((r) => forgeId(r) === id) || (await store.all()).some((r) => forgeId(repoOf(r.pr)) === id);
        const oauth = PB_URL && !!f.pb && ((await store.getOAuth()).providers.some((p) => p.name === f.pb) || await store.hasForgeIdentities(f.pb));
        if (linked || oauth) throw new Error(`Cannot change the ${f.label} server while repositories, reviews, or OAuth identities are linked`);
      }
      const token = nextUrl ? String(v.token || (nextUrl === f.url ? f.token : "")) : "";
      await store.setSetting(id, { url: nextUrl, token });
      await store.setSetting(`${id}Origin`, nextUrl);
      f.url = nextUrl;
      f.token = token;
      guideCache.clear();
    },
    async test() {
      return { ok: true, reply: await FORGE_API[id].test() };
    },
  }]));
// GitHub App manifest flow: the browser posts a manifest to GitHub, the user clicks Create once, GitHub returns a code
// to /github/manifest/callback, and the conversion gives us the app (sign-in client id + secret, and an id + key that
// list the repositories it is installed on).
// `http.setCookie(name, value, maxAgeSeconds)` is the route's cookie writer.
async function githubManifest(body: Body, http: CookieWriter): Promise<ActionResult> {
  if (!PB_URL) throw new Error("Sign-in is not available in file-storage mode (set PB_URL)");
  if ((await store.getOAuth()).providers.some((p) => p.name === "github" && p.clientId)) throw new Error("GitHub already has an app; turn sign-in off under Auth providers to replace it");
  const state = randomBytes(16).toString("hex");
  http.setCookie("pr_manifest", state, 600);
  // only a path on this site: the manifest callback redirects there
  if (typeof body?.returnTo === "string" && /^\/(?![/\\])/.test(body.returnTo)) {
    http.setCookie("pr_manifest_return", body.returnTo, 600);
  }
  const owner = ((await repos())[0] || "codeotter").split("/")[0].toLowerCase().replace(/[^a-z0-9-]/g, "-");
  const appPrefix = owner && owner !== "pr-scorer" && owner !== "code-otter" && owner !== "codeotter" ? `codeotter-${owner}` : "codeotter";
  const manifest = {
    name: `${appPrefix}`.slice(0, 28) + "-" + Math.random().toString(36).slice(2, 6),
    url: APP_URL,
    redirect_url: `${APP_URL}/github/manifest/callback`,
    callback_urls: [`${APP_URL}/auth/callback`],
    setup_url: `${APP_URL}/onboarding?step=2&connected=github`,
    public: false,
    default_permissions: {
      emails: "read",
      contents: "read",
      pull_requests: "write",
      statuses: "write",
      issues: "write",
      metadata: "read",
      administration: "read",
    },
    request_oauth_on_install: true,
    // GitHub refuses a localhost webhook URL; a laptop gets events through the forwarder instead.
    ...(LOCAL_APP_URL ? {} : { hook_attributes: { url: webhookUrl("github"), active: true }, default_events: ["pull_request", "issue_comment"] }),
  };
  return { submit: { url: `https://github.com/settings/apps/new?state=${state}`, fields: { manifest: JSON.stringify(manifest) } } };
}
// Admin / Git providers and Admin / Auth providers draw the same table: a row per provider with Provider, Server and Status.
// Only the row's action differs: Test and a gear for the connection there, a sign-in toggle here.
const PROVIDER_COLUMNS: { key: string; label: string }[] = [{ key: "provider", label: "Provider" }, { key: "server", label: "Server" }, { key: "status", label: "Status" }];
const PROVIDER_ICONS: Record<string, string> = { github: "https://github.com/github.png?size=64", forgejo: "https://forgejo.org/favicon.svg", gitea: "https://github.com/go-gitea.png?size=64", bitbucket: "/providers/bitbucket.svg", bitbucketdc: "/providers/bitbucket.svg", azure: "/providers/azure-devops.svg", microsoft: "/providers/microsoft.svg" };
const providerUrl = (id: string) => (id === "github" ? "https://github.com" : FORGES[id].url);
// `as` overrides what the row shows (the Auth providers page draws Azure DevOps' sign-in as Microsoft Entra ID).
function providerRow(id: string, status: CellObject, extra: Pick<Row, "actions" | "settings" | "toggle" | "toggleDisabled">, as: { label?: string; url?: string; icon?: string } = {}): Row {
  const label = as.label || (id === "github" ? "GitHub" : FORGES[id].label);
  const url = as.url ?? providerUrl(id);
  return {
    id,
    label,
    cells: {
      provider: { text: label, icon: PROVIDER_ICONS[as.icon || id] || "" },
      server: url ? { text: url.replace(/^https?:\/\//, ""), mono: true } : { text: "Not set", tone: "muted" },
      status: url ? status : { text: "Not connected", tone: "warn" },
    },
    ...extra,
  };
}
export const SETTINGS_PAGES: Record<string, SettingsPage> = {
  repos: {
    title: "Manage repositories",
    group: "workspace",
    access: "admin",
    // Scoped to the active organization: only its repositories are listed, offered, or touched on save.
    async load({ org } = {}) {
      const list = (await repos()).filter((r) => !org || r.startsWith(`${org}/`));
      // A repository's own settings live on its Repository settings page; this list only summarises them.
      const items = await Promise.all(list.map(async (r) => {
        const [files, rc, learnings, accepted] = await Promise.all([guideFiles(r), reviewConfig(r), getRepoLearnings(r), getRepoAccepted(r)]);
        const meta = [
          files.join(" + "),
          rc.auto ? "Auto-review" : "",
          rc.postScores ? "Post scores" : "",
          rc.postReview ? "Post review" : "",
          rc.postInlineSuggestions ? "Inline suggestions" : "",
          learnings.length ? `${learnings.length} learning${learnings.length === 1 ? "" : "s"}` : "",
          accepted.length ? `${accepted.length} accepted fix${accepted.length === 1 ? "" : "es"}` : "",
        ]
          .filter(Boolean)
          .join(" · ");
        return { id: r, label: repoLabel(r), meta: meta || undefined };
      }));
      const sections: Section[] = [
        {
          id: "repos",
          title: "Onboarded repositories",
          description: "Pull requests from these repositories show up in Reviews and in the sidebar.",
          fields: [
            { key: "list", label: "Repositories", type: "list", hint: "Removing a repository keeps its stored reviews." },
            { key: "add", label: "Add repository", type: "picker", placeholder: "Search, or owner/name or repository URL", options: (await repositoryChoices(org)).filter((r) => !list.includes(r)).map((value) => ({ value, label: repoLabel(value) })) },
          ],
          actions: [{ id: "save", label: "Save" }],
        },
      ];
      return { sections, values: { repos: { list: items, add: "" } } };
    },
    async save(body, { org } = {}) {
      if (!body.repos) return;
      const v = rec(body.repos);
      const clean = (r: unknown) => cleanRepo(String(r), org);
      const add = clean(v.add || "");
      const listed = arr(v.list).map((it) => (typeof it === "string" ? { id: it } : rec(it)));
      const mine = [...new Set([...listed.map((it) => clean(it.id)), add].filter(Boolean))];
      for (const r of mine) if (!REPO_RE.test(r)) throw new Error(`Not an owner/name: ${r}`);
      if (org) for (const r of listed.map((it) => clean(it.id))) if (!r.startsWith(`${org}/`)) throw new Error(`${r} is not under ${org}`);
      // other organizations' repositories are untouched by a scoped save
      const others = org ? (await repos()).filter((r) => !r.startsWith(`${org}/`)) : [];
      const next = [...others, ...mine];
      if (add && !arr(v.list).map(clean).includes(add)) {
        try {
          if (isForgeRepo(add)) await forgeOf(add).repoExists(add);
          else await ghAsync("repo", "view", add, "--json", "nameWithOwner");
        } catch {
          throw new Error(`Cannot access ${nativeRepo(add)}: check the name and ${isForgeRepo(add) ? FORGES[forgeId(add)].label : "GitHub"} credentials`);
        }
      }
      const before = await repos();
      await store.setSetting("repos", next);
      reposChanged(before, next).catch((e) => console.warn(`[repos] ${e.message}`));
      const [guides, repoSettings] = await Promise.all([
        store.getSetting("guides").then((x) => ({ ...(x || {}) })),
        store.getSetting("repoSettings").then((x) => ({ ...(x || {}) })),
      ]);
      for (const k of Object.keys(guides)) if (!next.includes(k)) delete guides[k];
      for (const k of Object.keys(repoSettings)) if (!next.includes(k)) delete repoSettings[k];
      await Promise.all([store.setSetting("guides", guides), store.setSetting("repoSettings", repoSettings)]);
      // a removed repository also leaves developers' access lists and pending invites, so re-adding it grants nothing
      await accessQueue(async () => {
        const [access0, invites0] = await Promise.all([store.getSetting("access"), store.getSetting("invites")]);
        const access = Object.fromEntries(Object.entries(access0 || {}).map(([id, list]): [string, string[]] => [id, (Array.isArray(list) ? list : []).filter((r) => next.includes(r))]));
        const invites = (Array.isArray(invites0) ? invites0 : []).map((i) => ({ ...i, repos: (i.repos || []).filter((r) => next.includes(r)) }));
        await Promise.all([store.setSetting("access", access), store.setSetting("invites", invites)]);
      });
    },
  },
  // One onboarded repository's settings, opened from its sidebar entry (/repo/<id>/settings); not listed in the sidebar's
  // Settings or Admin groups. The repository travels as ?repo= next to ?org=.
  repo: {
    title: "Repository settings",
    group: "repo",
    access: "admin",
    async load({ org = "", repo = "" } = {}) {
      await onboardedRepo(repo, org);
      const [rc, files, guides, learnings, accepted] = await Promise.all([reviewConfig(repo), guideFiles(repo), store.getSetting("guides"), getRepoLearnings(repo), getRepoAccepted(repo)]);
      // One section, one Save: review settings, guidelines and learnings are all this repository's.
      const sections: Section[] = [
        {
          id: "repo",
          title: "Review",
          description: "How much the model reads, how many findings it returns, and what gets posted as PR comments.",
          fields: [
            { key: "maxFindings", label: "Max findings", type: "range", min: 3, max: 12, step: 1 },
            { key: "diffChars", label: "Diff sent to the model", type: "select", options: [30000, 60000, 90000, 150000, 300000].map((v) => ({ value: v, label: `${v / 1000}k characters` })), hint: "Larger diffs cost more and may exceed the model's context." },
            { key: "contextLines", label: "Context above a change", type: "select", options: [0, 8, 16, 32].map((v) => ({ value: v, label: v ? `Up to ${v} lines, to the enclosing declaration` : "Off: git's 3 lines" })) },
            { key: "reflectMin", label: "Self-check", type: "select", options: [0, 3, 5, 7].map((v) => ({ value: v, label: v ? `Second pass drops findings scored below ${v}/10` : "Off" })) },
            { key: "temperature", label: "Temperature", type: "range", min: 0, max: 1, step: 0.1, hint: "Ignored by Anthropic models, which do not take sampling parameters." },
            { key: "postScores", label: "Post scores on PR", type: "checkbox", text: "Add a PR comment with all System One scores after review" },
            { key: "postReview", label: "Add PR review as a comment", type: "checkbox", text: "Add a PR comment with the review summary and link to the full report" },
            { key: "postInlineSuggestions", label: "Post inline suggestions", type: "checkbox", text: "Post inline committable suggestion comments on PR diff lines" },
            { key: "auto", label: "Auto-review", type: "checkbox", text: "Review every new or updated pull request and post the result (drafts and PRs labelled codeotter:skip are left alone)" },
            { key: "commands", label: "PR comment commands", type: "checkbox", text: "Run /review, /describe, /improve, /ask, /docs and /changelog from comments by owners, members and collaborators" },
            files.length ? { key: "useGuides", label: "Review guidelines", type: "checkbox", text: `Follow ${files.join(" + ")}` } : { key: "noGuides", label: "Review guidelines", type: "readonly" },
            { key: "learnings", label: "Team learnings", type: "list", hint: "Dismissed findings, kept as rules for this repository." },
            { key: "accepted", label: "Accepted fixes", type: "list" },
          ],
          actions: [{ id: "save", label: "Save" }],
        },
      ];
      return {
        sections,
        values: {
          repo: {
            ...Object.fromEntries((Object.keys(REVIEW_DEFAULTS) as (keyof ReviewSettings)[]).map((k) => [k, rc[k]])),
            ...(files.length ? { useGuides: guides?.[repo]?.use ?? true } : { noGuides: "No AGENTS.md or CLAUDE.md at the root" }),
            learnings,
            accepted,
            // not drawn: what the page loaded, so a save can tell removals from items added meanwhile
            loadedLearnings: learnings,
            loadedAccepted: accepted,
          },
        },
      };
    },
    async save(body, { org = "", repo = "" } = {}) {
      await onboardedRepo(repo, org);
      if (!body.repo) return;
      const v = rec(body.repo);
      const [guides0, rs0, current] = await Promise.all([store.getSetting("guides"), store.getSetting("repoSettings"), reviewConfig(repo)]);
      // Only what was sent changes. Review keys merge over the current values. Lists apply removals only: items the
      // page loaded (`loadedLearnings` / `loadedAccepted`) and no longer sends are dropped from the current list, so a
      // learning dismissed or a fix accepted while the page was open is kept.
      const pruned = (now: unknown, loaded: unknown, sent: unknown) => {
        const keep = new Set(normalizeLearningList(sent));
        const gone = normalizeLearningList(loaded).filter((x) => !keep.has(x));
        return normalizeLearningList(now).filter((x) => !gone.includes(x));
      };
      const prev = rs0?.[repo] || {};
      const reviewKeys = Object.keys(REVIEW_DEFAULTS).filter((k) => k in v);
      const next = { ...prev, ...(reviewKeys.length ? { review: normalizeReview({ ...current, ...Object.fromEntries(reviewKeys.map((k) => [k, v[k]])) }) } : {}) };
      const g = { ...(guides0?.[repo] || {}), ...("useGuides" in v ? { use: !!v.useGuides } : {}) };
      if ("learnings" in v) { next.learnings = pruned(await getRepoLearnings(repo), v.loadedLearnings, v.learnings); g.learnings = next.learnings; }
      if ("accepted" in v) next.accepted = pruned(await getRepoAccepted(repo), v.loadedAccepted, v.accepted);
      await Promise.all([store.setSetting("guides", { ...(guides0 || {}), [repo]: g }), store.setSetting("repoSettings", { ...(rs0 || {}), [repo]: next })]);
    },
  },
  model: {
    title: "Model provider",
    group: "admin",
    access: "admin",
    async load() {
      const c = await llmConfig();
      const s1 = await s1Config();
      const p = PROVIDERS[c.provider] || PROVIDERS.custom;
      const localIds = Object.keys(LOCAL);
      const llmCanList = !c.local && c.baseUrl && (c.apiKey || p.noKey || c.provider === "openrouter" || /localhost|127\.0\.0\.1/.test(c.baseUrl));
      const [llmLive, s1Live] = await Promise.all([
        llmCanList ? listModels(p.api === "anthropic" ? "anthropic" : "openai", c) : [],
        s1.provider === "jev" && s1.apiKey ? listModels("s1-typesafe", s1) : S1_PROVIDERS[s1.provider]?.listPrefix ? listModels("s1-openrouter", s1) : [],
      ]);
      // One table, a row per engine; the gear opens that engine's provider, model, key and URL (same fields as before).
      const llmFields: Field[] = [
            { key: "provider", label: "Provider", type: "select", options: Object.entries(PROVIDERS).map(([value, x]) => ({ value, label: x.label, icon: providerIcon(value) })) },
            { key: "model", label: "Model", type: "select", hint: llmLive.length ? `${llmLive.length} models listed by ${p.label}.` : c.provider === "custom" ? "Type the model id your endpoint serves." : "Save a key to list the provider's models.", optionsBy: { field: "provider", map: { ...Object.fromEntries(Object.entries(PROVIDERS).map(([k, x]) => [k, x.models.map((value) => ({ value, label: value, icon: modelIcon(value, k) }))])), ...(llmLive.length ? { [c.provider]: llmLive } : {}) } } },
            { key: "apiKey", label: "API key", type: "password", hint: c.apiKey ? `Saved key ${mask(c.apiKey)}. Leave blank to keep it.` : p.noKey ? "" : "No key saved yet.", placeholder: mask(c.apiKey) || "paste key", hideWhen: { field: "provider", in: Object.keys(PROVIDERS).filter((k) => PROVIDERS[k].noKey) }, linkBy: { field: "provider", map: Object.fromEntries(Object.entries(PROVIDERS).filter(([, x]) => x.keyUrl).map(([k, x]) => [k, { label: "Get a key", url: x.keyUrl || "" }])) } },
            { key: "baseUrl", label: "Base URL", type: "text", hint: "Prefilled per provider. Change only for proxies or self-hosted gateways.", hideWhen: { field: "provider", in: Object.keys(PROVIDERS).filter((k) => PROVIDERS[k].local) }, defaultBy: { field: "provider", map: byProvider((x) => x.baseUrl) } },
            { key: "llmStatus", label: "Status", type: "readonly", hideWhen: { field: "provider", in: Object.keys(PROVIDERS).filter((k) => !PROVIDERS[k].local) }, hint: c.local ? "Download, switch or delete local models under Settings / Local models." : "" },
      ];
      const s1Fields: Field[] = [
            { key: "provider", label: "Provider", type: "select", options: [{ value: "none", label: "None" }, ...Object.entries(S1_PROVIDERS).map(([value, x]) => ({ value, label: x.label, icon: providerIcon(value) }))], infoBy: { field: "provider", map: Object.fromEntries(LOCAL_S1.filter(contextNote).map((m) => [m.id, contextNote(m)])) } },
            { key: "model", label: "Model", type: "select", hideWhen: { field: "provider", in: ["none", ...localIds] }, hint: s1Live.length ? `${s1Live.length} models listed by ${S1_PROVIDERS[s1.provider].label}.` : "", optionsBy: { field: "provider", map: { none: [], ...Object.fromEntries(Object.entries(S1_PROVIDERS).map(([k, x]) => [k, x.models.map((value) => ({ value, label: value, icon: modelIcon(value, k) }))])), ...(s1Live.length ? { [s1.provider]: s1Live } : {}) } } },
            { key: "apiKey", label: "API key", type: "password", hideWhen: { field: "provider", in: ["none", ...localIds] }, hint: s1.apiKey ? `Saved key ${mask(s1.apiKey)}. Leave blank to keep it.` : s1.provider === "custom" ? "Optional." : "No key saved yet.", placeholder: mask(s1.apiKey) || "paste key", linkBy: { field: "provider", map: Object.fromEntries(Object.entries(S1_PROVIDERS).filter(([, x]) => x.keyUrl).map(([k, x]) => [k, { label: "Get a key", url: x.keyUrl || "" }])) } },
            { key: "baseUrl", label: "Base URL", type: "text", hideWhen: { field: "provider", in: ["none", ...localIds] }, placeholder: "http://host:port", defaultBy: { field: "provider", map: { none: "", ...Object.fromEntries(Object.entries(S1_PROVIDERS).map(([k, x]) => [k, x.baseUrl])) } } },
            { key: "status", label: "Status", type: "readonly", hideWhen: { field: "provider", in: ["none", ...Object.keys(S1_PROVIDERS).filter((k) => !S1_PROVIDERS[k].local)] }, hint: s1.local ? "Download, switch or delete local models under Settings / Local models." : "" },
      ];
      const s1Spec = S1_PROVIDERS[s1.provider];
      const triage = await triageConfig();
      const llmState: CellObject = c.local ? { text: localStatus(c.local).text, tone: c.enabled ? "ok" : "warn" } : !c.model ? { text: "Not set", tone: "warn" } : c.apiKey ? { text: "Key saved", tone: "ok" } : p.noKey ? { text: "No key needed", tone: "ok" } : { text: "No key", tone: "warn" };
      const s1State: CellObject = s1.provider === "none" || !s1Spec ? { text: "Off", tone: "muted" } : s1.local ? { text: localStatus(s1.local).text, tone: s1.enabled ? "ok" : "warn" } : s1.apiKey || s1.provider === "custom" ? { text: s1.apiKey ? "Key saved" : "No key needed", tone: "ok" } : { text: "No key", tone: "warn" };
      const rows: Row[] = [
        {
          id: "llm",
          label: "Language model",
          cells: {
            engine: "Language model",
            provider: { text: p.label, icon: providerIcon(c.provider) },
            model: c.local ? c.local.label : c.model ? { text: c.model, mono: true } : "",
            status: llmState,
          },
          actions: [{ id: "test", label: "Test", ...(c.model || c.local ? {} : { disabled: true }) }],
          settings: { title: "Language model", description: "Writes the walkthrough and findings. Also scores when no System One model is configured.", fields: llmFields, values: { provider: c.provider, model: c.model, apiKey: "", baseUrl: c.baseUrl, llmStatus: c.local ? localStatus(c.local).text : "" } },
        },
        {
          id: "s1",
          label: "System One model",
          cells: {
            engine: "System One",
            provider: s1Spec ? { text: s1Spec.label, icon: providerIcon(s1.provider) } : { text: "None", tone: "muted" },
            model: s1.local ? s1.local.label : s1Spec && s1.model ? { text: s1.model, mono: true } : "",
            status: s1State,
          },
          actions: [{ id: "probe", label: "Test", ...(s1Spec ? {} : { disabled: true }) }],
          settings: { title: "System One model", description: "Typed scores and merge gates in one fast pass. Owns scoring when configured; runs alongside the language model.", fields: [
            ...s1Fields,
            // Fast triage: System One rates correctness risk and blast radius of each PR and sets the codeotter/triage status.
            { key: "triageAuto", label: "Fast triage", type: "checkbox", text: "Triage new and updated pull requests and set the codeotter/triage status", hideWhen: { field: "provider", in: ["none"] } },
            { key: "triageStopAt", label: "Fail triage at risk", type: "range", min: 25, max: 100, step: 25, hint: "codeotter/triage fails at or above this correctness risk.", hideWhen: { field: "provider", in: ["none"] } },
          ], values: { provider: s1.provider, model: s1.model, apiKey: "", baseUrl: s1.baseUrl, status: s1.local ? localStatus(s1.local).text : "", triageAuto: triage.auto, triageStopAt: triage.stopAt } },
        },
      ];
      const sections: Section[] = [
        {
          id: "engines",
          title: "Review engines",
          description: "The language model writes the summary, walkthrough and findings; System One owns scores and gates when configured. Both run in parallel.",
          fields: [{ key: "rows", label: "Engines", type: "table", columns: [{ key: "engine", label: "Engine" }, { key: "provider", label: "Provider" }, { key: "model", label: "Model" }, { key: "status", label: "Status" }] }],
        },
      ];
      return { sections, values: { engines: { rows } } };
    },
    async save(body) {
      // The engines table posts its rows with the edited one marked; it is applied in the { llm | s1: {...}, triage }
      // shape, which is also accepted directly. Fast triage lives in the System One dialog.
      const edited = editedRow(body.engines, (r) => r.id === "llm" || r.id === "s1");
      if (edited) {
        const v = rec(rec(edited.settings).values);
        body = { [String(edited.id)]: v, ...(edited.id === "s1" && "triageAuto" in v ? { triage: { auto: v.triageAuto, stopAt: v.triageStopAt } } : {}) };
      }
      if (body.triage) {
        const v = rec(body.triage);
        await store.setSetting("triage", { auto: !!v.auto, stopAt: Math.min(100, Math.max(25, Math.round((Number(v.stopAt) || 75) / 25) * 25)) });
      }
      if (body.llm) {
        const v = rec(body.llm);
        const provider = String(v.provider), spec = PROVIDERS[provider];
        if (!spec) throw new Error(`Unknown provider ${v.provider}`);
        const prev = (await store.getSetting("llm")) || {};
        const apiKey = String(v.apiKey || (prev.provider === v.provider && (v.baseUrl || "") === (prev.baseUrl || "") ? prev.apiKey : "") || "");
        await store.setSetting("llm", spec.local ? { provider } : { provider, model: String(v.model || ""), baseUrl: String(v.baseUrl || ""), apiKey });
        if (spec.local && sidecars.llm.id && sidecars.llm.id !== spec.local.id) stopSidecar("llm");
        modelCache.clear();
      }
      if (body.s1) {
        const v = rec(body.s1);
        const provider = String(v.provider);
        if (provider !== "none" && !S1_PROVIDERS[provider]) throw new Error(`Unknown System One provider ${v.provider}`);
        if (provider === "custom" && !/^https?:\/\//.test(String(v.baseUrl || ""))) throw new Error("Custom endpoint needs a base URL");
        const prev = (await store.getSetting("s1")) || {};
        const apiKey = String(v.apiKey || (prev.provider === v.provider && (v.baseUrl || "") === (prev.baseUrl || "") ? prev.apiKey : "") || "");
        await store.setSetting("s1", provider === "none" ? { provider: "none" } : S1_PROVIDERS[provider].local ? { provider } : { provider, model: String(v.model || ""), baseUrl: String(v.baseUrl || ""), apiKey });
        if (S1_PROVIDERS[provider]?.local && sidecars.s1.id && sidecars.s1.id !== provider) stopSidecar("s1");
        modelCache.clear();
      }
    },
    actions: {
      async probe() {
        const t = Date.now();
        const a = await askSystemOne({ document: "The function returns the sum of two integers." }, { ok: { type: "noul", instructions: "The document describes an addition." } }, await s1Config());
        const yes = Number(a.ok?.noul) || 0;
        return { message: `Connected, answered in ${Date.now() - t} ms (${Math.round(yes * 100)}% yes).` };
      },
    },
    async test() {
      const t = Date.now();
      const reply = await askModel("Reply with the single word OK.", await llmConfig());
      return { ok: /ok/i.test(reply), reply: reply.trim().slice(0, 200), ms: Date.now() - t };
    },
  },
  // Repository access: where onboarded repositories are read from. Sign-in is the separate OAuth page; any login can
  // review any connected provider's repositories.
  git: {
    title: "Git providers",
    group: "admin",
    access: "admin",
    async load() {
      const githubToken = (await store.getSetting("githubToken")) || "";
      const app = (await store.getSetting("githubApp")) || {};
      const forward = !!(await store.getSetting("webhookForward"));
      // "Create app" makes the provider's OAuth app (GitHub: the app manifest flow, which also gives repository
      // discovery and the webhook; Forgejo/Gitea: their OAuth2 API with the saved token) and turns sign-in with it on.
      const o = PB_URL ? await store.getOAuth() : { providers: [] };
      const hasApp = (id: string) => o.providers.some((p) => p.name === LOGIN_PROVIDERS[id].pb && p.clientId);
      const rows: Row[] = [
        providerRow("github", githubToken ? { text: "Token saved", tone: "ok" } : { text: "gh login", tone: "muted" }, {
          actions: [{ id: "testgithub", label: "Test" }, { id: "connect", label: "Create app", ...(!PB_URL || hasApp("github") ? { disabled: true } : {}) }],
          settings: {
            title: "GitHub connection",
            fields: [
              { key: "token", label: "Access token", type: "password", placeholder: mask(githubToken), hint: githubToken ? "Leave blank to keep the stored token." : "Without one, the gh CLI's own login (or GH_TOKEN) is used." },
              ...(githubToken ? ([{ key: "clearToken", label: "Saved token", type: "checkbox", text: "Remove it and use the gh CLI's own login (or GH_TOKEN)" }] satisfies Field[]) : []),
              { key: "webhookUrl", label: "Webhook URL", type: "readonly", ...(app.slug ? { link: { label: "App settings", url: `https://github.com/settings/apps/${app.slug}` } } : {}) },
              { key: "webhookSecret", label: "Webhook secret", type: "password", placeholder: app.webhookSecret ? "Saved" : "", hint: app.webhookSecret ? "Leave blank to keep the stored secret." : "Apps created by Create app carry one. For an existing app, set the URL above and a secret under the app's Webhook settings, then paste the secret here." },
              { key: "webhookStatus", label: "Last delivery", type: "readonly" },
              { key: "actionSecret", label: "Action secret", type: "readonly", hint: "Repository secret CODEOTTER_SECRET for the CodeOtter GitHub Action." },
              { key: "forward", label: "Forward webhooks here", type: "checkbox", text: "gh webhook forward streams each GitHub repository's pull_request and issue_comment events to this process (local development without a public URL; needs gh extension install cli/gh-webhook)" },
              { key: "forwardStatus", label: "Forwarders", type: "readonly", hideWhen: { field: "forward", in: ["false"] } },
            ],
            values: { token: "", ...(githubToken ? { clearToken: false } : {}), webhookUrl: webhookUrl("github"), webhookSecret: "", webhookStatus: describeDelivery("github"), actionSecret: await actionSecret(), forward, forwardStatus: forwarderStatus() },
          },
        }),
        ...Object.entries(FORGES).map(([id, f]) => providerRow(id, f.token ? { text: "Token saved", tone: "ok" } : { text: "No token", tone: "muted" }, {
          // Create app: only Forgejo and Gitea can mint an OAuth app through their API
          actions: [{ id: `test${id}`, label: "Test", ...(f.url && (!f.fixed || f.token) ? {} : { disabled: true }) }, { id: `app${id}`, label: "Create app", ...(f.kind !== "gitea" || !PB_URL || !f.url || !f.token || hasApp(id) ? { disabled: true } : {}) }],
          settings: {
            title: `${f.label} connection`,
            fields: [
              ...(f.fixed ? [] : ([{ key: "url", label: "Server URL", type: "text", placeholder: `https://${id}.example.com` }] satisfies Field[])),
              ...(f.kind === "bitbucket" ? ([{ key: "user", label: "Atlassian account email", type: "text", placeholder: "you@example.com", hint: "With an Atlassian API token. Leave empty for a workspace or repository access token." }] satisfies Field[]) : []),
              ...(f.kind === "azure" ? ([{ key: "orgs", label: "Organizations", type: "text", placeholder: "contoso, fabrikam" }] satisfies Field[]) : []),
              { key: "token", label: f.kind === "azure" ? "Personal access token" : f.kind === "bitbucketdc" ? "HTTP access token" : f.kind === "bitbucket" ? "API token" : "Access token", type: "password", placeholder: mask(f.token), hint: "Leave blank to keep the stored token." },
              { key: "webhookUrl", label: "Webhook URL", type: "readonly", hint: f.kind === "azure" ? "Service hook subscriptions are added for each onboarded repository; the token needs the Service hooks scope." : "Registered on each onboarded repository; pull request and comment events arrive here." },
              { key: "webhookStatus", label: "Last delivery", type: "readonly" },
            ],
            values: { ...(f.fixed ? {} : { url: f.url }), ...(f.kind === "bitbucket" ? { user: f.user || "" } : {}), ...(f.kind === "azure" ? { orgs: (f.orgs || []).join(", ") } : {}), token: "", webhookUrl: webhookUrl(id), webhookStatus: describeDelivery(id) },
          },
        })),
      ];
      return {
        sections: [{
          id: "providers",
          title: "Git providers",
          description: "Where onboarded repositories are read from. Connect every provider your repositories live on.",
          fields: [{ key: "rows", label: "Providers", type: "table", columns: PROVIDER_COLUMNS }],
        }],
        values: { providers: { rows } },
      };
    },
    actions: {
      ...Object.fromEntries(Object.entries(FORGE_CONNECTIONS).map(([id, connection]): [string, PageAction] => [`test${id}`, async () => ({ message: (await connection.test()).reply })])),
      async testgithub() {
        const login = (await ghAsync("api", "user", "--jq", ".login")).trim();
        return { message: `Connected to GitHub as ${login}` };
      },
      ...Object.fromEntries(Object.entries(FORGES).filter(([, f]) => f.kind === "gitea").map(([id, f]): [string, PageAction] => [`app${id}`, async () => {
        if (!PB_URL) throw new Error("Sign-in requires PocketBase (PB_URL)");
        // the button is disabled then too; a stale page or a repeated request must not mint a second app and overwrite working credentials
        if ((await store.getOAuth()).providers.some((p) => p.name === f.pb && p.clientId)) throw new Error(`${f.label} already has an OAuth app; turn sign-in off under Auth providers to replace it`);
        let app: unknown;
        try {
          app = await forgeApi("user/applications/oauth2", { method: "POST", source: id, body: { name: "CodeOtter", redirect_uris: [`${APP_URL}/auth/callback`], confidential_client: true } });
        } catch (e) {
          const status = isObj(e) ? e.status : undefined;
          if (status === 401 || status === 403) throw new Error(`The ${f.label} access token cannot create OAuth apps: give it the write:user scope, or create one under ${f.url}/user/settings/applications`);
          throw e;
        }
        if (!isObj(app) || !app.client_id || !app.client_secret) throw new Error(`${f.label} returned no OAuth client credentials`);
        await SETTINGS_PAGES.oauth.save({ [`${id}oauth`]: { enabled: true, clientId: app.client_id, clientSecret: app.client_secret } });
        return { message: `${f.label} OAuth app created. Sign-in with ${f.label} is on.` };
      }])),
      // GitHub App manifest flow: the browser posts a manifest to GitHub, the user clicks Create once, GitHub returns a
      // code to /github/manifest/callback, and the conversion gives us the client id + secret to store in PocketBase.
      async connect(body, http) {
        return githubManifest(body, http);
      },
    },
    async save(body) {
      // The table posts its rows with the edited one marked; it is applied in the { github | [forge]: { url?, token } } shape.
      const edited = editedRow(body.providers, (r) => r.id === "github" || !!FORGES[String(r.id)]);
      if (edited) {
        const v = rec(rec(edited.settings).values);
        body = { [String(edited.id)]: { url: v.url, token: v.token, clearToken: !!v.clearToken, webhookSecret: v.webhookSecret, forward: v.forward, ...("user" in v ? { user: v.user } : {}), ...("orgs" in v ? { orgs: v.orgs } : {}) } };
      }
      const github = rec(body.github);
      const gh = String(github.token || "").trim();
      if (github.clearToken) { await store.setSetting("githubToken", ""); applyGithubToken(""); }
      else if (gh) { await store.setSetting("githubToken", gh); applyGithubToken(gh); }
      if (github.webhookSecret) {
        const app = (await store.getSetting("githubApp")) || {};
        await store.setSetting("githubApp", { ...app, webhookSecret: String(github.webhookSecret).trim() });
      }
      if (body.github && "forward" in github) {
        await store.setSetting("webhookForward", !!github.forward);
        syncForwarders().catch((e) => console.warn(`[forwarder] ${e.message}`));
      }
      for (const connection of Object.values(FORGE_CONNECTIONS)) await connection.save(body);
    },
  },
  oauth: {
    title: "Auth providers",
    group: "admin",
    access: "admin",
    // Sign-in: a table row per provider with a toggle. Turning one on asks for its client ID and secret; turning it off
    // removes them. A self-hosted provider's toggle stays disabled until its server is set under Git providers.
    async load(): Promise<PageData> {
      if (!PB_URL) return { sections: [{ id: "signin", title: "Sign-in", description: "Sign-in requires PocketBase (PB_URL).", fields: [] }], values: {} };
      const o = await store.getOAuth();
      const rows = Object.entries(LOGIN_PROVIDERS).map(([id, spec]) => {
        const current: Partial<OAuthProviderConfig> = o.providers.find((p) => p.name === spec.pb) || {};
        const tenant = spec.pb === "microsoft" ? entraTenant(current) : "";
        const url = spec.pb === "microsoft" ? `${ENTRA}${tenant ? `/${tenant}` : ""}` : providerUrl(id);
        const on = !!o.enabled && !!current.clientId;
        return providerRow(id, on ? { text: "Enabled", tone: "ok" } : { text: "Off", tone: "muted" }, {
          toggle: on,
          ...(url ? {} : { toggleDisabled: true }),
          settings: {
            title: `Sign in with ${spec.label}`,
            fields: [
              ...(spec.pb === "microsoft" ? ([{ key: "tenant", label: "Tenant", type: "text", placeholder: "contoso.onmicrosoft.com or tenant ID", hint: "One directory: invites match its users by email." }] satisfies Field[]) : []),
              { key: "clientId", label: spec.pb === "bitbucket" ? "Key" : spec.pb === "microsoft" ? "Application (client) ID" : "Client ID", type: "text", link: { label: spec.pb === "bitbucket" ? "OAuth consumers" : spec.pb === "microsoft" ? "App registrations" : "Create OAuth app", url: OAUTH_APP_LINKS[spec.pb] || `${url}/user/settings/applications` } },
              { key: "clientSecret", label: spec.pb === "bitbucket" ? "Secret" : "Client secret", type: "password", placeholder: current.clientId ? "Saved" : "", hint: current.clientId ? "Leave blank to keep the stored secret." : "" },
              { key: "callback", label: spec.pb === "microsoft" ? "Redirect URI" : "Callback URL", type: "readonly" },
            ],
            values: { ...(spec.pb === "microsoft" ? { tenant } : {}), clientId: current.clientId || "", clientSecret: "", callback: `${APP_URL}/auth/callback` },
          },
        }, spec.pb === "microsoft" ? { label: spec.label, url, icon: "microsoft" } : {});
      });
      return {
        sections: [{
          id: "signin",
          title: "Sign-in",
          description: "Providers your team signs in with. Turning one off removes its saved client credentials.",
          fields: [
            { key: "rows", label: "Providers", type: "table", columns: PROVIDER_COLUMNS },
          ],
        }],
        values: { signin: { rows } },
      };
    },
    actions: {
      async connect(body, http) {
        return githubManifest(body, http);
      },
    },
    async save(body) {
      // The sign-in table posts its rows with the toggled one marked; it is applied in the per-provider
      // { oauth | <forge>oauth: { enabled, clientId, clientSecret } } shape, which is also accepted directly.
      const edited = editedRow(body.signin, (r) => !!LOGIN_PROVIDERS[String(r.id)]);
      if (edited) {
        const v = rec(rec(edited.settings).values);
        body = { [edited.id === "github" ? "oauth" : `${edited.id}oauth`]: { enabled: !!edited.toggle, clientId: v.clientId, clientSecret: v.clientSecret, ...("tenant" in v ? { tenant: v.tenant } : {}) } };
      }
      if (!Object.keys(LOGIN_PROVIDERS).some((id) => body[id === "github" ? "oauth" : `${id}oauth`])) return;
      if (!PB_URL) throw new Error("Sign-in requires PocketBase (PB_URL)");
      const o = await store.getOAuth();
      let providers = [...o.providers];
      for (const [id, spec] of Object.entries(LOGIN_PROVIDERS)) {
        if (!body[id === "github" ? "oauth" : `${id}oauth`]) continue;
        const v = rec(body[id === "github" ? "oauth" : `${id}oauth`]);
        const current = providers.find((p) => p.name === spec.pb);
        providers = providers.filter((p) => p.name !== spec.pb);
        if (!v.enabled) continue;
        const clientId = String(v.clientId || "").trim();
        if (!clientId) throw new Error(`${spec.label} client ID is required`);
        if (!current && !v.clientSecret) throw new Error(`${spec.label} client secret is required`);
        providers.push(oauthProvider(id, current, clientId, v.clientSecret, v.tenant ?? entraTenant(current)));
      }
      await store.setOAuth({ ...o, enabled: providers.length > 0, providers });
    },
  },
};
// Manage accounts: a table row per account and per pending invite; the gear sets role and (developers) repositories.
// The first sign-in creates the owner; every later account comes from an invite (settings "invites"), matched in admit().
// Developer repositories live in settings "access" (user id -> repository ids).
const INVITE_ROLES: Role[] = ["developer", "admin"];
const INVITE_LOGIN_RE = /^[a-z0-9](?:[a-z0-9._-]{0,98}[a-z0-9])?$/;
const INVITE_EMAIL_RE = /^[^\s@"\\]+@[^\s@"\\]+\.[^\s@"\\]+$/;
// Sign-in providers that are enabled in PocketBase, as select options.
async function signInOptions() {
  try {
    const m = await store.authMethods();
    return Object.entries(LOGIN_PROVIDERS).filter(([, spec]) => m.oauth2?.enabled && m.oauth2.providers.some((p) => p.name === spec.pb)).map(([value, spec]) => ({ value, label: spec.label }));
  } catch { return []; }
}
// Only onboarded repositories can be assigned; anything else in the request is dropped.
const assignableRepos = async (list: unknown) => { const all = await repos(); return [...new Set((Array.isArray(list) ? list : []).map(String))].filter((r) => all.includes(r)); };
const reposCell = (role: string, list: string[] = []): Cell => (role !== "developer" ? "All" : list.length === 0 ? { text: "None", tone: "muted" } : list.length <= 2 ? list.map(repoLabel).join(", ") : `${list.length} repositories`);
// Its own invite() makes it more than a SettingsPage.
const accountsPage: SettingsPage & { invite(v: Body): Promise<void> } = {
  title: "Manage accounts",
  group: "workspace",
  access: "owner",
  async load(_scope, user): Promise<PageData> {
    if (!PB_URL) return { sections: [{ id: "accounts", title: "Accounts", description: "Accounts are not available in file-storage mode (set PB_URL).", fields: [] }], values: {} };
    const ROLE_TONE: Record<string, Tone> = { owner: "ok", admin: "warn", developer: "muted" };
    const [users, access, invites, providers] = [await store.users(), (await store.getSetting("access")) || {}, (await store.getSetting("invites")) || [], await signInOptions()];
    const repoOpts = (await repos()).map((value) => ({ value, label: repoLabel(value) }));
    const repoField = (hideFor: string[]): Field => ({ key: "repos", label: "Repositories", type: "multiselect", options: repoOpts, hideWhen: { field: "role", in: hideFor } });
    const rows = users.map((u): Row => {
      const v = userView(u);
      const role = u.role || "none";
      return {
        id: u.id,
        label: v.name,
        cells: {
          account: { text: v.name + (user && u.id === user.id ? " (you)" : ""), icon: v.avatar },
          email: v.email ? { text: v.email, mono: true } : "",
          role: { text: role, tone: ROLE_TONE[role] || "muted" },
          repos: reposCell(role, access[u.id]),
          status: { text: "Active", tone: "ok" },
        },
        settings: { title: v.name, fields: [{ key: "role", label: "Role", type: "select", options: ROLES.map((value) => ({ value, label: value })) }, repoField(["owner", "admin"])], values: { role: u.role || "", repos: access[u.id] || [] } },
      };
    });
    for (const i of invites) {
      const email = i.login.includes("@");
      rows.push({
        id: `invite:${i.id}`,
        label: i.login,
        cells: {
          account: { text: email ? `${LOGIN_PROVIDERS[i.provider]?.label || i.provider} invite` : `${i.login} · ${LOGIN_PROVIDERS[i.provider]?.label || i.provider}`, icon: "" },
          email: email ? { text: i.login, mono: true } : "",
          role: { text: i.role, tone: ROLE_TONE[i.role] || "muted" },
          repos: reposCell(i.role, i.repos),
          status: { text: "Pending", tone: "warn" },
        },
        actions: [{ id: "uninvite", label: "Remove" }],
      });
    }
    return {
      sections: [
        {
          id: "accounts",
          title: "Accounts",
          description: "The first sign-in is the owner; later sign-ins need an invite. Owners manage accounts; admins everything else; developers see their repositories only.",
          fields: [{ key: "rows", label: "Accounts", type: "table", columns: [{ key: "account", label: "Account" }, { key: "email", label: "Email" }, { key: "role", label: "Role" }, { key: "repos", label: "Repositories" }, { key: "status", label: "Status" }] }],
        },
        {
          id: "invite",
          title: "Invite",
          description: providers.length ? "Matched on first sign-in by provider and username, or by verified GitHub email." : "No sign-in provider is enabled: Admin / Auth providers.",
          fields: [
            { key: "login", label: "Username or email", type: "text", placeholder: "octocat or name@example.com" },
            { key: "provider", label: "Provider", type: "select", options: providers },
            { key: "role", label: "Role", type: "select", options: INVITE_ROLES.map((value) => ({ value, label: value })) },
            repoField(["admin"]),
          ],
          actions: providers.length ? [{ id: "save", label: "Invite" }] : [],
        },
      ],
      values: { accounts: { rows }, invite: { login: "", provider: providers[0]?.value || "", role: "developer", repos: [] } },
    };
  },
  async save(body) {
    if (body.invite) return this.invite(rec(body.invite));
    if (!body.accounts) return;
    const v = rec(body.accounts);
    const users = await store.users();
    const next = new Map<string, Role | "" | undefined>(users.map((u) => [u.id, u.role]));
    // The table posts its rows with the edited one marked; the list shape ({ list: [{ id, settings }] }) is still accepted.
    // Pending invite rows (id "invite:…") have no settings and are changed only through their Remove action.
    const changed = (v.rows ? arr(v.rows).map(rec).filter((r) => r.edited) : arr(v.list).map((it) => (typeof it === "string" ? { id: it } : rec(it)))).filter((it) => !String(it.id).startsWith("invite:"));
    if (v.list) for (const u of users) if (!changed.some((it) => it.id === u.id)) throw new Error("Removing accounts is not supported yet; change the role instead");
    const access = { ...((await store.getSetting("access")) || {}) };
    let accessChanged = false;
    for (const it of changed) {
      const values = rec(rec(it.settings).values);
      const role = values.role;
      if (!role) continue;
      if (!isRole(role)) throw new Error(`Unknown role ${role}`);
      const id = it.id;
      if (typeof id !== "string" || !next.has(id)) throw new Error("Unknown account");
      next.set(id, role);
      if (role === "developer") access[id] = await assignableRepos(values.repos);
      else delete access[id];
      accessChanged = true;
    }
    if (![...next.values()].includes("owner")) throw new Error("At least one owner is required");
    if (accessChanged) await store.setSetting("access", access);
    for (const [id, role] of next) if (role !== users.find((u) => u.id === id)?.role && isRole(role)) await store.setRole(id, role);
  },
  // A pending invite: provider + lowercased username, or a GitHub email (PocketBase keeps only GitHub's verified email),
  // or for Microsoft an email (Entra has no username; sign-in is pinned to one tenant, see oauthProvider).
  async invite(v) {
    const login = String(v.login || "").trim().toLowerCase();
    const provider = String(v.provider || "");
    const spec = Object.hasOwn(LOGIN_PROVIDERS, provider) && LOGIN_PROVIDERS[provider];
    if (!spec || !(await signInOptions()).some((p) => p.value === provider)) throw new Error("Pick a provider with sign-in enabled");
    const role = INVITE_ROLES.find((r) => r === v.role);
    if (!role) throw new Error(`Unknown role ${v.role}`);
    const email = login.includes("@");
    if (email ? !INVITE_EMAIL_RE.test(login) : !INVITE_LOGIN_RE.test(login)) throw new Error("Enter a username or an email address");
    if (spec.pb === "microsoft" && !email) throw new Error("Microsoft invites match by email address");
    if (email && !["github", "microsoft"].includes(spec.pb)) throw new Error(`${spec.label} invites match by username`);
    const invites = ((await store.getSetting("invites")) || []).filter((i) => !(i.pb === spec.pb && i.login === login));
    invites.push({ id: randomBytes(8).toString("hex"), provider, pb: spec.pb, login, role, repos: role === "developer" ? await assignableRepos(v.repos) : [], at: new Date().toISOString() });
    await store.setSetting("invites", invites);
  },
  actions: {
    async uninvite(body) {
      const id = String(body?.item || "").replace(/^invite:/, "");
      const invites = (await store.getSetting("invites")) || [];
      if (!invites.some((i) => i.id === id)) throw new Error("Unknown invite");
      await store.setSetting("invites", invites.filter((i) => i.id !== id));
      return { message: "Invite removed." };
    },
  },
};
SETTINGS_PAGES.accounts = accountsPage;
// Local models page: what is downloaded, what is available, one action per row. Nothing downloads by itself.
// What a running sidecar reports as its device, as GPU or CPU: laya and llama.cpp say vulkan:N / VulkanN / cuda /
// metal, the Python sidecar cuda or cpu.
const deviceKind = (device: string | undefined) => (/cpu/i.test(device || "") ? "CPU" : /vulkan|cuda|metal|rocm|hip|gpu|sycl|opencl/i.test(device || "") ? "GPU" : "");
// Display names; the catalog ids (laya, llama, codereviewer) stay internal. "laya" is the ggmlc runtime and serves every System One model.
const RUNTIME_LABEL: Record<string, string> = { laya: "ggmlc", llama: "llama.cpp", codereviewer: "Python (PyTorch)" };
SETTINGS_PAGES.models = {
  title: "Local models",
  group: "admin",
  access: "admin",
  async load() {
    const s1 = await s1Config();
    const llm = await llmConfig();
    const lastDevices = (await store.getSetting("runtimeDevices")) || {};
    // Where a runtime runs, whether or not it is loaded: the override env var, else the device it is on or last ran on,
    // else the runtime's own choice (a discrete GPU when there is one).
    const deviceOf = (runtime: string): CellObject => {
      const override = runtime === "laya" ? process.env.S1_DEVICE : process.env.LLM_DEVICE;
      const live = Object.values(sidecars).find((x) => x.proc && x.ready && LOCAL[String(x.id)]?.runtime === runtime)?.device;
      const dev = (override && override !== "auto" ? override : "") || live || lastDevices[runtime]?.device || "";
      const kind = deviceKind(dev);
      return dev ? { text: kind ? `${kind} · ${dev}` : dev, tone: kind === "CPU" ? "warn" : "ok" } : { text: "Auto (GPU if available)", tone: "muted" };
    };
    const row = (m: LocalModel): Row => {
      const st = localStatus(m);
      const d = downloads.get(m.id);
      const active = m.kind === "s1" ? s1.provider === m.id : llm.provider === `local_${m.id}`;
      const label = m.label.replace(" (local)", "");
      const pct = st.state === "downloading" && d?.total ? Math.round((d.done / d.total) * 100) : undefined;
      // Table row: the same columns for both tables; license, notes and the context note sit in the model's info tooltip.
      return {
        id: m.id,
        label,
        cells: {
          model: { text: label, icon: m.icon || modelIcon(m.repo || m.modelId, m.id), info: [m.license, m.notes, contextNote(m)].filter(Boolean).join(" · ") || undefined },
          maker: m.maker || "",
          size: `${m.sizeMB} MB`,
          context: m.contextTokens ? `${m.contextTokens} tokens` : "",
          runtime: RUNTIME_LABEL[m.runtime] || m.runtime,
          device: deviceOf(m.runtime),
          status: active ? { text: "Active", tone: "ok" } : st.state === "ready" ? { text: "Downloaded", tone: "ok" } : st.state === "downloading" ? { text: st.text, tone: "warn", ...(pct !== undefined ? { progress: pct } : {}) } : st.state === "missing" ? { text: "Not downloaded", tone: "muted" } : { text: st.text, tone: "warn" },
        },
        // One main button that follows the state (Download until downloaded, then Use; disabled while downloading and on
        // the active model), and Delete as an icon, disabled until there is something to delete.
        actions: [
          st.state === "ready"
            ? { id: "use", label: "Use", icon: "check", variant: "default", ...(active ? { disabled: true } : {}) }
            : { id: "download", label: "Download", icon: "download", variant: "default", ...(st.state === "downloading" ? { loading: true } : st.state === "missing" ? {} : { disabled: true }) },
          { id: "delete", label: `Delete ${label}`, icon: "trash", iconOnly: true, danger: true, variant: "outline", ...(st.state === "ready" ? {} : { disabled: true }) },
        ],
        state: st.state,
      };
    };
    const llmRows = LOCAL_LLM.map(row);
    const s1Rows = LOCAL_S1.map(row);
    // One row per runtime: which engine uses it, whether it is installed, and the device of the model it is serving
    // (or, while idle, the device it last ran on).
    const runtimeRows = Object.keys(RUNTIMES).map((name): Row => {
      const sc = Object.values(sidecars).find((x) => x.proc && x.ready && LOCAL[String(x.id)]?.runtime === name);
      const py = RUNTIMES[name].kind === "python";
      const installed = py ? existsSync(venvPython(name)) : existsSync(runtimeBin(name));
      const usedBy = [...new Set(Object.values(LOCAL).filter((m) => m.runtime === name).map((m) => (m.kind === "s1" ? "System One" : "Language model")))].join(", ");
      return {
        id: name,
        label: name,
        cells: {
          runtime: { text: RUNTIME_LABEL[name] || name, info: py ? "Python venv built from the catalog's pip list; uses CUDA when available, else CPU." : `Prefers a discrete GPU via Vulkan; falls back to CPU. ${name === "laya" ? "S1_DEVICE" : "LLM_DEVICE"} overrides.` },
          usedBy,
          version: py ? "venv" : { text: RUNTIMES[name].version, mono: true },
          status: installed ? { text: "Installed", tone: "ok" } : py ? (findPython() ? { text: "Created with the first download", tone: "muted" } : { text: "Needs Python 3.10+", tone: "warn" }) : runtimeAssets(name).length ? { text: "Fetched with the first download", tone: "muted" } : { text: `No build for ${process.platform}-${process.arch}`, tone: "bad" },
          state: sc ? { text: `Running · ${LOCAL[String(sc.id)].label.replace(" (local)", "")}`, tone: "ok" } : { text: "Idle", tone: "muted" },
          device: deviceOf(name),
        },
      };
    });
    const poll = (rows: Row[]) => (rows.some((r) => r.state === "downloading") ? 2000 : 0);
    // Same two engines as Model provider: both are used together. Download / Use / Delete per row; nothing downloads by itself.
    const columns: { key: string; label: string }[] = [{ key: "model", label: "Model" }, { key: "maker", label: "Maker" }, { key: "size", label: "Size" }, { key: "context", label: "Context" }, { key: "runtime", label: "Runtime" }, { key: "device", label: "Runs on" }, { key: "status", label: "Status" }];
    const sections: Section[] = [
      {
        id: "s1",
        title: "System One models",
        description: "Answers scores and gates. Use makes one the active System One model.",
        fields: [{ key: "rows", label: "Models", type: "table", columns }],
        poll: poll(s1Rows),
      },
      {
        id: "llm",
        title: "Language models",
        description: "Writes the summary, walkthrough and findings. Use makes one the active language model.",
        fields: [{ key: "rows", label: "Models", type: "table", columns }],
        poll: poll(llmRows),
      },
      {
        id: "runtime",
        title: "Runtimes",
        description: "Processes that serve local models. Each downloads with the first model that needs it.",
        fields: [{ key: "rows", label: "Runtimes", type: "table", columns: [{ key: "runtime", label: "Runtime" }, { key: "usedBy", label: "Used by" }, { key: "version", label: "Version" }, { key: "status", label: "Status" }, { key: "state", label: "State" }, { key: "device", label: "Runs on" }] }],
      },
    ];
    return { sections, values: { llm: { rows: llmRows }, s1: { rows: s1Rows }, runtime: { rows: runtimeRows } } };
  },
  async save() {},
  actions: {
    async download(body) {
      const m = LOCAL[String(body?.item)];
      if (!m) throw new Error("Unknown model");
      const haveModel = modelReady(m);
      if (!haveModel && !downloads.get(m.id)?.active) downloadModel(m);
      ensureRuntime(m.runtime).catch(() => {});
      return { message: haveModel ? `Installing the ${m.runtime} runtime…` : `Downloading ${m.label} (${m.sizeMB} MB)…` };
    },
    async use(body) {
      const m = LOCAL[String(body?.item)];
      if (!m) throw new Error("Unknown model");
      if (!modelReady(m)) throw new Error(`${m.label} is not downloaded`);
      if (sidecars[m.kind].id && sidecars[m.kind].id !== m.id) stopSidecar(m.kind);
      if (m.kind === "s1") await store.setSetting("s1", { provider: m.id });
      else await store.setSetting("llm", { provider: `local_${m.id}` });
      modelCache.clear();
      return { message: `${m.label} is now the ${m.kind === "s1" ? "System One" : "language"} model.` };
    },
    async delete(body) {
      const m = LOCAL[String(body?.item)];
      if (!m) throw new Error("Unknown model");
      if (sidecars[m.kind].id === m.id) stopSidecar(m.kind);
      rmSync(modelPath(m), { force: true, recursive: true });
      rmSync(`${modelPath(m)}.part`, { force: true });
      downloads.delete(m.id);
      if (m.kind === "s1") { const s1 = (await store.getSetting("s1")) || {}; if (s1.provider === m.id) await store.setSetting("s1", { provider: "none" }); }
      else { const l = (await store.getSetting("llm")) || {}; if (l.provider === `local_${m.id}`) await store.setSetting("llm", { provider: "minimax" }); }
      return { message: `${m.label} deleted.` };
    },
  },
};

export const settingsPages = async (user: { role?: Role | "" } | null | undefined) => {
  const role = await effectiveRole(user);
  // group "settings" = organization-scoped pages; group "admin" = platform-wide pages, shown to admins and owners in every organization
  return Object.entries(SETTINGS_PAGES).filter(([, p]) => allowed(role, p.access)).map(([id, p]) => ({ id, title: p.title, group: p.group || "settings" }));
};
