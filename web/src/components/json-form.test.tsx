import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { JsonForm, applyChange, type Section } from "./json-form";

const section: Section = {
  id: "llm",
  title: "Model provider",
  fields: [
    { key: "provider", label: "Provider", type: "select", options: [{ value: "openai", label: "OpenAI" }, { value: "anthropic", label: "Anthropic" }], },
    { key: "model", label: "Model", type: "text", defaultBy: { field: "provider", map: { openai: "gpt-5", anthropic: "claude-sonnet-5-5" } } },
    { key: "postScores", label: "Post scores", type: "checkbox", text: "Post scores on the PR" },
  ],
  actions: [{ id: "save", label: "Save" }],
};

describe("applyChange", () => {
  it("fills dependent defaults when the driving field changes", () => {
    const next = applyChange(section, { provider: "openai", model: "gpt-5" }, "provider", "anthropic");
    expect(next).toEqual({ provider: "anthropic", model: "claude-sonnet-5-5" });
  });

  it("leaves unrelated fields alone", () => {
    expect(applyChange(section, { provider: "openai", model: "custom" }, "postScores", true)).toEqual({ provider: "openai", model: "custom", postScores: true });
  });
});

describe("JsonForm", () => {
  const values = { llm: { provider: "openai", model: "gpt-5", postScores: false } };

  it("renders labels and controls from server JSON", () => {
    render(<JsonForm sections={[section]} values={values} saved={values} busy="" onChange={() => {}} onAction={() => {}} />);
    expect(screen.getByText("Model provider")).toBeInTheDocument();
    expect(screen.getByLabelText("Model")).toHaveValue("gpt-5");
    expect(screen.getByLabelText("Post scores on the PR")).not.toBeChecked();
  });

  it("reports edits through onChange with knock-on defaults applied", () => {
    const onChange = vi.fn();
    render(<JsonForm sections={[section]} values={values} saved={values} busy="" onChange={onChange} onAction={() => {}} />);
    fireEvent.change(screen.getByLabelText("Model"), { target: { value: "gpt-5-mini" } });
    expect(onChange).toHaveBeenCalledWith("llm", { provider: "openai", model: "gpt-5-mini", postScores: false });
  });

  it("enables Save only when values differ from saved, then fires the action", () => {
    const onAction = vi.fn();
    const { rerender } = render(<JsonForm sections={[section]} values={values} saved={values} busy="" onChange={() => {}} onAction={onAction} />);
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    rerender(<JsonForm sections={[section]} values={{ llm: { ...values.llm, model: "gpt-5-mini" } }} saved={values} busy="" onChange={() => {}} onAction={onAction} />);
    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    expect(onAction).toHaveBeenCalledWith("llm", "save");
  });
});
