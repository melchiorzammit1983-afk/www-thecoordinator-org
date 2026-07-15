# Trans Desk — Master Guide

This document tracks the full implementation roadmap for The Coordinator transport desk platform. Each batch is recorded with its status and scope.

---

## Batch Status Overview

| Batch | Phases | Status |
|---|---|---|
| **Batch A** | Phase 2 (Waiting System) + Phase 3 (Passenger Boarding) | ✅ Complete — ready for testing and merge |
| **Batch B** | Phase 4 (Safety Mode) + Phase 5 (Emergency Override) | 🔜 Not started |

---

## Batch A — Complete ✅

**Phases:** Phase 2 (Waiting System) + Phase 3 (Passenger Boarding System)  
**Completed:** 2026-07-15  
**Status:** Ready for testing and merge. Do not start Batch B until Batch A is merged.

### Scope

Batch A delivers automated waiting charge management and a structured passenger boarding approval flow.

**Phase 2 — Waiting System**

- Waiting sessions auto-start when driver marks `arrived`
- Per-company configurable free wait period (`free_wait_minutes`, default 5 min)
- Per-company configurable rate (`waiting_rate_per_minute`, default €0.00)
- `free_ends_at` computed server-side; live charge shown in driver panel
- Sessions auto-close when driver marks `en_route`
- `calculated_amount` immutably stored on close; `agreed_amount` updated only on accepted coordinator proposal
- Coordinator can propose adjusted waiting charge; driver accepts or rejects

**Phase 3 — Passenger Boarding System**

- New `cancelled` pax status and `Cancelled` driver action (amber badge)
- `noshow_at` and `cancelled_at` timestamps recorded
- All passengers must have a non-`pending` status before `in_progress` is allowed
- Driver can request coordinator approval for partial boarding
- Coordinator approves or rejects from TripDetailsSheet
- Driver can override after 5-minute coordinator timeout
- Pending boarding approvals surfaced in coordinator calendar

### Key documents

| Document | Purpose |
|---|---|
| `docs/BATCH_A_IMPLEMENTATION_PLAN.md` | Original plan — database, API, UI changes |
| `docs/BATCH_A_COMPLETED.md` | Post-implementation record — all changes, known risks, rollback instructions |
| `docs/BATCH_A_MANUAL_TESTING.md` | End-to-end testing guide — 10 scenarios with DB verification points |

### Migrations

| Migration | Description |
|---|---|
| `20260709144000_batch_a_step1_waiting_and_boarding_schema.sql` | Waiting policy columns on `companies`; `auto_started`/`free_ends_at` on `job_wait_sessions`; `job_wait_proposals` table; `cancelled` ENUM value; `noshow_at`/`cancelled_at` on `pax`; `job_boarding_approvals` table |
| `20260709150000_batch_a_step2_waiting_logic.sql` | `calculated_amount` column on `job_wait_sessions` |

---

## Batch B — Not Started 🔜

**Phases:** Phase 4 (Driver Safety Mode) + Phase 5 (Emergency Override)  
**Status:** Do not start until Batch A is merged and verified in production.

> See `docs/BATCH_B_IMPLEMENTATION_PLAN.md` and `docs/BATCH_B_ARCHITECTURE_REVIEW.md` for scope and pre-conditions.

---

## Notes

- Batch B has three blocking pre-conditions identified in the architecture review that must be resolved before implementation begins.
- The `pax_status 'cancelled'` ENUM value added in Batch A is irreversible. Any Batch B rollback plan must account for this.
- Feature flags (`features.auto_waiting`, `features.boarding_approval`) are recommended to enable per-company rollout of Batch A features in production.
