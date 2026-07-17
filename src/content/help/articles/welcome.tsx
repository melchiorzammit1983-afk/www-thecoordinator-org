import { HelpArticle } from "@/components/help/HelpArticle";
import { Callout } from "@/components/help/Callout";
import { StepList } from "@/components/help/StepList";
import { HelpLink } from "@/components/help/HelpLink";

export default function Article() {
  return (
    <HelpArticle slug="welcome" title="Welcome to The Coordinator" updated="Live">
      <p>
        <strong>The Coordinator</strong> is a dispatch platform that connects three sides of a transfer:
        the <em>hotel or client</em> booking a ride, the <em>coordinator</em> planning it,
        and the <em>driver</em> executing it. Everything the driver does on the road flows back
        to the coordinator screen in real time.
      </p>

      <h2>Who uses it</h2>
      <ul>
        <li><strong>Coordinators</strong> — the operations team who receive bookings, assign drivers, and monitor trips as they happen.</li>
        <li><strong>Drivers</strong> — installed as a native Android app; sees only their trips and updates status with big taps.</li>
        <li><strong>Clients (hotels)</strong> — a lightweight PWA to submit trips and watch progress.</li>
        <li><strong>Admins</strong> — manage users, pricing, and platform settings.</li>
      </ul>

      <h2>What makes it different</h2>
      <StepList
        items={[
          { title: "Live everywhere", body: "Every driver action pins itself on the trip map instantly — arrival, waiting, delays, everything." },
          { title: "AI-native", body: "Paste a booking email; AI extracts trips. Ask the Guide anywhere; it knows why your screen looks the way it does." },
          { title: "Payment & trust are automatic", body: "Trip events (no-show, cancel, wait) automatically adjust driver payout and trust score — no manual claims to chase." },
        ]}
      />

      <Callout tone="tip" title="Get set up">
        Start with <HelpLink slug="install-apps">Install the apps</HelpLink>, then jump to your role's guide.
      </Callout>
    </HelpArticle>
  );
}
