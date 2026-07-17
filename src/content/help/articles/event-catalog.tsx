import { HelpArticle } from "@/components/help/HelpArticle";
import { Callout } from "@/components/help/Callout";
import { EventCatalogTable } from "@/components/help/EventCatalogTable";

export default function Article() {
  return (
    <HelpArticle slug="event-catalog" title="Trip event catalog">
      <p>
        Every action the driver takes — and every override the coordinator makes — becomes a permanent event.
        Events pin themselves on the trip map, appear in the audit PDF, and automatically move driver trust and payout.
      </p>

      <Callout tone="info" title="Auto-generated">
        This table is generated from the same code that runs the platform. If the payout for "Passenger no-show" changes
        in the codebase, this page updates automatically.
      </Callout>

      <EventCatalogTable />

      <h2>How trust and payout are recalculated</h2>
      <p>
        A database trigger sums every event's <code>trust_delta</code> and <code>payout_delta_eur</code> for the trip
        as they're inserted, updated, or deleted. Trust is clamped between 0 and 200. If the coordinator deletes an event
        (say, to correct a false no-show), the linked payout adjustment is removed automatically.
      </p>
    </HelpArticle>
  );
}
