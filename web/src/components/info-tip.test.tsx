import { describe, expect, it } from "vitest";
import { tipLines } from "./info-tip";

describe("tipLines", () => {
  it("splits facts, sentences and explicit breaks into lines", () => {
    expect(tipLines("MIT · Fast on CPU · 32768-token context")).toEqual(["MIT", "Fast on CPU", "32768-token context"]);
    expect(tipLines("Prefers a discrete GPU via Vulkan; falls back to CPU. S1_DEVICE overrides.")).toEqual(["Prefers a discrete GPU via Vulkan; falls back to CPU.", "S1_DEVICE overrides."]);
    expect(tipLines("Higher is better.\nScale 0-100")).toEqual(["Higher is better.", "Scale 0-100"]);
  });

  it("keeps decimals, versions and file names on one line", () => {
    expect(tipLines("Qwen3.5-0.8B on llama.cpp b11388")).toEqual(["Qwen3.5-0.8B on llama.cpp b11388"]);
  });
});
