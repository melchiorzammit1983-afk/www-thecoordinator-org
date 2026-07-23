import { createFileRoute, Outlet, Link } from "@tanstack/react-router";
import { ArrowLeft, Menu } from "lucide-react";
import { useState } from "react";
import { HelpSidebar } from "@/components/help/HelpSidebar";
import { HelpSearch } from "@/components/help/HelpSearch";

export const Route = createFileRoute("/help")({
  head: () => ({
    meta: [
      { title: "Help & Guide — The Coordinator" },
      { name: "description", content: "How The Coordinator works. Guides for coordinators, drivers, clients and admins." },
      { property: "og:title", content: "Help & Guide — The Coordinator" },
      { property: "og:description", content: "Practical documentation for The Coordinator transport platform." },
    ],
  }),
  component: HelpLayout,
});

function HelpLayout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-border bg-background/95 px-4 py-2 backdrop-blur">
        <button
          onClick={() => setMobileOpen(true)}
          className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-muted lg:hidden"
        >
          <Menu className="h-4 w-4" />
        </button>
        <Link to="/" className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <ArrowLeft className="h-4 w-4" /> Back to app
        </Link>
        <div className="mx-auto flex-1 max-w-md">
          <HelpSearch />
        </div>
      </header>

      <div className="flex flex-1">
        <div className="hidden w-64 shrink-0 border-r border-border lg:block">
          <HelpSidebar />
        </div>
        {mobileOpen && (
          <div className="fixed inset-0 z-40 lg:hidden">
            <div className="absolute inset-0 bg-black/50" onClick={() => setMobileOpen(false)} />
            <div className="absolute inset-y-0 left-0 w-72 border-r border-border bg-background">
              <HelpSidebar onNavigate={() => setMobileOpen(false)} />
            </div>
          </div>
        )}
        <main className="min-w-0 flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
