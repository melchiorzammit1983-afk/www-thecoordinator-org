# Mobile Deployment Plan — Role-Targeted + Biometric Unlock

Additive only. No changes to dispatch, safety, audit, or route-optimization workflows.

## Role targeting

| Role | Delivery | Push | Offline | GPS | Biometric |
|---|---|---|---|---|---|
| **Driver** | Android APK (Capacitor) | FCM native | App-shell + last manifest cache | Background location | Native fingerprint / face unlock |
| **Client** | Installable PWA | Web Push (VAPID) | App-shell + trip cache | Foreground only | WebAuthn (platform authenticator) |
| **Coordinator** | Installable PWA now; APK scaffolded for later | Web Push (VAPID) | App-shell | n/a | WebAuthn (platform authenticator) |

## Phase 1 — PWA (Client + Coordinator)

- `vite-plugin-pwa` in `generateSW` mode, `filename: 'sw.js'`, `registerType: 'autoUpdate'`, `injectRegister: null`, `devOptions.enabled: false`.
- Guarded `src/lib/pwa/register-sw.ts` — refuses on preview / iframe / dev / `?sw=off`; unregisters stale `/sw.js` in those contexts. Called from `src/start.ts`. Replaces existing `public/sw.js` at the same path so returning browsers auto-upgrade.
- Workbox: `NetworkFirst` navigations, `CacheFirst` hashed assets, denylist `/~oauth`, `/_serverFn`, `/api`.
- Manifests: `public/manifest.client.webmanifest` (`start_url: /m/client`), `public/manifest.coordinator.webmanifest` (`start_url: /coordinator`). Picked per pathname in `src/routes/__root.tsx` `head().links`.
- Icons via `imagegen`: `public/icons/{client,coordinator}-{192,512,maskable-512}.png` + iOS apple-touch-icon.
- `src/components/pwa/InstallPrompt.tsx` — role-aware banner using `beforeinstallprompt`; iOS Safari fallback instructions.
- `src/components/pwa/UpdatePrompt.tsx` — toast on `onNeedRefresh` → `updateSW(true)`. Version = `import.meta.env.VITE_APP_VERSION`.

## Phase 2 — Driver Android APK (Capacitor)

Configs in repo; build runs on developer machine (Lovable sandbox cannot build APKs).

- Update `capacitor.config.ts`: `appId: org.thecoordinator.driver`, `appName: "Coordinator Driver"`, `server.url` published domain.
- Add `capacitor.coordinator.config.ts` scaffold for later.
- Plugins: `@capacitor/push-notifications`, `@capacitor/geolocation`, `@capacitor/camera`, `@capacitor/splash-screen`, `@capacitor/app`, `@capacitor/status-bar`, `@capacitor-community/background-geolocation`, **`@capacitor-community/biometric-auth`** (or `capacitor-native-biometric`).
- Permissions (documented one-time edits): FINE/COARSE/BACKGROUND_LOCATION, FOREGROUND_SERVICE, FOREGROUND_SERVICE_LOCATION, CAMERA, READ_MEDIA_IMAGES, POST_NOTIFICATIONS, INTERNET, **USE_BIOMETRIC + USE_FINGERPRINT**.
- Signing: upload keystore generated once; fingerprint recorded in plan doc.
- `scripts/build-driver-apk.sh`: `bun run build && npx cap sync android && cd android && ./gradlew assembleRelease` → `dist-apk/driver-v{version}.apk`.

## Phase 3 — Push Notifications

**Migration** (with GRANT + RLS):
- `push_devices` (`user_id`, `company_id`, `role`, `platform`, `token`, `endpoint`, `p256dh`, `auth`, `last_seen_at`, unique `(user_id, token)`).
- `notification_preferences` (per-category booleans).
- `notification_log` (`user_id`, `company_id`, `category`, `title`, `body`, `data`, `sent_at`, `delivered_at`, `clicked_at`, `error`, `device_id`).
- RLS: user owns own devices + prefs; log readable by owner and company admins via `has_role`; `service_role` writes. GRANTs to `authenticated` + `service_role`.

**Server**
- `src/lib/push.functions.ts`: `registerPushDevice`, `unregisterPushDevice`, `updateNotificationPreferences`.
- `src/lib/push.server.ts` (server-only, dynamic-imported): `sendPushToUser(userId, category, payload)` — resolves devices, checks prefs + company, fans out to FCM HTTP v1 + Web Push (VAPID), writes `notification_log`. Rate-limited.
- Trigger points (additive, no workflow edits):
  - Driver: assign, boarding decided, safety alert, coord chat, emergency-override message, coord change request decided.
  - Coordinator: boarding request, waiting proposal, driver override, breakdown/safety event, route optimization pending, driver cancel request.
  - Client: driver assigned, arrived, delayed threshold, trip started, trip completed.

**Secrets requested via `add_secret`:** `FCM_SERVICE_ACCOUNT_JSON`, `VAPID_PUBLIC_KEY` (+ `VITE_VAPID_PUBLIC_KEY`), `VAPID_PRIVATE_KEY`.

**Client wiring**
- Web: `public/firebase-messaging-sw.js` kept separate from app-shell SW (per PWA skill). Registered after login.
- Native (driver APK): `@capacitor/push-notifications` on launch; token upserted via `registerPushDevice`.
- Settings UI: coordinator page, driver sheet, client toggle.

## Phase 4 — Biometric Unlock

Goal: after first successful login the app can be re-opened / re-foregrounded by fingerprint (or Face ID / Face Unlock) instead of re-entering the password. Session stays a normal Supabase session; biometric only guards local access to it.

**Migration**
- `user_security_settings` — `user_id` PK, `biometric_enabled bool`, `require_biometric_on_open bool`, `auto_lock_seconds int` (default 60), `updated_at`. GRANT + RLS: owner-only.

**Native driver APK**
- Plugin: `@capacitor-community/biometric-auth`.
- `src/lib/biometric/native.ts` — `isAvailable()`, `enroll(userId)` (stores a random device-binding secret in Android Keystore behind biometric), `unlock()` (prompts fingerprint/face; on success returns the secret which is used to decrypt the cached Supabase refresh token in Capacitor Secure Storage).
- App lifecycle: on `App.appStateChange` → background >`auto_lock_seconds`, clear in-memory session and show lock screen. Lock screen has fingerprint prompt + fallback "Sign in with password".
- First-run flow: after successful password login → prompt "Enable fingerprint unlock?" → if yes, `enroll` + persist `user_security_settings.biometric_enabled = true`.

**PWA (Client + Coordinator)**
- WebAuthn `PublicKeyCredential` with `authenticatorSelection.authenticatorAttachment: 'platform'` + `userVerification: 'required'` — uses OS fingerprint/Face ID/Windows Hello.
- New tables `webauthn_credentials` (`user_id`, `credential_id`, `public_key`, `sign_count`, `transports`, `created_at`, `last_used_at`) — GRANT + RLS: owner reads; server writes via service role.
- Server fns in `src/lib/biometric/webauthn.functions.ts`:
  - `beginRegistration` → returns challenge; `finishRegistration` → verifies attestation, stores credential.
  - `beginAssertion` → challenge; `finishAssertion` → verifies signature. On success, calls a `service_role` helper to mint a fresh Supabase session via `admin.generateLink` / `signInWithIdToken` pattern OR unlocks a locally-cached refresh token protected by a random device key held behind the WebAuthn credential (chosen approach: local unlock only — no server-issued session — so we never bypass Supabase auth for a new device).
- Uses `@simplewebauthn/server` + `@simplewebauthn/browser`.
- Lock UI: `src/components/biometric/LockScreen.tsx` — shown when `require_biometric_on_open` and app was backgrounded past `auto_lock_seconds`. Fallback: "Sign in with password".
- Settings UI: toggle in coordinator profile and in client portal settings — "Unlock with fingerprint / Face ID" + auto-lock timer.

**Security rules**
- Biometric is an **unlock**, not a login: no biometric flow creates a Supabase session on a fresh device — password (or existing OAuth) always required to enroll first.
- Enrollment binds to a device-generated credential; loss of device just requires re-enrollment on new device.
- Enrollment + unlock events written to `trip_audit_log`-adjacent `notification_log` (`category: 'security'`) so admins can see suspicious re-enrollments.
- No secret material stored server-side; server keeps only the WebAuthn public key or (native) an opaque enrollment marker.

## Phase 5 — Download Portal

- Public route `src/routes/install.tsx`:
  - **Driver** → APK download + unknown-sources instructions + QR of APK URL.
  - **Client** → "Install app" (`beforeinstallprompt`) + iOS Add-to-Home-Screen steps + QR of `/m/client`.
  - **Coordinator** → "Install app" + QR of `/coordinator`.
- Hosting: `public/downloads/driver-latest.apk` + versioned copies; `public/releases.json`.
- `qrcode` npm dep.
- Linked from auth footer and coordinator More menu.

## Phase 6 — Mobile UX Review

`docs/MOBILE_UX_REVIEW.md`: driver, client, coordinator sweep. Touch ≥44px, font ≥14px, safe-area padding, permission-prompt copy, offline banner, notification opt-in placement, biometric prompt copy. Spacing/typography/copy only.

## Security

- APK signed with upload keystore; fingerprint documented.
- All calls go through existing `requireSupabaseAuth`; RLS unchanged.
- Push server verifies device `user_id` + `company_id` before send.
- Biometric unlock never bypasses Supabase auth for new devices; server never stores biometric templates.
- Existing audit trail + anti-tampering untouched.

## Risks & Rollback

- **SW breakage in preview** → guarded wrapper + `?sw=off`; kill-switch worker per PWA skill.
- **iOS Web Push** → iOS 16.4+ Home-Screen install required; portal shows this.
- **Sandbox cannot build APK** → docs + scripts; user runs locally.
- **WebAuthn browser support** → falls back to password automatically; toggle hidden when `PublicKeyCredential` absent.
- **Biometric lockout / no fingerprint** → password fallback always available; toggle can be disabled from settings.
- **FCM cost / spam** → rate limit + prefs; `push_enabled` flag in `admin_portal_settings` for global kill.
- **Rollback**: PWA — kill-switch SW, remove `VitePWA`. Push — flip `push_enabled=false`; tables retained. APK — publish previous version. Biometric — toggle off in `user_security_settings` (data retained).

## Build order

1. `docs/MOBILE_DEPLOYMENT_PLAN.md` (this plan, expanded).
2. Phase 1 PWA (manifests, guarded SW, install/update prompts).
3. Phase 3 DB migration + push server + web push registration on login.
4. Phase 4 biometric: DB (`user_security_settings`, `webauthn_credentials`), WebAuthn server fns, LockScreen, settings toggle.
5. Phase 5 download portal.
6. Phase 2 Capacitor driver-APK config, splash/icons, biometric plugin wiring, build script + docs.
7. Native push wiring inside driver APK.
8. Phase 6 UX sweep.
9. `docs/MOBILE_DEPLOYMENT_COMPLETED.md` + `docs/MOBILE_MANUAL_TESTING.md` (adds biometric enroll/unlock/fallback scenarios).
