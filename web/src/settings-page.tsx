import { useEffect, useState } from "react";
import { JsonForm, type Section, type Values } from "@/components/json-form";
import { FormSkeleton } from "@/components/skeletons";
import type { User } from "./types";

// Thin shell for every settings page: fetch that page's schema + values, hand them to the generic form, route actions to the API.
// Every settings page is scoped to the active organization (sent as ?org=), like every other page.
type Msg = { ok: boolean; text: string; status?: number };
// Messages handed back by a redirect (e.g. after GitHub app creation); read once, then the URL is cleaned.
const redirectMessage = (): Msg | null => {
  const q = new URLSearchParams(location.search);
  const c = q.get("connected");
  const e = q.get("error");
  if (c || e) history.replaceState(null, "", location.pathname);
  return c ? { ok: true, text: `GitHub app created and connected. Sign-in is enabled.${c.startsWith("http") ? ` App page: ${c}` : ""}` } : e ? { ok: false, text: e } : null;
};

export function SettingsPage({ page, org, setOrg, user, onLogin, onSaved }: { page: string; org: string; setOrg: (o: string) => void; user: User | null; onLogin: () => void; onSaved: () => void }) {
  const [sections, setSections] = useState<Section[] | null>(null);
  const [saved, setSaved] = useState<Values>({});
  const [values, setValues] = useState<Values>({});
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState<Msg | null>(redirectMessage);

  const apply = (d: { sections: Section[]; values: Values }) => {
    setSections(d.sections);
    setSaved(d.values);
    setValues(d.values);
  };
  const call = async (path: string, init?: RequestInit) => {
    const r = await fetch(path, init);
    const d = await r.json().catch(() => ({ error: `${r.status} ${r.statusText}` }));
    if (!r.ok) throw Object.assign(new Error(d.error || `${r.status}`), { status: r.status });
    return d;
  };
  const url = (suffix = "") => `/api/settings/${page}${suffix}?org=${encodeURIComponent(org)}`;
  // A page change clears the message; an organization change only reloads (keeps redirect messages visible).
  useEffect(() => { setMsg(redirectMessage()); }, [page]);
  useEffect(() => {
    let alive = true;
    setSections(null);
    call(url()).then((d) => alive && apply(d)).catch((e) => alive && setMsg({ ok: false, text: e.message, status: e.status }));
    return () => { alive = false; };
  }, [page, org]);

  const onAction = async (sectionId: string, actionId: string) => {
    setBusy(`${sectionId}:${actionId}`);
    setMsg(null);
    try {
      if (actionId === "save") {
        const added = String((values[sectionId] as Record<string, unknown> | undefined)?.add ?? "").trim().replace(/^https:\/\/github\.com\//, "");
        apply(await call(url(), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ [sectionId]: values[sectionId] }) }));
        onSaved();
        setMsg({ ok: true, text: "Saved." });
        // Onboarding a repository from another organization switches to it, so the page you land on is not empty.
        const owner = added.split("/")[0];
        if (page === "repos" && owner && added.includes("/") && owner !== org) setOrg(owner);
      } else if (actionId === "test") {
        const d = await call(url("/test"), { method: "POST" });
        setMsg({ ok: d.ok, text: d.ok ? `Connected, model answered in ${(d.ms / 1000).toFixed(1)}s.` : `Model answered but not with OK: "${d.reply}"` });
      } else {
        // Generic page action. A `submit` reply means "post this form to an external site" (GitHub app manifest flow).
        const d = await call(url(`/${actionId}`), { method: "POST" });
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
        if (d.message) setMsg({ ok: true, text: d.message });
      }
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message, status: (e as { status?: number }).status });
      // a failed save keeps the edits; other actions reload the page's current values
      if (actionId !== "save") call(url()).then(apply).catch(() => {});
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
      <FormSkeleton sections={page === "model" ? [4, 3] : page === "repos" ? [2] : page === "oauth" ? [6] : [1]} />
    );
  return (
    <div className="max-w-[820px]">
      {msg && <p className={`mb-4 rounded-lg px-3 py-2 text-sm ${msg.ok ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"}`}>{msg.text}</p>}
      <JsonForm sections={sections} values={values} saved={saved} busy={busy} onChange={(id, vals) => setValues((v) => ({ ...v, [id]: vals }))} onAction={onAction} />
    </div>
  );
}
