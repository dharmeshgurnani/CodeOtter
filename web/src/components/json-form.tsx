// One renderer for every settings-style form. The server sends sections + fields as JSON; nothing here is page-specific.
// Rule: the plainest control that does the job. Picklist over cards, range over slider widgets, text over anything fancier.
import { useState } from "react";
import { Settings2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/animate-ui/components/radix/dialog";

export type Option = { value: string | number; label: string };
// A list item may carry its own settings (fields + values); they open in an Animate UI dialog from a gear icon on the row.
export type ListItem = string | { id: string; label: string; meta?: string; settings?: { title?: string; description?: string; fields: Field[]; values: Record<string, unknown> } };
export type Field = {
  key: string;
  label: string;
  type: "text" | "password" | "select" | "combo" | "number" | "range" | "checkbox" | "readonly" | "list";
  hint?: string;
  text?: string; // inline label for a checkbox
  placeholder?: string;
  options?: Option[];
  optionsBy?: { field: string; map: Record<string, string[]> };
  defaultBy?: { field: string; map: Record<string, string> };
  hideWhen?: { field: string; in: string[] };
  link?: { label: string; url: string };
  linkBy?: { field: string; map: Record<string, { label: string; url: string }> };
  removable?: boolean; // list: whether rows can be removed (default true)
  min?: number;
  max?: number;
  step?: number;
};
export type Action = { id: string; label: string; variant?: "default" | "outline"; needsSaved?: boolean; always?: boolean };
export type Section = { id: string; title: string; description?: string; readonly?: boolean; fields: Field[]; actions?: Action[] };
export type Values = Record<string, Record<string, unknown>>;

// Apply a change plus its knock-on effects (dependent defaults and option lists) inside one section.
export function applyChange(section: Section, vals: Record<string, unknown>, key: string, value: unknown) {
  const next = { ...vals, [key]: value };
  for (const f of section.fields) {
    if (f.defaultBy?.field === key) next[f.key] = f.defaultBy.map[String(value)] ?? "";
    if (f.optionsBy?.field === key) next[f.key] = f.optionsBy.map[String(value)]?.[0] ?? "";
  }
  return next;
}

// Per-item settings in an Animate UI dialog, opened from a gear icon. Same generic controls; "Done" hands the values back
// to the list, and the page's Save persists them.
function ItemSettingsDialog({ item, onChange }: { item: Exclude<ListItem, string>; onChange: (values: Record<string, unknown>) => void }) {
  const s = item.settings!;
  const [vals, setVals] = useState<Record<string, unknown>>(s.values);
  const section: Section = { id: item.id, title: s.title ?? item.label, fields: s.fields };
  return (
    <Dialog onOpenChange={(open) => { if (open) setVals(s.values); }}>
      <DialogTrigger asChild>
        <button type="button" aria-label={`Settings for ${item.label}`} className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-neutral-100 hover:text-neutral-900"><Settings2 className="size-4" /></button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{s.title ?? item.label}</DialogTitle>
          {s.description && <DialogDescription>{s.description}</DialogDescription>}
        </DialogHeader>
        <div className="divide-y divide-border rounded-[10px] border border-border">
          {s.fields.map((f) => (
            <div key={f.key} className="grid grid-cols-1 gap-1 px-4 py-3 sm:grid-cols-[160px_1fr] sm:gap-4">
              <label className="pt-2 text-sm font-medium text-neutral-800" htmlFor={f.type === "checkbox" || f.type === "readonly" || f.type === "list" ? undefined : `d-${item.id}-${f.key}`}>{f.label}</label>
              <div>
                <Control f={f} vals={vals} id={`d-${item.id}-${f.key}`} scope={`d-${item.id}`} onChange={(v) => setVals(applyChange(section, vals, f.key, v))} />
                {f.hint && <span className="mt-1 block text-xs text-muted-foreground">{f.hint}</span>}
              </div>
            </div>
          ))}
        </div>
        <DialogFooter>
          <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
          <DialogClose asChild><Button onClick={() => onChange(vals)}>Done</Button></DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const Control = ({ f, vals, onChange, id, scope = "" }: { f: Field; vals: Record<string, unknown>; onChange: (v: unknown) => void; id?: string; scope?: string }) => {
  const v = vals[f.key];
  const cls = "w-full max-w-[520px]";
  switch (f.type) {
    case "readonly":
      return <span className="block py-2 text-[15px]">{String(v ?? "")}</span>;
    case "list": {
      // Items are strings or { id, label, meta?, settings? }; settings open in a dialog from the gear beside the remove control.
      const items = (Array.isArray(v) ? (v as ListItem[]) : []).map((it) => (typeof it === "string" ? { id: it, label: it } : it));
      return items.length ? (
        <ul className="max-w-[520px] divide-y divide-border rounded-md border border-border">
          {items.map((it) => (
            <li key={it.id} className="flex items-center gap-2 px-3 py-2 text-sm">
              <span className="min-w-0 flex-1">
                <span className="block truncate">{it.label}</span>
                {it.meta && <span className="block text-xs text-muted-foreground">{it.meta}</span>}
              </span>
              {it.settings && (
                <ItemSettingsDialog
                  item={it}
                  onChange={(values) => onChange(items.map((x) => (x.id === it.id ? { ...x, settings: { ...x.settings!, values } } : x)))}
                />
              )}
              {f.removable !== false && (
                <button type="button" aria-label={`Remove ${it.label}`} className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-neutral-100 hover:text-red-700" onClick={() => onChange(items.filter((x) => x.id !== it.id))}><X className="size-4" /></button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <span className="block py-2 text-sm text-muted-foreground">None yet.</span>
      );
    }
    case "select":
      return (
        <select id={id} className={`${cls} h-9 rounded-md border border-input bg-transparent px-3 text-sm`} value={String(v ?? "")} onChange={(e) => onChange(typeof f.options?.[0]?.value === "number" ? Number(e.target.value) : e.target.value)}>
          {v !== undefined && v !== "" && !f.options?.some((o) => String(o.value) === String(v)) && <option value={String(v)}>{String(v)}</option>}
          {f.options?.map((o) => <option key={String(o.value)} value={String(o.value)}>{o.label}</option>)}
        </select>
      );
    case "combo": {
      const opts = f.options?.map((o) => String(o.value)) ?? f.optionsBy?.map[String(vals[f.optionsBy.field])] ?? [];
      const listId = `dl-${scope}-${f.key}`;
      return (
        <>
          <Input id={id} className={cls} list={listId} value={String(v ?? "")} placeholder={f.placeholder} onChange={(e) => onChange(e.target.value)} />
          <datalist id={listId}>{opts.map((o) => <option key={o} value={o} />)}</datalist>
        </>
      );
    }
    case "range":
      return (
        <span className="flex max-w-[520px] items-center gap-3">
          <input id={id} type="range" className="flex-1 accent-brand" min={f.min} max={f.max} step={f.step} value={Number(v ?? f.min ?? 0)} onChange={(e) => onChange(Number(e.target.value))} />
          <span className="w-10 text-right text-sm tabular-nums">{String(v ?? "")}</span>
        </span>
      );
    case "number":
      return <Input id={id} className={cls} type="number" min={f.min} max={f.max} step={f.step} value={String(v ?? "")} onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))} />;
    case "checkbox":
      return (
        <label className="flex items-center gap-2 py-2 text-sm">
          <input type="checkbox" className="size-4 accent-brand" checked={!!v} onChange={(e) => onChange(e.target.checked)} />
          {f.text && <span>{f.text}</span>}
        </label>
      );
    default:
      return <Input id={id} className={cls} type={f.type} autoComplete="off" value={String(v ?? "")} placeholder={f.placeholder} onChange={(e) => onChange(e.target.value)} />;
  }
};

export function JsonForm({
  sections,
  values,
  saved,
  busy,
  onChange,
  onAction,
}: {
  sections: Section[];
  values: Values;
  saved: Values;
  busy: string;
  onChange: (sectionId: string, vals: Record<string, unknown>) => void;
  onAction: (sectionId: string, actionId: string) => void;
}) {
  return (
    <div className="space-y-8">
      {sections.map((s) => {
        const vals = values[s.id] ?? {};
        const dirty = JSON.stringify(vals) !== JSON.stringify(saved[s.id] ?? {});
        return (
          <section key={s.id}>
            <h4 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">{s.title}</h4>
            {s.description && <p className="mt-0.5 mb-3 text-sm text-muted-foreground">{s.description}</p>}
            <div className="divide-y divide-border rounded-[10px] border border-border">
              {s.fields
                .filter((f) => !f.hideWhen || !f.hideWhen.in.includes(String(vals[f.hideWhen.field])))
                .map((f) => {
                  const link = f.link ?? f.linkBy?.map[String(vals[f.linkBy.field])];
                  return (
                    <div key={f.key} className="grid grid-cols-1 gap-1 px-4 py-3 sm:grid-cols-[200px_1fr] sm:gap-4">
                      <label className="pt-2 text-sm font-medium text-neutral-800" htmlFor={f.type === "checkbox" || f.type === "readonly" || f.type === "list" ? undefined : `f-${s.id}-${f.key}`}>{f.label}</label>
                      <div>
                        <Control f={f} vals={vals} id={`f-${s.id}-${f.key}`} scope={s.id} onChange={(v) => onChange(s.id, applyChange(s, vals, f.key, v))} />
                        {(f.hint || link) && (
                          <span className="mt-1 block text-xs text-muted-foreground">
                            {f.type === "readonly" ? <code className="rounded bg-neutral-100 px-1.5">{f.hint}</code> : f.hint}
                            {link && <> <a className="text-brand hover:underline" href={link.url} target="_blank" rel="noreferrer">{link.label}</a></>}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              {s.actions?.length ? (
                <div className="flex items-center gap-2.5 px-4 py-3">
                  {s.actions.map((a) => (
                    <Button key={a.id} variant={a.variant ?? "default"} disabled={busy !== "" || (a.always ? false : a.needsSaved ? dirty : !dirty)} onClick={() => onAction(s.id, a.id)}>
                      {busy === `${s.id}:${a.id}` ? `${a.label}…` : a.label}
                    </Button>
                  ))}
                  {dirty && s.actions.some((a) => a.needsSaved) && <span className="text-xs text-muted-foreground">Save first.</span>}
                </div>
              ) : null}
            </div>
          </section>
        );
      })}
    </div>
  );
}
