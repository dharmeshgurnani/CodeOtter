import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

type NodeRole = "pr" | "cohort" | "file" | "hotspot" | "test";

type MermaidNode = {
  id: string;
  lines: string[];
  role: NodeRole;
};

type MermaidEdge = {
  from: string;
  to: string;
  dashed: boolean;
  label?: string;
};

function inferRole(id: string, label: string, explicit?: string): NodeRole {
  const e = (explicit || "").toLowerCase();
  if (e === "pr" || e === "cohort" || e === "file" || e === "hotspot" || e === "test") return e;
  if (/^pr\b/i.test(id) || /pull request|->/i.test(label)) return "pr";
  if (/^h\d+|hotspot|⚠️/i.test(id) || /hotspot|⚠️/i.test(label)) return "hotspot";
  if (/^t\d+|test|🧪/i.test(id) || /test|spec|🧪/i.test(label)) return "test";
  if (/^c\d+|cohort/i.test(id) || /\(\d+\s*files?\)/i.test(label)) return "cohort";
  return "file";
}

function parseMermaidFlowchart(raw: string): { nodes: MermaidNode[]; edges: MermaidEdge[] } {
  const nodeMap = new Map<string, MermaidNode>();
  const edges: MermaidEdge[] = [];

  const upsertEndpoint = (token: string): string => {
    let t = token.trim();
    let explicitRole: string | undefined;
    const roleMatch = t.match(/:::([a-zA-Z0-9_-]+)$/);
    if (roleMatch) {
      explicitRole = roleMatch[1];
      t = t.slice(0, -roleMatch[0].length).trim();
    }
    const bracketMatch = t.match(/^([a-zA-Z0-9_.-]+)\s*(?:\["([\s\S]*)"\]|\['([\s\S]*)'\]|\[([\s\S]*)\]|\("([\s\S]*)"\)|\(([\s\S]*)\))$/);
    if (bracketMatch) {
      const id = bracketMatch[1];
      const rawLabel = bracketMatch[2] ?? bracketMatch[3] ?? bracketMatch[4] ?? bracketMatch[5] ?? bracketMatch[6] ?? id;
      const lines = rawLabel
        .split(/<br\s*\/?>|\\n|\n/i)
        .map((s) => s.trim())
        .filter(Boolean);
      const safeLines = lines.length ? lines : [id];
      const role = inferRole(id, safeLines.join(" "), explicitRole);
      nodeMap.set(id, { id, lines: safeLines, role });
      return id;
    }
    const id = t.replace(/[^a-zA-Z0-9_.-]/g, "") || "node";
    if (!nodeMap.has(id)) {
      nodeMap.set(id, { id, lines: [id], role: inferRole(id, id, explicitRole) });
    } else if (explicitRole) {
      const prev = nodeMap.get(id)!;
      nodeMap.set(id, { ...prev, role: inferRole(id, prev.lines.join(" "), explicitRole) });
    }
    return id;
  };

  for (const rawLine of raw.split("\n")) {
    const line = rawLine.trim();
    if (
      !line ||
      line.startsWith("%%") ||
      /^(flowchart|graph)\b/i.test(line) ||
      /^(classDef|class|style|linkStyle|subgraph|end|direction)\b/i.test(line)
    ) {
      continue;
    }
    const edgeMatch = line.match(/^(.*?)\s*(-\.->|-->|==>|---)\s*(?:\|([^|]*)\|\s*)?(.*)$/);
    if (edgeMatch) {
      const from = upsertEndpoint(edgeMatch[1]);
      const arrow = edgeMatch[2];
      const label = edgeMatch[3]?.trim();
      const to = upsertEndpoint(edgeMatch[4]);
      if (from && to) {
        edges.push({ from, to, dashed: arrow.includes("."), label });
      }
    } else {
      upsertEndpoint(line);
    }
  }

  return { nodes: [...nodeMap.values()], edges };
}

function MermaidDiagram({ code, isDark }: { code: string; isDark: boolean }) {
  const [showSource, setShowSource] = useState(false);
  const { nodes, edges } = useMemo(() => parseMermaidFlowchart(code), [code]);

  const layout = useMemo(() => {
    if (!nodes.length) return null;
    const inDeg = new Map<string, number>();
    const adj = new Map<string, string[]>();
    for (const n of nodes) {
      inDeg.set(n.id, 0);
      adj.set(n.id, []);
    }
    for (const e of edges) {
      if (adj.has(e.from) && inDeg.has(e.to)) {
        adj.get(e.from)!.push(e.to);
        inDeg.set(e.to, (inDeg.get(e.to) || 0) + 1);
      }
    }
    const colOf = new Map<string, number>();
    const queue: string[] = [];
    for (const n of nodes) {
      if ((inDeg.get(n.id) || 0) === 0) {
        colOf.set(n.id, 0);
        queue.push(n.id);
      }
    }
    if (!queue.length && nodes.length) {
      colOf.set(nodes[0].id, 0);
      queue.push(nodes[0].id);
    }
    while (queue.length) {
      const u = queue.shift()!;
      const c = colOf.get(u) || 0;
      for (const v of adj.get(u) || []) {
        const nextCol = Math.min(5, c + 1);
        if ((colOf.get(v) ?? -1) < nextCol) {
          colOf.set(v, nextCol);
          queue.push(v);
        }
      }
    }
    for (const n of nodes) {
      if (!colOf.has(n.id)) colOf.set(n.id, 0);
    }

    const columns = new Map<number, MermaidNode[]>();
    for (const n of nodes) {
      const c = colOf.get(n.id) || 0;
      columns.set(c, [...(columns.get(c) || []), n]);
    }
    const sortedCols = [...columns.keys()].sort((a, b) => a - b);
    const nodeW = 216;
    const nodeH = 56;
    const colGap = 58;
    const rowGap = 14;
    const padX = 18;
    const padY = 18;

    const maxRows = Math.max(1, ...sortedCols.map((c) => columns.get(c)!.length));
    const totalH = padY * 2 + maxRows * nodeH + (maxRows - 1) * rowGap;
    const totalW = padX * 2 + sortedCols.length * nodeW + Math.max(0, sortedCols.length - 1) * colGap;

    const pos = new Map<string, { x: number; y: number; w: number; h: number; node: MermaidNode }>();
    sortedCols.forEach((c, colIdx) => {
      const colNodes = columns.get(c)!;
      const colH = colNodes.length * nodeH + (colNodes.length - 1) * rowGap;
      const startY = Math.max(padY, Math.round((totalH - colH) / 2));
      const x = padX + colIdx * (nodeW + colGap);
      colNodes.forEach((node, rowIdx) => {
        const y = startY + rowIdx * (nodeH + rowGap);
        pos.set(node.id, { x, y, w: nodeW, h: nodeH, node });
      });
    });

    return { pos, totalW, totalH };
  }, [nodes, edges]);

  if (!layout || !nodes.length) {
    return (
      <pre
        className={cn(
          "my-2.5 overflow-x-auto rounded-lg border p-3 font-mono text-xs leading-relaxed",
          isDark ? "border-neutral-800 bg-[#090d12] text-neutral-200" : "border-neutral-200 bg-neutral-900 text-neutral-100",
        )}
      >
        {code}
      </pre>
    );
  }

  const roleStyles: Record<
    NodeRole,
    { fill: string; stroke: string; accent: string; badgeBg: string; badgeText: string; title: string; sub: string; tag: string }
  > = isDark
    ? {
        pr: { fill: "#111c2d", stroke: "#38bdf8", accent: "#38bdf8", badgeBg: "#0c4a6e", badgeText: "#bae6fd", title: "#f8fafc", sub: "#94a3b8", tag: "PR" },
        cohort: { fill: "#131b26", stroke: "#64748b", accent: "#94a3b8", badgeBg: "#1e293b", badgeText: "#cbd5e1", title: "#f1f5f9", sub: "#94a3b8", tag: "COHORT" },
        file: { fill: "#0b1017", stroke: "#334155", accent: "#475569", badgeBg: "#1e293b", badgeText: "#94a3b8", title: "#e2e8f0", sub: "#94a3b8", tag: "FILE" },
        hotspot: { fill: "#291507", stroke: "#f59e0b", accent: "#f59e0b", badgeBg: "#78350f", badgeText: "#fde68a", title: "#fef3c7", sub: "#fcd34d", tag: "HOTSPOT" },
        test: { fill: "#072415", stroke: "#22c55e", accent: "#22c55e", badgeBg: "#14532d", badgeText: "#bbf7d0", title: "#dcfce7", sub: "#86efac", tag: "TEST" },
      }
    : {
        pr: { fill: "#f0f9ff", stroke: "#0284c7", accent: "#0284c7", badgeBg: "#e0f2fe", badgeText: "#0369a1", title: "#0f172a", sub: "#475569", tag: "PR" },
        cohort: { fill: "#f8fafc", stroke: "#64748b", accent: "#64748b", badgeBg: "#e2e8f0", badgeText: "#334155", title: "#0f172a", sub: "#475569", tag: "COHORT" },
        file: { fill: "#ffffff", stroke: "#cbd5e1", accent: "#64748b", badgeBg: "#f1f5f9", badgeText: "#475569", title: "#1e293b", sub: "#64748b", tag: "FILE" },
        hotspot: { fill: "#fffbeb", stroke: "#d97706", accent: "#d97706", badgeBg: "#fef3c7", badgeText: "#92400e", title: "#78350f", sub: "#b45309", tag: "HOTSPOT" },
        test: { fill: "#f0fdf4", stroke: "#16a34a", accent: "#16a34a", badgeBg: "#dcfce7", badgeText: "#166534", title: "#14532d", sub: "#15803d", tag: "TEST" },
      };

  const trunc = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

  return (
    <div
      className={cn(
        "my-3 overflow-hidden rounded-lg border",
        isDark ? "border-neutral-800 bg-[#090d12]" : "border-neutral-200 bg-white",
      )}
    >
      <div
        className={cn(
          "flex flex-wrap items-center justify-between gap-2 border-b px-3 py-1.5 text-[11px]",
          isDark ? "border-neutral-800 bg-[#11161f] text-neutral-300" : "border-neutral-200 bg-neutral-50 text-neutral-700",
        )}
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-block size-2 rounded-full bg-sky-400" />
          <span className="font-mono font-semibold tracking-tight">MERMAID · BLAST RADIUS GRAPH</span>
          <span className={cn("font-mono text-[10px]", isDark ? "text-neutral-400" : "text-neutral-500")}>
            ({nodes.length} nodes · {edges.length} edges)
          </span>
        </div>
        <button
          type="button"
          onClick={() => setShowSource((s) => !s)}
          className={cn(
            "rounded border px-2 py-0.5 font-mono text-[10.5px] transition-colors",
            isDark
              ? "border-neutral-700 bg-neutral-800/90 text-neutral-200 hover:bg-neutral-700"
              : "border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-100",
          )}
        >
          {showSource ? "View Diagram" : "Mermaid Source"}
        </button>
      </div>

      {showSource ? (
        <pre
          className={cn(
            "overflow-x-auto p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words",
            isDark ? "text-neutral-200" : "text-neutral-800",
          )}
        >
          {code}
        </pre>
      ) : (
        <div className="overflow-x-auto p-2">
          <svg
            width={layout.totalW}
            height={layout.totalH}
            viewBox={`0 0 ${layout.totalW} ${layout.totalH}`}
            className="block max-w-none"
            role="img"
            aria-label="Architecture and Blast Radius Mermaid Flowchart"
          >
            <defs>
              <marker id="mermaid-arrow-std" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 1 L 9 5 L 0 9 z" fill={isDark ? "#64748b" : "#94a3b8"} />
              </marker>
              <marker id="mermaid-arrow-hot" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 1 L 9 5 L 0 9 z" fill="#f59e0b" />
              </marker>
              <marker id="mermaid-arrow-test" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 1 L 9 5 L 0 9 z" fill="#22c55e" />
              </marker>
            </defs>

            {edges.map((e, idx) => {
              const a = layout.pos.get(e.from);
              const b = layout.pos.get(e.to);
              if (!a || !b) return null;
              const x1 = a.x + a.w;
              const y1 = a.y + a.h / 2;
              const x2 = b.x;
              const y2 = b.y + b.h / 2;
              const dx = Math.max(28, Math.abs(x2 - x1) * 0.48);
              const d = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
              const isHot = b.node.role === "hotspot" || e.dashed;
              const isTest = b.node.role === "test";
              const stroke = isHot ? "#f59e0b" : isTest ? "#22c55e" : isDark ? "#475569" : "#94a3b8";
              const marker = isHot ? "url(#mermaid-arrow-hot)" : isTest ? "url(#mermaid-arrow-test)" : "url(#mermaid-arrow-std)";
              return (
                <path
                  key={idx}
                  d={d}
                  fill="none"
                  stroke={stroke}
                  strokeWidth={isHot || isTest ? 1.75 : 1.35}
                  strokeDasharray={e.dashed ? "5 4" : undefined}
                  markerEnd={marker}
                />
              );
            })}

            {[...layout.pos.values()].map(({ x, y, w, h, node }) => {
              const st = roleStyles[node.role];
              const title = node.lines[0] || node.id;
              const sub = node.lines.slice(1).join(" · ");
              return (
                <g key={node.id} transform={`translate(${x}, ${y})`}>
                  <title>{node.lines.join("\n")}</title>
                  <rect width={w} height={h} rx={8} fill={st.fill} stroke={st.stroke} strokeWidth={1.35} />
                  <rect x={0} y={0} width={4.5} height={h} rx={2} fill={st.accent} />
                  <rect x={w - 52} y={7} width={44} height={14} rx={4} fill={st.badgeBg} />
                  <text
                    x={w - 30}
                    y={16.5}
                    textAnchor="middle"
                    fill={st.badgeText}
                    fontSize="8.5"
                    fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                    fontWeight="700"
                  >
                    {st.tag}
                  </text>
                  <text
                    x={11}
                    y={sub ? 22 : 31}
                    fill={st.title}
                    fontSize="11.5"
                    fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                    fontWeight="600"
                  >
                    {trunc(title, 23)}
                  </text>
                  {sub && (
                    <text
                      x={11}
                      y={40}
                      fill={st.sub}
                      fontSize="10"
                      fontFamily="ui-sans-serif, system-ui, sans-serif"
                    >
                      {trunc(sub, 31)}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        </div>
      )}
    </div>
  );
}

function SuggestionCodeCard({ code, isDark }: { code: string; isDark: boolean }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    try {
      navigator.clipboard?.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {}
  };

  return (
    <div
      className={cn(
        "my-2.5 overflow-hidden rounded-lg border",
        isDark ? "border-emerald-500/40 bg-[#071912]" : "border-emerald-300 bg-emerald-50/40",
      )}
    >
      <div
        className={cn(
          "flex flex-wrap items-center justify-between gap-2 border-b px-3 py-1.5 text-[11px]",
          isDark
            ? "border-emerald-500/30 bg-emerald-950/60 text-emerald-200"
            : "border-emerald-200 bg-emerald-100/70 text-emerald-900",
        )}
      >
        <div className="flex items-center gap-2">
          <span className="inline-block size-2 rounded-full bg-emerald-500" />
          <span className="font-mono font-semibold tracking-tight">Suggested Fix (suggestion)</span>
        </div>
        <button
          type="button"
          onClick={handleCopy}
          className={cn(
            "rounded border px-2 py-0.5 font-mono text-[10.5px] font-medium transition-colors",
            isDark
              ? "border-emerald-500/50 bg-emerald-900/70 text-emerald-100 hover:bg-emerald-800"
              : "border-emerald-300 bg-white text-emerald-900 hover:bg-emerald-50",
          )}
        >
          {copied ? "✓ Copied fix" : "Copy fix"}
        </button>
      </div>
      <pre
        className={cn(
          "overflow-x-auto p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words",
          isDark ? "text-emerald-200" : "text-emerald-950",
        )}
      >
        {code.split("\n").map((line, i) => (
          <div
            key={i}
            className={cn(
              "flex items-start rounded px-1.5 py-0.5",
              isDark ? "bg-emerald-500/10 text-emerald-300" : "bg-emerald-100/70 text-emerald-900",
            )}
          >
            <span className="select-none pr-2 font-bold text-emerald-500">+</span>
            <span className="flex-1">{line}</span>
          </div>
        ))}
      </pre>
    </div>
  );
}

export function MarkdownView({
  content,
  variant = "light",
  writing = false,
  cursor = false,
  duration = 2000,
  className,
}: {
  content: string;
  variant?: "light" | "dark";
  writing?: boolean;
  cursor?: boolean;
  duration?: number;
  className?: string;
}) {
  const [visible, setVisible] = useState(writing ? "" : content);
  const [done, setDone] = useState(!writing);

  useEffect(() => {
    if (!writing) {
      setVisible(content);
      setDone(true);
      return;
    }
    if (!content) {
      setVisible("");
      setDone(true);
      return;
    }
    setDone(false);
    const totalLen = content.length;
    const steps = 60;
    const chunkSize = Math.max(12, Math.ceil(totalLen / steps));
    const stepMs = Math.max(16, Math.floor(duration / steps));
    let idx = 0;
    const timer = setInterval(() => {
      idx = Math.min(totalLen, idx + chunkSize);
      setVisible(content.slice(0, idx));
      if (idx >= totalLen) {
        clearInterval(timer);
        setDone(true);
      }
    }, stepMs);
    return () => clearInterval(timer);
  }, [content, writing, duration]);

  const isDark = variant === "dark";
  const textToRender = writing ? visible : content;

  return (
    <div
      className={cn(
        "text-[13.5px] leading-relaxed break-words",
        isDark ? "text-neutral-200" : "text-neutral-800",
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h1
              className={cn(
                "mt-1 mb-3 border-b pb-2 text-base font-semibold tracking-tight",
                isDark ? "border-neutral-800 text-neutral-100" : "border-neutral-200 text-neutral-900",
              )}
            >
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2
              className={cn(
                "mt-5 mb-2 flex items-center gap-2 text-sm font-semibold tracking-wide uppercase",
                isDark ? "text-amber-400/95" : "text-neutral-900",
              )}
            >
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3
              className={cn(
                "mt-3.5 mb-1.5 text-[13.5px] font-semibold",
                isDark ? "text-neutral-100" : "text-neutral-900",
              )}
            >
              {children}
            </h3>
          ),
          p: ({ children }) => <p className="my-2 leading-relaxed">{children}</p>,
          ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>,
          ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>,
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
          blockquote: ({ children }) => (
            <blockquote
              className={cn(
                "my-2.5 border-l-2 pl-3.5 italic",
                isDark ? "border-amber-500/60 text-neutral-400" : "border-neutral-300 text-neutral-600",
              )}
            >
              {children}
            </blockquote>
          ),
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className={cn(
                "underline underline-offset-2",
                isDark ? "text-amber-400 hover:text-amber-300" : "text-brand hover:opacity-80",
              )}
            >
              {children}
            </a>
          ),
          table: ({ children }) => (
            <div className="my-3 overflow-x-auto">
              <table
                className={cn(
                  "w-full border-collapse text-xs",
                  isDark ? "border-neutral-800" : "border-neutral-200",
                )}
              >
                {children}
              </table>
            </div>
          ),
          th: ({ children }) => (
            <th
              className={cn(
                "border px-2.5 py-1.5 text-left font-semibold",
                isDark
                  ? "border-neutral-800 bg-neutral-900/90 text-neutral-200"
                  : "border-neutral-200 bg-neutral-100 text-neutral-800",
              )}
            >
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td
              className={cn(
                "border px-2.5 py-1.5 align-top",
                isDark ? "border-neutral-800 text-neutral-300" : "border-neutral-200 text-neutral-700",
              )}
            >
              {children}
            </td>
          ),
          code: ({ className: codeClass, children }) => {
            const isBlock = Boolean(codeClass && codeClass.includes("language-")) || String(children).includes("\n");
            if (!isBlock) {
              return (
                <code
                  className={cn(
                    "rounded px-1.5 py-0.5 font-mono text-[12px]",
                    isDark
                      ? "bg-neutral-800/90 text-amber-300 border border-neutral-700/70"
                      : "bg-neutral-100 text-neutral-900 border border-neutral-200/80",
                  )}
                >
                  {children}
                </code>
              );
            }
            const raw = String(children).replace(/\n$/, "");
            if (codeClass?.includes("language-mermaid")) {
              return <MermaidDiagram code={raw} isDark={isDark} />;
            }
            if (codeClass?.includes("language-suggestion")) {
              return <SuggestionCodeCard code={raw} isDark={isDark} />;
            }
            const isDiff = codeClass?.includes("language-diff");
            return (
              <pre
                className={cn(
                  "my-2.5 overflow-x-auto rounded-lg border p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words",
                  isDark
                    ? "border-neutral-800 bg-[#090d12] text-neutral-200"
                    : "border-neutral-200 bg-neutral-900 text-neutral-100",
                )}
              >
                {isDiff
                  ? raw.split("\n").map((line, i) => {
                      const tone = line.startsWith("+")
                        ? "text-emerald-400"
                        : line.startsWith("-")
                          ? "text-rose-400"
                          : line.startsWith("@@")
                            ? "text-sky-400"
                            : "";
                      return (
                        <div key={i} className={tone}>
                          {line}
                        </div>
                      );
                    })
                  : raw}
              </pre>
            );
          },
          hr: () => <hr className={cn("my-4", isDark ? "border-neutral-800" : "border-neutral-200")} />,
        }}
      >
        {textToRender}
      </ReactMarkdown>
      {cursor && (!done || writing) && (
        <span className="ml-1 inline-block h-4 w-2 translate-y-0.5 animate-pulse bg-amber-400" />
      )}
    </div>
  );
}
