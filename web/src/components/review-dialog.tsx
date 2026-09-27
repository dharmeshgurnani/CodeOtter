import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/animate-ui/components/radix/dialog";

// "Review pull request" from anywhere: an Animate UI dialog asking for the PR. A bare number works when a repository
// is in context (repository pages); elsewhere a github.com pull request URL is needed.
export function ReviewDialog({ repo, go }: { repo: string; go: (p: string) => void }) {
  const [value, setValue] = useState("");
  const [open, setOpen] = useState(false);
  const pr = value.trim();
  const isNumber = /^\d+$/.test(pr);
  const isUrl = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+$/.test(pr);
  const ok = isUrl || (isNumber && !!repo);
  const submit = () => {
    if (!ok) return;
    setOpen(false);
    go(`/review?pr=${encodeURIComponent(pr)}${isNumber ? `&repo=${encodeURIComponent(repo)}` : ""}`);
  };
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) setValue(""); }}>
      <DialogTrigger asChild>
        <Button>Review pull request</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Review pull request</DialogTitle>
          <DialogDescription>{repo ? `A number in ${repo}, or any github.com pull request URL.` : "A github.com pull request URL."}</DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <Input autoFocus value={value} onChange={(e) => setValue(e.target.value)} placeholder={repo ? `${repo} #123 or https://github.com/owner/name/pull/123` : "https://github.com/owner/name/pull/123"} />
          {pr && !ok && <p className="mt-2 text-xs text-red-700">{isNumber ? "Open a repository to review by number, or paste the URL." : "Not a github.com pull request URL."}</p>}
        </form>
        <DialogFooter>
          <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
          <Button onClick={submit} disabled={!ok}>Review</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
