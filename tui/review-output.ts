// Keep model fields and terminal control sequences out of the renderer.
import { stripVTControlCharacters } from "node:util";

export const SEVERITIES = ["critical", "warning", "suggestion", "note"] as const;
export type Severity = typeof SEVERITIES[number];
export type GateDefinition = { id: string; label?: string };
export type NormalizedGate = { id: string; label: string | undefined; pass: boolean; explanation: string };
export type NormalizedFinding = { file: string; line: number | null; severity: Severity; title: string; detail: string; suggestion: string };
export type NormalizedReview = {
  scores: Record<string, number>;
  gates: NormalizedGate[];
  summary: string;
  walkthrough: { file: string; change: string }[];
  findings: NormalizedFinding[];
};

export const isSeverity = (value: unknown): value is Severity => (SEVERITIES as readonly unknown[]).includes(value);
// Property of an untrusted value, undefined unless the value is an object.
const field = (value: unknown, key: string): unknown =>
  value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;

export function text(value: unknown): string {
  return typeof value === "string"
    ? stripVTControlCharacters(value).replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, "") : "";
}

export function normalizeReview(value: unknown, gateDefinitions: readonly GateDefinition[]): NormalizedReview {
  if (!value || typeof value !== "object") throw new Error("Invalid model review.");
  const scores: Record<string, number> = {};
  for (const key of ["quality", "correctness_risk", "test_coverage", "readability", "pr_hygiene", "blast_radius"]) {
    const score = field(field(value, "scores"), key);
    if (typeof score !== "number" || !Number.isFinite(score)) throw new Error(`Model omitted a valid ${key} score.`);
    scores[key] = Math.round(Math.max(0, Math.min(100, score)));
  }
  const rawGates = field(value, "gates");
  const gates = gateDefinitions.map(({ id, label }) => {
    const gate = Array.isArray(rawGates) && rawGates.find((g: unknown) => field(g, "id") === id);
    const pass = field(gate, "pass");
    if (!gate || typeof pass !== "boolean") throw new Error(`Model omitted a valid ${id} gate.`);
    return { id, label, pass, explanation: text(field(gate, "explanation")) };
  });
  const findings = field(value, "findings");
  const walkthrough = field(value, "walkthrough");
  if (!Array.isArray(findings) || !Array.isArray(walkthrough)) throw new Error("Model omitted findings or walkthrough.");
  return {
    scores, gates, summary: text(field(value, "summary")),
    walkthrough: walkthrough.filter((w: unknown) => typeof field(w, "file") === "string").map((w: unknown) => ({ file: text(field(w, "file")), change: text(field(w, "change")) })),
    findings: findings.filter((f: unknown) => typeof field(f, "title") === "string").map((f: unknown) => {
      const line = field(f, "line");
      const severity = field(f, "severity");
      return {
        file: text(field(f, "file")), line: typeof line === "number" && Number.isInteger(line) && line > 0 ? line : null,
        severity: isSeverity(severity) ? severity : "note",
        title: text(field(f, "title")), detail: text(field(f, "detail")), suggestion: text(field(f, "suggestion")),
      };
    }),
  };
}
