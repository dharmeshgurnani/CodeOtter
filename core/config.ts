// Environment, paths, the app's public address, git server settings, repository id rules and the update check.
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { makeForge } from "./forges.ts";
import type { Forge, ForgeConfig } from "./forges.ts";

// Importing the shared services from the TUI must not start a web server or automation: true only when server.ts is the entry point.
export const IS_SERVER = !!process.argv[1] && pathToFileURL(realpathSync(join(import.meta.dirname, "server.ts"))).href === pathToFileURL(realpathSync(process.argv[1])).href;
export const ROOT = resolve(import.meta.dirname, ".."); // repository root: package.json, web/, .env, data folders
export const CODEOTTER_HOME = resolve(process.env.CODEOTTER_HOME || ROOT);

// Auto-load .env if present
const ENV_FILE = join(CODEOTTER_HOME, ".env");
if (existsSync(ENV_FILE) && typeof process.loadEnvFile === "function") {
  try { process.loadEnvFile(ENV_FILE); } catch {}
}

export const PORT = process.env.PORT || 4747;
// Public address of this app, used for the OAuth callback. Set APP_URL when deployed behind a domain.
// Render and Railway publish the service's own address, so one-click deploys work without setting it.
export const APP_URL = (process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || (process.env.RAILWAY_PUBLIC_DOMAIN && `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`) || `http://localhost:${PORT}`).replace(/\/+$/, "");
// ponytail: default repo = the git repo you launch from; set REPO to point elsewhere
export function forgeOrigin(value: unknown): string {
  if (!value) return "";
  const u = new URL(String(value).replace(/\/+$/, ""));
  if (!["http:", "https:"].includes(u.protocol) || u.username || u.password || u.search || u.hash || u.pathname !== "/") {
    throw new Error("Server URL must be an HTTP(S) origin without credentials, a path, query or fragment");
  }
  if (u.hostname === "github.com") throw new Error("Git servers must use a separate server from github.com");
  return u.origin;
}
// Every git server besides GitHub. `kind` picks the adapter in forges.ts; `fixed` providers have one public origin;
// `pb` is the PocketBase OAuth2 provider used for sign-in (Bitbucket Data Center has none). Saved settings override env.
const envList = (v: string | undefined) => String(v || "").split(",").map((x) => x.trim()).filter(Boolean);
export const FORGES: Record<string, ForgeConfig> = {
  forgejo: { kind: "gitea", label: "Forgejo", pb: "oidc", url: forgeOrigin(process.env.FORGEJO_URL || ""), token: process.env.FORGEJO_TOKEN || "" },
  gitea: { kind: "gitea", label: "Gitea", pb: "gitea", url: forgeOrigin(process.env.GITEA_URL || ""), token: process.env.GITEA_TOKEN || "" },
  bitbucket: { kind: "bitbucket", label: "Bitbucket", pb: "bitbucket", fixed: true, url: "https://bitbucket.org", token: process.env.BITBUCKET_TOKEN || "", user: process.env.BITBUCKET_USER || "" },
  bitbucketdc: { kind: "bitbucketdc", label: "Bitbucket Data Center", url: forgeOrigin(process.env.BITBUCKET_DC_URL || ""), token: process.env.BITBUCKET_DC_TOKEN || "" },
  azure: { kind: "azure", label: "Azure DevOps", pb: "microsoft", signInLabel: "Microsoft", fixed: true, url: "https://dev.azure.com", token: process.env.AZURE_DEVOPS_TOKEN || "", orgs: envList(process.env.AZURE_DEVOPS_ORGS) },
};
export const FORGE_IDS = Object.keys(FORGES);
export const FORGE_API: Record<string, Forge> = Object.fromEntries(FORGE_IDS.map((id) => [id, makeForge(id, FORGES[id])]));
// A provider is in use once it can be reached: a self-hosted one when its server is set, a fixed one when it has a token.
export const forgeActive = (id: string): boolean => (FORGES[id].fixed ? !!FORGES[id].token : !!FORGES[id].url);
// Newest published release, refreshed in the background at most every 6 hours. CODEOTTER_UPDATE_CHECK=0 turns it off.
export const VERSION: string = (JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { version: string }).version;
const release = { at: 0, version: "", url: "" };
const newer = (a: string, b: string) => { const x = a.split(".").map(Number), y = b.split(".").map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]; return false; };
export function availableUpdate(): { version: string; url: string } | null {
  if (process.env.CODEOTTER_UPDATE_CHECK === "0") return null;
  if (Date.now() - release.at > 6 * 3600e3) {
    release.at = Date.now();
    fetch("https://api.github.com/repos/dharmeshgurnani/CodeOtter/releases/latest", { headers: { accept: "application/vnd.github+json", "user-agent": "CodeOtter" }, redirect: "error", signal: AbortSignal.timeout(5000) })
      .then((r) => (r.ok ? (r.json() as Promise<{ tag_name?: unknown }>) : null))
      .then((j) => {
        const v = String(j?.tag_name || "").replace(/^v/, "");
        if (/^\d+\.\d+\.\d+$/.test(v)) Object.assign(release, { version: v, url: `https://github.com/dharmeshgurnani/CodeOtter/releases/tag/v${v}` });
      })
      .catch(() => {});
  }
  return release.version && newer(release.version, VERSION) ? { version: release.version, url: release.url } : null;
}
// Declared before repoFromCwd() runs below: a const used before its declaration throws, and the catch blocks there would hide it.
// <repo-id>
// owner/name everywhere, except Azure DevOps: azure~org/project/repo, whose project and repository names may hold spaces.
export const OWNER_RE = /^(?:(?:forgejo|gitea|bitbucket|bitbucketdc|azure)~)?[\w][\w.-]*$/;
export const REPO_RE = /^(?:(?:(?:forgejo|gitea|bitbucket|bitbucketdc)~)?[\w][\w.-]*\/[\w][\w.-]*|azure~[\w][\w.-]*\/[\w](?:[\w. -]*[\w.-])?\/[\w](?:[\w. -]*[\w.-])?)$/;
// </repo-id>
export const REPO: string = process.env.REPO || (FORGE_IDS.some(forgeActive) ? "" : repoFromCwd());
function repoFromCwd(): string {
  try {
    const ghRepo = execFileSync("gh", ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"], { encoding: "utf8" }).trim();
    if (ghRepo && REPO_RE.test(ghRepo)) return ghRepo;
  } catch {}
  try {
    const origin = execFileSync("git", ["config", "--get", "remote.origin.url"], { encoding: "utf8" }).trim();
    const m = origin.match(/[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?$/);
    if (m && REPO_RE.test(`${m[1]}/${m[2]}`)) return `${m[1]}/${m[2]}`;
  } catch {}
  // No git checkout (Docker, Railway, Render): nothing is onboarded until the owner picks repositories.
  return "";
}
