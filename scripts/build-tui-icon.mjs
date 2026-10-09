// Build-time only: the running CLI needs no SVG renderer or native image package.
import { Resvg } from "@resvg/resvg-js";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { createHash } from "node:crypto";

// Hashed in LF form so a Windows checkout (CRLF) and CI (LF) agree.
const source = Buffer.from(readFileSync(new URL("../web/public/favicon.svg", import.meta.url), "utf8").replace(/\r\n/g, "\n"));
const image = new Resvg(source, { fitTo: { mode: "width", value: 128 }, font: { loadSystemFonts: false } }).render();
mkdirSync(new URL("../tui/assets/", import.meta.url), { recursive: true });
writeFileSync(new URL("../tui/assets/favicon.json", import.meta.url), JSON.stringify({
  source: "web/public/favicon.svg", sha256: createHash("sha256").update(source).digest("hex"),
  width: image.width, height: image.height, rgba: deflateSync(image.pixels).toString("base64"),
}) + "\n");
console.log("Built terminal favicon from web/public/favicon.svg");
