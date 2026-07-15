# Mobile Deployment Plan

Status: approved (see `.lovable/plan.md`). Additive only — no changes to
dispatch, safety, audit, route-optimization, or points workflows.

## Role targeting

| Role         | Delivery                                                | Push                | Offline                         | GPS                    | Biometric                                 |
|--------------|---------------------------------------------------------|---------------------|---------------------------------|------------------------|-------------------------------------------|
| Driver       | Android APK (Capacitor)                                 | FCM native          | App shell + last manifest cache | Background location    | Native fingerprint / Face Unlock          |
| Client       | Installable PWA                                         | Web Push (VAPID)    | App shell + trip cache          | Foreground only        | WebAuthn (platform authenticator)         |
| Coordinator  | Installable PWA now; Capacitor scaffold for later APK   | Web Push (VAPID)    | App shell                       | n/a                    | WebAuthn (platform authenticator)         |

## Architecture

```
+----------------+     +----------------------+     +--------------------+
| Driver APK     |     | Client / Coordinator |     | Coordinator dash   |
| Capacitor +    |     | Installable PWA      |     | (desktop web)      |
| BG Geo + FCM   |     | Web Push + WebAuthn  |     |                    |
+-------+--------+     +----------+-----------+     +---------+----------+
        |                         |                           |
        v                         v                           v
+------------------------------------------------------------------------+
|                 Existing TanStack Start app + server fns               |
|   requireSupabaseAuth, RLS, audit chain, points ledger (untouched)     |
+--------+-------------------+--------------------+--------------------+-+
         |                   |                    |                    |
   push_devices        notification_log     user_security_settings   FCM v1
   notif_preferences                        webauthn_credentials    Web Push
```

## Phase 1 — PWA (Client + Coordinator)

- `public/manifest.client.webmanifest`, `manifest.coordinator.webmanifest`,
  `manifest.driver.webmanifest` (existing generic manifest kept as
  fallback for old links).
- Role-specific manifest linked from `src/routes/__root.tsx` based on
  pathname prefix.
- `src/lib/pwa/register-sw.ts` — guarded registration wrapper. Refuses on
  preview / iframe / dev / `?sw=off`; unregisters stale `/sw.js` there.
- Existing `public/sw.js` reused (network-first HTML, runtime cache, push
  handler). Returning browsers auto-upgrade via the standard SW update flow.
- `src/components/pwa/InstallPrompt.tsx` — role-aware banner using
  `beforeinstallprompt`; iOS Safari fallback instructions.
- `src/components/pwa/UpdatePrompt.tsx` — toast on new-waiting-worker.
- Icons: `public/icons/{client,coordinator,driver}-{192,512,maskable-512}.png`.

## Phase 2 — Driver Android APK (Capacitor)

Runs on the developer machine; the Lovable sandbox has no Android SDK.

- `capacitor.config.ts` bumped to `appId: "org.thecoordinator.driver"`,
  `appName: "Coordinator Driver"`.
- `capacitor.coordinator.config.ts` scaffold for later coordinator APK.
- Plugins (installed once, on the developer machine):
  `@capacitor/push-notifications`, `@capacitor/geolocation`,
  `@capacitor/camera`, `@capacitor/splash-screen`, `@capacitor/app`,
  `@capacitor/status-bar`, `@capacitor-community/background-geolocation`,
  `@capacitor-community/biometric-auth`.
- Android permissions (one-time manual edit to `AndroidManifest.xml` —
  see `docs/native-app.md` and the completed doc):
  `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`,
  `ACCESS_BACKGROUND_LOCATION`, `FOREGROUND_SERVICE`,
  `FOREGROUND_SERVICE_LOCATION`, `CAMERA`, `READ_MEDIA_IMAGES`,
  `POST_NOTIFICATIONS`, `INTERNET`, `USE_BIOMETRIC`, `USE_FINGERPRINT`.
- Signing: developer generates a single upload keystore; SHA-256
  fingerprint recorded in `docs/MOBILE_DEPLOYMENT_COMPLETED.md`.
- Build script: `scripts/build-driver-apk.sh`.

## Phase 3 — Push Notifications

### Database (migrated)

| Table                      | Purpose                                          |
|----------------------------|--------------------------------------------------|
| `push_devices`             | one row per browser/phone that can receive push  |
| `notification_preferences` | per-user category toggles                        |
| `notification_log`         | send / delivery / click history + audit          |

RLS: owners read/write their own rows; `service_role` writes delivery
rows on the log. Company admins can be granted read on log via a
follow-up policy if needed.

### Server (follow-up patch)

- `src/lib/push.functions.ts` — `registerPushDevice`,
  `unregisterPushDevice`, `updateNotificationPreferences`,
  `getNotificationPreferences`. All wrapped in `requireSupabaseAuth`.
- `src/lib/push.server.ts` (server-only, dynamic-imported by handlers) —
  `sendPushToUser(userId, category, payload)`:
  1. Load `notification_preferences`; drop if category disabled.
  2. Load `push_devices` for the user; scope by `company_id`.
  3. Fan out: FCM HTTP v1 for `android`/`ios`; Web Push (VAPID) for `web`.
  4. Write a row into `notification_log` per device.
- Hook additively into existing server functions (no workflow changes):
  - Driver: `assignDriver`, boarding decided, safety alert, coord chat,
    coord change request decided, emergency-override coordinator message.
  - Coordinator: boarding approval request, waiting proposal, driver
    override, safety concern / breakdown, route optimization pending,
    driver cancel request.
  - Client: driver assigned, arrived, delayed threshold crossed, trip
    started, trip completed.

### Secrets

Requested via `add_secret` at build time (values pasted by the user):

- `FCM_SERVICE_ACCOUNT_JSON` — Firebase project service account JSON.
- `VAPID_PUBLIC_KEY` and `VITE_VAPID_PUBLIC_KEY` (same value, second copy
  for the client bundle).
- `VAPID_PRIVATE_KEY`.

### Client wiring

- Web: `public/firebase-messaging-sw.js` (kept separate from the app-shell
  SW per the PWA skill). Registered after successful login.
- Native (driver APK): `@capacitor/push-notifications` registers on
  launch; token upserted via `registerPushDevice`.
- Settings UI: coordinator page under `/coordinator`, driver in-sheet in
  `m.driver.$token.tsx`, client toggle in `m/client/$token.tsx`.

## Phase 4 — Biometric unlock

Fingerprint / Face ID / Face Unlock unlocks a previously established
session on the device. Biometric never mints a session on a fresh
device — password (or existing OAuth) is always required first.

### Database (migrated)

- `user_security_settings` — `biometric_enabled`,
  `require_biometric_on_open`, `auto_lock_seconds`.
- `webauthn_credentials` — public key + credential id per registered
  platform authenticator.

### Native (driver APK, follow-up patch)

- Plugin: `@capacitor-community/biometric-auth`.
- `src/lib/biometric/native.ts`: wraps `isAvailable`, `enroll(userId)`
  (stores a random secret in Android Keystore behind biometric),
  `unlock()` (biometric prompt → returns the secret used to decrypt the
  cached Supabase refresh token in Capacitor Secure Storage).
- Auto-lock: `@capacitor/app.appStateChange` → on background >
  `auto_lock_seconds`, clear the in-memory session and show LockScreen.

### PWA (Client + Coordinator, follow-up patch)

- `@simplewebauthn/browser` + `@simplewebauthn/server`.
- Server fns in `src/lib/biometric/webauthn.functions.ts` — begin/finish
  registration, begin/finish assertion.
- Assertion decrypts a locally-cached refresh token; the server does not
  mint sessions from biometric events.
- `src/components/biometric/LockScreen.tsx` gates the app when
  `require_biometric_on_open` is true and the tab was background >
  `auto_lock_seconds`. Fallback: "Sign in with password".

## Phase 5 — Download portal

- Public route `src/routes/install.tsx` with three role cards:
  - **Driver** — APK download, unknown-sources instructions, QR of the APK URL.
  - **Client** — "Install app" (`beforeinstallprompt`), iOS
    Add-to-Home-Screen steps, QR of `/m/client`.
  - **Coordinator** — "Install app", QR of `/coordinator`.
- APK hosting under `public/downloads/`; release manifest at
  `public/releases.json`.

## Phase 6 — Mobile UX review

`docs/MOBILE_UX_REVIEW.md` audits driver, client, coordinator mobile
screens. Fixes limited to spacing / typography / permission-copy /
offline banner. No behavior changes.

## Security posture

- APK signed with the upload keystore; SHA-256 fingerprint documented.
- Every API call still traverses `requireSupabaseAuth`; RLS unchanged.
- Push server verifies device `user_id` and `company_id` before send.
- Biometric server never issues sessions; only stores WebAuthn public
  keys or an opaque "enrolled" marker.
- Enrollment / unlock events append to `notification_log`
  (`category: 'security'`).
- Existing `trip_audit_log` + anti-tampering chain untouched.

## Risks & rollback

| Risk                                        | Mitigation                                                                             |
|---------------------------------------------|----------------------------------------------------------------------------------------|
| SW breakage in preview / dev                | Guarded wrapper refuses to register; `?sw=off` unregisters. Existing SW path reused.   |
| iOS Web Push (requires 16.4 + Add-to-Home)  | Portal shows the requirement; in-app alerts fall back otherwise.                       |
| Sandbox cannot build APKs                   | Repo ships configs + `scripts/build-driver-apk.sh`. Developer runs `gradlew` locally.  |
| WebAuthn not supported (older browsers)     | Toggle hidden when `window.PublicKeyCredential` absent; password fallback always on.   |
| Biometric device loss / lockout             | Password fallback always available.                                                    |
| FCM cost / spam                             | Per-user rate limit + prefs; global `push_enabled` flag in `admin_portal_settings`.    |
| APK sideload friction                       | Portal shows enable-unknown-sources instructions per Android version.                  |

Rollback: PWA → kill-switch SW at `/sw.js` per PWA skill and remove
install prompts. Push → flip `push_enabled = false`; tables retained.
APK → publish the previous version. Biometric → flip
`biometric_enabled = false` per user.

## Build order

1. This plan doc.
2. Migration (push + biometric tables) — done.
3. Role manifests + icons + guarded SW registration + install / update
   prompts.
4. Download portal.
5. Capacitor driver + coordinator configs; build script + docs.
6. Push server + web-push registration on login (requires FCM + VAPID
   secrets from the user first).
7. Biometric WebAuthn wiring (requires `@simplewebauthn/*` install).
8. `docs/MOBILE_DEPLOYMENT_COMPLETED.md` + `docs/MOBILE_MANUAL_TESTING.md`.
