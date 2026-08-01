import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Car, Plane, PlaneLanding, PlaneTakeoff, Route as RouteIcon, Users } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getAirportOperationsDashboard } from "@/lib/coordinator.functions";
import { formatMaltaDateTime } from "@/lib/time";

export const Route = createFileRoute("/_authenticated/coordinator/airport-operations")({
  head: () => ({ meta: [{ title: "Airport Operations — Coordinator" }] }),
  component: AirportOperationsPage,
});

function AirportOperationsPage() {
  const dashboardFn = useServerFn(getAirportOperationsDashboard);
  const { data, isLoading, error } = useQuery({
    queryKey: ["airport-operations-dashboard"],
    queryFn: () => dashboardFn(),
    refetchInterval: 60_000,
  });

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto space-y-6 pb-24 md:pb-8">
      <header>
        <h1 className="text-2xl font-semibold">Airport Operations</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Today&apos;s flight schedule and your connected transport operations.
        </p>
      </header>

      {error ? (
        <Card>
          <CardContent className="p-5 text-sm text-destructive">{error.message}</CardContent>
        </Card>
      ) : isLoading ? (
        <Card>
          <CardContent className="p-5 text-sm text-muted-foreground">
            Loading airport operations…
          </CardContent>
        </Card>
      ) : data ? (
        <>
          <section>
            <h2 className="text-sm font-semibold mb-2">Today&apos;s summary</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
              <SummaryCard
                label="Arrivals"
                value={data.summary.scheduledArrivals}
                icon={PlaneLanding}
              />
              <SummaryCard
                label="Departures"
                value={data.summary.scheduledDepartures}
                icon={PlaneTakeoff}
              />
              <SummaryCard label="Linked trips" value={data.summary.linkedTrips} icon={RouteIcon} />
              <SummaryCard label="Passengers" value={data.summary.totalPassengers} icon={Users} />
              <SummaryCard label="Drivers" value={data.summary.driversAssigned} icon={Users} />
              <SummaryCard label="Vehicles" value={data.summary.vehiclesAssigned} icon={Car} />
            </div>
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <OperationsCard
              title="Upcoming flights"
              description="Scheduled within the next two hours."
              empty="No scheduled flights in the next two hours."
              flights={data.upcomingFlights}
            />
            <OperationsCard
              title="Flights without trips"
              description="Active-schedule flights with no linked trip in your operations today."
              empty="Every remaining scheduled flight has a linked trip."
              flights={data.flightsWithoutTrips}
            />
          </section>

          <Card>
            <CardHeader>
              <CardTitle>Trips without flights</CardTitle>
              <CardDescription>
                Today&apos;s trips in your operations that have no linked schedule flight.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {data.tripsWithoutFlights.length === 0 ? (
                <EmptyLine text="Every trip today has a linked flight." />
              ) : (
                <div className="space-y-2">
                  {data.tripsWithoutFlights.map((trip) => (
                    <div key={trip.id} className="rounded-lg border p-3 text-sm">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-medium truncate">{trip.fromLocation}</div>
                          <div className="text-muted-foreground text-xs truncate">
                            → {trip.toLocation}
                          </div>
                        </div>
                        <Badge variant="secondary" className="shrink-0">
                          {trip.time.slice(0, 5)}
                        </Badge>
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {trip.pickupAt
                          ? formatMaltaDateTime(trip.pickupAt, {
                              dateStyle: "medium",
                              timeStyle: "short",
                            })
                          : trip.date}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: number;
  icon: typeof Plane;
}) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-medium text-muted-foreground truncate">{label}</span>
          <Icon className="h-4 w-4 text-primary shrink-0" />
        </div>
        <div className="text-2xl font-semibold mt-1.5 tabular-nums">{value}</div>
      </CardContent>
    </Card>
  );
}

function OperationsCard({
  title,
  description,
  empty,
  flights,
}: {
  title: string;
  description: string;
  empty: string;
  flights: Array<{
    id: string;
    scheduled_date: string;
    scheduled_time: string;
    direction: "arrival" | "departure";
    airline: string;
    flight_number: string;
    origin: string;
    destination: string;
  }>;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {flights.length === 0 ? (
          <EmptyLine text={empty} />
        ) : (
          <div className="space-y-2">
            {flights.map((flight) => (
              <div key={flight.id} className="rounded-lg border p-3 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium flex items-center gap-1.5">
                      <Plane className="h-3.5 w-3.5 text-primary" />
                      {flight.flight_number}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">
                      {flight.airline} · {flight.origin} → {flight.destination}
                    </div>
                  </div>
                  <Badge variant="secondary" className="shrink-0">
                    {flight.scheduled_time}
                  </Badge>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {flight.direction === "arrival" ? "Arrival" : "Departure"} ·{" "}
                  {flight.scheduled_date}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function EmptyLine({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-dashed bg-muted/30 p-4 text-center text-xs text-muted-foreground">
      {text}
    </div>
  );
}
