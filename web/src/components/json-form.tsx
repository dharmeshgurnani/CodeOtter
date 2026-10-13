// One renderer for every settings-style form. The server sends sections + fields as JSON; nothing here is page-specific.
// Rule: the plainest control that does the job. Picklist over cards, range over slider widgets, text over anything fancier.
import { useEffect, useRef, useState } from "react";
import { Check, ChevronsUpDown, Download, Loader2, Play, Plus, RefreshCw, Search, Settings2, Trash2, X } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InfoTip } from "@/components/info-tip";
import { Badge, CellView, DataTable, type Cell } from "@/components/data-table";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/animate-ui/components/radix/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/animate-ui/components/radix/dropdown-menu";
import { Switch } from "@/components/animate-ui/components/radix/switch";

export type Option = { value: string | number; label: string; icon?: string };
// A list item may carry its own settings (fields + values); they open in an Animate UI dialog from a gear icon on the row.
export type ListItem = string | { id: string; label: string; icon?: string; meta?: string; info?: string; badge?: string; progress?: number; actions?: Action[]; settings?: { title?: string; description?: string; fields: Field[]; values: Record<string, unknown> } };
// A table cell: plain text, or text with an icon, a status tone (drawn as a badge) or monospace.
// Table cells are the shared JSON cell (text, badge, icon, mono, info, progress, link); see components/data-table.tsx.
export type { Cell } from "@/components/data-table";
// A table row: cells by column key; settings open in the same dialog as list items, actions are row buttons.
// `toggle` draws a switch in place of the gear: turning it on opens the settings dialog (when there are settings) and
// saves on its Save; turning it off saves at once.
export type Row = { id: string; label: string; cells: Record<string, Cell>; actions?: Action[]; settings?: { title?: string; description?: string; fields: Field[]; values: Record<string, unknown> }; toggle?: boolean; toggleDisabled?: boolean; edited?: boolean };
export type Field = {
  key: string;
  label: string;
  type: "text" | "password" | "select" | "multiselect" | "combo" | "picker" | "number" | "range" | "checkbox" | "readonly" | "list" | "table";
  columns?: { key: string; label: string }[]; // table
  hint?: string;
  text?: string; // inline label for a checkbox
  placeholder?: string;
  options?: Option[];
  optionsBy?: { field: string; map: Record<string, (string | Option)[]> }; // options chosen by another field's value; an empty list means free text
  defaultBy?: { field: string; map: Record<string, string> };
  hideWhen?: { field: string; in: string[] };
  link?: { label: string; url: string };
  linkBy?: { field: string; map: Record<string, { label: string; url: string }> };
  infoBy?: { field: string; map: Record<string, string> }; // info icon beside the label, chosen by another field's value
  removable?: boolean; // list: whether rows can be removed (default true)
  min?: number;
  max?: number;
  step?: number;
};
// `icon` names one of ACTION_ICONS, drawn before the label; `iconOnly` keeps just the icon (label becomes its accessible
// name and tooltip); `loading` marks work the server reports in progress (e.g. a download); `danger` colours it light red.
export type Action = { id: string; label: string; variant?: "default" | "outline"; needsSaved?: boolean; always?: boolean; disabled?: boolean; icon?: keyof typeof ACTION_ICONS; iconOnly?: boolean; loading?: boolean; danger?: boolean };
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

// Per-item settings in an Animate UI dialog, opened from a gear icon, or by the caller when `open` is given (a row
// toggle turned on). Same generic controls; "Save" hands the values back to the list and persists them.
function ItemSettingsDialog({ item, onChange, open, onOpenChange, disabled }: { item: Exclude<ListItem, string>; onChange: (values: Record<string, unknown>) => void; open?: boolean; onOpenChange?: (open: boolean) => void; disabled?: boolean }) {
  const s = item.settings!;
  const [vals, setVals] = useState<Record<string, unknown>>(s.values);
  const section: Section = { id: item.id, title: s.title ?? item.label, fields: s.fields };
  const controlled = open !== undefined;
  useEffect(() => { if (open) setVals(s.values); }, [open]);
  return (
    <Dialog {...(controlled ? { open } : {})} onOpenChange={(o) => { if (o) setVals(s.values); onOpenChange?.(o); }}>
      {!controlled && (
        <DialogTrigger asChild>
          <button type="button" disabled={disabled} aria-label={`Settings for ${item.label}`} className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-neutral-100 hover:text-neutral-900 disabled:opacity-50"><Settings2 className="size-4" /></button>
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{s.title ?? item.label}</DialogTitle>
          {s.description && <DialogDescription>{s.description}</DialogDescription>}
        </DialogHeader>
        <div className="divide-y divide-border rounded-[10px] border border-border">
          {s.fields.filter((f) => !f.hideWhen || !f.hideWhen.in.includes(String(vals[f.hideWhen.field]))).map((f) => (
            <div key={f.key} className="grid grid-cols-1 gap-1 px-4 py-3 sm:grid-cols-[160px_1fr] sm:gap-4">
              <label className="pt-2 text-sm font-medium text-neutral-800" htmlFor={f.type === "checkbox" || f.type === "readonly" || f.type === "list" ? undefined : `d-${item.id}-${f.key}`}>{f.label}</label>
              <div className="min-w-0">
                <Control f={f} vals={vals} id={`d-${item.id}-${f.key}`} scope={`d-${item.id}`} onChange={(v) => setVals(applyChange(section, vals, f.key, v))} />
                {(() => {
                  const link = f.link ?? f.linkBy?.map[String(vals[f.linkBy.field])];
                  return (f.hint || link) && (
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {f.hint}
                      {link && <> <a className="text-brand hover:underline" href={link.url} target="_blank" rel="noreferrer">{link.label}</a></>}
                    </span>
                  );
                })()}
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

// Searchable option list with an Add button per row; typed text that matches no option can be added as is.
// Picking saves the section straight away with this field set to the picked value.
function Picker({ f, vals, onPick, busy = false }: { f: Field; vals: Record<string, unknown>; onPick: (value: string) => void; busy?: boolean }) {
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState(""); // the row whose Add is in flight shows the spinner
  const opts = (f.options ?? f.optionsBy?.map[String(vals[f.optionsBy.field])] ?? []).map((o) => (typeof o === "object" ? { ...o, value: String(o.value) } : { value: o, label: o }));
  const term = q.trim();
  const shown = opts.filter((o) => `${o.label} ${o.value}`.toLowerCase().includes(term.toLowerCase()));
  const exact = opts.some((o) => o.value.toLowerCase() === term.toLowerCase());
  const pick = (value: string) => { if (busy) return; setPicked(value); onPick(value); setQ(""); };
  const row = (key: string, label: string, sub: string, value: string, icon?: string) => (
    <li key={key} onClick={() => pick(value)} className={`flex items-center gap-2.5 px-3 py-2 text-sm ${busy ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:bg-neutral-50"}`}>
      <Avatar className="size-7 shrink-0 rounded-md border border-border bg-white">
        {icon && <AvatarImage src={icon} alt={label} className="object-cover" />}
        <AvatarFallback className="rounded-md text-[10px] font-semibold">{initials(label)}</AvatarFallback>
      </Avatar>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{label}</span>
        {sub && <span className="block truncate text-xs text-muted-foreground">{sub}</span>}
      </span>
      <Button type="button" size="sm" variant="outline" className="h-7 gap-1 text-xs" disabled={busy} loading={busy && picked === value} onClick={(e) => { e.stopPropagation(); pick(value); }}>{!(busy && picked === value) && <Plus className="size-3.5" />}Add</Button>
    </li>
  );
  return (
    <div className="max-w-[520px]">
      <form className="relative flex items-center" onSubmit={(e) => { e.preventDefault(); if (term) pick(term); }}>
        <Search className="pointer-events-none absolute left-3 size-4 text-muted-foreground" />
        <Input className="pl-9" value={q} disabled={busy} placeholder={f.placeholder} onChange={(e) => setQ(e.target.value)} />
      </form>
      <ul className="mt-2 max-h-[300px] divide-y divide-border overflow-y-auto rounded-md border border-border">
        {term && !exact && row(`add:${term}`, term, "", term)}
        {shown.map((o) => row(o.value, o.label, o.label === o.value ? "" : o.value, o.value, o.icon))}
        {!shown.length && !term && <li className="px-3 py-2 text-sm text-muted-foreground">None available.</li>}
      </ul>
    </div>
  );
}

const ACTION_ICONS = { download: Download, check: Check, play: Play, trash: Trash2, refresh: RefreshCw, plus: Plus };
// One row action button: icon + label, or icon only. Shared by table rows and list rows.
function ActionButton({ a, busy, lock, fallback, onClick }: { a: Action; busy: boolean; lock: boolean; fallback: "default" | "outline"; onClick: () => void }) {
  const Icon = a.icon ? ACTION_ICONS[a.icon] : null;
  const loading = busy || !!a.loading;
  return (
    <Button size={a.iconOnly ? "icon-sm" : "sm"} variant={a.variant ?? fallback} className={a.danger ? "border-red-200 text-red-500 hover:bg-red-50 hover:text-red-600" : undefined} disabled={a.disabled || lock} loading={loading} aria-label={a.iconOnly ? a.label : undefined} title={a.iconOnly ? a.label : undefined} onClick={onClick}>
      {Icon && !loading && <Icon />}
      {!a.iconOnly && a.label}
    </Button>
  );
}

// Rows × columns; each row's gear (or toggle) opens its settings in the shared dialog. A save posts every row, with the
// edited one marked, so the server applies only that row.
// While any server call runs (`busy`), every row control is locked; the running one shows a spinner.
function Table({ f, rows, onChange, onSave, onRowAction, busy = "", scope = "" }: { f: Field; rows: Row[]; onChange: (v: Row[]) => void; onSave?: (v: Row[]) => void; onRowAction?: (rowId: string, actionId: string) => void; busy?: string; scope?: string }) {
  const lock = busy !== "";
  const [saving, setSaving] = useState(""); // row whose toggle or dialog save is in flight
  const cols = f.columns ?? [];
  const [opening, setOpening] = useState(""); // row whose toggle was turned on and waits for its dialog's Save
  const commit = (id: string, patch: Partial<Row>) => {
    const next = rows.map((x) => (x.id === id ? { ...x, ...patch, edited: true } : { ...x, edited: false }));
    setSaving(id);
    onChange(next);
    onSave?.(next);
  };
  return (
    <DataTable
      columns={cols}
      rows={rows.map((r) => ({
        id: r.id,
        cells: Object.fromEntries(cols.map((c) => [c.key, <CellView c={r.cells[c.key]} />])),
        actions: r.actions?.length || r.toggle !== undefined || r.settings ? (
          <>
            {lock && saving === r.id && !r.actions?.some((a) => busy === `${scope}:${a.id}:${r.id}`) && <Loader2 aria-label="Saving" className="size-4 animate-spin text-muted-foreground" />}
            {r.actions?.map((a) => <ActionButton key={a.id} a={a} fallback="outline" lock={lock} busy={busy === `${scope}:${a.id}:${r.id}`} onClick={() => onRowAction?.(r.id, a.id)} />)}
            {r.toggle !== undefined ? (
              <>
                <Switch
                  aria-label={r.label}
                  className="data-[state=checked]:bg-brand"
                  checked={r.toggle}
                  disabled={r.toggleDisabled || lock}
                  onCheckedChange={(on) => (on && r.settings ? setOpening(r.id) : commit(r.id, { toggle: on }))}
                />
                {r.settings && (
                  <ItemSettingsDialog
                    item={r}
                    open={opening === r.id}
                    onOpenChange={(o) => { if (!o) setOpening(""); }}
                    onChange={(values) => commit(r.id, { toggle: true, settings: { ...r.settings!, values } })}
                  />
                )}
              </>
            ) : r.settings && (
              <ItemSettingsDialog item={r} disabled={lock} onChange={(values) => commit(r.id, { settings: { ...r.settings!, values } })} />
            )}
          </>
        ) : undefined,
      }))}
    />
  );
}

// Native range input; the mouse wheel over it moves one step (up = more). The listener is attached by hand because
// React's wheel listeners are passive, and the page must not scroll while the wheel adjusts the value.
function Range({ id, f, value, onChange }: { id?: string; f: Field; value: number; onChange: (v: number) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const latest = useRef({ value, onChange });
  latest.current = { value, onChange };
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (el.disabled || e.deltaY === 0) return;
      e.preventDefault();
      const step = f.step ?? 1;
      const min = f.min ?? 0;
      const max = f.max ?? 100;
      const next = Math.min(max, Math.max(min, latest.current.value + (e.deltaY < 0 ? step : -step)));
      const rounded = Number(next.toFixed(6)); // 0.1 steps without float drift
      if (rounded !== latest.current.value) latest.current.onChange(rounded);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [f.step, f.min, f.max]);
  return <input ref={ref} id={id} type="range" className="flex-1 accent-brand" min={f.min} max={f.max} step={f.step} value={value} onChange={(e) => onChange(Number(e.target.value))} />;
}

const Control = ({ f, vals, onChange, onSaveList, id, scope = "", onItemAction, busy = "" }: { f: Field; vals: Record<string, unknown>; onChange: (v: unknown) => void; onSaveList?: (v: unknown) => void; id?: string; scope?: string; onItemAction?: (itemId: string, actionId: string) => void; busy?: string }) => {
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
                  <AvatarImage src={it.icon} alt={it.label} className="object-cover" />
                  <AvatarFallback className="rounded-md text-[10px] font-semibold">{initials(it.label)}</AvatarFallback>
                </Avatar>
              )}
              <span className="min-w-[160px] flex-1">
                <span className="block truncate font-medium">{it.label}{it.info && <span className="ml-1.5"><InfoTip text={it.info} /></span>}{it.badge && <Badge tone="ok" className="ml-2">{it.badge}</Badge>}</span>
                {it.meta && <span className="block text-xs text-muted-foreground">{it.meta}</span>}
                {it.progress !== undefined && (
                  <span className="mt-1.5 block h-1.5 w-full max-w-[320px] overflow-hidden rounded-full bg-neutral-200"><span className="block h-full bg-brand" style={{ width: `${Math.max(0, Math.min(100, it.progress))}%` }} /></span>
                )}
              </span>
              <span className="ml-auto flex items-center gap-1.5 shrink-0">
                {it.actions?.map((a) => (
                  <ActionButton key={a.id} a={a} fallback="default" lock={busy !== ""} busy={busy === `${scope}:${a.id}:${it.id}`} onClick={() => onItemAction?.(it.id, a.id)} />
                ))}
                {it.settings && (
                  <ItemSettingsDialog
                    item={it}
                    disabled={busy !== ""}
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
                      <AvatarImage src={cur.icon} alt={cur.label} className="object-cover" />
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
                        <AvatarImage src={o.icon} alt={o.label} className="object-cover" />
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
    case "table":
      return <Table f={f} rows={Array.isArray(v) ? (v as Row[]) : []} onChange={onChange} onSave={onSaveList} onRowAction={onItemAction} busy={busy} scope={scope} />;
    case "picker":
      return <Picker f={f} vals={vals} busy={busy !== ""} onPick={(value) => onSaveList?.(value)} />;
    case "range":
      return (
        <span className="flex max-w-[520px] items-center gap-3">
          <Range id={id} f={f} value={Number(v ?? f.min ?? 0)} onChange={onChange} />
          <span className="w-10 text-right text-sm tabular-nums">{String(v ?? "")}</span>
        </span>
      );
    case "number":
      return <Input id={id} className={cls} type="number" min={f.min} max={f.max} step={f.step} value={String(v ?? "")} onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))} />;
    case "multiselect": {
      // A checkbox per option; the value is the list of checked option values, in option order.
      const picked = new Set((Array.isArray(v) ? v : []).map(String));
      const opts = (f.options ?? []).map((o) => String(o.value));
      const toggle = (value: string, on: boolean) => onChange(opts.filter((o) => (o === value ? on : picked.has(o))));
      return (f.options ?? []).length ? (
        <div id={id} role="group" aria-label={f.label} className="max-h-[220px] max-w-[520px] divide-y divide-border overflow-y-auto rounded-md border border-border">
          {(f.options ?? []).map((o) => (
            <label key={String(o.value)} className="flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm hover:bg-neutral-50">
              <input type="checkbox" className="size-4 cursor-pointer accent-brand" checked={picked.has(String(o.value))} onChange={(e) => toggle(String(o.value), e.target.checked)} />
              <span className="truncate">{o.label}</span>
            </label>
          ))}
        </div>
      ) : (
        <span className="block py-2 text-sm text-muted-foreground">None available.</span>
      );
    }
    case "checkbox":
      return (
        <label className="flex items-start gap-2.5 py-2 text-sm">
          <Switch className="data-[state=checked]:bg-brand" checked={!!v} onCheckedChange={(checked) => onChange(checked)} />
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
                  const info = f.infoBy?.map[String(vals[f.infoBy.field])];
                  const control = <Control f={f} vals={vals} id={`f-${s.id}-${f.key}`} scope={s.id} onChange={(v) => onChange(s.id, applyChange(s, vals, f.key, v))} onSaveList={(v) => onAction(s.id, "save", undefined, applyChange(s, vals, f.key, v))} onItemAction={(itemId, actionId) => onAction(s.id, actionId, itemId)} busy={busy} />;
                  if (f.type === "table") return <div key={f.key} className="p-3">{control}{f.hint && <span className="mt-1 block text-xs text-muted-foreground">{f.hint}</span>}</div>;
                  return (
                    <div key={f.key} className="grid grid-cols-1 gap-1.5 px-4 py-3 sm:grid-cols-[200px_1fr] sm:gap-4">
                      <label className="sm:pt-2 text-sm font-medium text-neutral-800" htmlFor={f.type === "checkbox" || f.type === "readonly" || f.type === "list" ? undefined : `f-${s.id}-${f.key}`}>{f.label}{info && <span className="ml-1.5"><InfoTip text={info} /></span>}</label>
                      <div className="min-w-0">
                        {control}
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
                    <Button key={a.id} variant={a.variant ?? "default"} disabled={busy !== "" || (a.always ? false : a.needsSaved ? dirty : !dirty)} loading={busy === `${s.id}:${a.id}`} onClick={() => onAction(s.id, a.id)}>
                      {a.label}
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
