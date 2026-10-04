import { useEffect, useState } from "react";
import { Loader2, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MarkdownView } from "@/components/markdown";

// Server-registered PR tools (PR_TOOLS in server.mjs): pick one, run it, then post the result or apply it to the PR.
type Tool = { id: string; label: string; input: string | null; apply: string | null };
type Result = { tool: string; markdown: string; at: string; message?: string };

export function PrTools({ org, prUrl }: { org: string; prUrl: string }) {
  const [tools, setTools] = useState<Tool[]>([]);
  const [id, setId] = useState("");
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState("");
  const [results, setResults] = useState<Record<string, Result>>({});
  const [note, setNote] = useState("");
  const endpoint = `/api/tools?org=${encodeURIComponent(org)}`;

  useEffect(() => {
    fetch(endpoint).then((r) => r.json()).then((d: Tool[]) => {
      if (!Array.isArray(d)) return;
      setTools(d);
      setId((cur) => cur || d[0]?.id || "");
    }).catch(() => {});
  }, [endpoint]);

  const tool = tools.find((t) => t.id === id);
  const result = results[id];

  const call = async (action: "run" | "comment" | "apply") => {
    setBusy(action);
    setNote("");
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prUrl, tool: id, action, question }),
      });
      const d = await res.json().catch(() => ({ error: `${res.status}` }));
      if (!res.ok || d.error) throw new Error(d.error || `${res.status}`);
      setResults((prev) => ({ ...prev, [id]: d }));
      if (d.message) setNote(d.message);
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="overflow-hidden rounded-[10px] border border-border bg-white">
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-[#efefef] px-4 py-2.5 text-sm">
        <Wrench className="size-4 shrink-0 text-brand" />
        <b className="font-semibold">Tools</b>
        <select
          aria-label="Tool"
          className="ml-2 h-8 rounded-md border border-input bg-white px-2 text-sm"
          value={id}
          disabled={!tools.length || !!busy}
          onChange={(e) => { setId(e.target.value); setNote(""); }}
        >
          {tools.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
        {tool?.input ? (
          <Input
            className="h-8 min-w-[16rem] flex-1 bg-white"
            placeholder={tool.input}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && question.trim() && !busy) call("run"); }}
          />
        ) : null}
        <Button size="sm" disabled={!tool || !!busy || (!!tool?.input && !question.trim())} onClick={() => call("run")}>
          {busy === "run" ? <Loader2 className="animate-spin" /> : null}Run
        </Button>
        <Button size="sm" variant="outline" disabled={!result || !!busy} onClick={() => call("comment")}>
          {busy === "comment" ? <Loader2 className="animate-spin" /> : null}Post as comment
        </Button>
        {tool?.apply ? (
          <Button size="sm" variant="outline" disabled={!result || !!busy} onClick={() => call("apply")}>
            {busy === "apply" ? <Loader2 className="animate-spin" /> : null}{tool.apply}
          </Button>
        ) : null}
        <span className="ml-auto text-xs text-muted-foreground">{note}</span>
      </div>
      <div className="min-h-[6rem] px-4 py-3.5 text-[15px]">
        {busy === "run" ? (
          <p className="text-sm text-muted-foreground">Running {tool?.label}…</p>
        ) : result ? (
          <MarkdownView content={result.markdown} />
        ) : (
          <p className="text-sm text-muted-foreground">No result yet.</p>
        )}
      </div>
    </div>
  );
}
