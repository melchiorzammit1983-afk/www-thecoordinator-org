import { maltaWallTimeToUtcIso } from "@/lib/time";
import { isMaltaLocation } from "@/lib/parse-crew";
import { resolveBookingJourney } from "@/lib/journey-resolver";

/**
 * Phase 3: when HR saves a crew itinerary leg that lands in Malta, auto-create
 * (or group into an existing) trip for the coordinator to review. Crew on the
 * same flight/date/time/destination are grouped into a single trip with N pax.
 *
 * Best-effort by design — called from the public crew-save/edit API routes
 * after the crew row itself is already persisted, so a failure here must never
 * roll back or block the crew save.
 */

type MaltaLeg = {
  id: string;
  crew_member_id: string;
  from_location: string;
  to_location: string;
  flight_number: string | null;
  arrival_date: string | null;
  arrival_time: string | null;
};

function normalizeTime(t: string): string {
  // Accept "HH:MM" or "HH:MM:SS"; pad to "HH:MM:SS" for stable equality checks.
  const parts = t.split(":");
  const hh = (parts[0] ?? "00").padStart(2, "0");
  const mm = (parts[1] ?? "00").padStart(2, "0");
  const ss = (parts[2] ?? "00").padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

/** Picks the Malta-landing leg (if any) out of a crew member's saved itinerary rows. */
export function pickMaltaLeg(legs: MaltaLeg[]): MaltaLeg | null {
  return legs.find((l) => isMaltaLocation(l.to_location) && l.arrival_date && l.arrival_time) ?? null;
}

/**
 * Detach a crew member from any auto-created trip they were previously grouped
 * into (used before re-applying itinerary edits, or on delete). Removes their
 * pax row and their itinerary id from the job's crew_itinerary_ids array; the
 * job itself is left in place (coordinator may already be reviewing it) even
 * if it ends up with zero crew.
 */
export async function detachCrewFromAutoTrips(admin: any, crewMemberId: string): Promise<void> {
  const { data: legIds } = await admin
    .from("crew_itineraries")
    .select("id")
    .eq("crew_member_id", crewMemberId);
  const ids: string[] = (legIds ?? []).map((r: any) => r.id);
  if (!ids.length) return;

  const { data: jobs } = await admin
    .from("jobs")
    .select("id, crew_itinerary_ids")
    .eq("auto_created_from_crew_itinerary", true)
    .overlaps("crew_itinerary_ids", ids);
  for (const job of (jobs ?? []) as any[]) {
    const remaining = (job.crew_itinerary_ids ?? []).filter((id: string) => !ids.includes(id));
    await admin.from("jobs").update({ crew_itinerary_ids: remaining }).eq("id", job.id);
  }

  const { data: crew } = await admin
    .from("crew_members")
    .select("name, surname")
    .eq("id", crewMemberId)
    .maybeSingle();
  if (crew && (jobs ?? []).length) {
    const fullName = `${crew.name} ${crew.surname}`.trim();
    const jobIds = (jobs ?? []).map((j: any) => j.id);
    await admin.from("pax").delete().eq("name", fullName).in("job_id", jobIds);
  }
}

export async function autoCreateOrGroupCrewTrip(
  admin: any,
  params: { portalCompanyId: string; crewMemberId: string; crewFullName: string; leg: MaltaLeg },
): Promise<{ job_id: string; created: boolean } | null> {
  const { portalCompanyId, crewMemberId, crewFullName, leg } = params;
  if (!leg.arrival_date || !leg.arrival_time) return null;
  if (!isMaltaLocation(leg.to_location)) return null;

  const { data: portal } = await admin
    .from("portal_companies")
    .select("id, name, coordinator_company_id, notification_email, contact_email")
    .eq("id", portalCompanyId)
    .maybeSingle();
  if (!portal) return null;
  const coordinatorCompanyId = portal.coordinator_company_id as string;

  let pickupAt: string;
  try {
    pickupAt = maltaWallTimeToUtcIso(leg.arrival_date, leg.arrival_time);
  } catch {
    return null;
  }
  const normTime = normalizeTime(leg.arrival_time);
  const flightNo = (leg.flight_number || "").trim().toUpperCase() || null;
  // This importer has an explicit arrival-leg semantic; this is not inferred
  // from free-text locations. The shared resolver therefore remains the
  // authority for the generated journey and tracking classification.
  const journey = resolveBookingJourney("airport", "local");

  // Group crew on the same flight/date/time/destination into one trip.
  let existingQ = admin
    .from("jobs")
    .select("id, crew_itinerary_ids")
    .eq("company_id", coordinatorCompanyId)
    .eq("auto_created_from_crew_itinerary", true)
    .eq("date", leg.arrival_date)
    .eq("to_location", leg.to_location)
    .eq("time", normTime);
  existingQ = flightNo ? existingQ.eq("flightorship", flightNo) : existingQ.is("flightorship", null);
  const { data: existing } = await existingQ.maybeSingle();

  let jobId: string;
  let created = false;

  if (existing) {
    jobId = existing.id;
    const ids = new Set<string>(existing.crew_itinerary_ids ?? []);
    ids.add(leg.id);
    await admin.from("jobs").update({ crew_itinerary_ids: Array.from(ids) }).eq("id", jobId);
  } else {
    const { data: job, error } = await admin
      .from("jobs")
      .insert({
        company_id: coordinatorCompanyId,
        origin_company_id: coordinatorCompanyId,
        executor_company_id: coordinatorCompanyId,
        from_location: leg.from_location || leg.to_location,
        to_location: leg.to_location,
        from_location_type: "airport",
        to_location_type: "local",
        date: leg.arrival_date,
        time: normTime,
        pickup_at: pickupAt,
        flightorship: flightNo,
        from_flight: flightNo,
        tracking_kind: journey.trackingKind,
        clientcompanyname: `${portal.name} — crew change`,
        status: "pending",
        needs_review: true,
        auto_created_from_crew_itinerary: true,
        crew_itinerary_ids: [leg.id],
      })
      .select("id")
      .single();
    if (error || !job) {
      console.error("autoCreateOrGroupCrewTrip: failed to create job", error);
      return null;
    }
    jobId = job.id;
    created = true;
    await admin.from("crew_trip_confirmations").insert({ job_id: jobId, stage: "created" });
    if (flightNo) {
      const { applyLiveStatusToJobBg } = await import("@/lib/coordinator.functions");
      applyLiveStatusToJobBg(jobId);
    }
  }

  // Seed a pax row for this crew member if not already present.
  const { data: existingPax } = await admin
    .from("pax")
    .select("id")
    .eq("job_id", jobId)
    .eq("name", crewFullName)
    .maybeSingle();
  if (!existingPax) {
    await admin.from("pax").insert({ job_id: jobId, name: crewFullName });
  }

  if (created) {
    try {
      const { data: company } = await admin
        .from("companies")
        .select("owner_user_id")
        .eq("id", coordinatorCompanyId)
        .maybeSingle();
      if (company?.owner_user_id) {
        const { sendPushToUserImpl } = await import("@/lib/push.functions");
        await sendPushToUserImpl(company.owner_user_id, {
          title: "New crew pickup — needs review",
          body: `${flightNo ?? "Flight"} landing ${leg.arrival_time.slice(0, 5)} · ${crewFullName}`,
          category: "new_job",
          url: "/coordinator/calendar",
          data: { job_id: jobId },
        });
      }
    } catch (e) {
      console.error("autoCreateOrGroupCrewTrip: coordinator push failed", e);
    }
  }

  return { job_id: jobId, created };
}

// ---------- Notifications for the assign/pickup-complete stages ----------

type TripAudience = {
  hrEmail: string | null;
  crew: { id: string; email: string; name: string; surname: string }[];
  flightorship: string | null;
  pickup_at: string | null;
  to_location: string;
};

async function resolveTripAudience(admin: any, jobId: string): Promise<TripAudience | null> {
  const { data: job } = await admin
    .from("jobs")
    .select("id, crew_itinerary_ids, flightorship, pickup_at, to_location")
    .eq("id", jobId)
    .maybeSingle();
  if (!job || !Array.isArray(job.crew_itinerary_ids) || job.crew_itinerary_ids.length === 0) return null;

  const { data: legs } = await admin
    .from("crew_itineraries")
    .select("crew_member_id")
    .in("id", job.crew_itinerary_ids);
  const crewIds = Array.from(new Set(((legs ?? []) as any[]).map((l) => l.crew_member_id)));
  if (!crewIds.length) return null;

  const { data: crewRows } = await admin
    .from("crew_members")
    .select("id, email, name, surname, portal_company_id")
    .in("id", crewIds);
  const crew = (crewRows ?? []) as any[];
  if (!crew.length) return null;

  const { data: portal } = await admin
    .from("portal_companies")
    .select("notification_email, contact_email")
    .eq("id", crew[0].portal_company_id)
    .maybeSingle();

  return {
    hrEmail: portal?.notification_email || portal?.contact_email || null,
    crew: crew.map((c) => ({ id: c.id, email: c.email, name: c.name, surname: c.surname })),
    flightorship: job.flightorship,
    pickup_at: job.pickup_at,
    to_location: job.to_location,
  };
}

async function enqueueNotificationEmail(admin: any, to: string, subject: string, text: string) {
  await admin.rpc("enqueue_email", {
    queue_name: "transactional_emails",
    payload: {
      to,
      from: "The Coordinator <noreply@thecoordinator.org>",
      sender_domain: "thecoordinator.org",
      subject,
      text,
      html: `<p>${text.replace(/\n/g, "<br/>")}</p>`,
      purpose: "transactional",
      label: "crew_trip_notification",
      idempotency_key: `crew-trip-${to}-${Date.now()}`,
      message_id: crypto.randomUUID(),
    },
  });
}

/** Coordinator assigned a driver to an auto-created crew trip — notify HR + crew. */
export async function notifyCrewTripAssigned(
  admin: any,
  jobId: string,
  driver: { name: string; car_make_model: string | null; plate: string | null },
): Promise<void> {
  const audience = await resolveTripAudience(admin, jobId);
  if (!audience) return;
  const car = [driver.car_make_model, driver.plate].filter(Boolean).join(" · ");
  const line = `Your pickup driver: ${driver.name}${car ? ` (${car})` : ""}. Flight ${audience.flightorship ?? ""} to ${audience.to_location}.`;

  const emails: Promise<void>[] = [];
  if (audience.hrEmail) {
    emails.push(enqueueNotificationEmail(admin, audience.hrEmail, "Driver assigned to your crew pickup", line));
  }
  for (const c of audience.crew) {
    emails.push(enqueueNotificationEmail(admin, c.email, "Your pickup driver", `Hi ${c.name}, ${line}`));
  }
  await Promise.allSettled(emails);
}

/** Coordinator confirmed the pickup is complete — notify HR + crew. */
export async function notifyCrewTripPickupComplete(admin: any, jobId: string): Promise<void> {
  const audience = await resolveTripAudience(admin, jobId);
  if (!audience) return;
  const emails: Promise<void>[] = [];
  if (audience.hrEmail) {
    emails.push(
      enqueueNotificationEmail(
        admin,
        audience.hrEmail,
        "Crew pickup complete",
        `Pickup for flight ${audience.flightorship ?? ""} to ${audience.to_location} is complete.`,
      ),
    );
  }
  for (const c of audience.crew) {
    emails.push(
      enqueueNotificationEmail(admin, c.email, "Pickup complete", `Hi ${c.name}, your pickup is complete. Safe travels!`),
    );
  }
  await Promise.allSettled(emails);
}
