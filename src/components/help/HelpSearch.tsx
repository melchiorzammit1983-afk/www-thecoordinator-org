import { useState, useMemo, useRef, useEffect } from "react";
import Fuse from "fuse.js";
import { Link } from "@tanstack/react-router";
import { Search, X } from "lucide-react";
import { HELP_ARTICLES } from "@/content/help/manifest";

const fuse = new Fuse(HELP_ARTICLES, {
  keys: ["title", "summary", "keywords", "group"],
  threshold: 0.35,
});

export function HelpSearch() {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const results = useMemo(() => (q.trim() ? fuse.search(q).slice(0, 8) : []), [q]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  return (
    <div ref={ref} className="relative w-full max-w-sm">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder="Search the guide…"
          className="w-full rounded-md border border-input bg-background py-1.5 pl-8 pr-8 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
        {q && (
          <button
            onClick={() => { setQ(""); setOpen(false); }}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {open && results.length > 0 && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-80 overflow-y-auto rounded-md border border-border bg-popover shadow-lg">
          {results.map(({ item }) => (
            <Link
              key={item.slug}
              to="/help/$topic"
              params={{ topic: item.slug }}
              onClick={() => { setOpen(false); setQ(""); }}
              className="block border-b border-border/50 px-3 py-2 text-sm hover:bg-muted last:border-b-0"
            >
              <div className="font-medium text-foreground">{item.title}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">{item.summary}</div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
