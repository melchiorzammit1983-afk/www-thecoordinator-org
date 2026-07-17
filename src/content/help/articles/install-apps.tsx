import { HelpArticle } from "@/components/help/HelpArticle";
import { Callout } from "@/components/help/Callout";
import { StepList } from "@/components/help/StepList";

export default function Article() {
  return (
    <HelpArticle slug="install-apps" title="Install the apps">
      <p>
        There are three ways to open The Coordinator, depending on your role. Visit <code>/install</code> from any phone —
        the page auto-detects your device and shows the right option.
      </p>

      <h2>For drivers — Android APK</h2>
      <StepList
        items={[
          { title: "Open /install", body: "From the phone's browser. The page detects Android automatically." },
          { title: "Download the APK", body: "Tap 'Get Driver App'. If Chrome warns about unknown sources, allow it once for this app." },
          { title: "Sign in", body: "Use the phone number your coordinator registered. You'll get a one-time code by SMS." },
        ]}
      />

      <h2>For coordinators & clients — PWA (installable web app)</h2>
      <StepList
        items={[
          { title: "Open the app in your phone browser", body: "Chrome on Android or Safari on iOS." },
          { title: "Tap 'Install' / 'Add to Home Screen'", body: "Android: the install banner appears automatically. iOS: use Share → Add to Home Screen." },
          { title: "Launch from your home screen", body: "It opens fullscreen with its own icon, just like a native app." },
        ]}
      />

      <Callout tone="tip" title="Send install link">
        On the <code>/install</code> page you can send yourself (or a colleague) the exact install link by SMS, WhatsApp, or email.
      </Callout>
    </HelpArticle>
  );
}
