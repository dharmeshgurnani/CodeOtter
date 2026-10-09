// favicon.svg tile color; indexed fallback for terminals without RGB support.
export const BRAND_COLOR = "#BE3609";
// Yellow hue, with the same HSL saturation and lightness as the brand orange.
export const SELECTION_COLOR = "#BEBE09";
export const PRIMARY = 130;
export const SELECTION = 142;
export const terminal = process.env.WT_SESSION ? "xterm-256color" : undefined;

// Matches web/src/types.ts tone() and review-page.tsx Ring colors.
export function scoreColor(value, key) {
  const rating = key === "correctness_risk" || key === "blast_radius" ? 100 - value : value;
  return rating >= 70 ? 28 : rating >= 40 ? 166 : 124;
}
export function colorScores(content) {
  return content.replace(/^(\w+)(\s+)(\d+)\/100$/gm, (_, key, spacing, value) => {
    const color = scoreColor(Number(value), key);
    return `${key}${spacing}{${color}-fg}${value}/100{/${color}-fg}`;
  });
}

export function applyBrandColor(screen) {
  if (!process.env.WT_SESSION && !/truecolor|24bit/i.test(process.env.COLORTERM || "")) return;
  const program = screen.program;
  const write = program._write;
  const palette = Object.fromEntries([[PRIMARY, BRAND_COLOR], [SELECTION, SELECTION_COLOR], [28, "#15803d"], [166, "#b45309"], [124, "#b91c1c"]]
    .map(([index, color]) => [index, color.slice(1).match(/../g).map(value => parseInt(value, 16)).join(";")]));
  // Blessed stores indexed attributes. Expand our theme indices on output,
  // leaving the user's terminal palette and all other colors untouched.
  program._write = function (data) {
    if (typeof data === "string") data = data.replace(/\x1b\[[\d;]*m/g, sgr =>
      sgr.replace(/(38|48);5;(130|142|28|166|124)(?=;|m)/g, (_, channel, index) => `${channel};2;${palette[index]}`));
    return write.call(this, data);
  };
  screen.once("destroy", () => { program._write = write; });
}

// Each widget owns its style: focusing one must not recolor every panel.
export function panelStyle() {
  return {
    fg: "white",
    border: { fg: PRIMARY },
    label: { fg: label => label.parent.focused ? SELECTION : "white", bold: true },
    selected: { bg: item => item.parent.focused ? SELECTION : PRIMARY, fg: "black" },
  };
}
