// In-app link: a real anchor (keyboard reachable, middle-click opens a tab) that routes client-side on a plain click.
export const Link = ({ path, go, className = "", children, ...rest }: { path: string; go: (p: string) => void; className?: string; children: React.ReactNode } & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "onClick" | "className" | "children">) => (
  <a
    href={path}
    className={className}
    onClick={(e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
      e.preventDefault();
      go(path);
    }}
    {...rest}
  >
    {children}
  </a>
);
