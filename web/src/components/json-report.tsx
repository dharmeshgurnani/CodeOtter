// One renderer for every read-only dashboard/report. The server sends sections; nothing here is page-specific.
// Kinds: "stats" (cards: label, value, unit, hint, optional action), "table" (columns + rows, cells may link), "links".
import { CellView, DataTable, type Cell } from "@/components/data-table";

export type { Cell } from "@/components/data-table";
export type StatItem = { label: string; value: string | number; unit?: string; hint?: string; action?: { label: string; path: string } };
export type ReportSection =
  | { id: string; kind: "stats"; title?: string; description?: string; items: StatItem[] }
  | { id: string; kind: "table"; title: string; description?: string; columns: string[]; rows: Cell[][]; empty?: string }
  | { id: string; kind: "links"; title: string; description?: string; items: { label: string; hint?: string; path?: string; href?: string }[] };

// Server JSON is trusted for shape but not for completeness: a missing list renders as empty, never as a crash.
const list = <T,>(v: T[] | undefined | null): T[] => (Array.isArray(v) ? v : []);

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
      {list(sections).map((s, si) => {
        const columns = s.kind === "table" ? list(s.columns) : [];
        const rows = s.kind === "table" ? list(s.rows) : [];
        return (
        <section key={`${s.id ?? si}`}>
          <Heading s={s} />
          {s.kind === "stats" && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {list(s.items).map((it, i) => (
                // Nested card: off-white outer shell with the title as a header row, and an inset white panel with its own border for the body.
                // Every card keeps the same geometry: the shell is a column, the inner panel fills it, and the subtitle and
                // button rows are always reserved (rendered invisible when empty) so no card is shorter than its neighbours.
                <div key={i} className="flex flex-col rounded-xl border border-neutral-200/90 bg-neutral-50 shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
                  <div className="px-5 pt-3.5 pb-3 text-[15px] font-medium text-neutral-900">{it.label}</div>
                  <div className="mx-1.5 mb-1.5 flex flex-1 flex-col rounded-lg border border-neutral-200 bg-white px-4 pt-4 pb-4">
                    <div className="flex items-baseline gap-2">
                      <span className="text-[22px] font-semibold leading-none tabular-nums text-neutral-900">{it.value}</span>
                      {it.unit && <span className="text-sm text-neutral-500">{it.unit}</span>}
                    </div>
                    <div className="mt-2.5 min-h-5 text-sm text-neutral-500">{it.hint ?? " "}</div>
                    <div className="mt-4">
                      <button
                        type="button"
                        className={`rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-sm text-neutral-900 shadow-[0_1px_1px_rgba(0,0,0,0.03)] hover:bg-neutral-50 ${it.action ? "" : "invisible"}`}
                        tabIndex={it.action ? 0 : -1}
                        aria-hidden={!it.action}
                        onClick={() => it.action && go(it.action.path)}
                      >
                        {it.action?.label ?? " "}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          {s.kind === "table" && (
            <DataTable
              columns={columns.map((label, i) => ({ key: String(i), label }))}
              rows={rows.map((row, i) => ({ id: String(i), cells: Object.fromEntries(list(row).map((c, j) => [String(j), <CellView c={c} go={go} />])) }))}
              empty={s.empty ?? "Nothing yet."}
            />
          )}
          {s.kind === "links" && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {list(s.items).map((it, i) => (
                <a
                  key={i}
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
        );
      })}
    </div>
  );
}
