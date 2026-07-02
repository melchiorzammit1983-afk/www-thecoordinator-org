import { createFileRoute } from "@tanstack/react-router";
import { DriverMap } from "@/components/coordinator/DriverMap";

export const Route = createFileRoute("/_authenticated/coordinator/map")({
  head: () => ({ meta: [{ title: "Live Map — Coordinator" }] }),
  component: MapPage,
});

function MapPage() {
  return (
    <div className="p-3 sm:p-4 md:p-6 space-y-4">
      <header>
        <h1 className="text-lg sm:text-xl font-semibold">Live driver map</h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          Drivers appear here while a trip is in progress. Locations refresh in real time.
        </p>
      </header>
      <DriverMap height={typeof window !== "undefined" && window.innerWidth < 640 ? 480 : 640} />
    </div>
  );
}
