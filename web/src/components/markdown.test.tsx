import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MarkdownView } from "./markdown";

describe("MarkdownView", () => {
  it("renders headings, lists and inline code from model text", () => {
    render(<MarkdownView content={"## Summary\n\nTotals now include tax.\n\n- `cart.js` multiplies by 1.15\n- tests updated"} />);
    expect(screen.getByRole("heading", { level: 2, name: "Summary" })).toBeInTheDocument();
    expect(screen.getByText("Totals now include tax.")).toBeInTheDocument();
    expect(screen.getByText("cart.js")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("does not execute raw HTML from the model", () => {
    const { container } = render(<MarkdownView content={'<img src=x onerror="window.pwned=1">\n\nplain text'} />);
    expect(container.querySelector("img[onerror]")).toBeNull();
    expect(screen.getByText("plain text")).toBeInTheDocument();
  });
});
