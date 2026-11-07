// Running a review: triage, startOrPollReview, posting inline suggestions and comments, score().
import { APP_URL, REPO_RE } from "./config.mjs";
import { PROVIDERS } from "./providers.mjs";
import { store } from "./store.mjs";
import { createPrComment, forgeOf, ghAsync, isForgeRepo, parsePrUrl, prUrlFor, readPr, repos, validPrUrl } from "./git.mjs";
import { askSystemOne, llmConfig, s1Config } from "./models.mjs";
import { acceptedSuggestions, blastRadius, dynamicContextFiles, extendDiffContext, parseDiff, sliceOutsideDiffImpact } from "./diff.mjs";
import { addRepoAccepted, extractHeadSha, fetchGitHistory, fetchLinkedIssues, getRepoAccepted, getRepoLearnings, guideFor, headFileTexts, REVIEW_DEFAULTS, reviewConfig, shaMatch } from "./context.mjs";
import { changeDigest, deriveSuggestionFromDetail, judge, S1_SCORES, scoreWithSystemOne, verifyFindingsWithSystemOne } from "./engines.mjs";
import { formatReviewComment, formatScoresComment } from "./comments.mjs";
import { repoOf } from "./views.mjs";

// Fast triage: System One answers two questions about the whole change (correctness risk, blast radius) and the result is
// published at once as a commit status (codeotter/triage) and an updatable PR comment, so a pipeline can stop or continue
// within minutes. The deep review (language model / CodeReviewer) stays on demand. Fails loudly: status "error".
const TRIAGE_CONTEXT = "codeotter/triage";
export const SHA_RE = /^[0-9a-f]{7,40}$/i;
export const triageConfig = async () => ({ auto: false, stopAt: 75, ...((await store.getSetting("triage")) || {}) });
const triageRuns = new Map();
async function postTriageStatus(repo, sha, state, description, url) {
  if (!SHA_RE.test(sha || "")) return;
  const fields = { state, context: TRIAGE_CONTEXT, description: description.slice(0, 140), target_url: `${APP_URL}/review?pr=${encodeURIComponent(url)}` };
  if (isForgeRepo(repo)) return forgeOf(repo).status(repo, sha, fields, parsePrUrl(url)?.number);
  return ghAsync(["api", "--method", "POST", `repos/${repo}/statuses/${sha}`, ...Object.entries(fields).flatMap(([k, v]) => ["-f", `${k}=${v}`])]);
}
function formatTriageComment(t) {
  const level = S1_SCORES.correctness_risk[Math.min(4, Math.round(t.risk / 25))];
  return [
    "<!-- codeotter:triage -->",
    "### 🦦 CodeOtter triage",
    "",
    `**${t.verdict === "attention" ? "⚠️ Needs attention" : "✅ OK to continue"}**: correctness risk **${t.risk}/100** (${level}), blast radius ${t.blast}/100. Stops at risk ${t.stopAt}.`,
    "",
    `System One \`${t.model}\` · ${t.seconds}s · commit \`${t.headSha.slice(0, 7)}\` · [Full review](${APP_URL}/review?pr=${encodeURIComponent(t.url)})`,
  ].join("\n");
}
async function saveTriage(entry) {
  const all = (await store.getSetting("triageResults")) || {};
  all[entry.url] = entry;
  const keep = Object.values(all).sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 500);
  await store.setSetting("triageResults", Object.fromEntries(keep.map((x) => [x.url, x])));
  return entry;
}
export async function triagePr(ref, repoHint = "") {
  const { urlGuess, spec } = await resolvePr(ref, repoHint);
  if (triageRuns.has(urlGuess)) return triageRuns.get(urlGuess);
  const run = (async () => {
    const started = Date.now();
    const pr = JSON.parse(await readPr(urlGuess, spec));
    const repo = repoOf(pr);
    const sha = SHA_RE.test(pr.headRefOid || "") ? pr.headRefOid : "";
    const base = { url: pr.url, repo, number: pr.number, title: pr.title, headSha: sha };
    try {
      const [cfg, s1] = await Promise.all([triageConfig(), s1Config()]);
      if (!s1.enabled) throw new Error(s1.provider === "none" ? "No System One model configured: open Admin / Model provider" : `${s1.local?.label || s1.provider} is not ready: open Admin / Local models`);
      await postTriageStatus(repo, sha, "pending", `System One triage running (${s1.provider})`, pr.url);
      const diff = await readPr(urlGuess, spec, true);
      const state = { pull_request: changeDigest(pr, diff, s1.contextChars || 12000) };
      const questions = Object.fromEntries(["correctness_risk", "blast_radius"].map((k) => [`score_${k}`, { type: "score", instructions: `Rate the pull request's ${k.replace("_", " ")}.`, criteria: S1_SCORES[k] }]));
      let a;
      try {
        a = await askSystemOne(state, questions, s1);
      } catch (err) {
        throw new Error(`System One model ${s1.provider}/${s1.model} failed: ${err.message}`);
      }
      const pct = (k) => {
        const v = Number(a?.[`score_${k}`]?.score);
        if (!Number.isFinite(v)) throw new Error(`System One model ${s1.provider}/${s1.model} did not answer ${k}`);
        return Math.max(0, Math.min(100, Math.round((v / 4) * 100)));
      };
      const risk = pct("correctness_risk");
      const entry = { ...base, risk, blast: pct("blast_radius"), verdict: risk >= cfg.stopAt ? "attention" : "ok", stopAt: cfg.stopAt, model: `${s1.provider}/${s1.model}`, seconds: Math.round((Date.now() - started) / 1000), at: new Date().toISOString() };
      await postTriageStatus(repo, sha, entry.verdict === "attention" ? "failure" : "success", `Risk ${risk}/100: ${entry.verdict === "attention" ? "needs attention" : "ok to continue"} (${entry.seconds}s)`, pr.url);
      if ((await reviewConfig(repo)).postScores) await syncPrComments({ pr }, repo, { triage: entry });
      return saveTriage(entry);
    } catch (e) {
      await postTriageStatus(repo, sha, "error", `Triage failed: ${e.message}`, pr.url).catch(() => {});
      await saveTriage({ ...base, error: e.message, at: new Date().toISOString() });
      throw e;
    }
  })().finally(() => triageRuns.delete(urlGuess));
  triageRuns.set(urlGuess, run);
  return run;
}

export const activeReviews = new Map();

export async function resolvePr(ref, repo) {
  ref = decodeURIComponent(String(ref || "")).trim();
  if (!/^[1-9]\d*$/.test(ref) && !validPrUrl(ref)) throw new Error("Paste a pull request URL from GitHub or a connected git provider, or a number with a repository selected");
  if (repo && !REPO_RE.test(repo)) throw new Error(`Not an owner/name: ${repo}`);
  if (/^\d+$/.test(ref) && !repo) repo = (await repos())[0];
  if (/^\d+$/.test(ref) && !repo) throw new Error("Paste the full pull request URL, or add a repository first");
  const urlGuess = /^\d+$/.test(ref) ? prUrlFor(repo, ref) : ref;
  if (!validPrUrl(urlGuess) || (repo && parsePrUrl(urlGuess).repo !== repo)) throw new Error("PR and repository mismatch");
  const spec = /^\d+$/.test(ref) ? ["-R", repo, ref] : [ref];
  return { urlGuess, spec };
}

const hasValidScores = (s) => s && typeof s === "object" && ["quality", "correctness_risk", "test_coverage", "readability", "pr_hygiene"].some((k) => Number(s[k]) > 0);

export async function startOrPollReview(ref, force, repo, part = "", publish = true) {
  const { urlGuess, spec } = await resolvePr(ref, repo);
  const existing = activeReviews.get(urlGuess);
  if (!force && existing) {
    if (existing.error) {
      activeReviews.delete(urlGuess);
      throw new Error(existing.error);
    }
    return existing.state;
  }
  // A forced re-review joins a run still in flight instead of starting a second one that would post twice.
  if (force && existing && !existing.done && !existing.error) return existing.state;
  const stored = (await store.get(urlGuess)) || (await store.reviews()).find((x) => x.pr?.url === urlGuess) || null;
  // Merge any in-flight state with stored state so partial re-runs never lose live scores or narrative
  const cached = existing?.state
    ? {
        ...stored,
        ...existing.state,
        blast: existing.state.blast?.score ? existing.state.blast : (stored?.blast || existing.state.blast),
        gates: existing.state.gates?.length ? existing.state.gates : (stored?.gates || []),
        review: {
          ...(stored?.review || {}),
          ...(existing.state.review || {}),
          scores: hasValidScores(existing.state.review?.scores)
            ? existing.state.review.scores
            : (stored?.review?.scores || existing.state.review?.scores),
        },
      }
    : stored;

  // If not forced, return cached only if its scores are valid (auto-heal records whose scores were zeroed)
  if (!force && cached && hasValidScores(cached.review?.scores)) {
    const repoLearnings = await getRepoLearnings(repoOf(cached.pr));
    const headSha = extractHeadSha(cached.pr, cached.gitHistory) || cached.headSha;
    const normFindings = Array.isArray(cached.review?.findings)
      ? cached.review.findings.map((f) => deriveSuggestionFromDetail(f, ""))
      : [];
    return {
      ...cached,
      ...(headSha ? { headSha, pr: { ...cached.pr, headSha } } : {}),
      learnings: repoLearnings,
      review: { ...cached.review, findings: normFindings },
    };
  }
  if (!force && cached && !hasValidScores(cached.review?.scores)) {
    part = cached.review?.summary ? "scores" : "";
  }

  const [c, s1, rc] = await Promise.all([llmConfig(), s1Config(), reviewConfig(repoOf({ url: urlGuess }))]);
  const llmReady = c.local ? c.enabled : !!c.model && (!!c.apiKey || !!PROVIDERS[c.provider]?.noKey || /localhost|127\.0\.0\.1/.test(c.baseUrl));
  if (!llmReady && !s1.enabled) throw new Error("No model configured: open Settings / Model provider");
  if (llmReady && c.api === "codereviewer" && !s1.enabled) throw new Error(`${c.local.label} writes review comments only. Configure a System One model for scores (Settings / Model provider; Laya runs on CPU next to it).`);

  const runScores = !part || part === "scores" || !cached || !hasValidScores(cached.review?.scores);
  const runLlm = !part || part === "llm" || !cached || !cached.review?.summary;

  // Use cached PR metadata immediately on Re-review if available, or fetch non-blockingly via ghAsync
  const pr = cached?.pr || JSON.parse(await readPr(urlGuess, spec));
  const initialHeadSha = extractHeadSha(pr, cached?.gitHistory) || cached?.headSha || "";
  if (initialHeadSha) pr.headSha = initialHeadSha;
  const initialLearnings = await getRepoLearnings(repoOf(pr));
  const prevBlast = cached?.blast;
  const blast = !runScores && prevBlast ? { ...prevBlast } : blastRadius(pr.files);
  const engines = { llm: llmReady ? `${c.provider}/${c.model}` : null, s1: s1.enabled ? `${s1.provider}/${s1.model}` : null };
  const modelLabel = [engines.llm, engines.s1].filter(Boolean).join(" + ");
  const prevReview = cached?.review || {};
  const initialScores = hasValidScores(prevReview.scores)
    ? { ...prevReview.scores }
    : { quality: 0, correctness_risk: 0, test_coverage: 0, readability: 0, pr_hygiene: 0 };
  const live = {
    pr,
    ...(initialHeadSha ? { headSha: initialHeadSha } : {}),
    ...(cached?.incremental ? { incremental: cached.incremental } : {}),
    blast: { ...blast },
    review: {
      summary: !runLlm ? (prevReview.summary || "") : "",
      verdict: !runLlm ? (prevReview.verdict || "comment") : "comment",
      scores: initialScores,
      findings: !runLlm ? (prevReview.findings || []) : [],
      walkthrough: !runLlm ? (prevReview.walkthrough || []) : [],
      rawOutput: !runLlm ? (prevReview.rawOutput || "") : "",
    },
    gates: !runScores && cached?.gates ? [...cached.gates] : [],
    engines,
    model: modelLabel,
    guide: cached?.guide || null,
    learnings: initialLearnings,
    linkedIssues: cached?.linkedIssues || [],
    gitHistory: cached?.gitHistory || { prCommits: Array.isArray(pr.commits) ? pr.commits.map((cm) => ({ sha: String(cm.oid || "").slice(0, 7), message: String(cm.messageHeadline || "").trim(), author: cm.authors?.[0]?.login || pr.author?.login || "" })) : [], baseCommits: [] },
    at: new Date().toISOString(),
    pending: {
      scores: runScores,
      readyScores: !runScores && hasValidScores(prevReview.scores) ? { ...prevReview.scores, blast_radius: blast.score } : {},
      gates: runScores && !!s1.enabled,
      narrative: runLlm && !!llmReady,
    },
  };
  const entry = { state: live, error: null, promise: null, done: false };
  activeReviews.set(pr.url, entry);

  entry.promise = (async () => {
    try {
      // Refresh PR metadata in background if we started from cached.pr
      if (cached?.pr) live.pr = JSON.parse(await readPr(urlGuess, spec));
      const [rawDiff, guide, learnings] = await Promise.all([
        readPr(urlGuess, spec, true),
        Promise.resolve().then(() => guideFor(repoOf(live.pr), isForgeRepo(repoOf(live.pr)) ? live.pr.headRefOid : live.pr.headRefName, live.pr.headRepo || repoOf(live.pr))),
        getRepoLearnings(repoOf(pr)),
      ]);
      live.guide = guide?.file || null;
      live.learnings = learnings;
      let diff = rawDiff;
      if (rc.contextLines > 0) {
        const parsed = parseDiff(rawDiff);
        const sources = await headFileTexts(live.pr, dynamicContextFiles(parsed));
        const ext = extendDiffContext(rawDiff, sources, { before: rc.contextLines, after: 1 });
        diff = ext.diff;
        live.dynamicContext = ext.stats;
      }

      const outsideImpact = await sliceOutsideDiffImpact(repoOf(live.pr), diff, (live.pr.files || []).map((f) => f.path));
      live.outsideDiffImpact = outsideImpact;
      const fb = blastRadius(live.pr.files, outsideImpact.outsideCallers, outsideImpact.uniqueFiles);
      const keepScore = !runScores || live.blast.source === "s1";
      live.blast = { ...fb, ...(keepScore ? { score: live.blast.score, source: live.blast.source || prevBlast?.source || "s1" } : {}) };
      const [gitHistory, linkedIssues] = await Promise.all([
        fetchGitHistory(repoOf(live.pr), live.pr),
        fetchLinkedIssues(repoOf(live.pr), live.pr),
      ]);
      const currentHeadSha = extractHeadSha(live.pr, gitHistory) || initialHeadSha;
      if (currentHeadSha) {
        live.pr.headSha = currentHeadSha;
        live.headSha = currentHeadSha;
      }
      live.gitHistory = {
        prCommits: gitHistory.prCommits.map(({ sha, message, author }) => ({ sha, message, ...(author ? { author } : {}) })),
        baseCommits: gitHistory.baseCommits,
      };
      live.linkedIssues = linkedIssues;

      // Incremental Commit-by-Commit Delta computation when a prior review exists
      const prevSaved = stored;
      const prevSha = String(
        prevSaved?.headSha ||
        prevSaved?.pr?.headSha ||
        prevSaved?.pr?.headRefOid ||
        prevSaved?.gitHistory?.prCommits?.at(-1)?.sha ||
        "",
      ).trim();
      const prevFindings = (prevSaved?.review?.findings || []).filter((f) => !f.dismissed);
      let incrementalCtx = null;
      if (prevSaved && (prevSha || prevFindings.length > 0)) {
        const prCommits = gitHistory.prCommits || [];
        const prevIdx = prevSha ? prCommits.findIndex((cm) => shaMatch(cm.sha, prevSha) || shaMatch(cm.fullSha, prevSha)) : -1;
        const hasNewSha = prevSha && currentHeadSha && !shaMatch(prevSha, currentHeadSha);
        const newCommits = hasNewSha
          ? (prevIdx >= 0 ? prCommits.slice(prevIdx + 1) : prCommits)
          : [];
        let deltaDiff = "";
        if (hasNewSha && newCommits.length > 0) {
          try {
            const cmp = isForgeRepo(repoOf(live.pr)) ? null : JSON.parse(await ghAsync("api", `repos/${repoOf(live.pr)}/compare/${encodeURIComponent(prevSha)}...${encodeURIComponent(currentHeadSha)}`));
            if (isForgeRepo(repoOf(live.pr))) deltaDiff = await forgeOf(repoOf(live.pr)).compare(repoOf(live.pr), prevSha, currentHeadSha);
            if (Array.isArray(cmp?.files)) {
              deltaDiff = cmp.files
                .filter((f) => f?.filename && f?.patch)
                .map((f) => `diff --git a/${f.filename} b/${f.filename}\n--- a/${f.filename}\n+++ b/${f.filename}\n${f.patch}`)
                .join("\n\n");
            }
          } catch {}
        }
        const shortPrev = (prevSha || currentHeadSha || "prev").slice(0, 7);
        const shortHead = (currentHeadSha || prevSha || "head").slice(0, 7);
        const promptParts = [
          `Incremental Review Delta: Reviewing new commits since ${shortPrev} -> ${shortHead} (${newCommits.length} new commit(s)).`,
          ...(newCommits.length
            ? [`New commits since ${shortPrev}:\n${newCommits.map((cm) => `- ${cm.sha} ${cm.message}`).join("\n")}`]
            : []),
          ...(prevFindings.length
            ? [
                `Prior review findings at commit ${shortPrev} (MANDATORY: verify whether each prior finding was fixed in the latest code/delta; do NOT re-report findings that have been resolved):\n` +
                  prevFindings.map((pf, idx) => `${idx + 1}. [${pf.severity}] ${pf.file}: ${pf.title}`).join("\n"),
              ]
            : []),
          ...(deltaDiff
            ? [`Incremental Commit Delta Diff (${shortPrev}...${shortHead}, focus on these changes first):\n${deltaDiff.slice(0, 24000)}`]
            : []),
        ];
        incrementalCtx = {
          prevSha: shortPrev,
          headSha: shortHead,
          newCommits: newCommits.map((cm) => ({ sha: cm.sha, message: cm.message, ...(cm.author ? { author: cm.author } : {}) })),
          prevFindings,
          deltaDiff,
          summaryText: `Incremental Review Delta: ${shortPrev} -> ${shortHead} (${newCommits.length} new commits, ${prevFindings.length} prior findings checked)`,
          promptBlock: promptParts.join("\n\n"),
        };
        live.incremental = {
          prevSha: incrementalCtx.prevSha,
          headSha: incrementalCtx.headSha,
          newCommits: incrementalCtx.newCommits,
          resolvedFindings: prevSaved?.incremental?.resolvedFindings || [],
        };
        // Learn from suggestions the author applied since the last review. A failed lookup only skips the learning.
        const withFix = prevFindings.filter((f) => f.suggestion && f.file);
        if (hasNewSha && withFix.length) {
          try {
            const paths = [...new Set(withFix.map((f) => f.file))];
            const [before, after] = await Promise.all([headFileTexts(live.pr, paths, 25, 400000, prevSha), headFileTexts(live.pr, paths)]);
            const accepted = acceptedSuggestions(withFix, before, after);
            if (accepted.length) {
              await addRepoAccepted(repoOf(live.pr), accepted);
              live.acceptedFixes = accepted;
            }
          } catch (e) {
            console.warn(`[accepted] ${e.message}`);
          }
        }
      }
      const acceptedFixes = await getRepoAccepted(repoOf(live.pr));

      const s1Task = runScores && s1.enabled
        ? scoreWithSystemOne(live.pr, diff, s1, guide, ({ readyScores, gates, done }) => {
            live.pending.readyScores = { ...live.pending.readyScores, ...readyScores };
            if (readyScores.blast_radius !== undefined) {
              live.blast = { ...live.blast, score: readyScores.blast_radius, source: "s1" };
            }
            const { blast_radius, ...restScores } = live.pending.readyScores;
            live.review = { ...live.review, scores: { ...live.review.scores, ...restScores } };
            if (gates?.length) live.gates = gates;
            if (done) {
              live.pending.scores = false;
              live.pending.gates = false;
            }
          }, gitHistory, linkedIssues, learnings, incrementalCtx, outsideImpact, acceptedFixes)
        : Promise.resolve(null);

      const needLlmForScores = runScores && !s1.enabled;
      const llmTask = (runLlm || needLlmForScores) && llmReady
        ? judge(live.pr, diff, c, rc, guide, !s1.enabled, gitHistory, (partial) => {
            if (runLlm) {
              live.review = { ...live.review, ...partial, scores: live.review.scores };
            }
          }, linkedIssues, learnings, incrementalCtx, outsideImpact, acceptedFixes).then(({ blastRadius: llmBlast, ...nav }) => {
            const scores = (!runScores || s1.enabled)
              ? (hasValidScores(live.review.scores) ? live.review.scores : initialScores)
              : nav.scores;
            if (runScores && !s1.enabled) live.blast = { ...live.blast, score: llmBlast, source: "llm" };
            const merged = { ...nav, scores };
            live.review = runLlm ? merged : { ...live.review, scores };
            live.pending.narrative = false;
            if (!s1.enabled && runScores) {
              live.pending.scores = false;
              live.pending.readyScores = { ...scores, blast_radius: live.blast.score };
            }
            return merged;
          })
        : Promise.resolve(null);

      const [narrative, typed] = await Promise.all([llmTask, s1Task]);
      let review = runLlm && narrative ? narrative : live.review;
      if (runLlm && c.api === "codereviewer" && s1.enabled && review?.findings?.length) {
        const proposed = review.findings;
        live.pending.narrative = true;
        live.review = { ...live.review, findings: [] };
        const kept = (await verifyFindingsWithSystemOne(proposed, s1, (done, total, k) => {
          live.review = { ...live.review, summary: `System One checked ${done} of ${total} CodeReviewer comments; kept ${k}.` };
        })).slice(0, rc.maxFindings || REVIEW_DEFAULTS.maxFindings);
        live.pending.narrative = false;
        review = {
          ...review,
          summary: `${review.summary.replace(/ Found \d+ actionable observation\(s\)\./, "")} System One kept ${kept.length} of ${proposed.length} CodeReviewer comments.`,
          verdict: kept.length ? "comment" : "approve",
          findings: kept,
        };
      }
      if (typed) {
        const { blast_radius, ...scores } = typed.scores;
        live.blast.score = blast_radius;
        live.blast.source = "s1";
        if (!review?.summary && !runLlm) {
          review = { ...live.review, scores };
        } else if (!review?.summary) {
          const g = typed.gates;
          const bad = g.some((x) => x.id === "security" && !x.pass) || scores.quality < 40;
          review = { summary: "Scored by CodeOtter.", verdict: bad ? "request_changes" : scores.quality >= 70 && g.every((x) => x.pass) ? "approve" : "comment", scores, findings: [], walkthrough: [] };
        } else review = { ...review, scores };
      } else if (!hasValidScores(review?.scores) && hasValidScores(initialScores)) {
        review = { ...review, scores: initialScores };
      }
      const finalGates = typed?.gates || (live.gates?.length ? live.gates : cached?.gates) || [];
      let finalIncremental = cached?.incremental;
      if (incrementalCtx) {
        const newFindingsList = review?.findings || [];
        const resolvedFindings = runLlm
          ? incrementalCtx.prevFindings.filter((pf) => {
              const pfFile = String(pf.file || "").toLowerCase();
              const pfTitle = String(pf.title || "").toLowerCase().slice(0, 32);
              const stillPresent = newFindingsList.some((nf) => {
                const nfFile = String(nf.file || "").toLowerCase();
                const nfTitle = String(nf.title || "").toLowerCase().slice(0, 32);
                return nfFile === pfFile && (nfTitle === pfTitle || (pfTitle.length >= 10 && nfTitle.includes(pfTitle.slice(0, 16))) || (nfTitle.length >= 10 && pfTitle.includes(nfTitle.slice(0, 16))));
              });
              return !stillPresent;
            })
          : (prevSaved?.incremental?.resolvedFindings || []);
        finalIncremental = {
          prevSha: incrementalCtx.prevSha,
          headSha: incrementalCtx.headSha,
          newCommits: incrementalCtx.newCommits,
          resolvedFindings,
        };
      }
      const result = {
        pr: live.pr,
        ...(currentHeadSha ? { headSha: currentHeadSha } : {}),
        ...(finalIncremental ? { incremental: finalIncremental } : {}),
        ...(live.acceptedFixes ? { acceptedFixes: live.acceptedFixes } : {}),
        blast: live.blast,
        outsideDiffImpact: live.outsideDiffImpact,
        review,
        gates: finalGates,
        engines,
        model: modelLabel,
        guide: guide?.file || null,
        learnings,
        linkedIssues: live.linkedIssues || [],
        gitHistory: live.gitHistory,
        at: new Date().toISOString(),
      };
      await syncPrComments(result, repoOf(live.pr), {
        postScores: !!(publish && runScores && rc.postScores && (typed || review?.scores)),
        postReview: !!(publish && runLlm && rc.postReview && review?.summary),
        postInlineSuggestions: !!(publish && runLlm && rc.postInlineSuggestions &&(review?.findings || []).some((f) => !f.dismissed && (f.suggestion || f.line))),
      });
      await store.put(result);
      entry.state = result;
      entry.done = true;
      setTimeout(() => { if (activeReviews.get(live.pr.url) === entry) activeReviews.delete(live.pr.url); }, 30000).unref?.();
      return result;
    } catch (e) {
      entry.error = e.message;
      entry.done = true;
      // The next poll reports the error; without a poller the entry (and its live state) would stay in memory for good.
      setTimeout(() => { if (activeReviews.get(live.pr.url) === entry) activeReviews.delete(live.pr.url); }, 120000).unref?.();
      throw e;
    }
  })();
  // Async polling reads entry.error on the next request; keep background failures handled.
  entry.promise.catch(() => {});

  return live;
}

export async function postInlineSuggestionsOnPr(r, repo = repoOf(r.pr), { findingIdx = null } = {}) {
  if (!r?.pr?.number || !repo || !REPO_RE.test(repo)) throw new Error("Invalid PR or repository");
  const allFindings = Array.isArray(r.review?.findings) ? r.review.findings : [];
  const candidates =
    findingIdx !== null && findingIdx !== undefined
      ? [allFindings[Number(findingIdx)]].filter(Boolean)
      : allFindings.filter((f) => !f?.dismissed && f?.file && (f?.suggestion || f?.line));
  if (!candidates.length) return { posted: 0, mode: "none", comments: [] };

  const rawHeadSha = String(
    r.pr?.headRefOid ||
      (r.headSha && r.headSha.length >= 40 ? r.headSha : "") ||
      (r.pr?.headSha && r.pr.headSha.length >= 40 ? r.pr.headSha : "") ||
      r.gitHistory?.prCommits?.at(-1)?.fullSha ||
      r.headSha ||
      r.pr?.headSha ||
      "",
  ).trim();

  const comments = candidates
    .map((rawF) => {
      const f = deriveSuggestionFromDetail(rawF, "");
      if (!f.file) return null;
      const targetLine = Number(f.line) > 0 ? Math.round(Number(f.line)) : 1;
      const explanation = String(f.detail || "").split("\n\n@@")[0].trim();
      const bodyLines = [
        `<!-- codeotter:suggestion:${f.file}:${targetLine} -->`,
        `🦦 **CodeOtter [${String(f.severity || "low").toUpperCase()}]** — **${f.title || "Suggested fix"}** (\`${f.file}:L${targetLine}\`)`,
        ...(explanation ? ["", explanation] : []),
        // Most git servers anchor a review comment on one line, so a multi-line fix is shown, not offered for commit
        // (GitHub and Azure DevOps take a line range).
        ...(f.suggestion
          ? [
              "",
              f.startLine && isForgeRepo(repo) && !forgeOf(repo).multiLineSuggestions ? `Replaces lines ${f.startLine}-${targetLine}:\n\`\`\`` : "```suggestion",
              String(f.suggestion).replace(/\r?\n$/, ""),
              "```",
            ]
          : []),
      ];
      return {
        path: f.file,
        line: targetLine,
        ...(f.startLine && f.startLine < targetLine ? { startLine: f.startLine } : {}),
        side: "RIGHT",
        body: bodyLines.join("\n"),
        finding: f,
      };
    })
    .filter(Boolean);

  if (!comments.length) return { posted: 0, mode: "none", comments: [] };

  if (isForgeRepo(repo)) {
    if (!validPrUrl(r.pr.url) || repoOf(r.pr) !== repo || Number(r.pr.url.split("/").at(-1)) !== Number(r.pr.number)) throw new Error("PR and repository mismatch");
    // A line outside the diff may be rejected (those come back here); auth/network failures throw before another write.
    const failed = await forgeOf(repo).inline(repo, r.pr.number, comments, rawHeadSha);
    if (failed.length) await createPrComment(r.pr.url, repo, r.pr.number, failed.map((c) => c.body).join("\n\n"));
    return { posted: comments.length, mode: !failed.length ? "inline_review" : failed.length === comments.length ? "pr_comment_fallback" : "mixed", comments: comments.map((c) => ({ path: c.path, line: c.line })) };
  }

  const buildReviewArgs = (includeCommitId) => {
    const args = [
      "api",
      "--method",
      "POST",
      `repos/${repo}/pulls/${r.pr.number}/reviews`,
      "-f",
      "event=COMMENT",
      "-f",
      `body=🦦 **CodeOtter Inline Suggestion${comments.length === 1 ? "" : "s"}** (${comments.length} committable fix${comments.length === 1 ? "" : "es"})`,
    ];
    if (includeCommitId && rawHeadSha) {
      args.push("-f", `commit_id=${rawHeadSha}`);
    }
    for (const c of comments) {
      args.push(
        "-f",
        `comments[][path]=${c.path}`,
        "-F",
        `comments[][line]=${c.line}`,
        "-f",
        `comments[][side]=${c.side}`,
        ...(c.startLine ? ["-F", `comments[][start_line]=${c.startLine}`, "-f", `comments[][start_side]=${c.side}`] : []),
        "-f",
        `comments[][body]=${c.body}`,
      );
    }
    return args;
  };

  try {
    const args = buildReviewArgs(rawHeadSha.length >= 7);
    await ghAsync(args);
    return {
      posted: comments.length,
      mode: "inline_review",
      comments: comments.map((c) => ({ path: c.path, line: c.line })),
    };
  } catch {
    try {
      if (rawHeadSha) {
        const argsNoSha = buildReviewArgs(false);
        await ghAsync(argsNoSha);
        return {
          posted: comments.length,
          mode: "inline_review",
          comments: comments.map((c) => ({ path: c.path, line: c.line })),
        };
      }
    } catch {}
    // Fallback to a line-referenced PR comment if the target line isn't part of the GitHub diff hunk
    const fallbackBody = [
      `<!-- codeotter:suggestion-comment -->`,
      `### 🦦 CodeOtter — Inline Suggestion${comments.length === 1 ? "" : "s"}`,
      ...comments.flatMap((c) => [
        "",
        `#### \`${c.path}:L${c.line}\` — **${c.finding.title || "Suggested fix"}** (\`${String(c.finding.severity || "low").toUpperCase()}\`)`,
        ...(c.finding.detail ? [String(c.finding.detail).split("\n\n@@")[0].trim()] : []),
        ...(c.finding.suggestion
          ? [
              "```suggestion",
              String(c.finding.suggestion).replace(/\r?\n$/, ""),
              "```",
            ]
          : []),
      ]),
    ].join("\n");
    await ghAsync("pr", "comment", r.pr.url, "--body", fallbackBody);
    return {
      posted: comments.length,
      mode: "pr_comment_fallback",
      comments: comments.map((c) => ({ path: c.path, line: c.line })),
    };
  }
}

export async function syncPrComments(r, repo = repoOf(r.pr), { postScores = false, postReview = false, postInlineSuggestions = false, triage = null, extra = [] } = {}) {
  if (!postScores && !postReview && !postInlineSuggestions && !triage && !extra.length) return [];
  // on a git server, a marker comment counts only when this token wrote it (where the server can say who that is)
  const commentAuthor = isForgeRepo(repo) ? await forgeOf(repo).me(repo) : null;
  let existingComments = [];
  try {
    // --paginate --slurp: on a busy PR the marker comment may sit past the first 100, and a miss would post a duplicate.
    const raw = isForgeRepo(repo) ? JSON.stringify(await forgeOf(repo).comments(repo, r.pr.number)) : await ghAsync(["api", "--paginate", "--slurp", `repos/${repo}/issues/${r.pr.number}/comments?per_page=100`]).then((s) => JSON.stringify(JSON.parse(s).flat()));
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) existingComments = parsed;
  } catch (e) { if (isForgeRepo(repo)) throw e; }

  const upsert = async (marker, body, label) => {
    const existing = existingComments.find((c) => typeof c?.body === "string" && c.body.includes(marker) && (!commentAuthor || c.user?.id === commentAuthor.id));
    if (existing?.id) {
      if (isForgeRepo(repo)) {
        await forgeOf(repo).editComment(repo, r.pr.number, existing.id, body);
        return `${label} (updated)`;
      }
      await ghAsync(["api", "--method", "PATCH", `repos/${repo}/issues/comments/${existing.id}`, "-f", `body=${body}`]);
      return `${label} (updated)`;
    }
    await createPrComment(r.pr.url, repo, r.pr.number, body);
    return label;
  };

  const posted = [];
  if (triage) posted.push(await upsert("<!-- codeotter:triage -->", formatTriageComment(triage), "triage"));
  for (const [marker, body, label] of extra) posted.push(await upsert(marker, body, label));
  if (postScores) {
    try {
      posted.push(await upsert("<!-- codeotter:scores -->", formatScoresComment(r), "scores"));
    } catch (e) {
      r.commentError = e.message;
    }
  }
  if (postReview) {
    try {
      posted.push(await upsert("<!-- codeotter:review -->", formatReviewComment(r), "review"));
    } catch (e) {
      r.commentError = [r.commentError, e.message].filter(Boolean).join("; ");
    }
  }
  if (postInlineSuggestions) {
    try {
      const inlineRes = await postInlineSuggestionsOnPr(r, repo);
      if (inlineRes.posted > 0) posted.push(`inline suggestions (${inlineRes.posted})`);
    } catch (e) {
      r.commentError = [r.commentError, e.message].filter(Boolean).join("; ");
    }
  }
  if (posted.length) r.commentsPosted = posted;
  return posted;
}

export async function score(ref, force, repo) {
  const initial = await startOrPollReview(ref, force, repo);
  if (!initial.pending) return initial;
  const entry = activeReviews.get(initial.pr.url);
  return entry?.promise ? await entry.promise : initial;
}
