// Middleware and helpers shared by the route modules: the session cookie, gate(), cookie writing and JSON bodies.
import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { getCookie, setCookie } from "hono/cookie";
import { APP_URL } from "../config.ts";
import { gate as decide } from "../access.ts";
import type { Access, GateResult } from "../access.ts";

// The viewer gate() leaves on the context: { user, role } of an allowed request.
export type Viewer = Extract<GateResult, { ok: true }>;
// The app's Hono environment: what route middleware sets with c.set() and handlers read with c.get().
export type Env = { Variables: { viewer: Viewer } };

// pr_auth is the PocketBase user token; pr_oauth an opaque key for server-held OAuth state and PKCE.
export const session = (c: Context) => getCookie(c, "pr_auth");

export const cookie = (c: Context, name: string, value: string, maxAge: number) =>
  setCookie(c, name, value, { path: "/", httpOnly: true, sameSite: "Lax", maxAge, secure: APP_URL.startsWith("https") });

// Every data route declares its level: gate("owner" | "admin" | "review"), or a function of the context when the level
// depends on the request (settings pages). The viewer ({ user, role }) is then c.get("viewer").
export const gate = <E extends Env = Env>(level: Access | ((c: Context<E>) => Access)) =>
  createMiddleware<E>(async (c, next) => {
    const g = await decide(session(c), typeof level === "function" ? level(c) : level);
    if (!g.ok) return c.json(g.refusal, 403);
    c.set("viewer", g);
    await next();
  });

// Cross-site requests never reach the API (defence in depth on top of SameSite=Lax cookies).
export const sameSite = createMiddleware(async (c, next) => {
  if (c.req.header("sec-fetch-site") === "cross-site") return c.json({ error: "Cross-site request refused" }, 403);
  await next();
});

// An own entry of a lookup table by a request-supplied key, or false: the key never reaches the prototype. The cast is
// what Object.hasOwn() just checked.
export const own = <T extends object>(table: T, key: string): T[keyof T] | false => Object.hasOwn(table, key) && table[key as keyof T];

// A JSON object (a nested request field) or not.
export const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
// A caught error's message.
export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

// A JSON body; an empty body is {}. Size is capped by bodyLimit in app.ts. Untrusted: callers narrow what they read.
export const jsonBody = async (c: Context): Promise<Record<string, unknown>> => {
  const text = await c.req.text();
  return text ? JSON.parse(text) : {};
};
