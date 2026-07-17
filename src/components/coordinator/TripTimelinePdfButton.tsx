import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { getTripMap } from "@/lib/trip-map.functions";

/**
 * Download a printable Trip Timeline PDF for audit / payment review.
 *
 * Includes: trip header (job id, pickup/dropoff labels, status), a summary
 * of planned vs live ETA, and a full chronological table of every
 * `trip_map_events` row with timestamp, event label, coordinates, notes,
 * and flattened `meta` details (waiting minutes, agreed amount, boarding
 * counts, override reasons, drift distance, etc).
 *
 * Rendered client-side with jsPDF + jspdf-autotable — no server round-trip
 * beyond the existing `getTripMap` server function that already powers
 * TripEventsMap, so RLS applies exactly as it does on-screen.
 */

const EVENT_LABEL: Record<string, string> = {
  en_route: "On the way",
  arrived_pickup: "Arrived at pickup",
  in_progress: "Passenger on board",
  completed: "Trip completed",
  actual_dropoff: "Actual drop-off",
  back_to_waiting: "Back to waiting",
  wait_started: "Waiting started",
  wait_ended: "Waiting ended",
  boarding_requested: "Boarding approval requested",
  boarding_approved: "Boarding approved",
  boarding_rejected: "Boarding rejected",
  pax_no_show: "Passenger no-show",
  pax_cancelled: "Passenger cancelled",
  navigate_opened: "Navigation opened",
  passenger_called: "Passenger called",
  pickup_snap: "Pickup GPS snapped",
  dropoff_snap: "Drop-off GPS snapped",
  emergency_override: "Emergency override",
  safety_concern: "Safety concern",
  breakdown: "Breakdown",
  status_corrected: "Status corrected",
  arrived_pickup_override: "Arrived (override, off-site)",
};

function fmtDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString([], {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}

function fmtEta(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec)) return "—";
  const m = Math.round(sec / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function flattenMeta(raw: unknown): string {
  let meta: Record<string, unknown> | null = null;
  try {
    meta = typeof raw === "string" ? JSON.parse(raw) : (raw as Record<string, unknown> | null);
  } catch {
    return "";
  }
  if (!meta || typeof meta !== "object") return "";
  const parts: string[] = [];
  const push = (label: string, val: unknown) => {
    if (val == null || val === "") return;
    parts.push(`${label}: ${String(val)}`);
  };
  if (meta.elapsed_minutes != null) push("Elapsed", `${meta.elapsed_minutes} min`);
  if (meta.chargeable_minutes != null) push("Chargeable", `${meta.chargeable_minutes} min`);
  if (meta.calculated_amount != null) push("Calculated", `€${Number(meta.calculated_amount).toFixed(2)}`);
  if (meta.agreed_amount != null) push("Agreed", `€${Number(meta.agreed_amount).toFixed(2)}`);
  if (meta.pax_name) push("Passenger", String(meta.pax_name));
  if (meta.pax_summary && typeof meta.pax_summary === "object") {
    const s = meta.pax_summary as Record<string, number>;
    push("Boarded", String(s.boarded ?? 0));
    push("Pending", String(s.pending ?? 0));
  }
  if (meta.reason) push("Reason", String(meta.reason).replace(/_/g, " "));
  if (meta.action) push("Action", String(meta.action).replace(/_/g, " "));
  if (meta.from_status && meta.to_status) push("Transition", `${meta.from_status} → ${meta.to_status}`);
  if (meta.street_address) push("Near", String(meta.street_address));
  if (meta.photo_url) push("Photo", String(meta.photo_url));
  return parts.join(" · ");
}

export function TripTimelinePdfButton({
  jobId,
  size = "sm",
  variant = "outline",
}: {
  jobId: string;
  size?: "sm" | "default";
  variant?: "outline" | "ghost" | "default" | "secondary";
}) {
  const fn = useServerFn(getTripMap);
  const [busy, setBusy] = useState(false);

  async function download() {
    setBusy(true);
    try {
      const [{ jsPDF }, autoTableMod] = await Promise.all([
        import("jspdf"),
        import("jspdf-autotable"),
      ]);
      const autoTable = (autoTableMod as any).default ?? (autoTableMod as any);

      const payload = (await fn({ data: { job_id: jobId } })) as {
        job: {
          id: string;
          pickup_label: string;
          dropoff_label: string;
          status: string;
          planned_duration_sec: number | null;
          live_eta_sec: number | null;
          live_eta_updated_at: string | null;
        };
        events: Array<{
          event_type: string;
          lat: number | null;
          lng: number | null;
          accuracy_m: number | null;
          notes: string | null;
          meta: string | null;
          occurred_at: string;
          payout_delta_eur?: number | null;
          trust_delta?: number | null;
        }>;
      };

      const events = [...(payload.events ?? [])].sort(
        (a, b) => new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime(),
      );

      const doc = new jsPDF({ unit: "pt", format: "a4" });
      const pageW = doc.internal.pageSize.getWidth();
      const marginX = 40;

      // Header
      doc.setFont("helvetica", "bold");
      doc.setFontSize(16);
      doc.text("Trip Timeline", marginX, 48);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(120);
      doc.text(`Generated ${fmtDateTime(new Date().toISOString())}`, marginX, 64);
      doc.text(`Job ${payload.job.id}`, pageW - marginX, 64, { align: "right" });
      doc.setTextColor(0);

      // Compute payout & trust totals across all events for this trip
      const totalPayout = events.reduce(
        (a, e) => a + Number(e.payout_delta_eur ?? 0),
        0,
      );
      const totalTrust = events.reduce(
        (a, e) => a + Number(e.trust_delta ?? 0),
        0,
      );

      // Trip summary block
      doc.setFontSize(10);
      const summary = [
        ["Status", payload.job.status ?? "—"],
        ["Pickup", payload.job.pickup_label ?? "—"],
        ["Drop-off", payload.job.dropoff_label ?? "—"],
        ["Planned ETA", fmtEta(payload.job.planned_duration_sec)],
        [
          "Latest live ETA",
          `${fmtEta(payload.job.live_eta_sec)}${
            payload.job.live_eta_updated_at ? ` (updated ${fmtDateTime(payload.job.live_eta_updated_at)})` : ""
          }`,
        ],
        ["Recorded events", String(events.length)],
        ["Auto payout impact", `€${totalPayout.toFixed(2)}`],
        ["Trust score impact", `${totalTrust > 0 ? "+" : ""}${totalTrust}`],
      ];
      autoTable(doc, {
        startY: 78,
        head: [],
        body: summary,
        theme: "plain",
        styles: { fontSize: 9, cellPadding: 3 },
        columnStyles: {
          0: { fontStyle: "bold", cellWidth: 110, textColor: 90 },
          1: { cellWidth: pageW - marginX * 2 - 110 },
        },
        margin: { left: marginX, right: marginX },
      });

      // Events table
      const startY = ((doc as any).lastAutoTable?.finalY ?? 78) + 14;
      autoTable(doc, {
        startY,
        head: [["#", "When", "Event", "Coords", "Impact", "Notes", "Details"]],
        body: events.map((ev, i) => {
          const payout = Number(ev.payout_delta_eur ?? 0);
          const trust = Number(ev.trust_delta ?? 0);
          const impact = [
            payout ? `€${payout.toFixed(2)}` : "",
            trust ? `Trust ${trust > 0 ? "+" : ""}${trust}` : "",
          ]
            .filter(Boolean)
            .join(" · ");
          return [
            String(i + 1),
            fmtDateTime(ev.occurred_at),
            EVENT_LABEL[ev.event_type] ?? ev.event_type,
            ev.lat != null && ev.lng != null
              ? `${Number(ev.lat).toFixed(5)}, ${Number(ev.lng).toFixed(5)}${
                  ev.accuracy_m ? ` ±${Math.round(ev.accuracy_m)}m` : ""
                }`
              : "—",
            impact || "—",
            ev.notes ?? "",
            flattenMeta(ev.meta),
          ];
        }),
        theme: "striped",
        headStyles: { fillColor: [37, 99, 235], textColor: 255, fontSize: 9 },
        styles: { fontSize: 8, cellPadding: 4, overflow: "linebreak", valign: "top" },
        columnStyles: {
          0: { cellWidth: 22 },
          1: { cellWidth: 100 },
          2: { cellWidth: 100 },
          3: { cellWidth: 95 },
          4: { cellWidth: 70 },
          5: { cellWidth: 75 },
          6: { cellWidth: "auto" },
        },
        margin: { left: marginX, right: marginX },
        didDrawPage: () => {
          const pageCount = doc.getNumberOfPages();
          const pageNo = (doc as any).internal.getCurrentPageInfo?.().pageNumber ?? pageCount;
          doc.setFontSize(8);
          doc.setTextColor(140);
          doc.text(
            `Page ${pageNo} of ${pageCount}`,
            pageW - marginX,
            doc.internal.pageSize.getHeight() - 20,
            { align: "right" },
          );
          doc.text(
            "Trip Timeline · Audit copy",
            marginX,
            doc.internal.pageSize.getHeight() - 20,
          );
          doc.setTextColor(0);
        },
      });

      if (events.length === 0) {
        const y = ((doc as any).lastAutoTable?.finalY ?? startY) + 20;
        doc.setFontSize(10);
        doc.setTextColor(120);
        doc.text("No events recorded for this trip.", marginX, y);
        doc.setTextColor(0);
      }

      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      doc.save(`trip-timeline-${jobId.slice(0, 8)}-${stamp}.pdf`);
      toast.success("Trip timeline downloaded");
    } catch (e) {
      toast.error(`Could not generate PDF: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button size={size} variant={variant} onClick={download} disabled={busy}>
      {busy ? (
        <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
      ) : (
        <Download className="h-3.5 w-3.5 mr-1.5" />
      )}
      Timeline PDF
    </Button>
  );
}
