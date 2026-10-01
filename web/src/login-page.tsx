import { useEffect, useState } from "react";
import { DitherCanvas } from "@/components/dither-canvas";

// Split login: the left column is the only way in (GitHub), the right column is showcase real estate whose content
// comes from the server (showcase.json) so sponsors, community and case studies change without a code change.
type Showcase = {
  headline: string;
  sub: string;
  groups: { title: string; items: { label: string; hint?: string; href?: string }[] }[];
};
type LoginData = { showcase: Showcase; signInAvailable: boolean; configured: boolean; providers: { id: string; label: string }[] };

export const GitHubMark = () => (
  <svg viewBox="0 0 16 16" className="size-5" fill="currentColor" aria-hidden="true">
    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
  </svg>
);

export const ForgejoMark = () => (
  <svg viewBox="0 0 24 24" className="size-5" fill="currentColor" aria-hidden="true">
    <path d="M16.7773 0c1.6018 0 2.9004 1.2986 2.9004 2.9005s-1.2986 2.9004-2.9004 2.9004c-1.0854 0-2.0315-.596-2.5288-1.4787H12.91c-2.3322 0-4.2272 1.8718-4.2649 4.195l-.0007 2.1175a7.0759 7.0759 0 0 1 4.148-1.4205l.1176-.001 1.3385.0002c.4973-.8827 1.4434-1.4788 2.5288-1.4788 1.6018 0 2.9004 1.2986 2.9004 2.9005s-1.2986 2.9004-2.9004 2.9004c-1.0854 0-2.0315-.596-2.5288-1.4787H12.91c-2.3322 0-4.2272 1.8718-4.2649 4.195l-.0007 2.319c.8827.4973 1.4788 1.4434 1.4788 2.5287 0 1.602-1.2986 2.9005-2.9005 2.9005-1.6018 0-2.9004-1.2986-2.9004-2.9005 0-1.0853.596-2.0314 1.4788-2.5287l-.0002-9.9831c0-3.887 3.1195-7.0453 6.9915-7.108l.1176-.001h1.3385C14.7458.5962 15.692 0 16.7773 0ZM7.2227 19.9052c-.6596 0-1.1943.5347-1.1943 1.1943s.5347 1.1943 1.1943 1.1943 1.1944-.5347 1.1944-1.1943-.5348-1.1943-1.1944-1.1943Zm9.5546-10.4644c-.6596 0-1.1944.5347-1.1944 1.1943s.5348 1.1943 1.1944 1.1943c.6596 0 1.1943-.5347 1.1943-1.1943s-.5347-1.1943-1.1943-1.1943Zm0-7.7346c-.6596 0-1.1944.5347-1.1944 1.1943s.5348 1.1943 1.1944 1.1943c.6596 0 1.1943-.5347 1.1943-1.1943s-.5347-1.1943-1.1943-1.1943Z" />
  </svg>
);

export const GiteaMark = () => (
  <svg viewBox="0 0 24 24" className="size-5" fill="currentColor" aria-hidden="true">
    <path d="M4.209 4.603c-.247 0-.525.02-.84.088-.333.07-1.28.283-2.054 1.027C-.403 7.25.035 9.685.089 10.052c.065.446.263 1.687 1.21 2.768 1.749 2.141 5.513 2.092 5.513 2.092s.462 1.103 1.168 2.119c.955 1.263 1.936 2.248 2.89 2.367 2.406 0 7.212-.004 7.212-.004s.458.004 1.08-.394c.535-.324 1.013-.893 1.013-.893s.492-.527 1.18-1.73c.21-.37.385-.729.538-1.068 0 0 2.107-4.471 2.107-8.823-.042-1.318-.367-1.55-.443-1.627-.156-.156-.366-.153-.366-.153s-4.475.252-6.792.306c-.508.011-1.012.023-1.512.027v4.474l-.634-.301c0-1.39-.004-4.17-.004-4.17-1.107.016-3.405-.084-3.405-.084s-5.399-.27-5.987-.324c-.187-.011-.401-.032-.648-.032zm.354 1.832h.111s.271 2.269.6 3.597C5.549 11.147 6.22 13 6.22 13s-.996-.119-1.641-.348c-.99-.324-1.409-.714-1.409-.714s-.73-.511-1.096-1.52C1.444 8.73 2.021 7.7 2.021 7.7s.32-.859 1.47-1.145c.395-.106.863-.12 1.072-.12zm8.33 2.554c.26.003.509.127.509.127l.868.422-.529 1.075a.686.686 0 0 0-.614.359.685.685 0 0 0 .072.756l-.939 1.924a.69.69 0 0 0-.66.527.687.687 0 0 0 .347.763.686.686 0 0 0 .867-.206.688.688 0 0 0-.069-.882l.916-1.874a.667.667 0 0 0 .237-.02.657.657 0 0 0 .271-.137 8.826 8.826 0 0 1 1.016.512.761.761 0 0 1 .286.282c.073.21-.073.569-.073.569-.087.29-.702 1.55-.702 1.55a.692.692 0 0 0-.676.477.681.681 0 1 0 1.157-.252c.073-.141.141-.282.214-.431.19-.397.515-1.16.515-1.16.035-.066.218-.394.103-.814-.095-.435-.48-.638-.48-.638-.467-.301-1.116-.58-1.116-.58s0-.156-.042-.27a.688.688 0 0 0-.148-.241l.516-1.062 2.89 1.401s.48.218.583.619c.073.282-.019.534-.069.657-.24.587-2.1 4.317-2.1 4.317s-.232.554-.748.588a1.065 1.065 0 0 1-.393-.045l-.202-.08-4.31-2.1s-.417-.218-.49-.596c-.083-.31.104-.691.104-.691l2.073-4.272s.183-.37.466-.497a.855.855 0 0 1 .35-.077z" />
  </svg>
);

export function LoginPage({ error, onLogin, go }: { error: string; onLogin: (provider: string) => Promise<void> | void; go: (p: string) => void }) {
  const [d, setD] = useState<LoginData | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { fetch("/api/login").then((r) => r.json()).then(setD).catch(() => {}); }, []);
  const canLogin = !!d?.signInAvailable && !!d?.configured;
  const reason = !d ? "" : !d.signInAvailable ? "Sign-in is not available on this instance." : !d.configured ? "Sign-in is not configured yet." : "";

  return (
    <div className="grid min-h-svh grid-cols-1 bg-white lg:grid-cols-[minmax(420px,5fr)_7fr]">
      {/* Left: the only way in */}
      <div className="flex flex-col px-5 py-6 sm:px-14 sm:py-8">
        <a className="flex items-center gap-2.5 no-underline cursor-pointer" onClick={() => go("/")}>
          <img src="/codeotter-icon.svg" alt="CodeOtter" className="size-7 rounded-lg shadow-xs" />
          <span className="text-[15px] font-semibold text-neutral-900">CodeOtter</span>
        </a>
        <div className="flex flex-1 flex-col justify-center py-10 sm:py-16">
          <div className="w-full max-w-[380px]">
            <h1 className="text-[28px] font-semibold tracking-tight text-neutral-900">Sign in</h1>
            <p className="mt-2 text-[15px] text-neutral-600">Review pull requests for quality, blast radius and actionable comments.</p>
            {!d && <div className="mt-8 h-12 w-full animate-pulse rounded-lg bg-neutral-200" />}
            {(d?.providers ?? []).map((provider) => <button
              key={provider.id}
              type="button"
              disabled={!canLogin || busy}
              onClick={() => { setBusy(true); Promise.resolve(onLogin(provider.id)).finally(() => setBusy(false)); }}
              className="mt-8 flex h-12 w-full items-center justify-center gap-3 rounded-lg bg-neutral-900 px-4 text-[15px] font-medium text-white shadow-[0_1px_2px_rgba(0,0,0,0.12)] transition-colors hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {provider.id === "github" && <GitHubMark />}
              {provider.id === "forgejo" && <ForgejoMark />}
              {provider.id === "gitea" && <GiteaMark />}
              {`Continue with ${provider.label}`}
            </button>)}
            {error && <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
            {reason && !error && (
              <p className="mt-4 text-sm text-neutral-500">
                {reason}{!d?.configured && d?.signInAvailable && <> Set it up under <a className="text-brand" onClick={() => go("/settings/oauth")}>Settings / OAuth</a>.</>}
              </p>
            )}
            <p className="mt-8 text-xs leading-relaxed text-neutral-500">Only your public profile and email are requested. Reviews run on the model you configure; nothing is sent anywhere else.</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-neutral-500">
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
