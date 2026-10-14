// Small info icon with an Animate UI tooltip. Clicks stay on the icon so it can sit inside clickable cards.
import { Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/animate-ui/components/animate/tooltip";

// Tooltips read as short lines, never one paragraph: split on explicit line breaks, on " · " between facts, and
// between sentences. Server text needs no special formatting.
export const tipLines = (text: string) =>
  text
    .split(/\n+|\s+·\s+|(?<=[.!?])\s+(?=[A-Z0-9(])/)
    .map((l) => l.trim())
    .filter(Boolean);

export function InfoTip({ text }: { text: string }) {
  const lines = tipLines(text);
  return (
    <TooltipProvider>
      <Tooltip side="top">
        <TooltipTrigger asChild>
          <button type="button" aria-label={text} onClick={(e) => e.stopPropagation()} className="inline-flex shrink-0 rounded-full p-0.5 align-middle text-amber-600 hover:text-amber-700">
            <Info className="size-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-[280px]">
          <div className="space-y-0.5 text-left">{lines.map((l, i) => <div key={i}>{l}</div>)}</div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
