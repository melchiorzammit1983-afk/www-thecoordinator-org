/** Shared between the crew-portal API routes (validation) and the dashboard UI (labels). */
export const CREW_STATUSES = [
  "not_yet_departed",
  "boarding",
  "boarded",
  "landed",
  "missed_connection",
  "delayed",
  "arrived",
] as const;

export type CrewStatus = (typeof CREW_STATUSES)[number];

/** Statuses crew can actively tap (not_yet_departed is only ever an implicit default). */
export const CREW_STATUS_ACTIONS: CrewStatus[] = [
  "boarding", "boarded", "landed", "missed_connection", "delayed", "arrived",
];
