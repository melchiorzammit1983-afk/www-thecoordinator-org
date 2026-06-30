import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Crew Change Admin" },
      { name: "description", content: "Operations console for crew-change transport companies." },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="px-6 py-5 border-b flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-primary text-primary-foreground grid place-items-center font-semibold">CC</div>
          <div className="font-semibold">Crew Change</div>
        </div>
        <Link to="/auth" className="text-sm font-medium hover:underline">Sign in</Link>
      </header>
      <main className="flex-1 grid place-items-center px-6">
        <div className="max-w-2xl text-center py-16">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-accent text-accent-foreground text-xs font-medium">
            Admin console
          </div>
          <h1 className="mt-6 text-4xl md:text-5xl font-semibold tracking-tight">
            Crew-change transport, organised.
          </h1>
          <p className="mt-4 text-muted-foreground">
            Approve companies, manage points, generate booking links, and audit every transaction
            from a single secure dashboard.
          </p>
          <div className="mt-8 flex items-center justify-center gap-3">
            <Link
              to="/auth"
              className="inline-flex items-center gap-2 rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Open the console <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </main>
      <footer className="px-6 py-4 border-t text-xs text-muted-foreground text-center">
        Units in metric (km, °C). Times in 24-hour UTC unless stated.
      </footer>
    </div>
  );
}
