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

  it("draws a table from columns and rows, with badge cells and row actions", () => {
    const table: Section = { id: "providers", title: "Git providers", fields: [{ key: "rows", label: "Providers", type: "table", columns: [{ key: "name", label: "Provider" }, { key: "signIn", label: "Sign-in" }] }] };
    const rows = [{ id: "gitea", label: "Gitea", cells: { name: "Gitea", signIn: { text: "Enabled", tone: "ok" as const } }, actions: [{ id: "testgitea", label: "Test" }] }];
    const onAction = vi.fn();
    render(<JsonForm sections={[table]} values={{ providers: { rows } }} saved={{ providers: { rows } }} busy="" onChange={() => {}} onAction={onAction} />);
    expect(screen.getByRole("columnheader", { name: "Sign-in" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Enabled" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Test" }));
    expect(onAction).toHaveBeenCalledWith("providers", "testgitea", "gitea");
  });

  it("moves a slider one step per wheel notch, within its bounds", () => {
    const range: Section = { id: "repo", title: "Review", fields: [{ key: "maxFindings", label: "Max findings", type: "range", min: 3, max: 12, step: 1 }] };
    const onChange = vi.fn();
    const { rerender } = render(<JsonForm sections={[range]} values={{ repo: { maxFindings: 8 } }} saved={{}} busy="" onChange={onChange} onAction={() => {}} />);
    const slider = screen.getByLabelText("Max findings");
    fireEvent.wheel(slider, { deltaY: -100 });
    expect(onChange).toHaveBeenLastCalledWith("repo", { maxFindings: 9 });
    fireEvent.wheel(slider, { deltaY: 100 });
    expect(onChange).toHaveBeenLastCalledWith("repo", { maxFindings: 7 });
    onChange.mockClear();
    rerender(<JsonForm sections={[range]} values={{ repo: { maxFindings: 12 } }} saved={{}} busy="" onChange={onChange} onAction={() => {}} />);
    fireEvent.wheel(screen.getByLabelText("Max findings"), { deltaY: -100 });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("while a row action runs, that button spins and every row control is locked", () => {
    const table: Section = { id: "providers", title: "Git providers", fields: [{ key: "rows", label: "Providers", type: "table", columns: [{ key: "name", label: "Provider" }] }] };
    const rows = [
      { id: "gitea", label: "Gitea", cells: { name: "Gitea" }, actions: [{ id: "testgitea", label: "Test" }] },
      { id: "forgejo", label: "Forgejo", cells: { name: "Forgejo" }, actions: [{ id: "testforgejo", label: "Test" }] },
    ];
    render(<JsonForm sections={[table]} values={{ providers: { rows } }} saved={{ providers: { rows } }} busy="providers:testgitea:gitea" onChange={() => {}} onAction={() => {}} />);
    const [gitea, forgejo] = screen.getAllByRole("button", { name: "Test" });
    expect(gitea).toBeDisabled();
    expect(gitea).toHaveAttribute("aria-busy", "true");
    expect(forgejo).toBeDisabled();
    expect(forgejo).not.toHaveAttribute("aria-busy");
  });

  it("saves a row at once when its toggle is turned off, marking only that row", () => {
    const table: Section = { id: "signin", title: "Sign-in", fields: [{ key: "rows", label: "Providers", type: "table", columns: [{ key: "name", label: "Provider" }] }] };
    const rows = [
      { id: "github", label: "GitHub", cells: { name: "GitHub" }, toggle: true },
      { id: "gitea", label: "Gitea", cells: { name: "Gitea" }, toggle: true },
    ];
    const onAction = vi.fn();
    render(<JsonForm sections={[table]} values={{ signin: { rows } }} saved={{ signin: { rows } }} busy="" onChange={() => {}} onAction={onAction} />);
    fireEvent.click(screen.getByRole("switch", { name: "Gitea" }));
    const posted = onAction.mock.calls[0][3].rows;
    expect(onAction.mock.calls[0].slice(0, 2)).toEqual(["signin", "save"]);
    expect(posted.find((r: { id: string }) => r.id === "gitea")).toMatchObject({ toggle: false, edited: true });
    expect(posted.find((r: { id: string }) => r.id === "github")).toMatchObject({ toggle: true, edited: false });
  });

  it("draws a multiselect as checkboxes and reports the checked values in option order", () => {
    const invite: Section = {
      id: "invite",
      title: "Invite",
      fields: [
        { key: "role", label: "Role", type: "select", options: [{ value: "developer", label: "developer" }, { value: "admin", label: "admin" }] },
        { key: "repos", label: "Repositories", type: "multiselect", options: [{ value: "acme/api", label: "acme/api" }, { value: "acme/web", label: "acme/web" }, { value: "gitea~acme/ops", label: "acme/ops · Gitea" }], hideWhen: { field: "role", in: ["admin"] } },
      ],
    };
    const onChange = vi.fn();
    const vals = { invite: { role: "developer", repos: ["gitea~acme/ops"] } };
    const { rerender } = render(<JsonForm sections={[invite]} values={vals} saved={vals} busy="" onChange={onChange} onAction={() => {}} />);
    expect(screen.getByRole("group", { name: "Repositories" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "acme/ops · Gitea" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "acme/api" })).not.toBeChecked();
    fireEvent.click(screen.getByRole("checkbox", { name: "acme/api" }));
    expect(onChange).toHaveBeenLastCalledWith("invite", { role: "developer", repos: ["acme/api", "gitea~acme/ops"] });
    fireEvent.click(screen.getByRole("checkbox", { name: "acme/ops · Gitea" }));
    expect(onChange).toHaveBeenLastCalledWith("invite", { role: "developer", repos: [] });
    rerender(<JsonForm sections={[invite]} values={{ invite: { role: "admin", repos: [] } }} saved={vals} busy="" onChange={onChange} onAction={() => {}} />);
    expect(screen.queryByRole("group", { name: "Repositories" })).not.toBeInTheDocument();
  });
});
