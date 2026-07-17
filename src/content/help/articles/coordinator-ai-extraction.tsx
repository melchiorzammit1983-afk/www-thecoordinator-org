import { HelpArticle } from "@/components/help/HelpArticle";
import { Callout } from "@/components/help/Callout";
import { StepList } from "@/components/help/StepList";

export default function Article() {
  return (
    <HelpArticle slug="coordinator-ai-extraction" title="AI trip extraction">
      <p>
        Paste a booking email, WhatsApp message, or spreadsheet row — the AI turns it into structured trips ready to assign.
        This is the fastest way to enter multiple bookings from a hotel.
      </p>

      <h2>How it works</h2>
      <StepList
        items={[
          { title: "Paste raw text", body: "Open 'AI extract' from the dashboard. Paste anything — plain text, an email thread, a table." },
          { title: "AI parses it", body: "A language model extracts pickup/drop-off, passenger name, date/time, and passenger count." },
          { title: "Review before saving", body: "Every extracted trip appears in a preview grid. Edit fields inline; auto-fixed addresses show an Undo affordance." },
          { title: "Save all", body: "One click creates all trips at once, ready for driver assignment." },
        ]}
      />

      <h2>Address auto-fix</h2>
      <p>
        Extracted addresses are resolved through Google Places to get the real business name (e.g. "Hilton Malta" instead of
        just "St George's Bay"). If you disabled auto-fix in settings, addresses are kept as-is.
      </p>

      <h2>Cost & retries</h2>
      <p>
        Each extraction costs a small number of platform points. If the AI is temporarily overloaded (Gemini 503),
        the system retries with exponential backoff and refunds points if all retries fail.
      </p>

      <Callout tone="tip" title="Best paste format">
        The AI works best with one booking per paragraph. Include the passenger name, date/time, pickup, drop-off, and passenger count in each block.
      </Callout>
    </HelpArticle>
  );
}
