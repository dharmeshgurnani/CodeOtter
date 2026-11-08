// Settings pages (SETTINGS_PAGES): GET loads a page, POST saves it, POST /:page/:action runs a row action or the test.
// Mounted at /api/settings. A page is never below admin; owner pages need owner.
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { OWNER_RE } from "../config.ts";
import { SETTINGS_PAGES } from "../settings-pages.ts";
import { onboardedRepo } from "../access.ts";
import { cookie, gate, jsonBody, own } from "./middleware.ts";
import type { Env, Viewer } from "./middleware.ts";

// ?org= and ?repo= of a settings request.
export type SettingsScope = { org: string; repo: string };
// What this router needs of a SETTINGS_PAGES entry.
type SettingsAction = (body: Record<string, unknown>, ctx: { setCookie: (name: string, value: string, maxAge: number) => void }) => Promise<unknown>;
type SettingsPage = {
  access?: string;
  load: (scope: SettingsScope, user: Viewer["user"]) => Promise<unknown>;
  save: (body: Record<string, unknown>, scope: SettingsScope, user: Viewer["user"]) => Promise<unknown>;
  test?: () => Promise<unknown>;
  actions?: Record<string, SettingsAction>;
};
type SettingsEnv = { Variables: Env["Variables"] & { page: SettingsPage; scope: SettingsScope } };
const PAGES: Record<string, SettingsPage> = SETTINGS_PAGES;

export const settings = new Hono<SettingsEnv>();

const page = createMiddleware<SettingsEnv>(async (c, next) => {
  const id = c.req.param("page") || "";
  const p = own(PAGES, id);
  if (!p) throw new Error(`No settings page ${c.req.param("page")}`);
  c.set("page", p);
  await next();
});
const access = gate<SettingsEnv>((c) => (c.get("page").access === "owner" ? "owner" : "admin"));
// ?org= and ?repo= (a repository's own settings page): validated, and the repository must be onboarded.
const scope = createMiddleware<SettingsEnv>(async (c, next) => {
  const s = { org: c.req.query("org") || "", repo: c.req.query("repo") || "" };
  if (s.org && !OWNER_RE.test(s.org)) throw new Error("Bad organization");
  if (s.repo) await onboardedRepo(s.repo, s.org);
  c.set("scope", s);
  await next();
});

settings.get("/:page{[a-z]+}", page, access, scope, async (c) => c.json(await c.get("page").load(c.get("scope"), c.get("viewer").user)));

settings.post("/:page{[a-z]+}", page, access, scope, async (c) => {
  const p = c.get("page"), s = c.get("scope"), user = c.get("viewer").user;
  await p.save(await jsonBody(c), s, user);
  return c.json(await p.load(s, user));
});

settings.post("/:page{[a-z]+}/:action{[a-z]+}", page, access, async (c) => {
  const p = c.get("page"), id = c.req.param("action");
  if (id === "test" && typeof p.test === "function") return c.json(await p.test());
  const action = own(p.actions || {}, id);
  if (!action) throw new Error(`No action ${id} on ${c.req.param("page")}`);
  return c.json(await action(await jsonBody(c), { setCookie: (name, value, maxAge) => cookie(c, name, value, maxAge) }));
});

settings.on(["GET", "PUT", "PATCH", "DELETE"], "/:page{[a-z]+}/:action{[a-z]+}", page, access, (c) => c.json({ error: "POST only" }, 405));
