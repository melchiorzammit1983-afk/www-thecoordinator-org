/**
 * Shared types for the coordinator dispatch dashboard.
 *
 * Extracted from coordinator.calendar.tsx so the board views, trip cards and
 * menus can live in their own modules without redeclaring these shapes. One
 * canonical Job/CardCtx is what stops the trip-card renderers drifting apart
 * the way they did before.
 */
import type { Label as TLabel } from "@/components/coordinator/LabelChip";
import type { UrgencyThresholds } from "@/lib/trip-display";
import type { MergeCandidate } from "@/components/coordinator/MergeTripsDialog";

export type Job = {
  id: string;
  trip_no?: number | null;
  from_location: string;
  to_location: string;
  from_port?: { name: string } | null;
  from_berth?: { name: string } | null;
  to_port?: { name: string } | null;
  to_berth?: { name: string } | null;
  date: string;
  time: string;
  pickup_at: string | null;
  flightorship: string | null;
  from_flight: string | null;
  to_flight: string | null;
  flight_schedule_record_id?: string | null;
  ship_event_id?: string | null;
  onward_flight_schedule_record_id?: string | null;
  onward_ship_event_id?: string | null;
  operation_group_id?: string | null;
  operation_groups?: { reference: string; name: string; colour?: string | null } | null;
  tracking_kind?: string | null;
  flight_status: string | null;
  flight_status_note: string | null;
  flight_status_updated_at: string | null;
  flight_scheduled_at: string | null;
  flight_estimated_at: string | null;
  tracking_enabled: boolean;
  qr_strict_mode: boolean;
  status: string;
  driver_id: string | null;
  vehicle: string | null;
  contact_phone: string | null;
  email?: string | null;
  clientcompanyname: string | null;
  notes?: string | null;
  driver_accepted_at: string | null;
  deletion_requested_at: string | null;
  drivers?: {
    name: string;
    vehicle?: string | null;
    phone?: string | null;
    seats_available?: number | null;
    availability_note?: string | null;
  } | null;
  pax?: { id: string; name: string; status?: string | null; boarded_at?: string | null }[];
  labels?: TLabel[];
  external?: boolean;
  chain_role?: "executor" | "creator_watching" | "hop_watching";
  executor_name?: string | null;
  origin_name?: string | null;
  external_driver_name?: string | null;
  payment_status?: string | null;
  grouped_count?: number | null;
  grouped_at?: string | null;
  group_id?: string | null;
  group_name?: string | null;
  group_note?: string | null;
  client_confirmed_at?: string | null;
  source?: string | null;
  coord_approved_at?: string | null;
  parent_job_id?: string | null;
  chain_names?: string[];
  dispatch_status?: string | null;
  dispatch_chain_company_ids?: string[] | null;
  executor_company_id?: string | null;
  traffic_delay_minutes?: number | null;
  traffic_severity?: string | null;
  leave_by_at?: string | null;
  pickup_shift_reason?: string | null;
  pickup_display_name?: string | null;
  dropoff_display_name?: string | null;
  pickup_place_id?: string | null;
  dropoff_place_id?: string | null;
  route_duration_sec?: number | null;
  route_distance_m?: number | null;
  created_by_driver?: boolean | null;
  needs_review?: boolean | null;
  auto_created_from_crew_itinerary?: boolean | null;
  crew_trip_stage?: "created" | "assigned" | "pickup_complete" | null;
};

export type Driver = { id: string; name: string; vehicle: string | null };

export type TripFlagInfo = {
  duplicates: {
    id: string;
    date: string | null;
    time: string | null;
    from_location: string | null;
    to_location: string | null;
    pax_names: string[];
  }[];
  suspicious: {
    id: string;
    date: string | null;
    time: string | null;
    flight_number: string | null;
    from_location: string | null;
    to_location: string | null;
    pax_names: string[];
  }[];
};

export type LiveEtaPoint = {
  job_id: string;
  captured_at: string;
  wait_started_at?: string | null;
  eta_sec?: number | null;
};

export type PendingBoardingApproval = {
  id: string;
  job_id: string;
  status: "pending";
  requested_at: string;
  driver_note?: string | null;
  pax_summary?: {
    onboard?: number;
    noshow?: number;
    cancelled?: number;
    pending?: number;
  } | null;
  job?: {
    id: string;
    from_location: string | null;
    to_location: string | null;
    pickup_display_name?: string | null;
    dropoff_display_name?: string | null;
  } | null;
};

export type CardCtx = {
  onEdit: (j: Job) => void;
  onPax: (j: Job) => void;
  onChat: (j: Job) => void;
  onOpenDetails: (j: Job) => void;
  onAssign: (j: Job, driverId: string | null) => void;
  onConfirmCrewPickup?: (j: Job) => void;
  drivers: Driver[];
  unread: Record<string, { driver: number; client: number; total: number }>;
  highlightId?: string | null;
  selected: Set<string>;
  onToggleSelect: (id: string) => void;
  expandedGroups: Set<string>;
  onToggleExpandedGroup: (gid: string) => void;
  onEditGroup: (groupId: string, jobs: Job[]) => void;
  clientPortalEnabled: boolean;
  clientPresence?: Record<string, string>;
  signals?: Record<
    string,
    {
      unread_client: number;
      unread_driver: number;
      client_change: boolean;
      sos_open: boolean;
      driver_status_new: boolean;
      rejected?: boolean;
      portal_name?: string | null;
      portal_logo_url?: string | null;
    }
  >;
  tripFlags?: Record<string, TripFlagInfo>;
  onDismissFlag?: (jobId: string, kind: "duplicate" | "suspicious") => void;
  onOpenMerge?: (current: MergeCandidate, duplicates: MergeCandidate[]) => void;
  urgency: UrgencyThresholds;
  nowTick: number; // ms — bumped every minute so cards re-evaluate glow
  openFlightFix?: (arg: { jobId: string; code: string; side: "from" | "to" }) => void;
};
export type RenderItem = { kind: "single"; job: Job } | { kind: "group"; group_id: string; jobs: Job[] };

export type ChainStop = { label: string; time?: string | null };
