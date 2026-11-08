// Sign-in: the current user, avatars, the OAuth start and callback, logout, the GitHub App manifest callback and the
// login page's data. Mounted at /. Public: each route checks what it needs itself.
import { Hono } from "hono";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getCookie } from "hono/cookie";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { APP_URL } from "../config.ts";
import { PB_URL, store } from "../store.ts";
import type { AuthResult } from "../store.ts";
import { forgetGithubRepos } from "../git.ts";
import { ENTRA_TENANT_RE, entraTenant, LOGIN_PROVIDERS, oauthFlows } from "../settings-pages.ts";
import { admit, currentUser, NOT_INVITED } from "../access.ts";
import { cookie, own, session } from "./middleware.ts";

export const auth = new Hono();

// POST /app-manifests/{code}/conversions: the fields this callback reads.
type GithubAppConversion = { id?: number; slug?: string; html_url?: string; owner?: { login?: string } | null; pem?: string; client_id?: string; client_secret?: string; webhook_secret?: string };

// Showcase content for the login page's right column: showcase.json next to the server, editable without code.
auth.get("/api/login", async (c) => {
  const file = join(import.meta.dirname, "..", "showcase.json");
  const showcase = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : { headline: "Code Otter", sub: "", groups: [] };
  let providers: { id: string; label: string }[] = [];
  if (PB_URL) { try { const m = await store.authMethods(); providers = Object.entries(LOGIN_PROVIDERS).filter(([, spec]) => m.oauth2?.enabled && m.oauth2.providers.some((p) => p.name === spec.pb)).map(([id, spec]) => ({ id, label: spec.label })); } catch {} }
  return c.json({ showcase, signInAvailable: !!PB_URL, configured: providers.length > 0, providers });
});

auth.get("/api/me", async (c) => {
  const u = await currentUser(session(c));
  return c.json({ user: u ? { id: u.id, name: u.name, email: u.email, role: u.role, avatar: u.avatar } : null, signInAvailable: !!PB_URL });
});

// Only the signed-in user's own avatar file, proxied from PocketBase.
auth.get("/api/me/avatar", async (c) => {
  const u = await currentUser(session(c));
  const name = c.req.query("f") || "";
  if (!u || u.id !== c.req.query("id") || !/^[\w.-]+$/.test(name)) return c.body(null, 404);
  const f = await store.userFile(u.id, name);
  // PocketBase's own status, passed through (Hono types the body overload by status class)
  return c.body(await f.arrayBuffer(), f.status as ContentfulStatusCode, { "content-type": f.headers.get("content-type") || "image/png", "cache-control": "private, max-age=3600" });
});

auth.get("/api/auth/start", async (c) => {
  if (!PB_URL) throw new Error("Sign-in is not available in file-storage mode (set PB_URL)");
  const m = await store.authMethods();
  const id = c.req.query("provider") || "github";
  const spec = own(LOGIN_PROVIDERS, id);
  if (!spec) throw new Error("Unsupported sign-in provider");
  const provider = m.oauth2?.enabled && m.oauth2.providers.find((p) => p.name === spec.pb);
  if (!provider) throw new Error(`${spec.label} sign-in is not configured: open Admin / Auth providers`);
  const back = c.req.query("back") || "/";
  for (const [key, flow] of oauthFlows) if (flow.expires < Date.now()) oauthFlows.delete(key);
  if (oauthFlows.size >= 1000) throw new Error("Too many pending sign-ins; try again later");
  const key = randomBytes(32).toString("hex");
  oauthFlows.set(key, { provider: spec.pb, state: provider.state, codeVerifier: provider.codeVerifier, back: /^\/(?![\/\\])/.test(back) ? back : "/", expires: Date.now() + 600000 });
  cookie(c, "pr_oauth", key, 600);
  return c.json({ url: provider.authURL + encodeURIComponent(`${APP_URL}/auth/callback`) });
});

auth.get("/auth/callback", async (c) => {
  const key = getCookie(c, "pr_oauth") || "";
  const flow = oauthFlows.get(key);
  oauthFlows.delete(key);
  cookie(c, "pr_oauth", "", 0);
  const fail = (msg: string) => c.redirect(`/login?login_error=${encodeURIComponent(msg)}`, 302);
  const q = c.req.query();
  if (!flow || flow.expires < Date.now() || flow.state !== q.state) return fail("Sign-in state mismatch, try again");
  if (q.error) return fail(q.error_description || q.error);
  let signedIn: AuthResult;
  try {
    signedIn = await store.authWithOAuth2({ provider: flow.provider, code: q.code, codeVerifier: flow.codeVerifier, redirectURL: `${APP_URL}/auth/callback` });
    // First account: owner. Later ones need an invite; an uninvited account is deleted again, never left usable.
    // Microsoft: the directory's mail (or UPN), trusted only while the app is pinned to one tenant
    let entraEmail = "";
    if (flow.provider === "microsoft") {
      const p = (await store.getOAuth()).providers.find((x) => x.name === "microsoft");
      if (ENTRA_TENANT_RE.test(entraTenant(p))) entraEmail = String(signedIn.meta?.email || signedIn.meta?.rawUser?.mail || signedIn.meta?.rawUser?.userPrincipalName || "");
    }
    if (!(await admit(signedIn.record, [flow.provider], signedIn.meta?.username, entraEmail))) {
      await store.deleteUser(signedIn.record.id).catch((e) => console.error(`Could not delete uninvited account ${signedIn.record.id}: ${e.message}`));
      return fail(NOT_INVITED);
    }
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
  cookie(c, "pr_auth", signedIn.token, 14 * 86400);
  return c.redirect(flow.back || "/", 302);
});

auth.post("/api/auth/logout", (c) => {
  cookie(c, "pr_auth", "", 0);
  return c.json({ ok: true });
});

// GitHub returns here after the user creates the app from our manifest (Settings / Git providers or onboarding).
auth.get("/github/manifest/callback", async (c) => {
  const returnTo = getCookie(c, "pr_manifest_return") || "/settings/git";
  const fail = (msg: string) => c.redirect(`${returnTo}?error=${encodeURIComponent(msg)}`, 302);
  const state = getCookie(c, "pr_manifest");
  if (!state || state !== c.req.query("state")) return fail("GitHub app creation state mismatch, try again");
  const conv = await fetch(`https://api.github.com/app-manifests/${encodeURIComponent(String(c.req.query("code")))}/conversions`, { method: "POST", headers: { accept: "application/vnd.github+json", "user-agent": "CodeOtter" } });
  if (!conv.ok) return fail(`GitHub rejected the app manifest (${conv.status})`);
  const app = (await conv.json()) as GithubAppConversion; // GitHub's reply to our own manifest; fields are optional
  const o = await store.getOAuth();
  await store.setOAuth({ ...o, enabled: true, providers: [...o.providers.filter((p) => p.name !== "github"), { name: "github", clientId: app.client_id, clientSecret: app.client_secret }] });
  await store.setSetting("primaryProvider", "github");
  await store.setSetting("githubApp", {
    id: app.id,
    slug: app.slug,
    owner: app.owner?.login || "",
    pem: app.pem || "",
    clientId: app.client_id,
    clientSecret: app.client_secret,
    webhookSecret: app.webhook_secret || "",
  });
  if (app.owner?.login) await store.setSetting("githubOwner", app.owner.login);
  cookie(c, "pr_manifest", "", 0);
  cookie(c, "pr_manifest_return", "", 0);
  forgetGithubRepos();
  if (app.slug && returnTo.startsWith("/onboarding")) return c.redirect(`https://github.com/apps/${encodeURIComponent(app.slug)}/installations/new`, 302);
  return c.redirect(`${returnTo}?connected=${encodeURIComponent(app.html_url || app.slug || "github")}`, 302);
});
