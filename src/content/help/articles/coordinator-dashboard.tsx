import { HelpArticle } from "@/components/help/HelpArticle";
import { Callout } from "@/components/help/Callout";

export default function Article() {
  return (
    <HelpArticle slug="coordinator-dashboard" title="The coordinator dashboard">
      <p>
        Your dashboard is the home base. It surfaces trips that need attention right now,
        the day's activity feed, and one-tap access to add a trip or chat with the AI.
      </p>

      <h2>Quick actions (top of screen)</h2>
      <ul>
        <li><strong>New trip</strong> — opens the trip form (supports single, group, and time-nudge with live conflict math).</li>
        <li><strong>Ask the AI</strong> — pastes a booking, extracts trips, or answers questions about the system.</li>
        <li><strong>Open dispatch</strong> — jumps to the dense calendar with schedule conflict detection.</li>
      </ul>

      <h2>Recent activity</h2>
      <p>
        The activity feed shows trips whose status changed recently — driver accepted, on the way, arrived, completed —
        together with a live <strong>ETA chip</strong> and a <strong>traffic badge</strong>. Hover the chip to see when
        the ETA was last refreshed and whether it's live or planned.
      </p>

      <Callout tone="info" title="Auto-refresh">
        ETAs poll every 60 seconds while the tab is visible, then pause when you switch away. No manual refresh needed.
      </Callout>

      <h2>Mobile layout</h2>
      <p>
        On phones the bottom nav collapses to four tabs: <strong>Home</strong>, <strong>Dispatch</strong>,
        <strong> Trips</strong>, <strong>More</strong>. Everything else lives under More.
      </p>
    </HelpArticle>
  );
}
