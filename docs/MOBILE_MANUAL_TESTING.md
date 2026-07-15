# Mobile Deployment — Manual Testing

## Setup

- Preview URL: `https://id-preview--<project>.lovable.app` (SW guarded off).
- Published URL: `https://www.thecoordinator.org` (real PWA behavior).
- Test devices:
  - **Android** phone (Chrome), Android 10+.
  - **iPhone** (Safari), iOS 16.4+ recommended.
  - **Desktop** Chrome or Edge.

## 1. PWA install — Android (Chrome)

1. Open the published URL on Android Chrome.
2. Visit `/install`. Confirm three cards render with QR codes.
3. Tap "Install now" on the **Coordinator** card. Chrome install sheet
   appears. Confirm install.
4. Open the installed app from the home screen. It launches full-screen
   (no browser chrome), title shows "Coordinator".
5. Navigate to `/m/client` in a new browser tab, install from `/install`
   → **Client** card. Confirm the installed shortcut is named "Trip
   Portal" and opens on `/m/client`.
6. Uninstall both apps and repeat once for a clean baseline.

## 2. PWA install — iPhone (Safari, iOS 16.4+)

1. Open the published URL in Safari.
2. Visit `/install` → **Client** card. Follow the "Add to Home Screen"
   steps in the accordion.
3. Verify the home-screen icon uses the teal client badge and the app
   opens at `/m/client` without Safari chrome.
4. Repeat for the **Coordinator** card at `/coordinator`.

## 3. PWA install — Desktop (Chrome / Edge)

1. Open `/coordinator`.
2. Confirm the browser shows an install icon in the address bar OR the
   in-app InstallPrompt banner appears.
3. Install; app opens in its own window with the Coordinator name.

## 4. Install-prompt behavior

1. Open the published site in Chrome incognito.
2. Confirm the InstallPrompt banner appears after a moment on eligible
   routes.
3. Click **Not now**. Reload — banner should stay hidden for 7 days
   (`cc.pwa.install.dismissed` in `localStorage`).
4. Clear site data. Confirm the banner returns.
5. Open `/m/client` — banner copy reads "Install Trip Portal".
6. Open `/coordinator` — banner copy reads "Install Coordinator".

## 5. Update prompt

1. Ship a code change to production.
2. In an already-open installed PWA session, wait up to an hour (or force
   `navigator.serviceWorker.getRegistration()` `.update()` from DevTools).
3. Confirm a **"A new version is available"** toast appears with a
   **Refresh** action.
4. Click Refresh — the app reloads on the new version.

## 6. SW guard — preview must NOT register

1. Open the Lovable preview URL (`id-preview--…`).
2. In DevTools → Application → Service Workers, confirm **no worker is
   registered for `/sw.js`**.
3. If a stale worker exists from a previous test, the guarded wrapper
   unregisters it automatically — reload the tab and confirm it's gone.
4. Navigate with `?sw=off` on production — confirm the wrapper
   unregisters and a manual reload has no SW controlling the page.

## 7. Offline shell

1. On an installed Coordinator PWA (production), load `/coordinator`.
2. Enable airplane mode.
3. Navigate to a route that was loaded earlier — confirm HTML + shell
   still render from the cache (data may show empty states or errors,
   which is expected).
4. Restore network — confirm normal fetches resume.

## 8. Download portal

1. Visit `/install` from a fresh browser.
2. Confirm all three QR codes render and encode absolute URLs.
3. Confirm the driver card shows "APK build coming soon" until
   `public/releases.json` has `driver.apk_url` filled in.
4. After uploading an APK, confirm the driver QR encodes the APK URL
   and the download button downloads a `.apk`.

## 9. Driver APK install (once first APK is built)

1. On Android, tap the APK link from `/install` or from an emailed link.
2. Confirm Android prompts to allow "Install unknown apps" for the
   browser. Allow it.
3. Install the APK. Icon on home screen shows the driver badge.
4. Launch the app — the Coordinator Driver web app loads inside the
   Capacitor shell.
5. Sign in with a driver token. Confirm the trip screen loads.
6. Allow **Location: Always** and **Notifications** when prompted.
7. Lock the phone → confirm the persistent "Sharing live location with
   dispatcher" notification stays visible and driver location keeps
   updating in the coordinator dashboard (`/coordinator` map).

## 10. Push notification permission (once server + secrets ship)

1. In an installed Coordinator PWA, open notification settings.
2. Toggle a category on. Browser prompts for Notification permission —
   allow.
3. Confirm a row appears in `push_devices` for your `user_id`.
4. Trigger the corresponding event from a second device (e.g. a driver
   requests boarding approval). Confirm a push notification arrives
   within a few seconds.
5. Tap the notification — confirm it opens the correct route and a
   `clicked_at` timestamp is written to `notification_log`.
6. Turn the category off in settings, trigger the event again, and
   confirm **no** notification arrives (verify `notification_log` shows
   the suppressed send with an `error` reason of `preference_disabled`).

## 11. Push notification — driver APK (once native wiring ships)

1. Install the driver APK. Sign in.
2. Grant Notifications permission.
3. Confirm a row appears in `push_devices` with `platform = 'android'`.
4. Assign a new job to that driver from the coordinator dashboard.
5. Confirm the notification arrives even with the app backgrounded.
6. Tap the notification → the driver app opens on the assigned trip.

## 12. Biometric unlock (once biometric patch ships)

1. Sign in on the client PWA. Open settings → toggle **Unlock with
   Face ID / fingerprint** on. Browser or OS prompts to verify.
2. Confirm a row appears in `webauthn_credentials`.
3. Background the app for longer than the auto-lock timer.
4. Foreground the app → LockScreen appears with a biometric prompt.
5. Authenticate with fingerprint / Face ID → app unlocks without a
   password.
6. Cancel the biometric prompt → confirm the "Sign in with password"
   fallback works.
7. Turn the setting off — confirm the LockScreen is no longer shown
   on foreground.

## Regression checklist

Before shipping any patch under this initiative, re-run:

- Coordinator dashboard: create trip, assign driver, complete trip.
- Driver: accept, arrive, complete a trip.
- Client: open portal, live-track a driver, chat.
- Audit chain: `SELECT * FROM public.verify_trip_audit_chain(<job>);`
  — all rows return `ok = true`.

If any of these regress, the change touched an existing workflow and
should be reverted per the rollback plan in
`docs/MOBILE_DEPLOYMENT_COMPLETED.md`.
