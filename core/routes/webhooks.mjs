// POST /webhooks/<source>: deliveries from GitHub and each forge. Authenticated by the delivery's signature (or Azure's
// secret header), not by session, so no gate and no cross-site check. Work is queued; the reply never waits for it.
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { handleWebhook } from "../queue.mjs";

export const webhooks = new Hono();
const SOURCE = "/:source{github|forgejo|gitea|bitbucket|bitbucketdc|azure}";

webhooks.post(SOURCE, bodyLimit({ maxSize: 2e6, onError: (c) => c.json({ error: "Request body too large" }, 413) }), async (c) => {
  const { status, body } = await handleWebhook(c.req.param("source"), c.req.header(), Buffer.from(await c.req.arrayBuffer()));
  return c.json(body, status);
});
webhooks.all(SOURCE, (c) => c.json({ error: "POST only" }, 405));
