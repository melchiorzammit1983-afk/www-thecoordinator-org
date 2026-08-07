# One shared bulk template + smart paste everywhere

Make the uploaded v2 sheet the single official trip template across the app, with a live "Message to Copy" column, and make pasting either format (sheet rows or the message text) fill the form correctly — in the coordinator's New trip dialog and in every company/HR portal booking screen. The hotel/guest portal stays exactly as it is today.

## What changes for the user

1. **Download template** now gives the v2 layout, matching the uploaded file:
   `Client/Company, Journey type, Pickup Date, Pickup Time, Passenger Name, Phone Number, Email, Pickup Address, From Flight, From Vessel, Delivery Address, To Flight, To Vessel, Pax Count, Notes, Vehicle, Immigration Needed, Operation Name, Message to Copy`
   - Excel version: column S ("Message to Copy") holds a real formula, so the message rebuilds itself as the user types on that row. Blank rows carry the formula ready to use.
   - CSV/Google Sheets version: same columns, with the formula included so it stays live after import.
   - Example rows (road transfer, flight→ship, ship→flight, ship departure/arrival, flight departure) plus an updated Instructions sheet.
2. **Pasting works both ways** in the same box:
   - paste rows copied from the sheet (with or without headers), or
   - paste the "Label - value" message from column S — one message, or several at once.
3. **Same template and same paste box** on the company/agent portal bulk booking screen and the HR crew/booking screens, so every portal user files trips in one format. Guest hotel portal is untouched.

## Technical detail

**`src/lib/sheet-template.ts`**
- Replace `SHEET_HEADERS` with the v2 order above and rewrite `SAMPLE_ROWS` / `INSTRUCTIONS` to match the uploaded file.
- Add a `MESSAGE_FORMULA` builder: for xlsx, write column S as `{ f: CONCATENATE(...) }` referencing that row's cells; for CSV, emit the same as an `=CONCATENATE(...)` string so Sheets keeps it live. Apply it to sample rows and ~200 blank rows.
- Parser updates:
  - `HEADER_ALIASES`: add `client/company`, `journey type` (read into `flightorship`/type, never used to classify — journey type stays derived from addresses, as today), `message to copy` (ignored on import).
  - Headerless fallback order must match the new column order.
  - **Multi-line cells**: `parseSheetPaste` currently splits on `\n` before parsing quotes, so a stacked `Passenger Name` / `Phone Number` cell breaks the row. Split records quote-aware first, then split fields; inside a name/phone cell, split on newlines and zip names to phones positionally (first phone becomes the booking contact).
  - `fileToSheetTsv` must keep embedded newlines (currently flattened into the tab join) — return quoted TSV that the new record splitter understands.

**`src/lib/labeled-message-parser.ts`**
- Add aliases already present in the v2 messages: `journey type` (parsed, not used for classification), `company`, `vehicle`, `pax count`, `to vassel`, and tolerate the missing space in `time-`.
- Passenger block: accept `Name - phone` pairs and keep each passenger's own phone alongside the name, rather than only capturing the first phone.
- Block splitting: currently only a new `Operation Name` line starts a new trip. Also start a new block when a `date` label appears after the previous block already has a date, so messages without an operation name still separate.

**Coordinator — `src/components/coordinator/JobFormDialog.tsx`**
- No behaviour change needed in the tab wiring (it already tries labeled-message first, then sheet paste); it picks up the new columns/parsers automatically.
- Update the Template dropdown labels/help text to mention the Message-to-Copy column.

**Portals / HR — `src/components/portal/BulkBookingGrid.tsx` (used by `src/routes/portal.$token.tsx`)**
- Add the same "Template" download menu (xlsx + CSV) using `sheet-template.ts`, replacing `booking-sheet-template.ts` as the offered download.
- Route uploads and pastes through the same detect → `parseLabeledMessages` / `parseSheetPaste` path, then map `ParsedTrip` into the grid's row shape (including the existing `selected` and `vehicle` fields).
- Keep the grid's existing columns and submit logic unchanged — only the intake format is unified.
- `src/lib/booking-sheet-template.ts` is kept only if still referenced elsewhere; otherwise removed.

**Untouched:** guest hotel portal (`src/routes/g.$session.tsx`, `h.$slug.*`) keeps its current simpler booking flow.

## Verification
- Download both templates, confirm column S recalculates in Excel and Google Sheets.
- Paste the uploaded v2 file's rows (multi-line passenger cells included) into the coordinator bulk box → expect one trip per primary row with all passengers and their phones.
- Paste a single column-S message, and several messages at once → same results.
- Repeat both pastes in the portal bulk grid.
