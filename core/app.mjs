// The HTTP app: middleware, each module's routes, errors. server.mjs serves it; tests call app.request() directly.
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { sameSite } from "./routes/middleware.mjs";
import { webhooks } from "./routes/webhooks.mjs";
import { reviews } from "./routes/reviews.mjs";
import { onboarding } from "./routes/onboarding.mjs";
import { settings } from "./routes/settings.mjs";
import { auth } from "./routes/auth.mjs";
import { site } from "./routes/site.mjs";

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
  const detail = e.cause ? ` (${e.cause.code || e.cause.message || e.cause})` : "";
  const msg = e.message === "fetch failed" ? `Fetch failed: connection error or endpoint unreachable${detail}` : `${e.message}${detail}`;
  console.error(`[API Error] ${c.req.method} ${c.req.path}:`, e.stack || e);
  return c.json({ error: msg }, e.status === 403 ? 403 : 500);
});
