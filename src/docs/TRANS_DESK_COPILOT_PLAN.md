# TRANS DESK - COPILOT MASTER PLAN

## PROJECT OBJECTIVE

Transform the current Trans Desk Driver App into a professional, touchless, GPS-verified transport platform with:

- GPS Validation
- Automatic Status Updates
- Waiting Time Tracking
- Passenger Boarding Verification
- Driver Safety Mode
- Emergency Overrides
- Full Audit Trail
- Grouped Trip Management
- Route Optimization
- Auto Next Job

---

# IMPORTANT RULES FOR COPILOT

Before making any code changes:

1. Read all files in the /docs folder.
2. Analyze existing code first.
3. Reuse existing functionality whenever possible.
4. Avoid breaking changes.
5. Prefer extending existing systems.
6. Update documentation after every phase.
7. Complete one phase at a time.
8. Do not start a new phase until the previous phase is tested.
9. Always explain database changes before applying them.
10. Always generate a completion report.

---

# DRIVER WORKFLOW

Trip Assigned
↓
Accepted
↓
Navigate
↓
Arrived
↓
Waiting
↓
Passenger On Board
↓
En Route
↓
Auto Drop Off
↓
Manual Complete
↓
Auto Next Trip

---

# PHASE 0 - DISCOVERY

Goal:
Understand the current system.

Tasks:

- Review entire codebase.
- Review driver app.
- Review coordinator app.
- Review database schema.
- Review navigation system.
- Review waiting charge system.
- Review grouped trips.
- Review passenger system.
- Check if coordinates already exist.
- Check map provider.
- Check route provider.
- Check geocoding system.

Deliverables:

- Architecture Report
- Database Report
- Risk Report
- Missing Features Report

No coding during Phase 0.

---

# PHASE 1 - GPS VALIDATION

Goal:

Create GPS verified arrivals.

Requirements:

- Company configurable radius.
- GPS validation.
- Reverse geocoding.
- GPS accuracy storage.
- Street address storage.
- Driver heading storage.
- Driver speed storage.

Flow:

Navigate
↓
Arrived

If outside radius:

"Move closer or request override."

Testing:

- Inside radius.
- Outside radius.
- Weak GPS.
- No GPS.

---

# PHASE 2 - WAITING SYSTEM

Goal:

Automate waiting time.

Requirements:

- Waiting begins automatically on Arrived.
- First 5 minutes free.
- Free period configurable.
- Waiting charge displays live.
- Waiting charge stops at En Route.

Display:

Waiting Time
Waiting Charge

Coordinator adjustments require driver approval.

Testing:

- Free period.
- Billing.
- Driver approval.
- Override scenarios.

---

# PHASE 3 - PASSENGER BOARDING

Goal:

Track every passenger.

Statuses:

- On Board
- No Show
- Cancelled

Rules:

- Every passenger must be assigned a status.
- Partial boarding requires coordinator approval.
- Driver override available after 5 minutes.

Testing:

- Single passenger.
- Multiple passengers.
- No Show.
- Partial boarding.

---

# PHASE 4 - SAFETY MODE

Goal:

Reduce driver distraction.

Default speed:

10 km/h

Disable:

- Edit Trip
- Change Route
- Fare Editing
- Waiting Adjustments
- Cancel Trip

Allow:

- Navigation
- Status Updates
- Emergency Button
- Passenger List

UI:

- Large buttons
- Large text
- High contrast
- Minimal touch interaction

Testing:
