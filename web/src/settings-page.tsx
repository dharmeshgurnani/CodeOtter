import { useEffect, useRef, useState } from "react";
import { JsonForm, type Section, type Values } from "@/components/json-form";
import { FormSkeleton } from "@/components/skeletons";
import { toast } from "sonner";
import type { User } from "./types";

// Thin shell for every settings page: fetch that page's schema + values, hand them to the generic form, route actions to the API.
// Every settings page is scoped to the active organization (sent as ?org=), like every other page.
type Msg = { ok: boolean; text: string; status?: number };
// Results are Sonner toasts. The id keeps one message from stacking (StrictMode, repeated saves).
const say = (m: Msg | null) => { if (m) (m.ok ? toast.success : toast.error)(m.text, { id: m.text }); };
// Messages handed back by a redirect (e.g. after GitHub app creation); read once, then the URL is cleaned.
const redirectMessage = (): Msg | null => {
  const q = new URLSearchParams(location.search);
  const c = q.get("connected");
  const e = q.get("error");
  if (c || e) history.replaceState(null, "", location.pathname);
  return c ? { ok: true, text: `GitHub app created and connected. Sign-in is enabled.${c.startsWith("http") ? ` App page: ${c}` : ""}` } : e ? { ok: false, text: e } : null;
};

export function SettingsPage({ forgeUrls, page, repo = "", org, setOrg, user, onLogin, onSaved }: { forgeUrls: Record<string, string>; page: string; repo?: string; org: string; setOrg: (o: string) => void; user: User | null; onLogin: () => void; onSaved: () => void }) {
  const [sections, setSections] = useState<Section[] | null>(null);
  const [saved, setSaved] = useState<Values>({});
  const [values, setValues] = useState<Values>({});
  const [busy, setBusy] = useState("");
  // Only a page that fails to load keeps its error inline: there is no form to show, and a 403 offers Sign in.
  const [msg, setMsg] = useState<Msg | null>(null);
  useEffect(() => say(redirectMessage()), []);

  const apply = (d: { sections: Section[]; values: Values }) => {
    setSections(d.sections);
    setSaved(d.values);
    setValues(d.values);
  };
  // Poll ticks refresh sections and saved values; a section's form values follow only while untouched (still equal to what was saved).
  const savedRef = useRef(saved);
  useEffect(() => { savedRef.current = saved; }, [saved]);
  const applyPoll = (d: { sections: Section[]; values: Values }) => {
    const prevSaved = savedRef.current;
    setSections(d.sections);
    setSaved(d.values);
    setValues((cur) => {
      const next = { ...cur };
      for (const id of Object.keys(d.values)) if (JSON.stringify(cur[id]) === JSON.stringify(prevSaved[id])) next[id] = d.values[id];
      return next;
    });
  };
  // Responses that arrive after the page or organization changed belong to another scope and are dropped.
  const scopeRef = useRef(`${page}\u0000${org}\u0000${repo}`);
  useEffect(() => { scopeRef.current = `${page}\u0000${org}\u0000${repo}`; }, [page, org, repo]);
  const inScope = (scope: string) => scopeRef.current === scope;
  const call = async (path: string, init?: RequestInit) => {
    const r = await fetch(path, init);
    const d = await r.json().catch(() => ({ error: `${r.status} ${r.statusText}` }));
    if (!r.ok) throw Object.assign(new Error(d.error || `${r.status}`), { status: r.status });
    return d;
  };
  const url = (suffix = "") => `/api/settings/${page}${suffix}?org=${encodeURIComponent(org)}${repo ? `&repo=${encodeURIComponent(repo)}` : ""}`;
  useEffect(() => {
    let alive = true;
    setMsg(null);
    setSections(null);
    call(url()).then((d) => alive && apply(d)).catch((e) => alive && setMsg({ ok: false, text: e.message, status: e.status }));
    return () => { alive = false; };
  }, [page, org, repo]);
  // A section in progress (e.g. a model download) asks to be refetched; stop when it no longer asks.
  const pollMs = Math.max(0, ...(sections ?? []).map((s) => s.poll ?? 0));
  useEffect(() => {
    if (!pollMs) return;
    let alive = true;
    const t = setInterval(() => call(url()).then((d) => alive && applyPoll(d)).catch(() => {}), pollMs);
    return () => { alive = false; clearInterval(t); };
  }, [pollMs, page, org, repo]);

  const onAction = async (sectionId: string, actionId: string, itemId?: string, nextVals?: Record<string, unknown>) => {
    setBusy(`${sectionId}:${actionId}${itemId ? `:${itemId}` : ""}`); // row actions carry their row, so only that button spins
    const scope = scopeRef.current;
    try {
      if (actionId === "save") {
        const secVals = nextVals ?? values[sectionId];
        const rawAdded = String((secVals as Record<string, unknown> | undefined)?.add ?? "").trim();
        const added = rawAdded.replace(/^https:\/\/github\.com\//, "");
        apply(await call(url(), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ [sectionId]: secVals }) }));
        onSaved();
        say({ ok: true, text: "Saved." });
        // Onboarding a repository from another organization switches to it, so the page you land on is not empty.
        const source = Object.keys(forgeUrls).find((id) => forgeUrls[id] && rawAdded.startsWith(`${forgeUrls[id]}/`));
        const prefix = /^(forgejo|gitea)~/.exec(org)?.[0] || "";
        const owner = source ? `${source}~${rawAdded.slice(forgeUrls[source].length + 1).split("/")[0]}` : `${prefix && !rawAdded.startsWith("https://github.com/") && !/^(forgejo|gitea)~/.test(added) ? prefix : ""}${added.split("/")[0]}`;
        if (page === "repos" && owner && added.includes("/") && owner !== org) setOrg(owner);
      } else if (actionId === "test") {
        const d = await call(url("/test"), { method: "POST" });
        say({ ok: d.ok, text: d.ok ? (typeof d.ms === "number" ? `Connected, model answered in ${(d.ms / 1000).toFixed(1)}s.` : d.reply || "Connected.") : `Model answered but not with OK: "${d.reply}"` });
      } else {
        // Generic page action. A `submit` reply means "post this form to an external site" (GitHub app manifest flow).
        const d = await call(url(`/${actionId}`), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ item: itemId ?? null }) });
        if (d.submit) {
          const f = document.createElement("form");
          f.method = "POST";
          f.action = d.submit.url;
          for (const [k, v] of Object.entries(d.submit.fields as Record<string, string>)) {
            const i = document.createElement("input");
            i.type = "hidden"; i.name = k; i.value = v;
            f.appendChild(i);
          }
          document.body.appendChild(f);
          f.submit();
          return;
        }
        if (d.message) say({ ok: true, text: d.message });
        if (itemId) { const d = await call(url()); if (inScope(scope)) apply(d); } // row actions change the page (downloaded / active); refetch
      }
    } catch (e) {
      say({ ok: false, text: (e as Error).message });
      // a failed form Save keeps the typed edits; an immediate save (toggle, row dialog, picker) reloads so controls show what is stored
      if (actionId !== "save" || nextVals) call(url()).then((d) => inScope(scope) && apply(d)).catch(() => {});
    } finally {
      setBusy("");
    }
  };

  if (!sections)
    return msg && !msg.ok ? (
      <p className="text-sm text-red-700">
        {msg.text}
        {msg.status === 403 && !user && <> <a className="text-brand" href="/login" onClick={(e) => { e.preventDefault(); onLogin(); }}>Sign in</a></>}
      </p>
    ) : (
      <FormSkeleton sections={page === "model" ? [4, 3] : page === "repos" ? [2] : page === "repo" ? [13] : page === "oauth" ? [7] : page === "git" ? [1] : page === "models" ? [2, 1] : [1]} />
    );
  return (
    <div className="w-full">
      <JsonForm sections={sections} values={values} saved={saved} busy={busy} onChange={(id, vals) => setValues((v) => ({ ...v, [id]: vals }))} onAction={onAction} />
    </div>
  );
}
