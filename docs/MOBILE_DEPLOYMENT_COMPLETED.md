# Mobile Deployment — Completed

Landed the additive mobile-distribution scaffold. Existing dispatch,
safety, audit, route-optimization, and points workflows are untouched.

## Files changed / added

### Documentation
- `docs/MOBILE_DEPLOYMENT_PLAN.md` — the approved plan.
- `docs/MOBILE_DEPLOYMENT_COMPLETED.md` — this file.
- `docs/MOBILE_MANUAL_TESTING.md` — install / push / offline scenarios.

### Database
Single migration adds five tables (all with RLS + GRANTs):
- `push_devices` — one row per browser/phone that can receive push.
- `notification_preferences` — per-user category toggles.
- `notification_log` — send / delivery / click history.
- `user_security_settings` — biometric-unlock preferences.
- `webauthn_credentials` — public keys for platform authenticators.

### PWA infra
- `public/manifest.driver.webmanifest`
- `public/manifest.client.webmanifest`
- `public/manifest.coordinator.webmanifest`
- `public/icons/{driver,client,coordinator}-512.png` (used at 512 + maskable)
- `src/lib/pwa/register-sw.ts` — guarded SW registration wrapper (refuses
  on preview / iframe / dev / `?sw=off`; unregisters stale registrations
  in those contexts).
- `src/components/pwa/InstallPrompt.tsx` — role-aware install banner.
- `src/components/pwa/UpdatePrompt.tsx` — "new version — refresh" toast.
- `src/routes/__root.tsx` — swaps `<link rel="manifest">` per role and
  mounts the two prompts + the SW registration.
- The existing `public/sw.js` is reused unchanged (network-first HTML,
  runtime cache, push handler, notification-click handler).

### Download portal
- `src/routes/install.tsx` — three role cards with QR codes, install
  buttons, and platform-specific instructions.
- `public/releases.json` — version + notes for driver / client /
  coordinator (edit whenever you ship a new APK or release).
- `public/downloads/` — where you drop APKs; empty until the first APK
  is built on a developer machine.

### Native (Capacitor) scaffolding
- `capacitor.coordinator.config.ts` — scaffold for a future coordinator
  APK (not wired to any build).
- `scripts/build-driver-apk.sh` — one-command driver APK build for a
  developer machine.
- The existing `capacitor.config.ts` continues to target the driver app.

## APK build process (developer machine only)

The Lovable sandbox has no Android SDK, so APKs are built locally.

```bash
# One-time
bun install
npx cap add android
# Edit android/app/src/main/AndroidManifest.xml — see docs/native-app.md
# Generate an upload keystore, export the four ANDROID_* env vars

# Each release
./scripts/build-driver-apk.sh 1.0.0
# → dist-apk/driver-v1.0.0.apk + dist-apk/driver-latest.apk
# Copy the APK into public/downloads/ and update public/releases.json
# (set `driver.version`, `driver.apk_url`, `driver.released_at`, `driver.notes`).
```

The driver APK connects to the production web app via
`capacitor.config.ts` `server.url`, so code changes shipped from Lovable
appear in installed drivers' apps without rebuilding the APK.

## PWA installation guide (users)

- **Android (Chrome / Edge)** — open `/install`, tap "Install now" on
  the coordinator or client card. Chrome may also show an in-address-bar
  install icon.
- **iPhone / iPad (Safari, iOS 16.4+)** — open `/install`, follow the
  "Add to Home Screen" steps in the card. Push notifications require
  iOS 16.4 and require the app to be installed to the home screen.
- **Desktop (Chrome / Edge)** — visit `/coordinator`; the address bar
  shows an install icon.

The install banner also appears automatically inside the app for
first-time visitors on eligible browsers.

## Push notifications (follow-up patch, gated on secrets)

Database + tables are in place. The server + client wiring is the next
patch and needs the following secrets to be provided first:

- `FCM_SERVICE_ACCOUNT_JSON` — Firebase project → Service accounts →
  Generate new private key.
- `VAPID_PUBLIC_KEY` and `VITE_VAPID_PUBLIC_KEY` (same value, second
  copy is exposed to the client bundle).
- `VAPID_PRIVATE_KEY`.

Once those exist, the follow-up patch adds:

- `src/lib/push.functions.ts` — `registerPushDevice`,
  `unregisterPushDevice`, `updateNotificationPreferences`.
- `src/lib/push.server.ts` — `sendPushToUser(userId, category, payload)`
  with FCM v1 + Web Push fan-out and per-device delivery logging.
- Client web-push subscription on login (writes to `push_devices`).
- Native push registration inside the driver APK.
- Notification-preferences UI (coordinator page, driver sheet, client
  toggle).
- Additive `sendPushToUser` calls from existing server functions at the
  trigger points listed in `docs/MOBILE_DEPLOYMENT_PLAN.md`.

## Biometric unlock (follow-up patch)

Tables (`user_security_settings`, `webauthn_credentials`) are in place.
The follow-up patch adds:

- Web: `@simplewebauthn/browser` + `@simplewebauthn/server` for platform
  authenticators (fingerprint, Face ID, Windows Hello).
- Native: `@capacitor-community/biometric-auth` for the driver APK.
- LockScreen + settings toggle + auto-lock timer.
- Server never mints Supabase sessions from biometric events — biometric
  only unlocks a locally-cached refresh token.

## Testing checklist

See `docs/MOBILE_MANUAL_TESTING.md`.

## Known risks

- Preview environments must not register the SW — the guarded wrapper
  handles this and unregisters stale registrations.
- iOS Web Push requires 16.4+ and installation to the home screen.
- Older browsers (Safari < 16, Edge < 79) fall back to the in-app
  toast — no WebAuthn or Web Push.
- The APK's server.url points at the production domain; a driver on an
  unpublished environment will not see live code from Lovable.

## Rollback

- PWA — replace `public/sw.js` with the kill-switch worker from the PWA
  skill and remove the two prompts from `__root.tsx`.
- Push — flip a global `push_enabled=false` flag in
  `admin_portal_settings` (retain tables + data).
- APK — publish the previous version in `public/releases.json` and drop
  the previous APK into `public/downloads/driver-latest.apk`.
- Biometric — users toggle `biometric_enabled=false` from settings.
