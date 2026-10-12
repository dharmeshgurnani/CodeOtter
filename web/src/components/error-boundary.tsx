import { Component, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

// A render error in one subtree shows its message and a reload control instead of blanking the whole app.
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="p-4 text-sm text-red-700">
        <pre className="whitespace-pre-wrap">{error.message || String(error)}</pre>
        <Button variant="outline" size="sm" className="mt-3" onClick={() => location.reload()}>Reload</Button>
      </div>
    );
  }
}
