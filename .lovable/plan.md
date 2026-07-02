## Goal
When the coordinator types a flight code in any format into any text box on the trip form ("From", "To", or either flight box), the system detects it, normalizes it (e.g., `km 643`, `Flight KM-0643`, `flt km643` → `KM643`), moves it into the correct **From flight** or **To flight** field, and auto-sets the location to `Airport` when the location box is empty.

## Scope (frontend only)
Edit only `src/components/coordinator/JobFormDialog.tsx`. No backend / DB changes — the bulk-paste parser already normalizes flight codes on the server side; we're extending the same behavior to the manual form.

## Behavior
1. **Detection rule** (matches existing bulk parser):
   - 2 letters + 1–4 digits, with optional space/dash between (IATA/ICAO carrier + flight number).
   - Optionally preceded by noise like `flight`, `flt`, `#`, `✈`.
   - Case-insensitive; strip spaces/dashes; uppercase the letters.
2. **Trigger**: on `blur` of the four inputs (From, To, From-flight, To-flight). Blur (not per keystroke) so partial typing like `K` doesn't jump fields.
3. **Routing**:
   - Typed into **From** box → move the code to **From flight**; if From location is now empty, set it to `Airport`.
   - Typed into **To** box → move to **To flight**; if To location is empty, set it to `Airport`.
   - Typed into a **flight** box → just normalize in-place (`km 0643` → `KM0643`); if the matching location box is empty, set it to `Airport`.
4. **No overwrite**: if the target flight box already has a value, leave it alone (only clean the source field) and show a small inline hint ("Already has flight — kept existing").
5. **Only one code**: if the From box contains `Airport KM643 T1`, we extract `KM643` and leave the rest as the location text minus the code.

## Technical notes
- Add a local helper `extractFlightCode(text: string): { code: string | null; rest: string }` inside `JobFormDialog.tsx` using a single regex:
  `\b(?:flight|flt|#|✈)?\s*([A-Za-z]{2})\s*-?\s*(\d{1,4})\b`
- Wire `onBlur` handlers on the four `<Input>` elements (lines 171, 172, 181, 182). Update the corresponding `useState` setters (`setFrom`, `setFromFlight`, `setTo`, `setToFlight`).
- Keep the existing `.toUpperCase()` behavior on the flight boxes.
- Small `useState` for a transient hint message shown under the flight box for 3s when we auto-move a code.

## Out of scope
- No changes to the bulk-paste tab (already normalizes).
- No changes to server functions, schema, or validation.
- No live flight-status lookup here — that stays in the existing flight tracking flow.