import { createFileRoute, Link } from "@tanstack/react-router";
import { HELP_ARTICLES, HELP_GROUPS } from "@/content/help/manifest";
import { ArrowRight, Sparkles } from "lucide-react";
import { useAskGuide } from "@/components/help/AskGuideProvider";

export const Route = createFileRoute("/help/")({
  component: HelpIndex,
});

function HelpIndex() {
  const { open } = useAskGuide();
  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-8">
      <div className="rounded-2xl bg-gradient-to-br from-primary/10 via-primary/5 to-transparent p-8">
        <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
          How The Coordinator works
        </h1>
        <p className="mt-2 max-w-2xl text-muted-foreground">
          Everything you need to know — for coordinators, drivers, clients and admins.
          Every article stays in sync with the live app, so numbers you see here match what's actually running.
        </p>
        <button
          onClick={() => open()}
          className="mt-4 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
        >
          <Sparkles className="h-4 w-4" /> Ask the Guide anything
        </button>
      </div>

      <div className="mt-10 space-y-8">
        {HELP_GROUPS.map((group) => (
          <section key={group}>
            <h2 className="mb-3 text-lg font-semibold text-foreground">{group}</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {HELP_ARTICLES.filter((a) => a.group === group).map((a) => (
                <Link
                  key={a.slug}
                  to="/help/$topic"
                  params={{ topic: a.slug }}
                  className="group flex flex-col justify-between rounded-lg border border-border p-4 transition-colors hover:border-primary hover:bg-primary/5"
                >
                  <div>
                    <div className="font-semibold text-foreground group-hover:text-primary">{a.title}</div>
                    <p className="mt-1 text-sm text-muted-foreground">{a.summary}</p>
                  </div>
                  <ArrowRight className="mt-3 h-4 w-4 self-end text-muted-foreground group-hover:text-primary" />
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
