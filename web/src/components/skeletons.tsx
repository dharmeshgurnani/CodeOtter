// Loading states that mirror the real layouts, so the page does not jump when data arrives.
// One skeleton per generic renderer: report (home), form (settings), table (lists), review (report page).
import { Skeleton } from "@/components/ui/skeleton";

const Line = ({ w = "w-full", h = "h-3.5", className = "" }: { w?: string; h?: string; className?: string }) => <Skeleton className={`${h} ${w} ${className}`} />;

const SectionHeading = ({ w = "w-28", sub = true }: { w?: string; sub?: boolean }) => (
  <div className="mb-2 space-y-1.5">
    <Line w={w} h="h-3" />
    {sub && <Line w="w-64" h="h-3" className="opacity-60" />}
  </div>
);

export function TableSkeleton({ cols = 5, rows = 4, widths }: { cols?: number; rows?: number; widths?: string[] }) {
  const ws = widths ?? Array.from({ length: cols }, (_, i) => (i === 0 ? "w-3/4" : "w-16"));
  return (
    <div className="overflow-hidden rounded-[10px] border border-border">
      <table className="w-full border-collapse">
        <thead>
          <tr>{ws.map((_, i) => <th key={i} className="bg-[#efefef] px-4 py-2.5 text-left"><Line w={i === 0 ? "w-28" : "w-14"} h="h-3" className="bg-neutral-300/60" /></th>)}</tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }, (_, r) => (
            <tr key={r}>{ws.map((w, c) => <td key={c} className="border-t border-border px-4 py-3.5"><Line w={w} /></td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const StatCardSkeleton = ({ button }: { button?: boolean }) => (
  <div className="flex flex-col rounded-xl border border-neutral-200/90 bg-neutral-50">
    <div className="px-5 pt-3.5 pb-3"><Line w="w-32" h="h-4" /></div>
    <div className="mx-1.5 mb-1.5 flex flex-1 flex-col rounded-lg border border-neutral-200 bg-white px-4 pt-4 pb-4">
      <div className="flex items-baseline gap-2"><Line w="w-8" h="h-6" /><Line w="w-20" h="h-3" /></div>
      <div className="mt-2.5 min-h-5"><Line w="w-40" h="h-3" /></div>
      <div className="mt-4"><Skeleton className={`h-[34px] w-36 rounded-lg ${button ? "" : "invisible"}`} /></div>
    </div>
  </div>
);

// Home / any report: stat cards, two tables, a link grid.
export function ReportSkeleton() {
  return (
    <div className="space-y-8" aria-busy="true" aria-label="Loading">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <StatCardSkeleton button /><StatCardSkeleton /><StatCardSkeleton />
      </div>
      <section><SectionHeading w="w-24" sub={false} /><TableSkeleton rows={2} widths={["w-48", "w-20", "w-8", "w-8", "w-8", "w-28"]} /></section>
      <section><SectionHeading w="w-28" sub={false} /><TableSkeleton rows={4} widths={["w-80", "w-40", "w-24", "w-8", "w-8", "w-14"]} /></section>
      <section>
        <SectionHeading w="w-20" sub={false} />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="rounded-[10px] border border-border px-4 py-3 space-y-2"><Line w="w-28" h="h-4" /><Line w="w-44" h="h-3" /></div>
          ))}
        </div>
      </section>
    </div>
  );
}

// Settings: sections of label/control rows with an action row, like the JSON form.
export function FormSkeleton({ sections = [4, 3] }: { sections?: number[] }) {
  return (
    <div className="max-w-[820px] space-y-8" aria-busy="true" aria-label="Loading">
      {sections.map((n, si) => (
        <section key={si}>
          <SectionHeading w={si === 0 ? "w-20" : "w-16"} />
          <div className="divide-y divide-border rounded-[10px] border border-border">
            {Array.from({ length: n }, (_, i) => (
              <div key={i} className="grid grid-cols-1 gap-1 px-4 py-3 sm:grid-cols-[200px_1fr] sm:gap-4">
                <div className="pt-2"><Line w="w-24" h="h-3.5" /></div>
                <div>
                  <Skeleton className="h-9 w-full max-w-[520px] rounded-md" />
                  <Line w="w-72" h="h-3" className="mt-2 opacity-60" />
                </div>
              </div>
            ))}
            <div className="flex gap-2.5 px-4 py-3"><Skeleton className="h-9 w-16 rounded-md" /><Skeleton className="h-9 w-32 rounded-md" /></div>
          </div>
        </section>
      ))}
    </div>
  );
}

const FindingSkeleton = () => (
  <div className="my-2.5 overflow-hidden rounded-lg border border-border">
    <div className="border-b border-border bg-neutral-50 px-3 py-2"><Line w="w-64" h="h-3" /></div>
    <div className="space-y-2 px-3.5 py-3"><Line w="w-40" h="h-3.5" /><Line w="w-72" h="h-3.5" /><Line w="w-full" h="h-3" /><Line w="w-5/6" h="h-3" /></div>
  </div>
);

// Review report: title, meta line, the two bot comments with their headings, score rings and finding cards.
export function ReviewSkeleton({ note }: { note?: string }) {
  const Comment = ({ children }: { children: React.ReactNode }) => (
    <div className="mb-4 rounded-[10px] border border-border">
      <div className="flex items-center gap-2 border-b border-border bg-[#efefef] px-4 py-2.5"><Skeleton className="size-5 rounded-full bg-neutral-300/60" /><Line w="w-16" h="h-3" className="bg-neutral-300/60" /><Line w="w-40" h="h-3" className="bg-neutral-300/40" /></div>
      <div className="px-5 py-4">{children}</div>
    </div>
  );
  return (
    <div aria-busy="true" aria-label="Loading">
      <div className="mb-2 flex items-center gap-2"><Line w="w-2/3" h="h-5" /><Skeleton className="h-5 w-20 rounded-md" /></div>
      <div className="mb-4 flex items-center gap-2"><Line w="w-40" h="h-3" /><Line w="w-24" h="h-3" /><Line w="w-32" h="h-3" /></div>
      <Comment>
        <Line w="w-24" h="h-3.5" className="mb-3" />
        <div className="space-y-2"><Line /><Line w="w-11/12" /><Line w="w-3/4" /></div>
        <Line w="w-16" h="h-3.5" className="mt-5 mb-2" />
        <TableSkeleton cols={2} rows={3} widths={["w-56", "w-full"]} />
        <Line w="w-20" h="h-3.5" className="mt-5 mb-2" />
        <div className="my-1.5 flex flex-wrap gap-4">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="size-[88px] rounded-full" />)}</div>
        <div className="mt-4 space-y-2"><Line w="w-36" h="h-3.5" /><Line w="w-32" h="h-3.5" /></div>
      </Comment>
      <Comment>
        <Line w="w-48" h="h-3.5" className="mb-3" />
        <FindingSkeleton /><FindingSkeleton /><FindingSkeleton />
      </Comment>
      {note && <p className="text-sm text-muted-foreground">{note}</p>}
    </div>
  );
}
