import { Link } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import { getPrevNext } from "@/content/help/manifest";
import { useAskGuide } from "./AskGuideProvider";

export function HelpArticle({
  slug,
  title,
  updated,
  children,
}: {
  slug: string;
  title: string;
  updated?: string;
  children: ReactNode;
}) {
  const { prev, next } = getPrevNext(slug);
  const { open } = useAskGuide();
  return (
    <article className="mx-auto max-w-3xl px-4 py-8 sm:px-8">
      <header className="mb-6 border-b border-border pb-6">
        <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
          {title}
        </h1>
        {updated && (
          <p className="mt-2 text-xs text-muted-foreground">
            Updated automatically · {updated}
          </p>
        )}
      </header>

      <div className="prose prose-sm max-w-none text-foreground prose-headings:text-foreground prose-h2:mt-8 prose-h2:text-xl prose-h2:font-semibold prose-h3:mt-6 prose-h3:text-base prose-p:text-muted-foreground prose-p:leading-relaxed prose-strong:text-foreground prose-a:text-primary prose-code:rounded prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:text-[0.85em] prose-code:before:content-none prose-code:after:content-none prose-li:text-muted-foreground">
        {children}
      </div>

      <div className="mt-10 rounded-lg border border-primary/20 bg-primary/5 p-4">
        <div className="flex items-start gap-3">
          <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <div className="flex-1">
            <div className="text-sm font-semibold text-foreground">Still stuck?</div>
            <p className="mt-1 text-sm text-muted-foreground">
              Ask the AI Guide a follow-up. It understands your live data and can explain exactly what's happening on your screen.
            </p>
            <button
              onClick={() => open({ prefill: `About "${title}": ` })}
              className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              <Sparkles className="h-3.5 w-3.5" />
              Ask the Guide
            </button>
          </div>
        </div>
      </div>

      <nav className="mt-10 grid gap-3 sm:grid-cols-2">
        {prev ? (
          <Link
            to="/help/$topic"
            params={{ topic: prev.slug }}
            className="group rounded-lg border border-border p-4 transition-colors hover:border-primary hover:bg-primary/5"
          >
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <ArrowLeft className="h-3.5 w-3.5" /> Previous
            </div>
            <div className="mt-1 font-medium text-foreground group-hover:text-primary">{prev.title}</div>
          </Link>
        ) : <div />}
        {next ? (
          <Link
            to="/help/$topic"
            params={{ topic: next.slug }}
            className="group rounded-lg border border-border p-4 text-right transition-colors hover:border-primary hover:bg-primary/5"
          >
            <div className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
              Next <ArrowRight className="h-3.5 w-3.5" />
            </div>
            <div className="mt-1 font-medium text-foreground group-hover:text-primary">{next.title}</div>
          </Link>
        ) : <div />}
      </nav>
    </article>
  );
}
