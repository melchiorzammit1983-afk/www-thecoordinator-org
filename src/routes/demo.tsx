import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Mail, Phone, Sparkles } from "lucide-react";

export const Route = createFileRoute("/demo")({
  head: () => ({
    meta: [
      { title: "Book a demo — The Coordinator" },
      {
        name: "description",
        content:
          "See how The Coordinator turns messy hotel-transfer requests into confirmed, tracked, on-time trips. Book a short personalised demo.",
      },
      { property: "og:title", content: "Book a demo — The Coordinator" },
      {
        property: "og:description",
        content:
          "Live driver tracking, AI trip extraction, and a client link every guest can follow. Book a 20-minute demo.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: DemoPage,
});

function DemoPage() {
  return (
    <div className="mx-auto flex min-h-svh max-w-2xl flex-col px-6 py-10">
      <Link
        to="/"
        className="mb-8 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Back
      </Link>

      <div className="mb-6 inline-flex w-fit items-center gap-2 rounded-full border border-primary/30 bg-primary/5 px-3 py-1 text-xs font-medium text-primary">
        <Sparkles className="h-3.5 w-3.5" /> 20-minute personalised demo
      </div>

      <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
        See The Coordinator in action
      </h1>
      <p className="mt-3 text-base text-muted-foreground">
        We'll walk through your real workflow — how trips come in, how you dispatch
        them, and how drivers and clients stay in sync. No slides, no pressure.
      </p>

      <div className="mt-8 space-y-3 rounded-xl border border-border bg-card p-6">
        <div className="text-sm font-semibold text-foreground">What you'll see</div>
        <ul className="space-y-2 text-sm text-muted-foreground">
          <li>• Paste an email or spreadsheet → confirmed trips in seconds.</li>
          <li>• Live driver tracking + automatic ETAs and delay alerts.</li>
          <li>• The client link every guest gets — no signup, no app install.</li>
          <li>• Payouts and audit trail built from real trip events.</li>
        </ul>
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <Button asChild size="lg" className="w-full">
          <a href="mailto:hello@thecoordinator.org?subject=Demo%20request">
            <Mail className="mr-2 h-4 w-4" /> Email us
          </a>
        </Button>
        <Button asChild size="lg" variant="outline" className="w-full">
          <a href="https://wa.me/35699000000">
            <Phone className="mr-2 h-4 w-4" /> WhatsApp
          </a>
        </Button>
      </div>

      <p className="mt-6 text-xs text-muted-foreground">
        Prefer to poke around first? You can{" "}
        <Link to="/auth" className="text-primary hover:underline">
          create a free account
        </Link>
        .
      </p>
    </div>
  );
}
