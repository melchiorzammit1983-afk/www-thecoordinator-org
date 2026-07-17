import { HelpArticle } from "@/components/help/HelpArticle";
import { Callout } from "@/components/help/Callout";
import { Fact } from "@/components/help/Fact";
import { StepList } from "@/components/help/StepList";
import { HelpLink } from "@/components/help/HelpLink";

export default function Article() {
  return (
    <HelpArticle slug="driver-guide" title="Driver walkthrough">
      <p>
        The driver app is designed for one-hand use while walking to your car. Big buttons, one primary action at a time,
        and a sticky bottom bar so you never hunt for the next step.
      </p>

      <h2>First time</h2>
      <StepList
        items={[
          { title: "Install the APK", body: "Follow the /install page on your phone." },
          { title: "Sign in with your phone number", body: "You'll get an SMS code. Optionally set up fingerprint unlock." },
          { title: "Enable notifications", body: "Required to get new trip alerts even when the app is closed." },
          { title: "Enable location", body: "Set to 'Allow all the time' so live ETA works when the app is in the background." },
        ]}
      />

      <h2>The trip screen</h2>
      <p>
        Each trip shows:
      </p>
      <ul>
        <li>A <strong>status pill</strong> at the top — your current state (Accepted, On the way, Arrived, etc.).</li>
        <li>A <strong>route insights panel</strong> — ETA to pickup, ETA to drop-off, distance, and traffic delay.</li>
        <li>A <strong>sticky primary button</strong> at the bottom — the next action you should take.</li>
      </ul>

      <h2>Status buttons — what happens</h2>
      <p>
        Every button you press is logged as a map pin the coordinator can see. See the full list on the
        <HelpLink slug="event-catalog"> Trip event catalog</HelpLink> page.
      </p>

      <Callout tone="warning" title="Arrived at pickup ≠ arrived anywhere">
        If you tap "Arrived at pickup" more than <Fact name="ARRIVAL_ACCURACY_M" /> from the actual pickup, the app will warn you
        and ask what to do (retry, override, contact coordinator).
      </Callout>

      <h2>Waiting time</h2>
      <p>
        Waiting only starts counting at the <strong>scheduled pickup time</strong> or when you actually arrive — whichever is later.
        Arriving early is free for the passenger. You must be within <Fact name="WAIT_PROXIMITY_M" /> for the meter to count.
      </p>

      <h2>Trust score & payout</h2>
      <p>
        Every event either helps or hurts you a small amount. A completed trip with no-shows correctly reported <strong>protects</strong> your trust.
        A false "arrived" without GPS proximity <strong>flags</strong> your account for coordinator review. See the
        <HelpLink slug="event-catalog"> event catalog</HelpLink> for exact values.
      </p>
    </HelpArticle>
  );
}
