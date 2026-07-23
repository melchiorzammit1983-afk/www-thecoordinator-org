import { HelpArticle } from "@/components/help/HelpArticle";
import { HelpLink } from "@/components/help/HelpLink";

const FAQS: Array<{ q: string; a: React.ReactNode }> = [
  {
    q: "Why is my trip card glowing red?",
    a: (
      <p>
        A red glow means the assigned driver has a <strong>schedule conflict</strong> — their previous trip won't end in time
        (with the drop-off buffer + handover drive) to make the new pickup. Click the card for the full timeline, or use
        "Suggest alternatives" to pick another driver. See <HelpLink slug="coordinator-dispatch">Dispatch</HelpLink>.
      </p>
    ),
  },
  {
    q: "Why isn't the ETA updating?",
    a: (
      <p>
        ETAs auto-refresh every 60 seconds while the tab is visible. Hover the ETA chip to see the last refresh time.
        If it says "Planned" instead of "Live", GPS data hasn't come in yet — usually because the driver hasn't started the trip.
      </p>
    ),
  },
  {
    q: "The driver tapped 'Arrived' but they're not at the pickup",
    a: (
      <p>
        If GPS shows the driver too far from the pickup point, the app warns them and logs the event with a "GPS mismatch" tag.
        As a coordinator, you can override the status from the trip sheet — the override is logged with your name and reason.
      </p>
    ),
  },
  {
    q: "Why is waiting time not counting?",
    a: (
      <p>
        Waiting only accumulates once the <strong>scheduled pickup time</strong> has passed and the driver is within 150m of the pickup.
        Arriving early is free for the passenger.
      </p>
    ),
  },
  {
    q: "How do I remove a wrong status the driver entered?",
    a: (
      <p>
        Open the trip sheet → Timeline → three-dot menu on the event → Delete. The linked payout adjustment (if any) is removed
        automatically and the driver's trust score is recalculated.
      </p>
    ),
  },
];

export default function Article() {
  return (
    <HelpArticle slug="faq" title="FAQ & troubleshooting">
      <p>Quick answers to the most common operational questions.</p>
      <div className="not-prose mt-6 space-y-3">
        {FAQS.map(({ q, a }) => (
          <details key={q} className="group rounded-lg border border-border p-4 open:bg-muted/30">
            <summary className="cursor-pointer list-none font-medium text-foreground marker:hidden">
              <span className="mr-2 text-primary group-open:rotate-90 inline-block transition-transform">▸</span>{q}
            </summary>
            <div className="prose prose-sm mt-3 max-w-none text-muted-foreground">{a}</div>
          </details>
        ))}
      </div>
    </HelpArticle>
  );
}
