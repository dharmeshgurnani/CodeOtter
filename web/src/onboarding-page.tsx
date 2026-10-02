import { useEffect, useState } from "react";
import { Check, Plus, RotateCw, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InfoTip } from "@/components/info-tip";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { DitherCanvas } from "@/components/dither-canvas";
import { Toaster, toast } from "sonner";
import { GitHubMark, ForgejoMark, GiteaMark } from "./login-page";

const initials = (s: string) =>
  s
    .split(/[\s/_-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("") || "?";

type OnboardingStatus = {
  completed: boolean;
  appUrl: string;
  hasPb: boolean;
  primaryProvider: string;
  forges: Record<string, { url: string; configured: boolean }>;
  oauth: any;
  repos: string[];
  s1: { provider: string; model: string; baseUrl: string; hasKey: boolean };
  llm: { provider: string; model: string; baseUrl: string; hasKey: boolean };
  localModels: {
    s1: { id: string; label: string; sizeMB: number; status: string; info?: string }[];
    llm: { id: string; label: string; sizeMB: number; status: string }[];
  };
};

type RepoChoice = { id: string; label: string; org: string };

export function OnboardingPage({
  onComplete,
}: {
  onComplete: (targetOrg: string) => void;
  go?: (path: string) => void;
}) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<OnboardingStatus | null>(null);
  const [error, setError] = useState("");
  const [successBanner, setSuccessBanner] = useState("");
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [showManualGh, setShowManualGh] = useState(false);

  // Step 1: Provider State
  const [provider, setProvider] = useState<"github" | "forgejo" | "gitea">("github");
  const [ghToken, setGhToken] = useState("");
  const [ghClientId, setGhClientId] = useState("");
  const [ghClientSecret, setGhClientSecret] = useState("");
  const [forgeUrl, setForgeUrl] = useState("");
  const [forgeToken, setForgeToken] = useState("");
  const [forgeClientId, setForgeClientId] = useState("");
  const [forgeClientSecret, setForgeClientSecret] = useState("");

  // Step 2: Model State
  const [modelMode, setModelMode] = useState<"local" | "cloud">("local");
  // Local choices (Laya for S1, Microsoft CodeReviewer as recommended default for LLM)
  const [localS1, setLocalS1] = useState("kev");
  const [localLlm, setLocalLlm] = useState("codereviewer");
  // Cloud choices
  const [cloudS1Provider, setCloudS1Provider] = useState("jev");
  const [cloudS1Key, setCloudS1Key] = useState("");
  const [cloudS1Url, setCloudS1Url] = useState("");
  const [cloudLlmProvider, setCloudLlmProvider] = useState("anthropic");
  const [cloudLlmModel, setCloudLlmModel] = useState("claude-3-5-sonnet-latest");
  const [cloudLlmKey, setCloudLlmKey] = useState("");
  const [cloudLlmUrl, setCloudLlmUrl] = useState("");

  // Step 3: Repositories State
  const [repoChoices, setRepoChoices] = useState<RepoChoice[]>([]);
  const [selectedRepos, setSelectedRepos] = useState<string[]>([]);
  const [repoSearch, setRepoSearch] = useState("");
  const [reposLoading, setReposLoading] = useState(false);

  // Initial Data Load & Query Parameter Handling
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const connectedParam = urlParams.get("connected");
    const errorParam = urlParams.get("error");
    const stepParam = urlParams.get("step");

    if (errorParam) {
      setError(errorParam);
    }
    if (connectedParam) {
      setSuccessBanner("GitHub App successfully created and connected.");
      setStep(2);
    } else if (stepParam) {
      const s = parseInt(stepParam, 10);
      if (s >= 1 && s <= 3) setStep(s as 1 | 2 | 3);
    }

    fetch("/api/onboarding")
      .then((r) => r.json())
      .then((data: OnboardingStatus) => {
        setStatus(data);
        if (data.primaryProvider === "forgejo" || data.primaryProvider === "gitea") {
          setProvider(data.primaryProvider);
          const f = data.forges[data.primaryProvider];
          if (f?.url) setForgeUrl(f.url);
        }
        if (data.repos?.length) setSelectedRepos(data.repos);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  // Fetch Available Repositories for Step 3
  const loadRepositories = () => {
    setReposLoading(true);
    fetch("/api/onboarding/repos")
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d.repos)) {
          setRepoChoices(d.repos);
          if (selectedRepos.length === 0 && d.repos.length > 0) {
            setSelectedRepos([d.repos[0].id]);
          }
        }
      })
      .catch(() => {})
      .finally(() => setReposLoading(false));
  };

  useEffect(() => {
    if (step === 3) {
      loadRepositories();
    }
  }, [step]);

  // 1-Click Automated GitHub App Manifest Flow (just like Settings -> OAuth)
  const handleCreateGitHubApp = async () => {
    setError("");
    setBusy(true);
    try {
      const res = await fetch("/api/settings/oauth/connect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ returnTo: "/onboarding" }),
      });
      const data = await res.json();
      if (data.submit) {
        const form = document.createElement("form");
        form.method = "POST";
        form.action = data.submit.url;
        for (const [k, v] of Object.entries(data.submit.fields as Record<string, string>)) {
          const inp = document.createElement("input");
          inp.type = "hidden";
          inp.name = k;
          inp.value = v;
          form.appendChild(inp);
        }
        document.body.appendChild(form);
        form.submit();
        return;
      }
      if (data.error) {
        throw new Error(data.error);
      }
      await handleSaveStep1();
    } catch (err: any) {
      setError(err.message || "Failed to initiate GitHub App creation");
      setBusy(false);
    }
  };

  // Test Provider Connection
  const handleTestProvider = async () => {
    setError("");
    setBusy(true);
    setTestResult(null);
    try {
      const payload: any = { provider };
      if (provider === "github") {
        if (ghToken) payload.token = ghToken;
      } else {
        payload.url = forgeUrl;
        payload.token = forgeToken;
      }
      const res = await fetch("/api/onboarding/test-provider", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setTestResult({ ok: false, message: data.error || data.message || "Connection failed" });
      } else {
        setTestResult({ ok: true, message: data.message || "Connection successful" });
      }
    } catch (err: any) {
      setTestResult({ ok: false, message: err.message || "Connection failed" });
    } finally {
      setBusy(false);
    }
  };

  // Step 1 -> Step 2
  const handleSaveStep1 = async () => {
    setError("");
    setBusy(true);
    try {
      const payload: any = { provider };
      if (provider === "github") {
        if (ghToken) payload.token = ghToken;
        if (ghClientId) payload.clientId = ghClientId;
        if (ghClientSecret) payload.clientSecret = ghClientSecret;
      } else {
        if (!forgeUrl.trim()) throw new Error("Server URL is required");
        payload.url = forgeUrl;
        payload.token = forgeToken;
        payload.clientId = forgeClientId;
        payload.clientSecret = forgeClientSecret;
      }

      const res = await fetch("/api/onboarding/save-provider", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || "Failed to save provider configuration");
      }
      setTestResult(null);
      setStep(2);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  // Step 2 -> Step 3
  const handleSaveStep2 = async () => {
    setError("");
    setBusy(true);
    try {
      const payload: any = {};
      if (modelMode === "local") {
        payload.s1 = { provider: localS1 };
        payload.llm = { provider: localLlm };
      } else {
        payload.s1 = {
          provider: cloudS1Provider,
          apiKey: cloudS1Key,
          baseUrl: cloudS1Url,
        };
        payload.llm = {
          provider: cloudLlmProvider,
          model: cloudLlmModel,
          apiKey: cloudLlmKey,
          baseUrl: cloudLlmUrl,
        };
      }

      const res = await fetch("/api/onboarding/save-models", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || "Failed to save model configuration");
      }

      if (modelMode === "local") {
        toast.info("Downloading local model checkpoints in background...");
      }

      setStep(3);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  // Step 3 Finish -> Save Repos, Complete, and drop straight to Dashboard
  const handleSaveStep3 = async () => {
    setError("");
    if (selectedRepos.length === 0) {
      setError("Please select at least one repository to onboard.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/onboarding/save-repos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repos: selectedRepos }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || "Failed to save repositories");
      }

      const compRes = await fetch("/api/onboarding/complete", { method: "POST" });
      const data = await compRes.json().catch(() => ({}));
      localStorage.setItem("pr-scorer.onboarding_done", "true");
      onComplete(data.org || selectedRepos[0]?.split("/")[0] || "");
    } catch (err: any) {
      setError(err.message || "Failed to complete setup");
      setBusy(false);
    }
  };

  const addRepo = (id: string) => {
    setSelectedRepos((prev) => (prev.includes(id) ? prev : [...prev, id]));
  };

  const removeRepo = (id: string) => {
    setSelectedRepos((prev) => prev.filter((r) => r !== id));
  };

  const handleAddFromSearch = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const name = repoSearch.trim().replace(/^https:\/\/github\.com\//, "").replace(/\/+$/, "");
    if (!name) return;
    if (!selectedRepos.includes(name)) {
      setSelectedRepos((prev) => [...prev, name]);
    }
    if (!repoChoices.some((c) => c.id === name)) {
      setRepoChoices((prev) => [{ id: name, label: name, org: name.split("/")[0] || "" }, ...prev]);
    }
    setRepoSearch("");
  };

  const availableRepos = repoChoices.filter((r) => !selectedRepos.includes(r.id));
  const filteredRepos = availableRepos.filter(
    (r) =>
      r.label.toLowerCase().includes(repoSearch.toLowerCase()) ||
      r.id.toLowerCase().includes(repoSearch.toLowerCase())
  );

  const callbackUrl = `${status?.appUrl || window.location.origin}/auth/callback`;

  if (loading) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-white p-8">
        <div className="flex flex-col items-center gap-3">
          <img src="/codeotter-icon.svg" alt="CodeOtter" className="size-10 animate-pulse rounded-lg shadow-xs" />
          <p className="text-sm font-medium text-neutral-600">Loading setup wizard...</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <Toaster richColors position="top-right" />
      <div className="grid h-svh max-h-svh overflow-hidden grid-cols-1 bg-white lg:grid-cols-[minmax(560px,7fr)_5fr]">
        {/* Left: Interactive Wizard (Scrollable) */}
        <div className="flex h-full flex-col overflow-y-auto px-6 py-6 sm:px-14 sm:py-10">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <img src="/codeotter-icon.svg" alt="CodeOtter" className="size-8 rounded-lg shadow-xs" />
            <span className="text-[17px] font-semibold tracking-tight text-neutral-900">CodeOtter Setup</span>
          </div>
          <span className="rounded-full bg-neutral-100 px-3 py-1 text-xs font-medium text-neutral-600">
            Step {step} of 3
          </span>
        </div>

        {/* Stepper Progress Indicator */}
        <div className="mt-6 grid grid-cols-3 gap-2">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className={`h-1.5 rounded-full transition-colors ${
                i <= step ? "bg-neutral-900" : "bg-neutral-200"
              }`}
            />
          ))}
        </div>

        <div className="mt-8 flex-1">
          {successBanner && (
            <div className="mb-6 flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 p-3.5 text-sm text-emerald-800">
              <span>{successBanner}</span>
              <button
                type="button"
                onClick={() => setSuccessBanner("")}
                className="text-emerald-700 hover:text-emerald-900 text-xs font-semibold cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          )}

          {error && (
            <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-3.5 text-sm text-red-800">
              {error}
            </div>
          )}

          {/* ========================================================================= */}
          {/* STEP 1: Git & OAuth Provider                                              */}
          {/* ========================================================================= */}
          {step === 1 && (
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-neutral-900 sm:text-3xl">
                Choose your Primary Git &amp; OAuth Provider
              </h1>
              <p className="mt-2 text-[15px] text-neutral-600">
                Select where your onboarded repositories and developer identities live. If you use multiple forges, you can easily connect and configure the rest later in Admin &rarr; OAuth.
              </p>

              {/* Provider Selection Cards (Using Dashboard Nested Card Geometry) */}
              <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
                {[
                  {
                    id: "github" as const,
                    label: "GitHub",
                    badge: "Cloud / Enterprise",
                    hint: "Cloud or GitHub Enterprise with 1-click automated App creation",
                    icon: (
                      <div className="flex size-7 items-center justify-center rounded-md bg-neutral-900 text-white p-1">
                        <GitHubMark />
                      </div>
                    ),
                  },
                  {
                    id: "forgejo" as const,
                    label: "Forgejo",
                    badge: "Self-Hosted",
                    hint: "Self-hosted community forge with REST API & OAuth integration",
                    icon: (
                      <div className="flex size-7 items-center justify-center rounded-md bg-[#FF5B00] text-white p-1">
                        <ForgejoMark />
                      </div>
                    ),
                  },
                  {
                    id: "gitea" as const,
                    label: "Gitea",
                    badge: "Self-Hosted",
                    hint: "Self-hosted lightweight Git server with PKCE OAuth sign-in",
                    icon: (
                      <div className="flex size-7 items-center justify-center rounded-md bg-[#609926] text-white p-1">
                        <GiteaMark />
                      </div>
                    ),
                  },
                ].map((p) => {
                  const isSelected = provider === p.id;
                  return (
                    <div
                      key={p.id}
                      onClick={() => {
                        setProvider(p.id);
                        setTestResult(null);
                      }}
                      className={`flex flex-col rounded-xl border transition-all cursor-pointer select-none ${
                        isSelected
                          ? "border-neutral-900 bg-neutral-100 ring-1 ring-neutral-900 shadow-xs"
                          : "border-neutral-200/90 bg-neutral-50 hover:border-neutral-300 shadow-[0_1px_2px_rgba(0,0,0,0.03)]"
                      }`}
                    >
                      <div className="flex items-center justify-between px-4 pt-3 pb-2.5">
                        <div className="flex items-center gap-2.5">
                          {p.icon}
                          <span className="text-[15px] font-semibold text-neutral-900">{p.label}</span>
                        </div>
                        <span className="rounded-md bg-neutral-200/70 px-2 py-0.5 text-[11px] font-medium text-neutral-700">
                          {p.badge}
                        </span>
                      </div>
                      <div className="mx-1.5 mb-1.5 flex flex-1 flex-col rounded-lg border border-neutral-200 bg-white p-3.5">
                        <div className="text-xs text-neutral-600 leading-relaxed min-h-[36px]">{p.hint}</div>
                        <div className="mt-3 flex items-center justify-between border-t border-neutral-100 pt-2.5">
                          <span className="text-[11px] font-medium text-neutral-500">
                            {isSelected ? "Active Provider" : "Click to select"}
                          </span>
                          <div
                            className={`flex size-4 items-center justify-center rounded-full border transition-colors ${
                              isSelected
                                ? "border-neutral-900 bg-neutral-900 text-white"
                                : "border-neutral-300 bg-white"
                            }`}
                          >
                            {isSelected && <div className="size-1.5 rounded-full bg-white" />}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Provider Config Details */}
              <div className="mt-6 rounded-xl border border-neutral-200 bg-neutral-50/50 p-5">
                {provider === "github" ? (
                  <div className="space-y-4">
                    {/* 1-Click Manifest Action (Fastest & Simplest) */}
                    <div className="rounded-xl border border-neutral-300 bg-white p-4 shadow-xs">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <h2 className="text-sm font-semibold text-neutral-900">1-Click Automated Setup</h2>
                          <p className="mt-0.5 text-xs text-neutral-600">
                            Creates and installs a dedicated GitHub App to automatically discover all your public &amp; private repositories.
                          </p>
                        </div>
                        <Button
                          type="button"
                          size="default"
                          disabled={busy}
                          onClick={handleCreateGitHubApp}
                          className="shrink-0 font-medium"
                        >
                          {busy ? "Opening GitHub..." : "Create & Connect GitHub App \u2192"}
                        </Button>
                      </div>
                    </div>

                    {/* Manual Fallback Option */}
                    <div className="pt-2">
                      <button
                        type="button"
                        onClick={() => setShowManualGh(!showManualGh)}
                        className="text-xs font-medium text-neutral-600 hover:text-neutral-900 underline underline-offset-2 cursor-pointer"
                      >
                        {showManualGh ? "Hide manual credentials" : "Or configure manually / Personal Access Token \u2193"}
                      </button>

                      {showManualGh && (
                        <div className="mt-4 space-y-4 rounded-lg border border-neutral-200 bg-white p-4">
                          <div>
                            <label className="block text-xs font-medium text-neutral-700">OAuth Callback URL</label>
                            <input
                              type="text"
                              readOnly
                              value={callbackUrl}
                              className="mt-1 w-full rounded-lg border border-neutral-200 bg-neutral-100 px-3 py-2 text-xs font-mono text-neutral-700 select-all"
                            />
                          </div>
                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <div>
                              <label className="block text-xs font-medium text-neutral-700">Client ID (OAuth)</label>
                              <input
                                type="text"
                                value={ghClientId}
                                onChange={(e) => setGhClientId(e.target.value)}
                                placeholder="Ov23..."
                                className="mt-1 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 focus:border-neutral-900 focus:outline-hidden"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-neutral-700">Client Secret (OAuth)</label>
                              <input
                                type="password"
                                value={ghClientSecret}
                                onChange={(e) => setGhClientSecret(e.target.value)}
                                placeholder="secret..."
                                className="mt-1 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 focus:border-neutral-900 focus:outline-hidden"
                              />
                            </div>
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-neutral-700">Personal Access Token (Optional for discovery)</label>
                            <input
                              type="password"
                              value={ghToken}
                              onChange={(e) => setGhToken(e.target.value)}
                              placeholder="ghp_... or gho_..."
                              className="mt-1 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 focus:border-neutral-900 focus:outline-hidden"
                            />
                          </div>
                          <div className="flex items-center justify-between pt-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={busy}
                              onClick={handleTestProvider}
                            >
                              {busy ? "Testing..." : "Test Connection"}
                            </Button>
                            {testResult && (
                              <span
                                className={`text-xs font-medium ${
                                  testResult.ok ? "text-emerald-700" : "text-red-700"
                                }`}
                              >
                                {testResult.message}
                              </span>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <h2 className="text-sm font-semibold text-neutral-900">
                      {provider === "forgejo" ? "Forgejo" : "Gitea"} Server Connection
                    </h2>
                    <div>
                      <label className="block text-xs font-medium text-neutral-700">Server Origin URL *</label>
                      <input
                        type="url"
                        value={forgeUrl}
                        onChange={(e) => setForgeUrl(e.target.value)}
                        placeholder={provider === "forgejo" ? "https://forgejo.company.internal" : "https://gitea.company.internal"}
                        className="mt-1 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 focus:border-neutral-900 focus:outline-hidden"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-neutral-700">Repository Access Token (Required for reviews)</label>
                      <input
                        type="password"
                        value={forgeToken}
                        onChange={(e) => setForgeToken(e.target.value)}
                        placeholder="Paste personal access token"
                        className="mt-1 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 focus:border-neutral-900 focus:outline-hidden"
                      />
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div>
                        <div className="flex items-center justify-between">
                          <label className="block text-xs font-medium text-neutral-700">OAuth Client ID (Optional)</label>
                          {forgeUrl && (
                            <a
                              href={`${forgeUrl}/user/settings/applications`}
                              target="_blank"
                              rel="noreferrer"
                              className="text-[11px] text-blue-600 hover:underline"
                            >
                              Create OAuth App &rarr;
                            </a>
                          )}
                        </div>
                        <input
                          type="text"
                          value={forgeClientId}
                          onChange={(e) => setForgeClientId(e.target.value)}
                          placeholder="Client ID from Settings / Applications"
                          className="mt-1 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 focus:border-neutral-900 focus:outline-hidden"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-neutral-700">OAuth Client Secret (Optional)</label>
                        <input
                          type="password"
                          value={forgeClientSecret}
                          onChange={(e) => setForgeClientSecret(e.target.value)}
                          placeholder="Client Secret"
                          className="mt-1 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 focus:border-neutral-900 focus:outline-hidden"
                        />
                      </div>
                    </div>
                    <div className="flex items-center justify-between pt-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={handleTestProvider}
                      >
                        {busy ? "Testing..." : "Test Connection"}
                      </Button>
                      {testResult && (
                        <span
                          className={`text-xs font-medium ${
                            testResult.ok ? "text-emerald-700" : "text-red-700"
                          }`}
                        >
                          {testResult.message}
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <div className="mt-8 flex justify-end">
                <Button size="lg" disabled={busy} onClick={handleSaveStep1}>
                  Next: Configure AI Models &rarr;
                </Button>
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* STEP 2: AI Review Engine (System 1 + LLM)                                 */}
          {/* ========================================================================= */}
          {step === 2 && (
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-neutral-900 sm:text-3xl">
                Configure Dual-Engine AI Models
              </h1>
              <p className="mt-2 text-[15px] text-neutral-600">
                CodeOtter operates two concurrent engines: <strong>System 1</strong> for typed rubrics &amp; merge gates, and <strong>Language Model (LLM)</strong> for narrative walkthroughs &amp; suggestions.
              </p>

              {/* Mode Toggle (No Emojis) */}
              <div className="mt-6 flex rounded-lg border border-neutral-200 bg-neutral-100 p-1">
                <button
                  type="button"
                  onClick={() => setModelMode("local")}
                  className={`flex-1 rounded-md py-2 text-center text-sm font-medium transition-all cursor-pointer ${
                    modelMode === "local" ? "bg-white text-neutral-900 shadow-xs" : "text-neutral-600 hover:text-neutral-900"
                  }`}
                >
                  Local Models (100% Offline)
                </button>
                <button
                  type="button"
                  onClick={() => setModelMode("cloud")}
                  className={`flex-1 rounded-md py-2 text-center text-sm font-medium transition-all cursor-pointer ${
                    modelMode === "cloud" ? "bg-white text-neutral-900 shadow-xs" : "text-neutral-600 hover:text-neutral-900"
                  }`}
                >
                  Cloud APIs (BYOK)
                </button>
              </div>

              {modelMode === "local" ? (
                <div className="mt-5 space-y-6">
                  {/* System 1 Model Selection (Kev Default) */}
                  <div>
                    <div className="mb-2">
                      <label className="block text-xs font-semibold text-neutral-900">
                        System 1 Model
                      </label>
                      <p className="mt-0.5 text-xs text-neutral-600">
                        Evaluates calibrated 0–100 scores (Quality, Blast Radius, Risk, Tests) and deterministic pre-merge safety gates.
                      </p>
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      {[
                        {
                          id: "kev",
                          name: "Kev 0.8B (S1)",
                          maker: "Jared Palmer",
                          icon: "https://cdn-avatars.huggingface.co/v1/production/uploads/6215ca5692c0ecfba9186921/hrRM50-6XcdWgg2AKpENG.jpeg",
                          size: "828 MB",
                          speed: "High Precision",
                          desc: "Qwen3.5-0.8B decision model. Deeper nuance for complex pull requests.",
                        },
{
                          id: "laya",
                          name: "Laya typed-decisions",
                          maker: "Convai Innovations",
                          icon: "https://cdn-avatars.huggingface.co/v1/production/uploads/1596903074565-noauth.jpeg",
                          size: "455 MB",
                          speed: "Instant CPU / GPU",
                          desc: "421M encoder. Deterministic rubric scoring, safety gates & blast radius evaluation.",
                        },
                                              ].map((m) => {
                        const isSelected = localS1 === m.id;
                        return (
                          <div
                            key={m.id}
                            onClick={() => setLocalS1(m.id)}
                            className={`flex flex-col rounded-xl border transition-all cursor-pointer select-none ${
                              isSelected
                                ? "border-neutral-900 bg-neutral-100 ring-1 ring-neutral-900 shadow-xs"
                                : "border-neutral-200/90 bg-neutral-50 hover:border-neutral-300 shadow-[0_1px_2px_rgba(0,0,0,0.03)]"
                            }`}
                          >
                            <div className="flex items-center justify-between px-4 pt-3 pb-2.5">
                              <div className="flex items-center gap-2.5">
                                <Avatar className="size-6 shrink-0 rounded-md border border-neutral-200 bg-white">
                                  <AvatarImage src={m.icon} alt={m.maker} className="object-contain p-0.5" />
                                  <AvatarFallback className="rounded-md text-[10px] font-semibold">{m.name.slice(0, 2)}</AvatarFallback>
                                </Avatar>
                                <div>
                                  <span className="text-sm font-semibold text-neutral-900">{m.name}</span>
                                  {(() => { const info = status?.localModels?.s1.find((x) => x.id === m.id)?.info; return info ? <span className="ml-1.5"><InfoTip text={info} /></span> : null; })()}
                                  <span className="block text-[11px] text-neutral-500">{m.maker}</span>
                                </div>
                              </div>
                              <div className="flex flex-col items-end">
                                <span className="rounded-md bg-neutral-200/70 px-2 py-0.5 text-[11px] font-medium text-neutral-700">
                                  {m.size}
                                </span>
                              </div>
                            </div>
                            <div className="mx-1.5 mb-1.5 flex flex-1 flex-col rounded-lg border border-neutral-200 bg-white p-3.5">
                              <div className="text-xs text-neutral-600 leading-relaxed min-h-[32px]">{m.desc}</div>
                              <div className="mt-3 flex items-center justify-between border-t border-neutral-100 pt-2.5">
                                <span className="text-[11px] font-medium text-neutral-500">{m.speed}</span>
                                <div
                                  className={`flex size-4 items-center justify-center rounded-full border transition-colors ${
                                    isSelected
                                      ? "border-neutral-900 bg-neutral-900 text-white"
                                      : "border-neutral-300 bg-white"
                                  }`}
                                >
                                  {isSelected && <div className="size-1.5 rounded-full bg-white" />}
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Language Model Selection (Microsoft CodeReviewer Pre-selected, 2 cards per row) */}
                  <div>
                    <div className="mb-2">
                      <label className="block text-xs font-semibold text-neutral-900">
                        Language Model (LLM)
                      </label>
                      <p className="mt-0.5 text-xs text-neutral-600">
                        Writes executive summary, file cohort walkthroughs, and line-anchored actionable comments with committable fixes.
                      </p>
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      {[
                        {
                          id: "codereviewer",
                          name: "CodeReviewer",
                          maker: "Microsoft Research",
                          icon: "https://cdn-avatars.huggingface.co/v1/production/uploads/1583646260758-5e64858c87403103f9f1055d.png",
                          size: "895 MB",
                          role: "Diff comments & fixes",
                          desc: "Pre-trained code review model. Writes inline hunk comments and fixes.",
                        },
                        {
                          id: "qwen-coder-1.5b",
                          name: "Qwen2.5-Coder 1.5B",
                          maker: "Alibaba Qwen",
                          icon: "https://cdn-avatars.huggingface.co/v1/production/uploads/6215ca5692c0ecfba9186921/hrRM50-6XcdWgg2AKpENG.jpeg",
                          size: "1.1 GB",
                          role: "Fast laptop model",
                          desc: "Lightweight, fast PR summary and file walkthrough comments.",
                        },
                        {
                          id: "qwen-coder-7b",
                          name: "Qwen2.5-Coder 7B",
                          maker: "Alibaba Qwen",
                          icon: "https://cdn-avatars.huggingface.co/v1/production/uploads/6215ca5692c0ecfba9186921/hrRM50-6XcdWgg2AKpENG.jpeg",
                          size: "4.7 GB",
                          role: "Full staff reviewer",
                          desc: "Comprehensive code critique with committable inline suggestions.",
                        },
                      ].map((m) => {
                        const isSelected = localLlm === m.id;
                        return (
                          <div
                            key={m.id}
                            onClick={() => setLocalLlm(m.id)}
                            className={`flex flex-col rounded-xl border transition-all cursor-pointer select-none ${
                              isSelected
                                ? "border-neutral-900 bg-neutral-100 ring-1 ring-neutral-900 shadow-xs"
                                : "border-neutral-200/90 bg-neutral-50 hover:border-neutral-300 shadow-[0_1px_2px_rgba(0,0,0,0.03)]"
                            }`}
                          >
                            <div className="flex items-center justify-between px-4 pt-3 pb-2.5">
                              <div className="flex items-center gap-2.5">
                                <Avatar className="size-6 shrink-0 rounded-md border border-neutral-200 bg-white">
                                  <AvatarImage src={m.icon} alt={m.maker} className="object-contain p-0.5" />
                                  <AvatarFallback className="rounded-md text-[10px] font-semibold">{m.name.slice(0, 2)}</AvatarFallback>
                                </Avatar>
                                <div>
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-sm font-semibold text-neutral-900">{m.name}</span>
                                  </div>
                                  <span className="block text-[11px] text-neutral-500">{m.maker}</span>
                                </div>
                              </div>
                              <div className="flex flex-col items-end">
                                <span className="rounded-md bg-neutral-200/70 px-2 py-0.5 text-[11px] font-medium text-neutral-700">
                                  {m.size}
                                </span>
                              </div>
                            </div>
                            <div className="mx-1.5 mb-1.5 flex flex-1 flex-col rounded-lg border border-neutral-200 bg-white p-3.5">
                              <div className="text-xs text-neutral-600 leading-relaxed min-h-[32px]">{m.desc}</div>
                              <div className="mt-3 flex items-center justify-between border-t border-neutral-100 pt-2.5">
                                <span className="text-[11px] font-medium text-neutral-500">{m.role}</span>
                                <div
                                  className={`flex size-4 items-center justify-center rounded-full border transition-colors ${
                                    isSelected
                                      ? "border-neutral-900 bg-neutral-900 text-white"
                                      : "border-neutral-300 bg-white"
                                  }`}
                                >
                                  {isSelected && <div className="size-1.5 rounded-full bg-white" />}
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="mt-5 space-y-4">
                  {/* Cloud System 1 */}
                  <div className="rounded-xl border border-neutral-200 p-4">
                    <h2 className="text-xs font-semibold text-neutral-900">System 1 Provider</h2>
                    <p className="mt-0.5 text-xs text-neutral-600">
                      Evaluates calibrated 0–100 scores (Quality, Blast Radius, Risk, Tests) and deterministic pre-merge safety gates.
                    </p>
                    <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div>
                        <label className="block text-xs font-medium text-neutral-700">Provider</label>
                        <select
                          value={cloudS1Provider}
                          onChange={(e) => setCloudS1Provider(e.target.value)}
                          className="mt-1 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900"
                        >
                          <option value="jev">TypeSafe Jev (Cloud)</option>
                          <option value="jev_openrouter">OpenRouter (TypeSafe Jev)</option>
                          <option value="custom">Custom System 1 Endpoint</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-neutral-700">API Key</label>
                        <input
                          type="password"
                          value={cloudS1Key}
                          onChange={(e) => setCloudS1Key(e.target.value)}
                          placeholder="Paste API key"
                          className="mt-1 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900"
                        />
                      </div>
                    </div>
                    {cloudS1Provider === "custom" && (
                      <div className="mt-3">
                        <label className="block text-xs font-medium text-neutral-700">Custom Base URL</label>
                        <input
                          type="text"
                          value={cloudS1Url}
                          onChange={(e) => setCloudS1Url(e.target.value)}
                          placeholder="http://127.0.0.1:8080/v1"
                          className="mt-1 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900"
                        />
                      </div>
                    )}
                  </div>

                  {/* Cloud LLM */}
                  <div className="rounded-xl border border-neutral-200 p-4">
                    <h2 className="text-xs font-semibold text-neutral-900">Language Model (LLM) Provider</h2>
                    <p className="mt-0.5 text-xs text-neutral-600">
                      Writes executive summary, file cohort walkthroughs, and line-anchored actionable comments with committable fixes.
                    </p>
                    <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                      <div>
                        <label className="block text-xs font-medium text-neutral-700">Provider</label>
                        <select
                          value={cloudS1Provider}
                          onChange={(e) => setCloudS1Provider(e.target.value)}
                          className="mt-1 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900"
                        >
                          <option value="jev">TypeSafe Jev (Cloud)</option>
                          <option value="jev_openrouter">OpenRouter (TypeSafe Jev)</option>
                          <option value="custom">Custom System 1 Endpoint</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-neutral-700">API Key</label>
                        <input
                          type="password"
                          value={cloudS1Key}
                          onChange={(e) => setCloudS1Key(e.target.value)}
                          placeholder="Paste API key"
                          className="mt-1 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900"
                        />
                      </div>
                    </div>
                    {cloudS1Provider === "custom" && (
                      <div className="mt-3">
                        <label className="block text-xs font-medium text-neutral-700">Custom Base URL</label>
                        <input
                          type="text"
                          value={cloudS1Url}
                          onChange={(e) => setCloudS1Url(e.target.value)}
                          placeholder="http://127.0.0.1:8080/v1"
                          className="mt-1 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900"
                        />
                      </div>
                    )}
                  </div>

                  {/* Cloud LLM */}
                  <div className="rounded-xl border border-neutral-200 p-4">
                    <h2 className="text-xs font-semibold text-neutral-900">Language Model Provider</h2>
                    <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
                      <div>
                        <label className="block text-xs font-medium text-neutral-700">Provider</label>
                        <select
                          value={cloudLlmProvider}
                          onChange={(e) => setCloudLlmProvider(e.target.value)}
                          className="mt-1 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900"
                        >
                          <option value="anthropic">Anthropic (Claude)</option>
                          <option value="openai">OpenAI (GPT-4o/5)</option>
                          <option value="minimax">MiniMax</option>
                          <option value="openrouter">OpenRouter</option>
                          <option value="ollama">Ollama (Local Server)</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-neutral-700">Model Name</label>
                        <input
                          type="text"
                          value={cloudLlmModel}
                          onChange={(e) => setCloudLlmModel(e.target.value)}
                          placeholder="claude-3-5-sonnet-latest"
                          className="mt-1 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-neutral-700">API Key</label>
                        <input
                          type="password"
                          value={cloudLlmKey}
                          onChange={(e) => setCloudLlmKey(e.target.value)}
                          placeholder="Paste API key"
                          className="mt-1 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900"
                        />
                      </div>
                    </div>
                    {cloudLlmProvider === "ollama" && (
                      <div className="mt-3">
                        <label className="block text-xs font-medium text-neutral-700">Ollama Server Base URL</label>
                        <input
                          type="text"
                          value={cloudLlmUrl}
                          onChange={(e) => setCloudLlmUrl(e.target.value)}
                          placeholder="http://localhost:11434/v1"
                          className="mt-1 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900"
                        />
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className="mt-8 flex justify-between">
                <Button variant="outline" onClick={() => setStep(1)}>
                  &larr; Back
                </Button>
                <Button size="lg" disabled={busy} onClick={handleSaveStep2}>
                  Next: Connect Repositories &rarr;
                </Button>
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* STEP 3: Connect Repositories                                              */}
          {/* ========================================================================= */}
          {step === 3 && (
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-neutral-900 sm:text-3xl">
                Select Repositories to Onboard
              </h1>
              <p className="mt-2 text-[15px] text-neutral-600">
                Choose the repositories you want CodeOtter to monitor. Pull requests will be scored, reviewed, and tracked automatically.
              </p>

              {/* Added Repositories Section (Shows when at least 1 repo is selected) */}
              {selectedRepos.length > 0 && (
                <div className="mt-6 rounded-xl border border-neutral-200 bg-neutral-50/70 p-4">
                  <div className="flex items-center justify-between pb-3">
                    <div className="flex items-center gap-2">
                      <Check className="size-4 text-emerald-600" />
                      <span className="text-xs font-semibold text-neutral-900">
                        Added Repositories ({selectedRepos.length})
                      </span>
                    </div>
                    <span className="text-[11px] text-neutral-500">
                      Ready for automated PR intelligence
                    </span>
                  </div>

                  <ul className="divide-y divide-neutral-200/80 rounded-lg border border-neutral-200 bg-white">
                    {selectedRepos.map((repoId) => {
                      const choice = repoChoices.find((c) => c.id === repoId);
                      const label = choice?.label || repoId;
                      const org = choice?.org || repoId.split("/")[0];
                      return (
                        <li
                          key={repoId}
                          className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-sm"
                        >
                          <div className="flex min-w-0 items-center gap-2.5">
                            <Avatar className="size-7 shrink-0 rounded-md border border-neutral-200 bg-white">
                              <AvatarFallback className="rounded-md text-[10px] font-semibold">
                                {initials(label)}
                              </AvatarFallback>
                            </Avatar>
                            <div className="min-w-0">
                              <span className="block truncate font-medium text-neutral-900">
                                {label}
                              </span>
                              <span className="block text-[11px] text-neutral-500">
                                {org}
                              </span>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 border border-emerald-200/60">
                              Added
                            </span>
                            <button
                              type="button"
                              aria-label={`Remove ${label}`}
                              onClick={() => removeRepo(repoId)}
                              className="shrink-0 rounded-md p-1 text-neutral-400 hover:bg-neutral-100 hover:text-red-700 cursor-pointer transition-colors"
                            >
                              <X className="size-4" />
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              {/* Available Repositories Header & Search Bar */}
              <div className="mt-6">
                <div className="flex items-center justify-between mb-2.5">
                  <label className="block text-xs font-semibold text-neutral-900">
                    Available Repositories
                  </label>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-neutral-500">
                      {filteredRepos.length} available
                    </span>
                    <button
                      type="button"
                      onClick={() => loadRepositories()}
                      disabled={reposLoading}
                      title="Refresh repositories"
                      className="rounded-md p-1 text-neutral-500 hover:text-neutral-900 hover:bg-neutral-100 cursor-pointer disabled:opacity-50"
                    >
                      <RotateCw className={`size-3.5 ${reposLoading ? "animate-spin" : ""}`} />
                    </button>
                  </div>
                </div>

                <form onSubmit={handleAddFromSearch} className="relative flex items-center">
                  <Search className="absolute left-3 size-4 text-neutral-400 pointer-events-none" />
                  <input
                    type="text"
                    placeholder="Search or type owner/repo name..."
                    value={repoSearch}
                    onChange={(e) => setRepoSearch(e.target.value)}
                    className="w-full rounded-lg border border-neutral-300 bg-white pl-9 pr-20 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-900 focus:outline-hidden shadow-xs"
                  />
                  <div className="absolute right-1.5 flex items-center gap-1">
                    {repoSearch && (
                      <button
                        type="button"
                        onClick={() => setRepoSearch("")}
                        className="rounded-md p-1 text-neutral-400 hover:text-neutral-700 cursor-pointer"
                      >
                        <X className="size-3.5" />
                      </button>
                    )}
                    {repoSearch.trim() && (
                      <Button type="submit" size="sm" className="h-7 px-2.5 text-xs font-medium">
                        <Plus className="size-3.5" />
                        Add
                      </Button>
                    )}
                  </div>
                </form>
              </div>

              {/* Repositories Discovery List */}
              <div className="mt-3 max-h-[300px] overflow-y-auto rounded-xl border border-neutral-200 bg-white shadow-xs divide-y divide-neutral-100">
                {reposLoading ? (
                  <div className="p-8 text-center text-sm text-neutral-500">
                    Discovering repositories from connected provider...
                  </div>
                ) : (
                  <>
                    {/* If typing something not yet in choices, show instant Add row */}
                    {repoSearch.trim() && !repoChoices.some((c) => c.id.toLowerCase() === repoSearch.trim().toLowerCase()) && (
                      <div className="flex items-center justify-between px-4 py-3 text-sm bg-neutral-50/70">
                        <div className="flex min-w-0 items-center gap-3">
                          <Avatar className="size-7 shrink-0 rounded-md border border-neutral-200 bg-white">
                            <AvatarFallback className="rounded-md text-[10px] font-semibold">
                              {initials(repoSearch.trim())}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <span className="block truncate font-medium text-neutral-900">
                              {repoSearch.trim()}
                            </span>
                            <span className="block text-[11px] text-neutral-500">
                              Add repository
                            </span>
                          </div>
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => handleAddFromSearch()}
                          className="h-8 gap-1 text-xs font-medium shrink-0"
                        >
                          <Plus className="size-3.5" />
                          Add
                        </Button>
                      </div>
                    )}

                    {filteredRepos.length === 0 && !repoSearch.trim() ? (
                      <div className="p-8 text-center text-sm text-neutral-500">
                        {availableRepos.length === 0 && selectedRepos.length > 0
                          ? "All discovered repositories have been added. Type an owner/repo in the search bar above to add another repository."
                          : "No repositories found matching your search. Type an owner/repo above and click Add."}
                      </div>
                    ) : (
                      filteredRepos.map((r) => {
                        return (
                          <div
                            key={r.id}
                            onClick={() => addRepo(r.id)}
                            className="flex items-center justify-between px-4 py-3 text-sm transition-colors hover:bg-neutral-50/60 cursor-pointer select-none"
                          >
                            <div className="flex min-w-0 items-center gap-3">
                              <Avatar className="size-7 shrink-0 rounded-md border border-neutral-200 bg-white">
                                <AvatarFallback className="rounded-md text-[10px] font-semibold">
                                  {initials(r.label)}
                                </AvatarFallback>
                              </Avatar>
                              <div className="min-w-0">
                                <span className="block truncate font-medium text-neutral-900">
                                  {r.label}
                                </span>
                                <span className="block text-[11px] text-neutral-500">
                                  {r.org}
                                </span>
                              </div>
                            </div>

                            <div className="ml-3 shrink-0" onClick={(e) => e.stopPropagation()}>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => addRepo(r.id)}
                                className="h-8 gap-1 text-xs font-medium hover:bg-neutral-900 hover:text-white transition-colors"
                              >
                                <Plus className="size-3.5" />
                                Add
                              </Button>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </>
                )}
              </div>

              <div className="mt-8 flex justify-between">
                <Button variant="outline" onClick={() => setStep(2)}>
                  &larr; Back
                </Button>
                <Button
                  size="lg"
                  disabled={busy || selectedRepos.length === 0}
                  onClick={handleSaveStep3}
                >
                  {busy ? "Finalizing..." : "Go to Dashboard \u2192"}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Right: Fixed Non-Scrolling Showcase, Sponsors & News */}
      <div className="relative hidden h-full overflow-hidden bg-[#0a0a0b] text-white lg:flex lg:flex-col justify-end p-12 xl:p-16">
        <DitherCanvas className="absolute inset-0 h-full w-full pointer-events-none" pixel={3} />
        <div className="absolute inset-0 bg-gradient-to-t from-[#0a0a0b] via-[#0a0a0b]/70 to-transparent pointer-events-none" />
        <div className="relative z-10 space-y-6">
          <span className="inline-block rounded-md bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-white">
            Autonomous PR Intelligence
          </span>
          <h2 className="max-w-[22ch] text-[32px] font-semibold leading-[1.15] tracking-tight xl:text-[38px]">
            Calibrated review scores, blast radius &amp; merge gates on your hardware.
          </h2>
          <p className="max-w-[46ch] text-[15px] leading-relaxed text-white/70">
            Run 100% offline with zero external cloud dependencies or connect hosted models of your choice.
          </p>

          {/* Sponsors & Community Section */}
          <div className="pt-4 border-t border-white/10 grid grid-cols-1 gap-6 sm:grid-cols-2">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/50 mb-2.5">
                Sponsors &amp; Support
              </div>
              <div className="space-y-2 text-xs">
                <a
                  href="https://github.com/sponsors/dharmeshgurnani"
                  target="_blank"
                  rel="noreferrer"
                  className="block text-white/90 hover:text-white hover:underline font-medium"
                >
                  GitHub Sponsors &rarr;
                  <span className="block text-white/50 text-[11px] font-normal">Back autonomous AI development</span>
                </a>
                <a
                  href="https://github.com/dharmeshgurnani/CodeOtter"
                  target="_blank"
                  rel="noreferrer"
                  className="block text-white/90 hover:text-white hover:underline font-medium"
                >
                  Star on GitHub &rarr;
                  <span className="block text-white/50 text-[11px] font-normal">Support the open-source project</span>
                </a>
              </div>
            </div>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/50 mb-2.5">
                Latest Features
              </div>
              <div className="space-y-2 text-xs">
                <span className="block text-white/90 font-medium">
                  Outside-Diff Call Graph Fan-Out
                  <span className="block text-white/50 text-[11px] font-normal">Cross-file blast radius slicing</span>
                </span>
                <span className="block text-white/90 font-medium">
                  Native CLI &amp; MCP Server
                  <span className="block text-white/50 text-[11px] font-normal">CI gating via codeotter command</span>
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </>
);
}
