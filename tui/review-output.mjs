// Keep model fields and terminal control sequences out of the renderer.
import { stripVTControlCharacters } from "node:util";

export function text(value) {
  return typeof value === "string"
    ? stripVTControlCharacters(value).replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, "") : "";
}

export function normalizeReview(value, gateDefinitions) {
  if (!value || typeof value !== "object") throw new Error("Invalid model review.");
  const scores = {};
  for (const key of ["quality", "correctness_risk", "test_coverage", "readability", "pr_hygiene", "blast_radius"]) {
    const score = value.scores?.[key];
    if (typeof score !== "number" || !Number.isFinite(score)) throw new Error(`Model omitted a valid ${key} score.`);
    scores[key] = Math.round(Math.max(0, Math.min(100, score)));
  }
  const gates = gateDefinitions.map(({ id, label }) => {
    const gate = Array.isArray(value.gates) && value.gates.find(g => g?.id === id);
    if (!gate || typeof gate.pass !== "boolean") throw new Error(`Model omitted a valid ${id} gate.`);
    return { id, label, pass: gate.pass, explanation: text(gate.explanation) };
  });
  if (!Array.isArray(value.findings) || !Array.isArray(value.walkthrough)) throw new Error("Model omitted findings or walkthrough.");
  return {
    scores, gates, summary: text(value.summary),
    walkthrough: value.walkthrough.filter(w => w && typeof w.file === "string").map(w => ({ file: text(w.file), change: text(w.change) })),
    findings: value.findings.filter(f => f && typeof f.title === "string").map(f => ({
      file: text(f.file), line: Number.isInteger(f.line) && f.line > 0 ? f.line : null,
      severity: ["critical", "warning", "suggestion", "note"].includes(f.severity) ? f.severity : "note",
      title: text(f.title), detail: text(f.detail), suggestion: text(f.suggestion),
    })),
  };
}
