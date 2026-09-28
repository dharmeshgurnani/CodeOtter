import { useEffect, useState } from "react";
import { JsonReport, type ReportSection } from "@/components/json-report";
import { ReportSkeleton } from "@/components/skeletons";

// Thin shell: the server computes the dashboard sections, the generic report renderer draws them.
export function HomePage({ go, version, org }: { go: (p: string) => void; version: number; org: string }) {
  const [sections, setSections] = useState<ReportSection[] | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    let alive = true;
    setSections(null);
    setErr("");
    fetch(`/api/home?org=${encodeURIComponent(org)}`)
      .then(async (r) => (r.ok ? r.json() : Promise.reject(new Error((await r.json().catch(() => ({}))).error || `${r.status}`))))
      .then((d) => alive && setSections(d.sections))
      .catch((e) => alive && setErr(e.message));
    return () => { alive = false; };
  }, [version, org]);
  if (err) return <p className="text-sm text-red-700">{err}</p>;
  if (!sections) return <ReportSkeleton />;
  return <JsonReport sections={sections} go={go} />;
}
