
## Diagnosis

Two problems in the screenshot:

1. **`looksLikeSheetPaste` returns false** because the user copied only data rows (no `Pickup Date / Pickup Time / …` header line). The detector requires at least one header keyword in the first row, so the paste falls through to the WhatsApp-message parser, which can't understand TSV and produces the two `? → ?` broken rows.
2. **Contact number shows as `3.93331E+11`** because Excel/Sheets stored the long phone as a number and converted it to scientific notation on copy. Even once row 1 is fixed, that value would be saved as an unusable phone.

The template itself is fine — the issue is on the paste side.

## Fix

### `src/lib/sheet-template.ts`
- **Headerless detection.** Extend `looksLikeSheetPaste` so it also returns true when the first non-empty row splits into ≥ 5 tab- or comma-separated cells AND the first cell parses as a date via `normDate`. That matches the exact shape of the template's data rows and won't false-positive on ordinary chat messages.
- **Scientific-notation phone rescue.** Add a small helper that, before calling `normalizePhone`, detects strings like `3.93331E+11` / `3.5699e10` and expands them back to a plain digit string (`Number(s).toFixed(0)`), then feeds that into `normalizePhone`. Applied inside `parseSheetPaste`.
- **Template hardening.** In `buildWorkbook`, format the Contact Number column as text (`z: "@"` on each cell in that column) and prefix sample phones with a `'` for the CSV path is not needed — the Excel text format alone stops the scientific-notation conversion at the source. Add one Instructions line: "Keep Contact Number as text (already preset) so long numbers don't turn into 3.9E+11."

### `src/components/coordinator/JobFormDialog.tsx` (BulkForm only)
- Update the textarea placeholder and helper line to say: "You can paste rows directly from the template — headers are optional." No logic change beyond what already routes through `looksLikeSheetPaste` / `parseSheetPaste`.

## Verification
- Paste the exact two rows from the screenshot (no header) → both parse into complete trips (`Hotel Cerviola, Marsaskala → Malta International Airport`, 2 pax; `Valletta Cruise Port → Radisson Golden Sands`, 4 pax) with phones `+35699123456` and `+393331234567`.
- Paste the same rows with the header row included → still works (existing path).
- Paste a plain WhatsApp message → still routes to `parseTrips` (detector requires ≥ 5 delimited cells AND a valid date in cell 1).
- Re-download the Excel template, type a long phone, copy the row → phone stays as digits, not scientific notation.

No database, RLS, or server-function changes.
