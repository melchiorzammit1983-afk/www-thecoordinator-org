export type ComparableFlightScheduleRecord = {
  scheduledDate: string;
  direction: string;
  airline: string;
  flightNumber: string;
  scheduledTime: string;
  origin: string;
  destination: string;
};

export type FlightScheduleFieldChange = {
  flight: ComparableFlightScheduleRecord;
  before: string;
  after: string;
};

export type FlightScheduleRouteChange = {
  flight: ComparableFlightScheduleRecord;
  before: { origin: string; destination: string };
  after: { origin: string; destination: string };
};

export type FlightScheduleComparison = {
  added: ComparableFlightScheduleRecord[];
  removed: ComparableFlightScheduleRecord[];
  timeChanges: FlightScheduleFieldChange[];
  airlineChanges: FlightScheduleFieldChange[];
  routeChanges: FlightScheduleRouteChange[];
};

function flightIdentity(record: ComparableFlightScheduleRecord) {
  return [record.flightNumber, record.scheduledDate, record.direction]
    .map((value) => value.trim().toLocaleUpperCase())
    .join("|");
}

function exactSignature(record: ComparableFlightScheduleRecord) {
  return [
    record.flightNumber,
    record.scheduledDate,
    record.direction,
    record.scheduledTime,
    record.airline,
    record.origin,
    record.destination,
  ]
    .map((value) => value.trim().toLocaleUpperCase())
    .join("|");
}

function groupByIdentity(records: ComparableFlightScheduleRecord[]) {
  const groups = new Map<string, ComparableFlightScheduleRecord[]>();
  for (const record of records) {
    const key = flightIdentity(record);
    groups.set(key, [...(groups.get(key) ?? []), record]);
  }
  return groups;
}

/**
 * Compares immutable schedule records without modifying them. A normal schedule
 * has one flight per number/date/direction; ambiguous duplicate identities are
 * conservatively treated as added/removed records to avoid false change claims.
 */
export function compareFlightScheduleRecords(
  left: ComparableFlightScheduleRecord[],
  right: ComparableFlightScheduleRecord[],
): FlightScheduleComparison {
  const result: FlightScheduleComparison = {
    added: [],
    removed: [],
    timeChanges: [],
    airlineChanges: [],
    routeChanges: [],
  };
  const leftGroups = groupByIdentity(left);
  const rightGroups = groupByIdentity(right);
  const identities = new Set([...leftGroups.keys(), ...rightGroups.keys()]);

  for (const identity of identities) {
    const oldRecords = leftGroups.get(identity) ?? [];
    const newRecords = rightGroups.get(identity) ?? [];
    if (!oldRecords.length) {
      result.added.push(...newRecords);
      continue;
    }
    if (!newRecords.length) {
      result.removed.push(...oldRecords);
      continue;
    }

    if (oldRecords.length !== 1 || newRecords.length !== 1) {
      const unmatchedNew = [...newRecords];
      for (const oldRecord of oldRecords) {
        const matchIndex = unmatchedNew.findIndex(
          (newRecord) => exactSignature(newRecord) === exactSignature(oldRecord),
        );
        if (matchIndex >= 0) unmatchedNew.splice(matchIndex, 1);
        else result.removed.push(oldRecord);
      }
      result.added.push(...unmatchedNew);
      continue;
    }

    const [oldRecord] = oldRecords;
    const [newRecord] = newRecords;
    if (oldRecord.scheduledTime !== newRecord.scheduledTime) {
      result.timeChanges.push({
        flight: newRecord,
        before: oldRecord.scheduledTime,
        after: newRecord.scheduledTime,
      });
    }
    if (oldRecord.airline !== newRecord.airline) {
      result.airlineChanges.push({
        flight: newRecord,
        before: oldRecord.airline,
        after: newRecord.airline,
      });
    }
    if (oldRecord.origin !== newRecord.origin || oldRecord.destination !== newRecord.destination) {
      result.routeChanges.push({
        flight: newRecord,
        before: { origin: oldRecord.origin, destination: oldRecord.destination },
        after: { origin: newRecord.origin, destination: newRecord.destination },
      });
    }
  }

  return result;
}
