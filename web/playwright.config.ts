// End to end against the real server in a throwaway home: JSON file storage, no PocketBase, no model, no forge token.
// Needs web/dist (pnpm build) and a Chromium from `pnpm exec playwright install chromium`.
import { defineConfig } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const port = 4790;
const home = mkdtempSync(join(tmpdir(), "codeotter-e2e-"));

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["junit", { outputFile: "test-results/e2e.xml" }]] : "list",
  use: { baseURL: `http://127.0.0.1:${port}`, trace: "retain-on-failure", channel: "chromium" },
  webServer: {
    command: `node ${resolve(import.meta.dirname, "..", "core", "server.mjs")}`,
    url: `http://127.0.0.1:${port}/healthz`,
    reuseExistingServer: false,
    env: { CODEOTTER_HOME: home, PB_URL: "", PORT: String(port), REPO: "acme/shop", CODEOTTER_UPDATE_CHECK: "0", GH_TOKEN: "", LLM_API_KEY: "", ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "" },
  },
});
