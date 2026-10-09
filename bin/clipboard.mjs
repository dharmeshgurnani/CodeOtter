import { spawn } from "node:child_process";

function pipeTo(command, args, content) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, timeout: 5000, stdio: ["pipe", "ignore", "ignore"] });
    child.once("error", reject);
    child.once("close", code => code === 0 ? resolve() : reject(new Error("Clipboard unavailable")));
    child.stdin.on("error", reject);
    child.stdin.end(content, "utf8");
  });
}

export async function copyText(content, program) {
  if (process.platform === "win32") {
    await pipeTo("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", "[Console]::InputEncoding = [System.Text.Encoding]::UTF8; Set-Clipboard -Value ([Console]::In.ReadToEnd())"], content);
    return "Copied";
  }
  if (process.platform === "darwin") {
    await pipeTo("pbcopy", [], content);
    return "Copied";
  }
  for (const [command, args] of [["wl-copy", []], ["xclip", ["-selection", "clipboard"]]]) {
    try { await pipeTo(command, args, content); return "Copied"; } catch {}
  }
  // Remote/sandbox terminals can forward clipboard writes through OSC 52.
  program.flush();
  program.output.write(`\x1b]52;c;${Buffer.from(content, "utf8").toString("base64")}\x07`);
  return "Sent to terminal clipboard";
}
