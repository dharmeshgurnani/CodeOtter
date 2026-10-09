import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

const asset = JSON.parse(readFileSync(new URL("./assets/favicon.json", import.meta.url), "utf8"));
const pixels = inflateSync(Buffer.from(asset.rgba, "base64"));

// SIXEL stores six vertical pixels per character, with separate palette planes.
export function faviconSixel(size) {
  size = Math.max(12, Math.min(128, Math.floor(size)));
  const palette = new Map();
  const indexed = [];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const offset = (Math.floor(y * asset.height / size) * asset.width + Math.floor(x * asset.width / size)) * 4;
    if (pixels[offset + 3] < 128) { indexed.push(-1); continue; }
    const color = [...pixels.subarray(offset, offset + 3)].map(v => Math.round(v / 17) * 17).join(",");
    if (!palette.has(color)) palette.set(color, palette.size);
    indexed.push(palette.get(color));
  }
  let output = `\x1bP0;1;0q"1;1;${size};${size}`;
  for (const [color, id] of palette) output += `#${id};2;${color.split(",").map(v => Math.round(Number(v) * 100 / 255)).join(";")}`;
  for (let y = 0; y < size; y += 6) {
    for (const id of palette.values()) {
      let row = "";
      for (let x = 0; x < size; x++) {
        let bits = 0;
        for (let bit = 0; bit < 6 && y + bit < size; bit++) if (indexed[(y + bit) * size + x] === id) bits |= 1 << bit;
        row += String.fromCharCode(63 + bits);
      }
      if (/[^?]/.test(row)) output += `#${id}${row.replace(/(.)\1{3,}/g, run => `!${run.length}${run[0]}`)}$`;
    }
    if (y + 6 < size) output += "-";
  }
  return output + "\x1b\\";
}

// Query capabilities and cell pixels; do not send image escapes to unsupported terminals.
export function attachTerminalIcon(screen, fallback) {
  if (process.env.CODEOTTER_IMAGE === "off" || !screen.program.output.isTTY) return;
  let supported = false;
  let cell = null;
  let buffer = "";
  let encoded = "";
  let timer;
  let destroyed = false;
  function draw() {
    if (!encoded || destroyed || screen.width < 20 || screen.height < 8) return;
    // Don't cover a modal whose bounds intersect the reserved icon rectangle.
    if (screen.children.some(widget => !widget.hidden && widget.lpos && widget.lpos.xi < 8 && widget.lpos.yi < 3 && widget.lpos.yl > 0 && widget.type !== "box")) return;
    screen.program.flush();
    screen.program.output.write(`\x1b7\x1b[1;3H${encoded}\x1b8`);
  }
  function onData(chunk) {
    buffer = (buffer + chunk.toString()).slice(-512);
    const attributes = /\x1b\[\?([\d;]+)c/.exec(buffer);
    if (attributes) supported = attributes[1].split(";").slice(1).includes("4");
    const dimensions = /\x1b\[6;(\d+);(\d+)t/.exec(buffer);
    if (dimensions) cell = { height: Number(dimensions[1]), width: Number(dimensions[2]) };
    if (supported && cell?.width > 0 && cell?.height > 0 && !destroyed) {
      const size = Math.min(cell.width * 6, cell.height * 3, 128);
      encoded = faviconSixel(size);
      fallback.hide();
      stopQuery();
      screen.render();
    }
  }
  function stopQuery() { clearTimeout(timer); screen.program.removeListener("data", onData); }
  function query() {
    stopQuery(); buffer = ""; cell = null; encoded = ""; fallback.show();
    screen.program.on("data", onData);
    screen.program.flush();
    screen.program.output.write("\x1b[c\x1b[16t");
    timer = setTimeout(stopQuery, 1500); timer.unref?.();
  }
  screen.on("render", draw);
  screen.on("resize", query);
  screen.once("destroy", () => { destroyed = true; stopQuery(); screen.removeListener("render", draw); screen.removeListener("resize", query); });
  query();
}
