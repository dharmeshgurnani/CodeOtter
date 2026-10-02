// Small info icon with an Animate UI tooltip. Clicks stay on the icon so it can sit inside clickable cards.
import { Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/animate-ui/components/animate/tooltip";

export function InfoTip({ text }: { text: string }) {
  return (
    <TooltipProvider>
      <Tooltip side="top">
        <TooltipTrigger asChild>
          <button type="button" aria-label={text} onClick={(e) => e.stopPropagation()} className="inline-flex shrink-0 rounded-full p-0.5 align-middle text-amber-600 hover:text-amber-700">
            <Info className="size-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-[280px]">{text}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
