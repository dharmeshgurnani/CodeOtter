import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { JsonReport, type ReportSection } from "./json-report";

const sections: ReportSection[] = [
  { id: "stats", kind: "stats", title: "This week", items: [{ label: "Reviews", value: 12, unit: "PRs", hint: "last 7 days", action: { label: "Open", path: "/reviews" } }] },
  { id: "table", kind: "table", title: "Open pull requests", columns: ["PR", "Verdict"], rows: [[{ text: "#7 fix totals", path: "/review?pr=7" }, { text: "Approved", tone: "ok" }]] },
  { id: "links", kind: "links", title: "More", items: [{ label: "Docs", href: "https://codeotter.io/docs/" }] },
];

describe("JsonReport", () => {
  it("renders every section kind from server JSON", () => {
    render(<JsonReport sections={sections} go={() => {}} />);
    expect(screen.getByText("This week")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("Open pull requests")).toBeInTheDocument();
    expect(screen.getByText("Approved")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Docs" })).toHaveAttribute("href", "https://codeotter.io/docs/");
  });

  it("routes in-app paths through go()", () => {
    const go = vi.fn();
    render(<JsonReport sections={sections} go={go} />);
    fireEvent.click(screen.getByText("#7 fix totals"));
    expect(go).toHaveBeenCalledWith("/review?pr=7");
  });

  it("shows the empty text when a table has no rows", () => {
    render(<JsonReport sections={[{ id: "t", kind: "table", title: "Nothing", columns: ["A"], rows: [], empty: "No rows yet" }]} go={() => {}} />);
    expect(screen.getByText("No rows yet")).toBeInTheDocument();
  });
});
