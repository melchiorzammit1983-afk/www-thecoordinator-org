## Audio + TTS layer for Driver Dashboard

Hands-free audio cues and voice readouts for new trips and chat messages, using only browser APIs (no server-side TTS, no audio files).

### Scope

Frontend only. Files:
- New: `src/hooks/use-driver-audio.ts` — chimes + speech synthesis helpers.
- Edit: `src/routes/m.driver.$token.tsx` — detect new-trip / new-chat events, play the right chime, expose the "Speak" emblem in `NavigateHud` and a smaller version in the normal card header, add a per-driver "auto-read" toggle.

No changes to routing, wake lock, server functions, or backend.

### 1. Chimes (Web Audio API, generated on the fly)

Inside `use-driver-audio.ts`:
- Lazy-init a single `AudioContext`; first user interaction (any click on the dashboard) `resume()`s it so autoplay policy doesn't swallow the first chime.
- Two named chimes built from short oscillator envelopes — no asset files:
  - `dispatch` — sharp urgent double-beep (two 880 → 1320 Hz square/triangle blips, ~180 ms total, higher gain).
  - `message` — soft single ding (660 Hz sine with quick attack + gentle decay ~350 ms, lower gain).
- Exported API: `playChime("dispatch" | "message")`, `speak(text, opts?)`, `cancelSpeech()`, `isSpeaking`, `supported`, `autoRead`, `setAutoRead`.

### 2. Speech synthesis (Web Speech API)

- Uses `window.speechSynthesis` + `SpeechSynthesisUtterance`.
- `speak(text)` cancels any in-flight utterance first, so back-to-back events don't queue up minutes of speech.
- Voice/lang: default (`en-US`), rate 1.0, volume 1.0. No voice picker in this pass.
- `autoRead` preference persisted in `localStorage` under `driver:auto-read:<token>` (default off, per the user's "should not force them to read" requirement).
- Fail silently on unsupported browsers (`'speechSynthesis' in window` guard).

### 3. Event detection in `DriverManifest`

Uses existing manifest polling — no new realtime channels. On each `data` change:
- Track previous `jobs[].id` set in a ref. Any newly present job (not in previous set) → `playChime("dispatch")` and, if it's marked urgent (see below) or `autoRead` is on, `speak(...)`.
  - "Urgent" heuristic: no `driver_accepted_at` AND pickup time is within 60 minutes; otherwise treat as a normal new-trip chime with lower priority (still dispatch chime, but no auto-speak unless autoRead).
- Track previous `unread_messages` counts by job id. On increase → `playChime("message")` and, if `autoRead` is on, `speak("New message on trip to <destination>")`. We don't have the message body in the manifest payload, so we announce the arrival, not the content, in this pass.
- First render seeds the refs without firing chimes (no false alerts on load).

### 4. UI: the "Speak" emblem

Two placements, both wired to the same handler:

- **Navigate Mode HUD** (`NavigateHud`): add a large circular Speak button (min 64×64, `rounded-full`, high-contrast primary color, `Volume2` icon from lucide-react while idle, `VolumeX` while speaking to allow tap-to-stop). Positioned to the left of the existing Expand button. Announces the most recent pending event — a small `lastAnnouncement` string ref holds the composed text (e.g. `"New trip: airport pickup at 14:30"` or `"New message on trip to Valletta"`). If nothing is pending, tapping it re-reads the current live instruction + ETA.
- **Normal driver view**: a smaller icon toggle in the header row (only when `inMotion`) that (a) taps to speak the same `lastAnnouncement`, and (b) long-press/secondary menu item toggles `autoRead` on/off with a toast.

Both use `aria-label` and `aria-pressed` for accessibility. Buttons are `type="button"` and don't submit forms.

### 5. Safety + edge cases

- All Web Audio + speechSynthesis calls happen inside effects / event handlers — never during SSR (`typeof window !== 'undefined'` guards).
- On unmount and on `inMotion` flipping false, call `cancelSpeech()` so speech doesn't continue after leaving the dashboard.
- If the tab is hidden, still play the chime (browsers allow this) but skip speech (some browsers suspend `speechSynthesis` when hidden — cancel + drop rather than queue).

### Non-goals

- No provider TTS, no server round-trip, no audio uploads.
- No push notifications or background service worker.
- No voice-command input (mic listening) — this pass is output only.
- No new dependencies.
