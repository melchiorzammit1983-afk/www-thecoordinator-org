## Plan: Fix AI Auto-Coordinate behavior

### What I found
- The app has today’s trips in the backend: **3 trips today**, **2 pending/unassigned**, and the driver **BaygorCab (me)** exists.
- The Auto-Coordinate planner only queries unassigned trips, but its prompt says to assign only when a driver “clearly fits.” That means even a direct instruction like “move all today trips to BaygorCab” can still come back with zero proposals.
- The Calendar **AI Auto-Coordinate** button currently runs immediately with no prompt, so it cannot ask “what do you want to do?” before planning.
- The standalone Auto-Coordinate dialog does not support the newer `dispatch` proposal type yet; the chat path does.

### Changes to make
1. **Honor explicit target directives deterministically**
   - In `runAutoCoordinate`, when there is a resolved target:
     - `driver` target: create `assign` proposals directly for all eligible unassigned trips, instead of relying on Gemini to decide.
     - `partner` target: create `dispatch` proposals directly for all eligible unassigned trips.
   - Keep AI planning for general “coordinate my backlog” requests with no specific target.

2. **Improve today/all wording support**
   - Add directive-aware filtering so instructions like “today” only propose today’s unassigned trips.
   - Keep “all” as all currently eligible unassigned trips.

3. **Change Calendar Auto-Coordinate button flow**
   - Opening the Auto-Coordinate window should first show: **“What do you want to do?”**
   - Add a text box and quick chips like:
     - “Assign today’s unassigned trips to…”
     - “Group similar trips”
     - “Dispatch unassigned trips to partner…”
   - Only run after the coordinator presses **Plan**.

4. **Bring standalone dialog up to date**
   - Support `dispatch` proposal cards in `AiAutoCoordinateButton`.
   - Pass the typed directive to `aiAutoCoordinate`.
   - Show clearer zero-result text: if trips were considered but no proposal was made, say why and suggest entering a clearer target.

5. **Keep confirm-first behavior**
   - No trip assignment/dispatch happens automatically.
   - The assistant/dialog will show proposals, and the coordinator must press **Accept** / **Accept all**.

### Technical notes
- Main files:
  - `src/lib/coordinator.functions.ts`
  - `src/components/coordinator/AiAutoCoordinateButton.tsx`
- No database schema change is needed.
- Existing apply function will still perform the actual confirmed assignment/dispatch.