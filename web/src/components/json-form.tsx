// One renderer for every settings-style form. The server sends sections + fields as JSON; nothing here is page-specific.
// Rule: the plainest control that does the job. Picklist over cards, range over slider widgets, text over anything fancier.
import { useState } from "react";
import { Check, ChevronsUpDown, Settings2, X } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/animate-ui/components/radix/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/animate-ui/components/radix/dropdown-menu";

export type Option = { value: string | number; label: string; icon?: string };
// A list item may carry its own settings (fields + values); they open in an Animate UI dialog from a gear icon on the row.
export type ListItem = string | { id: string; label: string; icon?: string; meta?: string; badge?: string; progress?: number; actions?: Action[]; settings?: { title?: string; description?: string; fields: Field[]; values: Record<string, unknown> } };
export type Field = {
  key: string;
  label: string;
  type: "text" | "password" | "select" | "combo" | "number" | "range" | "checkbox" | "readonly" | "list";
  hint?: string;
  text?: string; // inline label for a checkbox
  placeholder?: string;
  options?: Option[];
  optionsBy?: { field: string; map: Record<string, (string | Option)[]> }; // options chosen by another field's value; an empty list means free text
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
export type Section = { id: string; title: string; description?: string; readonly?: boolean; fields: Field[]; actions?: Action[]; poll?: number }; // poll: refetch interval in ms while something is in progress
export type Values = Record<string, Record<string, unknown>>;

const initials = (s: string) => s.split(/[\s/_-]+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";

// Apply a change plus its knock-on effects (dependent defaults and option lists) inside one section.
export function applyChange(section: Section, vals: Record<string, unknown>, key: string, value: unknown) {
  const next = { ...vals, [key]: value };
  for (const f of section.fields) {
    if (f.defaultBy?.field === key) next[f.key] = f.defaultBy.map[String(value)] ?? "";
    if (f.optionsBy?.field === key) { const first = f.optionsBy.map[String(value)]?.[0]; next[f.key] = first === undefined ? "" : typeof first === "object" ? first.value : first; }
  }
  return next;
}

// Per-item settings in an Animate UI dialog, opened from a gear icon. Same generic controls; "Save" hands the values back
// to the list and persists them.
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
              <div className="min-w-0">
                <Control f={f} vals={vals} id={`d-${item.id}-${f.key}`} scope={`d-${item.id}`} onChange={(v) => setVals(applyChange(section, vals, f.key, v))} />
                {f.hint && <span className="mt-1 block text-xs text-muted-foreground">{f.hint}</span>}
              </div>
            </div>
          ))}
        </div>
        <DialogFooter>
          <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
          <DialogClose asChild><Button onClick={() => onChange(vals)}>Save</Button></DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const Control = ({ f, vals, onChange, onSaveList, id, scope = "", onItemAction }: { f: Field; vals: Record<string, unknown>; onChange: (v: unknown) => void; onSaveList?: (v: unknown) => void; id?: string; scope?: string; onItemAction?: (itemId: string, actionId: string) => void }) => {
  const v = vals[f.key];
  const cls = "w-full max-w-[520px]";
  switch (f.type) {
    case "readonly":
      return <span className="block py-2 text-[15px] break-all">{String(v ?? "")}</span>;
    case "list": {
      // Items are strings or { id, label, icon?, meta?, settings? }; settings open in a dialog from the gear beside the remove control.
      const items = (Array.isArray(v) ? (v as ListItem[]) : []).map((it) => (typeof it === "string" ? { id: it, label: it } : it));
      return items.length ? (
        <ul className="max-w-[520px] divide-y divide-border rounded-md border border-border">
          {items.map((it) => (
            <li key={it.id} className="flex flex-wrap sm:flex-nowrap items-center gap-2.5 px-3 py-2 text-sm">
              {it.icon && (
                <Avatar className="size-7 shrink-0 rounded-md border border-border bg-white">
                  <AvatarImage src={it.icon} alt={it.label} className="object-contain p-0.5" />
                  <AvatarFallback className="rounded-md text-[10px] font-semibold">{initials(it.label)}</AvatarFallback>
                </Avatar>
              )}
              <span className="min-w-[160px] flex-1">
                <span className="block truncate font-medium">{it.label}{it.badge && <span className="ml-2 rounded-md bg-green-100 px-1.5 py-px text-[11px] font-normal text-green-800 align-middle">{it.badge}</span>}</span>
                {it.meta && <span className="block text-xs text-muted-foreground">{it.meta}</span>}
                {it.progress !== undefined && (
                  <span className="mt-1.5 block h-1.5 w-full max-w-[320px] overflow-hidden rounded-full bg-neutral-200"><span className="block h-full bg-brand" style={{ width: `${Math.max(0, Math.min(100, it.progress))}%` }} /></span>
                )}
              </span>
              <span className="ml-auto flex items-center gap-1.5 shrink-0">
                {it.actions?.map((a) => (
                  <Button key={a.id} size="sm" variant={a.variant ?? "default"} onClick={() => onItemAction?.(it.id, a.id)}>{a.label}</Button>
                ))}
                {it.settings && (
                  <ItemSettingsDialog
                    item={it}
                    onChange={(values) => {
                      const next = items.map((x) => (x.id === it.id ? { ...x, settings: { ...x.settings!, values } } : x));
                      onChange(next);
                      onSaveList?.(next);
                    }}
                  />
                )}
                {f.removable !== false && (
                  <button type="button" aria-label={`Remove ${it.label}`} className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-neutral-100 hover:text-red-700" onClick={() => onChange(items.filter((x) => x.id !== it.id))}><X className="size-4" /></button>
                )}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <span className="block py-2 text-sm text-muted-foreground">None yet.</span>
      );
    }
    case "select": {
      const baseOpts: Option[] = (f.options ?? f.optionsBy?.map[String(vals[f.optionsBy.field])] ?? []).map((o) => (typeof o === "object" ? o : { value: o, label: o }));
      if (!f.options && baseOpts.length === 0) return <Input id={id} className={cls} value={String(v ?? "")} placeholder={f.placeholder ?? "model id"} onChange={(e) => onChange(e.target.value)} />;
      const opts = v !== undefined && v !== "" && !baseOpts.some((o) => String(o.value) === String(v)) ? [{ value: String(v), label: String(v) }, ...baseOpts] : baseOpts;
      if (opts.some((o) => o.icon)) {
        const cur = opts.find((o) => String(o.value) === String(v)) ?? opts[0];
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button id={id} type="button" className={`${cls} flex h-9 items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 text-left text-sm hover:bg-neutral-50`}>
                <span className="flex min-w-0 items-center gap-2">
                  {cur?.icon && (
                    <Avatar className="size-5 shrink-0 rounded-sm border border-border/60 bg-white">
                      <AvatarImage src={cur.icon} alt={cur.label} className="object-contain p-px" />
                      <AvatarFallback className="rounded-sm text-[9px] font-semibold">{initials(cur.label)}</AvatarFallback>
                    </Avatar>
                  )}
                  <span className="truncate">{cur?.label ?? String(v ?? "")}</span>
                </span>
                <ChevronsUpDown className="ml-auto size-4 shrink-0 text-muted-foreground" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-80 w-[--radix-dropdown-menu-trigger-width] min-w-[260px] overflow-y-auto">
              {opts.map((o) => {
                const active = String(o.value) === String(v);
                return (
                  <DropdownMenuItem key={String(o.value)} onClick={() => onChange(typeof baseOpts[0]?.value === "number" ? Number(o.value) : o.value)} className="gap-2">
                    {o.icon ? (
                      <Avatar className="size-5 shrink-0 rounded-sm border border-border/60 bg-white">
                        <AvatarImage src={o.icon} alt={o.label} className="object-contain p-px" />
                        <AvatarFallback className="rounded-sm text-[9px] font-semibold">{initials(o.label)}</AvatarFallback>
                      </Avatar>
                    ) : (
                      <span className="size-5 shrink-0" />
                    )}
                    <span className="flex-1 truncate">{o.label}</span>
                    {active && <Check className="ml-auto size-4 shrink-0 text-brand" />}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      }
      return (
        <select id={id} className={`${cls} h-9 rounded-md border border-input bg-transparent px-3 text-sm`} value={String(v ?? "")} onChange={(e) => onChange(typeof baseOpts[0]?.value === "number" ? Number(e.target.value) : e.target.value)}>
          {opts.map((o) => <option key={String(o.value)} value={String(o.value)}>{o.label}</option>)}
        </select>
      );
    }
    case "combo": {
      const opts = (f.options ?? f.optionsBy?.map[String(vals[f.optionsBy.field])] ?? []).map((o) => String(typeof o === "object" ? o.value : o));
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
  onAction: (sectionId: string, actionId: string, itemId?: string, nextVals?: Record<string, unknown>) => void;
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
                    <div key={f.key} className="grid grid-cols-1 gap-1.5 px-4 py-3 sm:grid-cols-[200px_1fr] sm:gap-4">
                      <label className="sm:pt-2 text-sm font-medium text-neutral-800" htmlFor={f.type === "checkbox" || f.type === "readonly" || f.type === "list" ? undefined : `f-${s.id}-${f.key}`}>{f.label}</label>
                      <div className="min-w-0">
                        <Control f={f} vals={vals} id={`f-${s.id}-${f.key}`} scope={s.id} onChange={(v) => onChange(s.id, applyChange(s, vals, f.key, v))} onSaveList={(v) => onAction(s.id, "save", undefined, applyChange(s, vals, f.key, v))} onItemAction={(itemId, actionId) => onAction(s.id, actionId, itemId)} />
                        {(f.hint || link) && (
                          <span className="mt-1 block text-xs text-muted-foreground">
                            {f.type === "readonly" ? <code className="break-all rounded bg-neutral-100 px-1.5">{f.hint}</code> : f.hint}
                            {link && <> <a className="text-brand hover:underline" href={link.url} target="_blank" rel="noreferrer">{link.label}</a></>}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              {s.actions?.length ? (
                <div className="flex flex-wrap items-center gap-2.5 px-4 py-3">
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
