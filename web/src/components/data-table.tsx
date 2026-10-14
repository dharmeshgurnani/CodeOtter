// The one table in the app. Settings tables (json-form), report tables (json-report), the review and PR lists, the
// review page's checks and the loading skeleton all draw through DataTable, so a table looks and behaves the same
// everywhere: same shell, header, row spacing, badge, and the stacked card layout on small screens (index.css).
import type { ReactNode } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { InfoTip } from "@/components/info-tip";
import { Link } from "@/components/link";

// ok green, warn amber, bad red, muted grey, info blue, accent purple (team learnings).
export type Tone = "ok" | "muted" | "warn" | "bad" | "info" | "accent";

// A JSON cell from the server: plain text or number, or text with an icon, a tone (drawn as a badge), monospace, an
// info tooltip, a progress bar (0-100), or a link (`path` inside the app, `href` outside).
export type Cell = string | number | { text: string; icon?: string; tone?: Tone; mono?: boolean; info?: string; progress?: number; path?: string; href?: string };

// `align: "right"` for numbers and scores; `info` puts an info tooltip in the header (units, scale, what high means).
export type Column = { key: string; label: string; align?: "right"; info?: string };
export type TableRow = { id: string; cells: Record<string, ReactNode>; actions?: ReactNode };

// The tone is only the light fill; text and the 1px border are the app's secondary text colour (neutral-700) on every badge.
const TONE: Record<Tone, string> = { ok: "bg-green-50", muted: "bg-neutral-50", warn: "bg-amber-50", bad: "bg-red-50", info: "bg-blue-50", accent: "bg-purple-50" };

// The one badge in the app: tables, verdicts, review-page chips, onboarding tags. Small 4px corners so it reads as a
// tag, not a pill. `mono` for SHAs, line numbers and scores; `title` for a hover note.
export const Badge = ({ tone = "muted", mono, title, className = "", children }: { tone?: Tone; mono?: boolean; title?: string; className?: string; children: ReactNode }) => (
  <span title={title} className={`inline-flex items-center gap-1 whitespace-nowrap rounded-[4px] border border-neutral-700 px-1.5 text-neutral-700 py-px align-middle text-xs font-medium ${mono ? "font-mono" : ""} ${TONE[tone]} ${className}`}>{children}</span>
);

const initials = (s: string) => s.split(/[\s/_-]+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";

export function CellView({ c, go }: { c: Cell | null | undefined; go?: (path: string) => void }) {
  if (c === undefined || c === null || c === "") return <span className="text-muted-foreground">—</span>;
  if (typeof c !== "object") return <span className={typeof c === "number" ? "tabular-nums" : ""}>{c}</span>;
  const text = c.tone ? (
    <Badge tone={c.tone}>{c.text}</Badge>
  ) : c.path && go ? (
    <Link className="text-brand" path={c.path} go={go}>{c.text}</Link>
  ) : c.href ? (
    <a className="text-brand hover:underline" href={c.href} target="_blank" rel="noreferrer">{c.text}</a>
  ) : (
    <span className={`truncate ${c.mono ? "font-mono text-xs" : ""}`}>{c.text}</span>
  );
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      {c.icon !== undefined && (
        <Avatar className="size-6 shrink-0 rounded-md border border-border bg-white">
          {c.icon && <AvatarImage src={c.icon} alt={c.text} />}
          <AvatarFallback className="rounded-md text-[10px] font-semibold">{initials(c.text)}</AvatarFallback>
        </Avatar>
      )}
      {c.progress !== undefined ? (
        <span className="flex min-w-[120px] flex-col gap-1">
          {text}
          <span className="block h-1.5 w-full overflow-hidden rounded-full bg-neutral-200"><span className="block h-full bg-brand" style={{ width: `${Math.max(0, Math.min(100, c.progress))}%` }} /></span>
        </span>
      ) : text}
      {c.info && <InfoTip text={c.info} />}
    </span>
  );
}

// Columns × rows. `actions` (buttons, toggles) sit in a trailing right-aligned column with the height of a small
// button, so rows with and without buttons line up. On small screens each row becomes a card with labelled cells.
export function DataTable({ columns, rows, empty = "Nothing yet." }: { columns: Column[]; rows: TableRow[]; empty?: ReactNode }) {
  const hasActions = rows.some((r) => r.actions);
  return (
    <div className="overflow-x-auto rounded-[10px] border border-border">
      <table className="responsive-table w-full border-collapse text-sm">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={`bg-neutral-50 px-3 py-2 text-xs font-medium text-muted-foreground ${c.align === "right" ? "text-right" : "text-left"}`}>
                <span className="inline-flex items-center gap-1">{c.label}{c.info && <InfoTip text={c.info} />}</span>
              </th>
            ))}
            {hasActions && <th className="bg-neutral-50 px-3 py-2" />}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr><td colSpan={columns.length + (hasActions ? 1 : 0)} className="border-t border-border px-3 py-3 text-muted-foreground">{empty}</td></tr>
          )}
          {rows.map((r) => (
            <tr key={r.id}>
              {columns.map((c, i) => (
                <td key={c.key} data-label={i > 0 ? c.label || undefined : undefined} className={`border-t border-border px-3 py-2.5 align-middle ${c.align === "right" ? "text-right tabular-nums" : ""}`}>{r.cells[c.key]}</td>
              ))}
              {hasActions && (
                <td className="border-t border-border px-3 py-2.5">
                  <span className="flex min-h-8 items-center justify-end gap-1.5">{r.actions}</span>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
