# Native driver app (iOS + Android)

The web app is wrapped with Capacitor so drivers can install it on a phone
and share their live location to the coordinator dashboard even when the
screen is locked or the app is minimized.

Coordinators and desktop users keep using the web app — no changes needed.

## First-time setup (on your Mac / PC — not inside Lovable)

Requires: Node 20+, and Xcode (iOS) or Android Studio (Android) installed.

```bash
git pull
npm install                     # or: bun install

npx cap add ios                 # once, on macOS only
npx cap add android             # once
npx cap sync                    # copies web config + plugins into the native shells
```

After `cap add`, edit these two files once to declare the permissions the
background-geolocation plugin needs (Capacitor's `sync` won't add them for
you):

### `ios/App/App/Info.plist`
Inside `<dict>` add:
```xml
<key>NSLocationWhenInUseUsageDescription</key>
<string>Share your live location with the dispatcher while you're driving.</string>
<key>NSLocationAlwaysAndWhenInUseUsageDescription</key>
<string>Continue sharing your live location with the dispatcher while the app is in the background.</string>
<key>UIBackgroundModes</key>
<array>
  <string>location</string>
</array>
```

### `android/app/src/main/AndroidManifest.xml`
Inside `<manifest>` (above `<application>`) add:
```xml
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_BACKGROUND_LOCATION" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_LOCATION" />
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
```

Then:
```bash
npx cap sync
npx cap open ios       # Xcode: pick your device, press Run
npx cap open android   # Android Studio: pick your device, press Run
```

## After the first build

`capacitor.config.ts` points `server.url` at `https://transfersmt.lovable.app`.
That means every change you ship from Lovable appears instantly in the
installed app — you do NOT need to rebuild in Xcode / Android Studio
for code changes. Rebuild only when:
- you change permissions in the manifests above,
- you upgrade Capacitor or a native plugin,
- you're ready to submit to the App Store / Play Store.

For a stores build, remove the `server.url` block so the app runs from the
bundled `dist/` output, then `npm run build && npx cap sync` before archiving.

## What the driver sees

- Turn on **Share live location** on their manifest → the OS asks for
  **Location: Always** and **Notifications**.
- Android shows a persistent notification *"Sharing live location with
  dispatcher"* while tracking (required by the OS to keep the GPS awake).
- iOS shows the blue location pill in the status bar.
- Turning the toggle off, or force-quitting the app, stops tracking.

## Troubleshooting

- **"Background" badge doesn't appear in the toggle** → the app is running in
  the browser, not the native shell. Open the installed app instead.
- **"Location permission denied. Enable 'Always' in Settings"** → the user
  granted "While using" only. Send them to Settings → Transfers MT →
  Location → Always.
- **Points stop after the screen locks on Android** → battery-saver killed
  the app. Ask the user to allow unrestricted background activity for
  Transfers MT.
