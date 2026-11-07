// Middleware and helpers shared by the route modules: the session cookie, gate(), cookie writing and JSON bodies.
import { createMiddleware } from "hono/factory";
import { getCookie, setCookie } from "hono/cookie";
import { APP_URL } from "../config.mjs";
import { gate as decide } from "../access.mjs";

// pr_auth is the PocketBase user token; pr_oauth an opaque key for server-held OAuth state and PKCE.
export const session = (c) => getCookie(c, "pr_auth");

export const cookie = (c, name, value, maxAge) =>
  setCookie(c, name, value, { path: "/", httpOnly: true, sameSite: "Lax", maxAge, secure: APP_URL.startsWith("https") });

// Every data route declares its level: gate("owner" | "admin" | "review"), or a function of the context when the level
// depends on the request (settings pages). The viewer ({ user, role }) is then c.get("viewer").
export const gate = (level) =>
  createMiddleware(async (c, next) => {
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

// A JSON body; an empty body is {}. Size is capped by bodyLimit in app.mjs.
export const jsonBody = async (c) => {
  const text = await c.req.text();
  return text ? JSON.parse(text) : {};
};
