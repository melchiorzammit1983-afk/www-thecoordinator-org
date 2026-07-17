import { HelpArticle } from "@/components/help/HelpArticle";
import { Callout } from "@/components/help/Callout";
import { Fact } from "@/components/help/Fact";
import { StepList } from "@/components/help/StepList";

export default function Article() {
  return (
    <HelpArticle slug="coordinator-dispatch" title="Dispatch, calendar & schedule conflicts">
      <p>
        The dispatch calendar is where trips are assigned to drivers and monitored live. It's designed for density:
        one line per trip, color-coded status rails, and expandable panels for detail.
      </p>

      <h2>Chain reflow</h2>
      <p>
        When trips are grouped (multiple legs for the same run), the "from" and "to" labels automatically reflow to match
        the actual leg order — pickup → intermediate stops → final drop-off. When multiple trips share the same pickup and
        drop-off, they merge into a single card once the driver approves them.
      </p>

      <h2>Schedule conflict detection</h2>
      <p>
        Assigning a driver who's already busy? The card <strong>glows red</strong> and a banner explains why. The math is:
      </p>
      <ul>
        <li>Previous trip's completion time (based on live ETA + traffic)</li>
        <li>Plus <Fact name="PAX_DROPOFF_BUFFER_MIN" /> to unload passengers</li>
        <li>Plus the handover drive time from the previous drop-off to the new pickup</li>
        <li>Compared to the new trip's pickup time</li>
      </ul>

      <Callout tone="warning" title="Red glow ≠ blocked">
        A conflict is a warning, not a lock. You can still assign — the system just makes sure you know. Click the card
        for the full conflict timeline modal.
      </Callout>

      <h2>Alternative driver suggestions</h2>
      <StepList
        items={[
          { title: "Open the conflict banner", body: "Click 'Suggest alternatives' on any red-glowing trip." },
          { title: "Pick from the ranked list", body: "Drivers are scored by proximity, current workload, and trust score." },
          { title: "Assign in one click", body: "The suggestion re-checks all buffers before confirming." },
        ]}
      />

      <h2>Time nudge</h2>
      <p>
        In the trip form, use ±5 / ±15 minute buttons to shift pickup time and see the collision math re-check instantly.
      </p>
    </HelpArticle>
  );
}
