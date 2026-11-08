// The HTTP app: middleware, each module's routes, errors. server.ts serves it; tests call app.request() directly.
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { sameSite } from "./routes/middleware.ts";
import { webhooks } from "./routes/webhooks.ts";
import { reviews } from "./routes/reviews.ts";
import { onboarding } from "./routes/onboarding.ts";
import { settings } from "./routes/settings.ts";
import { auth } from "./routes/auth.ts";
import { site } from "./routes/site.ts";

export const app = new Hono();

app.use("/api/*", sameSite);
app.use("/score", sameSite);
app.use("/api/*", bodyLimit({ maxSize: 1e6, onError: (c) => c.json({ error: "Request body too large" }, 413) }));

app.route("/webhooks", webhooks);
app.route("/api", reviews);
app.route("/api/onboarding", onboarding);
app.route("/api/settings", settings);
app.route("/", auth);
app.route("/", site);

app.notFound((c) => c.json({ error: "Not found" }, 404));

// A thrown error is the reply: { error } with 403 for access errors (err.status 403), 500 otherwise.
app.onError((e, c) => {
  if (e instanceof HTTPException) return e.getResponse();
  const cause = e.cause;
  const detail = cause ? ` (${(typeof cause === "object" && (("code" in cause && cause.code) || ("message" in cause && cause.message))) || cause})` : "";
  const msg = e.message === "fetch failed" ? `Fetch failed: connection error or endpoint unreachable${detail}` : `${e.message}${detail}`;
  console.error(`[API Error] ${c.req.method} ${c.req.path}:`, e.stack || e);
  return c.json({ error: msg }, "status" in e && e.status === 403 ? 403 : 500);
});
