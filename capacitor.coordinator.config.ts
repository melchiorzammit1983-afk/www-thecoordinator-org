import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Scaffold for a future coordinator APK. Not wired to any build script yet.
 * To use: copy this file to `capacitor.config.ts` on the developer machine,
 * then `npx cap sync android && cd android && ./gradlew assembleRelease`.
 */
const config: CapacitorConfig = {
  appId: "org.thecoordinator.dispatch",
  appName: "Coordinator",
  webDir: "dist",
  server: {
    url: "https://www.thecoordinator.org/coordinator",
    cleartext: false,
  },
  ios: { contentInset: "always" },
  android: { allowMixedContent: false },
};

export default config;
