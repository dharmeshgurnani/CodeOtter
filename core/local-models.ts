// Local models: downloads, runtimes and the sidecar processes that serve them.
import { execFileSync, spawn, spawnSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { existsSync, readdirSync, mkdirSync, createWriteStream, renameSync, rmSync } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import type { TransformCallback } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { join } from "node:path";
import { fileSize, modelPath, modelReady, runtimeAssets, runtimeBin, runtimeDir, RUNTIMES } from "./providers.ts";
import { store } from "./store.ts";

// Catalog entries from models.json: local models of either kind and the runtimes that serve them.
export type ModelKind = "s1" | "llm";
export interface LocalModel {
  id: string;
  kind: ModelKind;
  runtime: string;
  label: string;
  maker: string;
  repo: string;
  icon: string;
  file?: string; // a single GGUF ...
  files?: string[]; // ... or a checkpoint directory (`dir`) of several files
  dir?: string;
  sizeMB: number;
  modelId: string;
  contextTokens: number;
  contextChars: number;
  maxQuestions?: number;
  license: string;
  notes: string;
  api?: string;
}
interface RuntimeBase { version: string; license: string; notes?: string; }
export interface BinaryRuntime extends RuntimeBase { kind?: undefined; source: string; bin: string; assets: Record<string, string[]>; }
export interface PythonRuntime extends RuntimeBase { kind: "python"; script: string; pip: string[]; pipIndex?: string; }
export type Runtime = BinaryRuntime | PythonRuntime;
export interface ModelCatalog { runtimes: Record<string, Runtime>; models: LocalModel[]; }
export interface DownloadState { active: boolean; done: number; total: number; error: string; label?: string; }
export interface LocalStatus { state: "downloading" | "error" | "ready" | "missing"; text: string; }
export interface Sidecar { proc: ChildProcess | null; id: string | null; port: number; ready: boolean; device: string; lastUse: number; starting: Promise<number> | null; }

const errMessage = (e: unknown): string => (e as Error).message; // thrown values here are Errors (fetch, fs, spawn)

// Downloads with progress and resume. One at a time per target; state readable by the settings page.
export const downloads = new Map<string, DownloadState>();
async function downloadFile(url: string, dest: string, key: string): Promise<void> {
  if (downloads.get(key)?.active) return;
  const st: DownloadState = { active: true, done: 0, total: 0, error: "" };
  downloads.set(key, st);
  try {
    mkdirSync(join(dest, ".."), { recursive: true });
    const part = `${dest}.part`;
    let have = fileSize(part);
    // Idle timeout instead of a fixed total: a multi-GB file is allowed to take hours, a stalled socket is cut in a minute.
    const ctl = new AbortController();
    let idle = setTimeout(() => ctl.abort(new Error("Download stalled: no data for 60 s")), 60000);
    const touch = () => { clearTimeout(idle); idle = setTimeout(() => ctl.abort(new Error("Download stalled: no data for 60 s")), 60000); };
    let res = await fetch(url, { headers: have ? { range: `bytes=${have}-` } : {}, redirect: "follow", signal: ctl.signal });
    if (res.status === 416) {
      // the partial file is not resumable (already complete, or the server changed): start over once
      rmSync(part, { force: true });
      have = 0;
      res = await fetch(url, { redirect: "follow", signal: ctl.signal });
    }
    if (!res.ok && res.status !== 206) throw new Error(`Download failed: HTTP ${res.status}`);
    const resumed = res.status === 206;
    st.done = resumed ? have : 0;
    st.total = st.done + Number(res.headers.get("content-length") || 0);
    const out = createWriteStream(part, { flags: resumed ? "a" : "w" });
    const counter = new (class extends (await import("node:stream")).Transform { override _transform(chunk: Buffer, _e: BufferEncoding, cb: TransformCallback) { st.done += chunk.length; touch(); cb(null, chunk); } })();
    try {
      await pipeline(Readable.fromWeb(res.body as NodeReadableStream<Uint8Array>), counter, out);
    } finally {
      clearTimeout(idle);
    }
    renameSync(part, dest);
  } catch (e) {
    st.error = errMessage(e);
  } finally {
    st.active = false;
  }
}
// Runtimes: tried in catalog order per platform (e.g. a GPU build first, a CPU build as fallback).
const TAR = process.platform === "win32" && existsSync(join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe")) ? join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe") : "tar";
let pythonFound: string | null = null; // probing up to four interpreters blocks the event loop for seconds; do it once per process
export function findPython(): string {
  if (pythonFound !== null) return pythonFound;
  for (const cand of [process.env.PR_SCORER_PYTHON, "python3", "python", "py"].filter((x): x is string => !!x)) {
    const r = spawnSync(cand, cand === "py" ? ["-3", "-c", "import sys;print(sys.version_info[:2]>=(3,10))"] : ["-c", "import sys;print(sys.version_info[:2]>=(3,10))"], { encoding: "utf8", timeout: 20000, windowsHide: true });
    if (r.status === 0 && /True/.test(r.stdout)) return (pythonFound = cand);
  }
  return (pythonFound = "");
}
const pyReady = new Set<string>();
export const venvPython = (name: string): string => join(runtimeDir(name), "venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
export async function ensureRuntime(name: string): Promise<string> {
  const rt: Runtime = RUNTIMES[name];
  if (rt.kind === "python") {
    // Python runtime: a private venv with the packages from the catalog. The install shows as a "download" on the page.
    const py = venvPython(name);
    if (pyReady.has(name)) return py;
    if (existsSync(py) && spawnSync(py, ["-c", "import torch, transformers"], { timeout: 120000, windowsHide: true }).status === 0) { pyReady.add(name); return py; }
    const sys = findPython();
    if (!sys) throw new Error("Python 3.10+ is needed for this model and was not found on PATH (set PR_SCORER_PYTHON)");
    const key = `runtime:${name}`;
    if (downloads.get(key)?.active) throw new Error("Runtime install already in progress");
    const st: DownloadState = { active: true, done: 0, total: 0, error: "", label: "Installing Python packages" };
    downloads.set(key, st);
    try {
      mkdirSync(runtimeDir(name), { recursive: true });
      const run = (cmd: string, args: string[]) => new Promise<void>((resolve, reject) => {
        // 30 minutes: a stalled pip would otherwise report "install already in progress" until the server restarts
        const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
        let log = "";
        let timedOut = false;
        const timer = setTimeout(() => { timedOut = true; try { p.kill("SIGKILL"); } catch {} }, 1800000);
        timer.unref?.();
        p.stdout.on("data", (d) => { log = (log + d).slice(-2000); });
        p.stderr.on("data", (d) => { log = (log + d).slice(-2000); });
        p.on("error", (e) => { clearTimeout(timer); reject(e); });
        p.on("exit", (code) => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`${args.slice(0, 3).join(" ")} failed: ${timedOut ? "timed out after 30 min" : log.trim().split("\n").pop()}`)); });
      });
      if (!existsSync(py)) await run(sys, sys === "py" ? ["-3", "-m", "venv", join(runtimeDir(name), "venv")] : ["-m", "venv", join(runtimeDir(name), "venv")]);
      st.label = "Installing Python packages (PyTorch, Transformers)";
      await run(py, ["-m", "pip", "install", "--quiet", "--upgrade", "pip"]);
      await run(py, ["-m", "pip", "install", "--quiet", ...rt.pip, ...(rt.pipIndex ? ["--extra-index-url", rt.pipIndex] : [])]);
      pyReady.add(name);
      return py;
    } catch (e) {
      st.error = errMessage(e);
      throw e;
    } finally {
      st.active = false;
    }
  }
  const bin = runtimeBin(name);
  if (existsSync(bin)) return bin;
  const assets = runtimeAssets(name);
  if (!assets.length) throw new Error(`No ${name} runtime for ${process.platform}-${process.arch}; use a hosted model`);
  mkdirSync(runtimeDir(name), { recursive: true });
  let last = "";
  for (const asset of assets) {
    const archive = join(runtimeDir(name), asset);
    try {
      if (!existsSync(archive)) await downloadFile(`${rt.source}${asset}`, archive, `runtime:${name}`);
      if (downloads.get(`runtime:${name}`)?.error) throw new Error(downloads.get(`runtime:${name}`)?.error);
      // bsdtar reads zip and tar.gz alike; run from the directory with a relative name so drive letters never look like hosts
      execFileSync(TAR, ["-xf", asset], { cwd: runtimeDir(name) });
      // some archives unpack into a subfolder; hoist the binary and its libraries
      if (!existsSync(bin)) for (const d of readdirSync(runtimeDir(name))) { const inner = join(runtimeDir(name), d, process.platform === "win32" ? `${rt.bin}.exe` : rt.bin); if (existsSync(inner)) for (const f of readdirSync(join(runtimeDir(name), d))) renameSync(join(runtimeDir(name), d, f), join(runtimeDir(name), f)); }
      if (existsSync(bin)) return bin;
      last = `${asset} did not contain ${rt.bin}`;
    } catch (e) {
      last = errMessage(e);
      rmSync(archive, { force: true });
    }
  }
  throw new Error(`Could not install the ${name} runtime: ${last}`);
}
export async function downloadModel(m: LocalModel): Promise<void> {
  if (!m.files) return downloadFile(`https://huggingface.co/${m.repo}/resolve/main/${m.file}`, modelPath(m), m.id);
  // several files: one progress entry, files in catalog order (the big one last)
  const st: DownloadState = { active: true, done: 0, total: m.sizeMB * 1e6, error: "" };
  downloads.set(m.id, st);
  try {
    for (const f of m.files) {
      const dest = join(modelPath(m), f);
      if (existsSync(dest)) { st.done += fileSize(dest); continue; }
      const sub = `${m.id}/${f}`;
      const before = st.done;
      const tick = setInterval(() => { const d = downloads.get(sub); if (d) st.done = before + d.done; }, 500);
      await downloadFile(`https://huggingface.co/${m.repo}/resolve/main/${f}`, dest, sub);
      clearInterval(tick);
      const d = downloads.get(sub);
      if (d?.error) throw new Error(d.error);
      st.done = before + fileSize(dest);
    }
  } catch (e) {
    st.error = errMessage(e);
  } finally {
    st.active = false;
  }
}
export const localStatus = (m: LocalModel): LocalStatus => {
  const d = downloads.get(m.id);
  const rd = downloads.get(`runtime:${m.runtime}`);
  const sc = sidecars[m.kind];
  if (d?.active) return { state: "downloading", text: `Downloading ${d.total ? Math.round((d.done / d.total) * 100) : 0}% (${Math.round(d.done / 1e6)} of ${d.total ? Math.round(d.total / 1e6) : m.sizeMB} MB)` };
  if (rd?.active && modelReady(m)) return { state: "downloading", text: rd.label || "Installing runtime" };
  if (d?.error) return { state: "error", text: `Download failed: ${d.error}` };
  if (modelReady(m)) return { state: "ready", text: sc.proc && sc.id === m.id ? `Ready · running on ${sc.device || "local"}` : "Ready" };
  return { state: "missing", text: `Not downloaded (${m.sizeMB} MB, ${m.license})` };
};

// One sidecar per kind (typed engine on 47110, language model on 47120). Started on first use, stopped after 15 idle minutes.
export const sidecars: Record<ModelKind, Sidecar> = {
  s1: { proc: null, id: null, port: 47110, ready: false, device: "", lastUse: 0, starting: null },
  llm: { proc: null, id: null, port: 47120, ready: false, device: "", lastUse: 0, starting: null },
};
export function stopSidecar(kind: ModelKind): void {
  const sc = sidecars[kind];
  if (sc.proc) { try { sc.proc.kill(); } catch {} }
  Object.assign(sc, { proc: null, id: null, ready: false, device: "", starting: null });
}
export const stopSidecars = () => { stopSidecar("s1"); stopSidecar("llm"); };
// The runtime's "auto" device takes Vulkan device 0, which on laptops is often the integrated GPU. Read the device list
// from `laya info` once and prefer a discrete GPU. S1_DEVICE overrides (cpu, vulkan:1, cuda, metal ...).
// Vulkan device index of a discrete GPU (laptops list the integrated one first). Cached; S1_DEVICE / LLM_DEVICE override.
let gpuIndex: number | null = null;
function discreteGpu(bin: string, m: LocalModel): number {
  if (gpuIndex !== null) return gpuIndex;
  const r = spawnSync(bin, ["info", modelPath(m), "--device", "auto"], { encoding: "utf8", timeout: 120000, windowsHide: true });
  const out = String(r.stdout || "") + String(r.stderr || "");
  const devs = [...out.matchAll(/ggml_vulkan: (\d+) = ([^|\n]+)/g)].map((x) => ({ i: Number(x[1]), name: x[2].trim() }));
  const discrete = devs.find((d) => /nvidia|geforce|radeon|amd|\barc\b/i.test(d.name) && !/intel\(r\) (uhd|iris)/i.test(d.name));
  gpuIndex = discrete ? discrete.i : -1;
  return gpuIndex;
}
function discreteGpuLlama(bin: string): number {
  if (gpuIndex !== null) return gpuIndex;
  const r = spawnSync(bin, ["--list-devices"], { encoding: "utf8", timeout: 60000, windowsHide: true });
  const out = String(r.stdout || "") + String(r.stderr || "");
  const devs = [...out.matchAll(/Vulkan(\d+): ([^(\n]+)/g)].map((x) => ({ i: Number(x[1]), name: x[2].trim() }));
  const discrete = devs.find((d) => /nvidia|geforce|radeon|amd|\barc\b/i.test(d.name) && !/intel\(r\) (uhd|iris)/i.test(d.name));
  gpuIndex = discrete ? discrete.i : -1;
  return gpuIndex;
}
function sidecarArgs(m: LocalModel, bin: string, port: number): string[] {
  const rt: Runtime = RUNTIMES[m.runtime];
  if (rt.kind === "python") return [join(import.meta.dirname, rt.script), "--model", modelPath(m), "--port", String(port), "--device", process.env.LLM_DEVICE || "auto"];
  if (m.runtime === "laya") {
    const dev = process.env.S1_DEVICE || (discreteGpu(bin, m) >= 0 ? `vulkan:${gpuIndex}` : "auto");
    return ["serve", modelPath(m), "--port", String(port), "--device", dev];
  }
  // llama-server: OpenAI-compatible chat at /v1/chat/completions
  const args = ["-m", modelPath(m), "--host", "127.0.0.1", "--port", String(port), "-c", String(m.contextTokens || 8192), "-ngl", "99"];
  const dev = process.env.LLM_DEVICE || (discreteGpuLlama(bin) >= 0 ? `Vulkan${gpuIndex}` : "");
  if (dev === "cpu") args.push("-ngl", "0");
  else if (dev) args.push("--device", dev);
  return args;
}
export async function ensureSidecar(m: LocalModel): Promise<number> {
  const sc = sidecars[m.kind];
  if (sc.proc && sc.id === m.id && sc.ready) { sc.lastUse = Date.now(); return sc.port; }
  if (sc.starting && sc.id === m.id) return sc.starting;
  stopSidecar(m.kind);
  const bin = await ensureRuntime(m.runtime);
  if (!modelReady(m)) throw new Error(`${m.label} is not downloaded: open Settings / Local models`);
  sc.id = m.id;
  sc.starting = (async () => {
    const proc = spawn(bin, sidecarArgs(m, bin, sc.port), { stdio: ["ignore", "pipe", "pipe"], windowsHide: true, cwd: RUNTIMES[m.runtime].kind === "python" ? import.meta.dirname : runtimeDir(m.runtime) });
    sc.proc = proc;
    let log = "";
    proc.stderr.on("data", (d) => { log = (log + d).slice(-4000); });
    proc.stdout.on("data", (d) => { log = (log + d).slice(-4000); });
    proc.on("error", (e) => { log = `${log}\n${e.message}`.slice(-4000); if (sc.proc === proc) Object.assign(sc, { proc: null, ready: false, starting: null }); });
    proc.on("exit", () => { if (sc.proc === proc) Object.assign(sc, { proc: null, ready: false, starting: null }); });
    for (let i = 0; i < 300; i++) {
      if (!sc.proc) throw new Error(`Local model runtime exited: ${log.trim().split("\n").pop() || "no output"}`);
      try {
        const h = (await (await fetch(`http://127.0.0.1:${sc.port}/health`, { signal: AbortSignal.timeout(2000) })).json()) as { status?: string; device?: string };
        if (h.status === "ok") {
          sc.ready = true; sc.device = h.device || (m.runtime === "llama" ? ((gpuIndex ?? 0) >= 0 ? `Vulkan${gpuIndex}` : "cpu") : ""); sc.lastUse = Date.now(); sc.starting = null;
          // remembered so Local models can say where a runtime ran while it is idle (sidecars stop after 15 idle minutes)
          if (sc.device) store.getSetting("runtimeDevices").then((d) => store.setSetting("runtimeDevices", { ...(d || {}), [m.runtime]: { device: sc.device, model: m.id } })).catch(() => {});
          return sc.port;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 1000));
    }
    stopSidecar(m.kind);
    throw new Error("Local model runtime did not become ready in time");
  })();
  return sc.starting;
}
setInterval(() => { for (const k of ["s1", "llm"] as const) { const sc = sidecars[k]; if (sc.proc && sc.ready && Date.now() - sc.lastUse > 15 * 60e3) stopSidecar(k); } }, 60e3).unref();
process.on("exit", stopSidecars);
