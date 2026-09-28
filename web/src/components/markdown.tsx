import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

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
