// Reviews, home, learnings, PR tools, inline suggestions, triage and scores. Mounted at /api, next to other modules' /api
// routes, so each route carries its own gate("review") (a .use() here would gate all of /api). Then every route is scoped
// to the active organization and to the repositories the viewer may see.
import { Hono } from "hono";
import type { Context } from "hono";
import { availableUpdate, FORGES, OWNER_RE } from "../config.ts";
import { PB_URL, store } from "../store.ts";
import { openPrs, parsePrUrl, validPrUrl } from "../git.ts";
import { llmConfig } from "../models.ts";
import { getRepoLearnings, setRepoLearnings } from "../context.ts";
import { deriveSuggestionFromDetail } from "../engines.ts";
import type { Severity } from "../engines.ts";
import type { InlineTarget } from "../review.ts";
import { activeReviews, postInlineSuggestionsOnPr, resolvePr, score, startOrPollReview, triagePr } from "../review.ts";
import { PR_TOOLS, runPrTool } from "../pr-tools.ts";
import { homeData, renderScore, repoOf } from "../views.ts";
import { settingsPages } from "../settings-pages.ts";
import { assertRepo, checkRepoScope, requestOrg, seesAll, visibleRepos } from "../access.ts";
import { gate, jsonBody } from "./middleware.ts";
import type { Env } from "./middleware.ts";

export const reviews = new Hono<Env>();
const review = gate("review");
// A URL already validated (validPrUrl or resolvePr) parsed: owner/name and number.
const parsed = (url: string | null) => {
  const p = url ? parsePrUrl(url) : null;
  if (!p?.repo) throw new Error("Invalid pull request URL");
  return { repo: p.repo, number: p.number };
};
// A posted finding's severity from the request ("low" when it is not one of ours).
const SEVERITIES: readonly Severity[] = ["high", "medium", "low", "nit"];
const severityOf = (v: unknown): Severity => SEVERITIES.find((x) => x === v) || "low";
// A review whose findings a learning can mark dismissed.
type Dismissable = { review?: { findings?: { file?: string; title?: string; dismissed?: boolean }[] } };

reviews.get("/reviews", review, async (c) => {
  const g = c.get("viewer");
  const conf = await llmConfig();
  const rs = await visibleRepos(g);
  const org = requestOrg(c.req.query("org"));
  const scoped = rs.filter((r) => !org || r.startsWith(`${org}/`));
  const onboardingComplete = (await store.getSetting("onboardingComplete")) === true;
  const onboardingNeeded = seesAll(g) && !onboardingComplete && rs.length === 0;
  const reviewed = (await store.all()).filter((r) => (!org || repoOf(r.pr).startsWith(`${org}/`)) && (seesAll(g) || rs.includes(repoOf(r.pr))));
  return c.json({ repo: scoped[0] || "", repos: rs, onboardingNeeded, forgejoUrl: FORGES.forgejo.url, forgeUrls: Object.fromEntries(Object.entries(FORGES).map(([id, f]) => [id, f.url])), model: `${conf.provider}/${conf.model}`, baseUrl: seesAll(g) ? conf.baseUrl : "", store: PB_URL ? "pocketbase" : "files", update: availableUpdate(), settingsPages: await settingsPages(g.user), reviewed, open: (await Promise.all(scoped.map((r) => openPrs(r)))).flat() });
});

reviews.get("/home", review, async (c) => {
  const org = c.req.query("org") || "";
  if (org && !OWNER_RE.test(org)) throw new Error("Bad organization");
  return c.json(await homeData(org, c.get("viewer")));
});

reviews.post("/learnings", review, async (c) => {
  const g = c.get("viewer");
  const body = await jsonBody(c);
  const prUrl = String(body.prUrl || "").trim();
  const repo = String(body.repo || (prUrl ? repoOf({ url: prUrl }) : "")).trim();
  checkRepoScope(repo, requestOrg(c.req.query("org")));
  if (prUrl && repoOf({ url: prUrl }) !== repo) throw new Error("PR and repository mismatch");
  await assertRepo(g, repo);
  const fileBit = String(body.file || "").trim();
  const titleBit = String(body.title || "").trim();
  const detailBit = String(body.detail || "").trim().split("\n")[0].slice(0, 140);
  const ruleText = String(
    body.rule ||
    (fileBit && titleBit
      ? `[${fileBit}] Ignore pattern: ${titleBit}`
      : titleBit
        ? `Ignore pattern: ${titleBit}`
        : fileBit && detailBit
          ? `[${fileBit}] Ignore pattern: ${detailBit}`
          : detailBit || "Ignore dismissed finding pattern"),
  )
    .trim()
    .slice(0, 300);
  const prev = await getRepoLearnings(repo);
  const learnings = await setRepoLearnings(repo, [...prev, ruleText]);
  let updatedReview = null;
  if (prUrl && validPrUrl(prUrl)) {
    const stored = await store.get(prUrl).catch(() => null);
    const active = activeReviews.get(prUrl)?.state || null;
    const target = stored || active;
    if (target) {
      const markDismissed = <R extends Dismissable>(rObj: R): R => {
        if (!rObj?.review?.findings) return rObj;
        let matched = false;
        const nextFindings = rObj.review.findings.map((f) => {
          if (!matched && !f.dismissed) {
            const sameFile = !fileBit || String(f.file || "") === fileBit;
            const sameTitle = !titleBit || String(f.title || "") === titleBit;
            if (sameFile && sameTitle) {
              matched = true;
              return { ...f, dismissed: true };
            }
          }
          return f;
        });
        return { ...rObj, learnings, review: { ...rObj.review, findings: nextFindings } };
      };
      updatedReview = markDismissed(target);
      if (stored) await store.put(updatedReview);
      const live = activeReviews.get(prUrl);
      if (live) live.state = markDismissed(live.state);
    }
  }
  return c.json({ ok: true, learnings, review: updatedReview });
});

reviews.get("/tools", review, (c) => c.json(Object.entries(PR_TOOLS).map(([id, t]) => ({ id, label: t.label, input: ("input" in t && t.input) || null, apply: ("applyLabel" in t && t.applyLabel) || null }))));

reviews.post("/tools", review, async (c) => {
  const body = await jsonBody(c);
  const prUrl = String(body.prUrl || "").trim();
  if (!validPrUrl(prUrl)) throw new Error("Invalid pull request URL");
  checkRepoScope(repoOf({ url: prUrl }), requestOrg(c.req.query("org")));
  await assertRepo(c.get("viewer"), repoOf({ url: prUrl }));
  return c.json(await runPrTool(prUrl, String(body.tool || ""), { question: typeof body.question === "string" ? body.question : undefined, action: String(body.action || "run") }));
});

reviews.post("/review-suggestions", review, async (c) => {
  const body = await jsonBody(c);
  const prUrl = String(body.prUrl || "").trim();
  if (!prUrl || !validPrUrl(prUrl)) throw new Error("Invalid pull request URL");
  const repo = String(body.repo || repoOf({ url: prUrl })).trim();
  checkRepoScope(repo, requestOrg(c.req.query("org")));
  if (repoOf({ url: prUrl }) !== repo) throw new Error("PR and repository mismatch");
  await assertRepo(c.get("viewer"), repo);
  const prNum = parsed(prUrl).number;
  const stored = await store.get(prUrl).catch(() => null);
  const active = activeReviews.get(prUrl)?.state || null;
  let target: InlineTarget | null = stored || active;
  if (!target) {
    target = {
      // only url and number: postInlineSuggestionsOnPr reads nothing else of a PR it has no stored review for
      pr: { url: prUrl, number: prNum },
      headSha: String(body.headSha || ""),
      review: {
        findings: body.file
          ? [
              {
                file: String(body.file || ""),
                line: Number(body.line) || 0,
                severity: severityOf(body.severity),
                title: String(body.title || ""),
                detail: String(body.detail || ""),
                suggestion: String(body.suggestion || ""),
              },
            ]
          : [],
      },
    };
  } else if (body.findingIdx !== undefined && body.findingIdx !== null) {
    const idx = Number(body.findingIdx);
    if (Array.isArray(target.review?.findings) && target.review.findings[idx]) {
      const existingF = target.review.findings[idx];
      target.review.findings[idx] = deriveSuggestionFromDetail(
        {
          ...existingF,
          ...(body.line ? { line: Number(body.line) } : {}),
          ...(body.suggestion !== undefined ? { suggestion: String(body.suggestion) } : {}),
        },
        "",
      );
    }
  }
  const resInfo = await postInlineSuggestionsOnPr(target, repo, {
    findingIdx: body.findingIdx !== undefined && body.findingIdx !== null ? Number(body.findingIdx) : null,
  });
  if (stored && resInfo.posted > 0) {
    const tag = resInfo.comments[0]
      ? `inline suggestion (${resInfo.comments[0].path}:L${resInfo.comments[0].line})`
      : `inline suggestions (${resInfo.posted})`;
    const nextPosted = [...new Set([...(stored.commentsPosted || []), tag])];
    const updated = { ...stored, commentsPosted: nextPosted, review: stored.review }; // target is stored here (findings updated in place)
    await store.put(updated);
    const live = activeReviews.get(prUrl);
    if (live) live.state = updated;
  }
  return c.json({ ok: true, ...resInfo });
});

// GET: every triage result in scope, or one PR's (?pr=). POST ?pr=: triage that PR now.
reviews.on(["GET", "POST"], "/triage", review, async (c) => {
  const g = c.get("viewer");
  const org = requestOrg(c.req.query("org"));
  const results = (await store.getSetting("triageResults")) || {};
  const ref = (c.req.query("pr") || "").trim();
  if (!ref) {
    const mine = seesAll(g) ? null : await visibleRepos(g);
    return c.json(Object.values(results).filter((t) => { try { checkRepoScope(t.repo, org); return !mine || mine.includes(t.repo); } catch { return false; } }));
  }
  const repo = c.req.query("repo") || "";
  const resolved = await resolvePr(ref, repo);
  checkRepoScope(parsed(resolved.urlGuess).repo, org);
  await assertRepo(g, parsed(resolved.urlGuess).repo);
  if (c.req.method === "POST") return c.json(await triagePr(ref, repo));
  return c.json(results[resolved.urlGuess] || null);
});

// ?pr= (URL or number), ?repo=, ?force, ?async (start or poll, with ?part=). Also serves the /score HTML page.
export async function scoreResult(c: Context<Env>) {
  const ref = (c.req.query("pr") || "").trim();
  if (!ref) throw new Error("Missing pr");
  const force = c.req.query("force") !== undefined;
  const repo = c.req.query("repo") || "";
  const resolved = await resolvePr(ref, repo);
  checkRepoScope(parsed(resolved.urlGuess).repo, requestOrg(c.req.query("org")));
  await assertRepo(c.get("viewer"), parsed(resolved.urlGuess).repo);
  if (c.req.path === "/api/score" && c.req.query("async") !== undefined) return c.json(await startOrPollReview(ref, force, repo, c.req.query("part") || ""));
  const result = await score(ref, force, repo);
  return c.req.path === "/api/score" ? c.json(result) : c.html(renderScore(result));
}
reviews.get("/score", review, scoreResult);
