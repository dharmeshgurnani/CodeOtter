#!/usr/bin/env node
import { spawn } from "node:child_process";
import { join } from "node:path";
import { existsSync } from "node:fs";

const root = join(import.meta.dirname, "..");
const isWin = process.platform === "win32";
const clientRunner = isWin ? "pnpm.cmd" : "pnpm";

console.log("\x1b[36m%s\x1b[0m", "\n🦦 Starting CodeOtter dev environment...");
console.log("\x1b[90m%s\x1b[0m", "• Backend API + PocketBase on http://localhost:4747 (PocketBase :8090)");
console.log("\x1b[90m%s\x1b[0m", "• Frontend Vite Dev Server with HMR on http://localhost:5173\n");

// Ensure web dependencies are installed
if (!existsSync(join(root, "web", "node_modules"))) {
  console.log("\x1b[33m%s\x1b[0m", "Installing web dependencies first...");
  const { execFileSync } = await import("node:child_process");
  if (isWin) {
    execFileSync("cmd.exe", ["/d", "/s", "/c", clientRunner, "-C", join(root, "web"), "install"], { stdio: "inherit" });
  } else {
    execFileSync(clientRunner, ["-C", join(root, "web"), "install"], { stdio: "inherit" });
  }
}

// 1. Backend Server (node core/server.mjs)
const server = spawn(process.execPath, [join(root, "core", "server.mjs")], {
  cwd: root,
  stdio: ["inherit", "pipe", "pipe"],
  env: { ...process.env },
});

// 2. Vite Frontend Dev Server
const webArgs = ["-C", join(root, "web"), "dev"];
const web = isWin
  ? spawn("cmd.exe", ["/d", "/s", "/c", clientRunner, ...webArgs], {
      cwd: root,
      stdio: ["inherit", "pipe", "pipe"],
      env: { ...process.env },
    })
  : spawn(clientRunner, webArgs, {
      cwd: root,
      stdio: ["inherit", "pipe", "pipe"],
      env: { ...process.env },
    });

function pipePrefixed(stream, prefix, color) {
  let buf = "";
  stream.on("data", (chunk) => {
    buf += chunk.toString();
    const lines = buf.split(/\r?\n/);
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim()) console.log(`${color}${prefix}\x1b[0m ${line}`);
    }
  });
}

pipePrefixed(server.stdout, "[server]", "\x1b[35m");
pipePrefixed(server.stderr, "[server:err]", "\x1b[31m");
pipePrefixed(web.stdout, "[vite]", "\x1b[32m");
pipePrefixed(web.stderr, "[vite:err]", "\x1b[33m");

let cleaningUp = false;
const cleanup = () => {
  if (cleaningUp) return;
  cleaningUp = true;
  try { server.kill(); } catch {}
  try { web.kill(); } catch {}
  process.exit();
};

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);
process.on("exit", cleanup);

server.on("exit", (code) => {
  if (!cleaningUp && code !== 0 && code !== null) {
    console.error(`\x1b[31m[server] exited with code ${code}\x1b[0m`);
  }
});
web.on("exit", (code) => {
  if (!cleaningUp && code !== 0 && code !== null) {
    console.error(`\x1b[31m[vite] exited with code ${code}\x1b[0m`);
  }
});
