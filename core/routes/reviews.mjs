// Reviews, home, learnings, PR tools, inline suggestions, triage and scores. Mounted at /api, next to other modules' /api
// routes, so each route carries its own gate("review") (a .use() here would gate all of /api). Then every route is scoped
// to the active organization and to the repositories the viewer may see.
import { Hono } from "hono";
import { availableUpdate, FORGES, OWNER_RE } from "../config.mjs";
import { PB_URL, store } from "../store.mjs";
import { openPrs, parsePrUrl, validPrUrl } from "../git.mjs";
import { llmConfig } from "../models.mjs";
import { getRepoLearnings, setRepoLearnings } from "../context.mjs";
import { deriveSuggestionFromDetail } from "../engines.mjs";
import { activeReviews, postInlineSuggestionsOnPr, resolvePr, score, startOrPollReview, triagePr } from "../review.mjs";
import { PR_TOOLS, runPrTool } from "../pr-tools.mjs";
import { homeData, renderScore, repoOf } from "../views.mjs";
import { settingsPages } from "../settings-pages.mjs";
import { assertRepo, checkRepoScope, requestOrg, seesAll, visibleRepos } from "../access.mjs";
import { gate, jsonBody } from "./middleware.mjs";

export const reviews = new Hono();
const review = gate("review");

reviews.get("/reviews", review, async (c) => {
  const g = c.get("viewer");
  const conf = await llmConfig();
  const rs = await visibleRepos(g);
  const org = requestOrg(c.req.query("org"));
  const scoped = rs.filter((r) => !org || r.startsWith(`${org}/`));
  const onboardingComplete = (await store.getSetting("onboardingComplete")) === true;
  const onboardingNeeded = seesAll(g) && !onboardingComplete && rs.length === 0;
  const reviewed = (await store.all()).filter((r) => (!org || repoOf(r.pr).startsWith(`${org}/`)) && (seesAll(g) || rs.includes(repoOf(r.pr))));
  return c.json({ repo: scoped[0] || "", repos: rs, onboardingNeeded, forgejoUrl: FORGES.forgejo.url, forgeUrls: Object.fromEntries(Object.entries(FORGES).map(([id, f]) => [id, f.url])), model: `${conf.provider}/${conf.model}`, baseUrl: seesAll(g) ? conf.baseUrl : "", store: PB_URL ? "pocketbase" : "files", update: availableUpdate(), settingsPages: await settingsPages(g.user), reviewed, open: (await Promise.all(scoped.map(openPrs))).flat() });
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
      const markDismissed = (rObj) => {
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
      if (activeReviews.get(prUrl)) activeReviews.get(prUrl).state = markDismissed(activeReviews.get(prUrl).state);
    }
  }
  return c.json({ ok: true, learnings, review: updatedReview });
});

reviews.get("/tools", review, (c) => c.json(Object.entries(PR_TOOLS).map(([id, t]) => ({ id, label: t.label, input: t.input || null, apply: t.applyLabel || null }))));

reviews.post("/tools", review, async (c) => {
  const body = await jsonBody(c);
  const prUrl = String(body.prUrl || "").trim();
  if (!validPrUrl(prUrl)) throw new Error("Invalid pull request URL");
  checkRepoScope(repoOf({ url: prUrl }), requestOrg(c.req.query("org")));
  await assertRepo(c.get("viewer"), repoOf({ url: prUrl }));
  return c.json(await runPrTool(prUrl, String(body.tool || ""), { question: body.question, action: String(body.action || "run") }));
});

reviews.post("/review-suggestions", review, async (c) => {
  const body = await jsonBody(c);
  const prUrl = String(body.prUrl || "").trim();
  if (!prUrl || !validPrUrl(prUrl)) throw new Error("Invalid pull request URL");
  const repo = String(body.repo || repoOf({ url: prUrl })).trim();
  checkRepoScope(repo, requestOrg(c.req.query("org")));
  if (repoOf({ url: prUrl }) !== repo) throw new Error("PR and repository mismatch");
  await assertRepo(c.get("viewer"), repo);
  const prNum = parsePrUrl(prUrl).number;
  const stored = await store.get(prUrl).catch(() => null);
  const active = activeReviews.get(prUrl)?.state || null;
  let target = stored || active;
  if (!target) {
    target = {
      pr: { url: prUrl, number: prNum },
      headSha: String(body.headSha || ""),
      review: {
        findings: body.file
          ? [
              {
                file: String(body.file || ""),
                line: Number(body.line) || 0,
                severity: String(body.severity || "low"),
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
    const updated = { ...stored, commentsPosted: nextPosted, review: target.review };
    await store.put(updated);
    if (activeReviews.get(prUrl)) activeReviews.get(prUrl).state = updated;
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
  checkRepoScope(parsePrUrl(resolved.urlGuess).repo, org);
  await assertRepo(g, parsePrUrl(resolved.urlGuess).repo);
  if (c.req.method === "POST") return c.json(await triagePr(ref, repo));
  return c.json(results[resolved.urlGuess] || null);
});

// ?pr= (URL or number), ?repo=, ?force, ?async (start or poll, with ?part=). Also serves the /score HTML page.
export async function scoreResult(c) {
  const ref = (c.req.query("pr") || "").trim();
  if (!ref) throw new Error("Missing pr");
  const force = c.req.query("force") !== undefined;
  const repo = c.req.query("repo") || "";
  const resolved = await resolvePr(ref, repo);
  checkRepoScope(parsePrUrl(resolved.urlGuess).repo, requestOrg(c.req.query("org")));
  await assertRepo(c.get("viewer"), parsePrUrl(resolved.urlGuess).repo);
  if (c.req.path === "/api/score" && c.req.query("async") !== undefined) return c.json(await startOrPollReview(ref, force, repo, c.req.query("part") || ""));
  const result = await score(ref, force, repo);
  return c.req.path === "/api/score" ? c.json(result) : c.html(renderScore(result));
}
reviews.get("/score", review, scoreResult);
