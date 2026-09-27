// One renderer for every read-only dashboard/report. The server sends sections; nothing here is page-specific.
// Kinds: "stats" (cards: label, value, unit, hint, optional action), "table" (columns + rows, cells may link), "links".
import { Pill } from "@/App";
import { Link } from "@/components/link";

export type Cell = string | number | { text: string; path?: string; href?: string; tone?: "ok" | "warn" | "bad" | "muted" };
export type StatItem = { label: string; value: string | number; unit?: string; hint?: string; action?: { label: string; path: string } };
export type ReportSection =
  | { id: string; kind: "stats"; title?: string; description?: string; items: StatItem[] }
  | { id: string; kind: "table"; title: string; description?: string; columns: string[]; rows: Cell[][]; empty?: string }
  | { id: string; kind: "links"; title: string; description?: string; items: { label: string; hint?: string; path?: string; href?: string }[] };

const CellView = ({ c, go }: { c: Cell; go: (p: string) => void }) => {
  if (typeof c !== "object") return <span className={typeof c === "number" ? "tabular-nums" : ""}>{c}</span>;
  if (c.tone) return <Pill tone={c.tone === "muted" ? undefined : c.tone}>{c.text}</Pill>;
  if (c.path) return <Link className="text-brand" path={c.path} go={go}>{c.text}</Link>;
  if (c.href) return <a className="text-brand hover:underline" href={c.href} target="_blank" rel="noreferrer">{c.text}</a>;
  return <span>{c.text}</span>;
};

const Heading = ({ s }: { s: ReportSection }) =>
  s.title ? (
    <div className="mb-2">
      <h4 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">{s.title}</h4>
      {s.description && <p className="mt-0.5 text-sm text-muted-foreground">{s.description}</p>}
    </div>
  ) : null;

export function JsonReport({ sections, go }: { sections: ReportSection[]; go: (p: string) => void }) {
  return (
    <div className="space-y-8">
      {sections.map((s) => (
        <section key={s.id}>
          <Heading s={s} />
          {s.kind === "stats" && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {s.items.map((it) => (
                // Nested card: off-white outer shell with the title as a header row, and an inset white panel with its own border for the body.
                // Every card keeps the same geometry: the shell is a column, the inner panel fills it, and the subtitle and
                // button rows are always reserved (rendered invisible when empty) so no card is shorter than its neighbours.
                <div key={it.label} className="flex flex-col rounded-xl border border-neutral-200/90 bg-neutral-50 shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
                  <div className="px-5 pt-3.5 pb-3 text-[15px] font-medium text-neutral-900">{it.label}</div>
                  <div className="mx-1.5 mb-1.5 flex flex-1 flex-col rounded-lg border border-neutral-200 bg-white px-4 pt-4 pb-4">
                    <div className="flex items-baseline gap-2">
                      <span className="text-[22px] font-semibold leading-none tabular-nums text-neutral-900">{it.value}</span>
                      {it.unit && <span className="text-sm text-neutral-500">{it.unit}</span>}
                    </div>
                    <div className="mt-2.5 min-h-5 text-sm text-neutral-500">{it.hint ?? " "}</div>
                    <div className="mt-4">
                      <button
                        type="button"
                        className={`rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-sm text-neutral-900 shadow-[0_1px_1px_rgba(0,0,0,0.03)] hover:bg-neutral-50 ${it.action ? "" : "invisible"}`}
                        tabIndex={it.action ? 0 : -1}
                        aria-hidden={!it.action}
                        onClick={() => it.action && go(it.action.path)}
                      >
                        {it.action?.label ?? " "}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          {s.kind === "table" && (
            <div className="overflow-hidden rounded-[10px] border border-border">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr>{s.columns.map((c) => <th key={c} className="bg-[#efefef] px-4 py-2 text-left font-medium text-neutral-700">{c}</th>)}</tr>
                </thead>
                <tbody>
                  {s.rows.length === 0 && <tr><td colSpan={s.columns.length} className="px-4 py-3 text-muted-foreground">{s.empty ?? "Nothing yet."}</td></tr>}
                  {s.rows.map((r, i) => (
                    <tr key={i}>{r.map((c, j) => <td key={j} className="border-t border-border px-4 py-2 align-top"><CellView c={c} go={go} /></td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {s.kind === "links" && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {s.items.map((it) => (
                <a
                  key={it.label}
                  className="block cursor-pointer rounded-[10px] border border-border px-4 py-3 hover:bg-neutral-50"
                  href={it.href ?? it.path}
                  target={it.href ? "_blank" : undefined}
                  rel={it.href ? "noreferrer" : undefined}
                  onClick={it.path ? (e) => { if (!e.metaKey && !e.ctrlKey && !e.shiftKey && e.button === 0) { e.preventDefault(); go(it.path!); } } : undefined}
                >
                  <div className="text-[15px] font-medium">{it.label}</div>
                  {it.hint && <div className="text-sm text-muted-foreground">{it.hint}</div>}
                </a>
              ))}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
