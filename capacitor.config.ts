import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "app.lovable.transfersmt",
  appName: "Transfers MT",
  webDir: "dist",
  server: {
    // Live-reload against the published web app so code updates from Lovable
    // appear in the installed native app without rebuilding.
    // For a fully offline / stores build, remove this `server` block and use
    // the bundled `dist/` output.
    url: "https://transfersmt.lovable.app",
    cleartext: false,
  },
  ios: {
    contentInset: "always",
  },
  android: {
    allowMixedContent: false,
  },
  plugins: {
    // Background geolocation plugin uses native permission strings from
    // Info.plist / AndroidManifest — no runtime config needed here.
  },
};

export default config;
