import { useEffect, useState } from "react";
import { DitherCanvas } from "@/components/dither-canvas";

// Split login: the left column is the only way in (GitHub), the right column is showcase real estate whose content
// comes from the server (showcase.json) so sponsors, community and case studies change without a code change.
type Showcase = {
  headline: string;
  sub: string;
  groups: { title: string; items: { label: string; hint?: string; href?: string }[] }[];
};
type LoginData = { showcase: Showcase; signInAvailable: boolean; configured: boolean };

export const GitHubMark = () => (
  <svg viewBox="0 0 16 16" className="size-5" fill="currentColor" aria-hidden="true">
    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
  </svg>
);

export function LoginPage({ error, onLogin, go }: { error: string; onLogin: () => Promise<void> | void; go: (p: string) => void }) {
  const [d, setD] = useState<LoginData | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { fetch("/api/login").then((r) => r.json()).then(setD).catch(() => {}); }, []);
  const canLogin = !!d?.signInAvailable && !!d?.configured;
  const reason = !d ? "" : !d.signInAvailable ? "Sign-in is not available on this instance." : !d.configured ? "GitHub sign-in is not configured yet." : "";

  return (
    <div className="grid min-h-svh grid-cols-1 bg-white lg:grid-cols-[minmax(420px,5fr)_7fr]">
      {/* Left: the only way in */}
      <div className="flex flex-col px-8 py-8 sm:px-14">
        <a className="flex items-center gap-2.5 no-underline" onClick={() => go("/")}>
          <span className="size-7 rounded-full bg-gradient-to-br from-amber-400 to-brand" />
          <span className="text-[15px] font-semibold text-neutral-900">CodeOtter</span>
        </a>
        <div className="flex flex-1 flex-col justify-center py-16">
          <div className="w-full max-w-[380px]">
            <h1 className="text-[28px] font-semibold tracking-tight text-neutral-900">Sign in</h1>
            <p className="mt-2 text-[15px] text-neutral-600">Review pull requests for quality, blast radius and actionable comments. One account, your GitHub.</p>
            <button
              type="button"
              disabled={!canLogin || busy}
              onClick={() => { setBusy(true); Promise.resolve(onLogin()).finally(() => setBusy(false)); }}
              className="mt-8 flex h-12 w-full items-center justify-center gap-3 rounded-lg bg-neutral-900 px-4 text-[15px] font-medium text-white shadow-[0_1px_2px_rgba(0,0,0,0.12)] transition-colors hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <GitHubMark />
              {busy ? "Redirecting to GitHub…" : "Continue with GitHub"}
            </button>
            {error && <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
            {reason && !error && (
              <p className="mt-4 text-sm text-neutral-500">
                {reason}{!d?.configured && d?.signInAvailable && <> Set it up under <a className="text-brand" onClick={() => go("/settings/oauth")}>Settings / OAuth</a>.</>}
              </p>
            )}
            <p className="mt-8 text-xs leading-relaxed text-neutral-500">Only your public profile and email are requested. Reviews run on the model you configure; nothing is sent anywhere else.</p>
          </div>
        </div>
        <div className="flex gap-5 text-xs text-neutral-500">
          <a className="no-underline hover:underline" href="https://github.com/dharmeshgurnani/CodeOtter#readme" target="_blank" rel="noreferrer">Documentation</a>
          <a className="no-underline hover:underline" href="https://github.com/dharmeshgurnani/CodeOtter" target="_blank" rel="noreferrer">Source</a>
          <a className="no-underline hover:underline" href="/" onClick={(e) => { e.preventDefault(); go("/"); }}>Continue without signing in</a>
        </div>
      </div>

      {/* Right: showcase on a dithered shader */}
      <div className="relative hidden overflow-hidden bg-[#0a0a0b] text-white lg:block">
        <DitherCanvas className="absolute inset-0 h-full w-full" pixel={3} />
        <div className="absolute inset-0 bg-gradient-to-t from-[#0a0a0b] via-[#0a0a0b]/70 to-transparent" />
        <div className="relative flex h-full flex-col justify-end p-12 xl:p-16">
          {d ? (
            <>
              <h2 className="max-w-[22ch] text-[34px] font-semibold leading-[1.1] tracking-tight xl:text-[40px]">{d.showcase.headline}</h2>
              <p className="mt-3 max-w-[48ch] text-[15px] text-white/70">{d.showcase.sub}</p>
              <div className="mt-10 grid grid-cols-1 gap-8 xl:grid-cols-3">
                {d.showcase.groups.map((g) => (
                  <div key={g.title}>
                    <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/50">{g.title}</div>
                    <ul className="space-y-2">
                      {g.items.map((it) => (
                        <li key={it.label}>
                          {it.href ? (
                            <a className="group block no-underline" href={it.href} target="_blank" rel="noreferrer">
                              <span className="text-[15px] font-medium text-white/90 group-hover:text-white group-hover:underline">{it.label}</span>
                              {it.hint && <span className="block text-[13px] text-white/50">{it.hint}</span>}
                            </a>
                          ) : (
                            <>
                              <span className="text-[15px] font-medium text-white/90">{it.label}</span>
                              {it.hint && <span className="block text-[13px] text-white/50">{it.hint}</span>}
                            </>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
