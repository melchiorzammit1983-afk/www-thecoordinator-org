import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AddressAutocomplete, type AddressPick } from "@/components/address/AddressAutocomplete";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { classifyProviderEndpoint } from "@/lib/journey-resolver";
import { resolvePortalRecipient } from "@/lib/portal-definitions.functions";
import {
  isPortalFieldRequired,
  isPortalFieldVisible,
  normalizePortalBookingFields,
  type NormalizedPortalBookingFields,
} from "@/lib/portal-field-configuration";

export const Route = createFileRoute("/portal/creator/$token")({
  head: () => ({ meta: [{ title: "Portal" }] }),
  component: CreatorPortalPage,
});

function CreatorPortalPage() {
  const { token } = Route.useParams();
  const resolveFn = useServerFn(resolvePortalRecipient);
  const { data, isLoading, error } = useQuery({ queryKey: ["creator-portal", token], queryFn: () => resolveFn({ data: { token } }) as Promise<any>, retry: false });
  if (isLoading) return <main className="mx-auto max-w-2xl p-6 text-sm text-muted-foreground">Loading portal…</main>;
  if (error || !data) return <main className="mx-auto max-w-2xl p-6"><Card><CardContent className="p-6 text-sm text-destructive">This portal link is unavailable.</CardContent></Card></main>;
  const config = data.portal.configuration ?? {};
  const bookingFields = normalizePortalBookingFields(config.booking_fields, config.capabilities ?? {});
  const enabled = Object.entries(config.capabilities ?? {}).filter(([, value]) => value === true).map(([key]) => key.replaceAll("_", " "));
  return <main className="min-h-screen bg-muted/30 p-4 md:p-8"><div className="mx-auto max-w-2xl space-y-6">
    <Card><CardHeader><CardTitle>{config.branding?.display_name || data.portal.name}</CardTitle><p className="text-sm text-muted-foreground">{data.portal.description || "A secure portal shared with you by The Coordinator."}</p></CardHeader><CardContent className="space-y-3"><div className="text-sm">Access for <span className="font-medium">{data.recipient.recipient_name}</span> · {data.recipient.recipient_company}</div><Badge variant="outline">{data.portal.portal_type.replaceAll("_", " ")}</Badge></CardContent></Card>
    {config.capabilities?.create_booking === true && <CreatorBookingForm token={token} capabilities={config.capabilities} bookingFields={bookingFields} recipientCompany={data.recipient.recipient_company} />}
    <Card><CardHeader><CardTitle className="text-base">Available features</CardTitle></CardHeader><CardContent>{enabled.length ? <div className="flex flex-wrap gap-2">{enabled.map((item) => <Badge key={item} variant="secondary">{item}</Badge>)}</div> : <p className="text-sm text-muted-foreground">No features have been enabled yet.</p>}</CardContent></Card>
  </div></main>;
}

type BookingCapabilities = {
  add_passengers?: boolean;
  add_notes?: boolean;
  select_operation_group?: boolean;
};

type OperationGroupOption = { id: string; reference: string; name: string; status: string };

function CreatorBookingForm({ token, capabilities, bookingFields, recipientCompany }: { token: string; capabilities: BookingCapabilities; bookingFields: NormalizedPortalBookingFields; recipientCompany: string }) {
  const [fromPick, setFromPick] = useState<AddressPick>({ address: "", place_id: null, lat: null, lng: null });
  const [toPick, setToPick] = useState<AddressPick>({ address: "", place_id: null, lat: null, lng: null });
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [passenger, setPassenger] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [operationGroupId, setOperationGroupId] = useState("");
  const [operationGroups, setOperationGroups] = useState<OperationGroupOption[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ id: string; requiresApproval: boolean } | null>(null);

  useEffect(() => {
    if (!capabilities.select_operation_group || !isPortalFieldVisible(bookingFields, "operation_group")) return;
    fetch(`/api/public/portal/recipient/${token}/bookings`)
      .then(async (response) => response.ok ? response.json() : { groups: [] })
      .then((payload) => setOperationGroups(payload.groups ?? []))
      .catch(() => setOperationGroups([]));
  }, [bookingFields, capabilities.select_operation_group, token]);

  async function submit() {
    setBusy(true);
    setResult(null);
    try {
      const response = await fetch(`/api/public/portal/recipient/${token}/bookings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from_location: fromPick.address,
          to_location: toPick.address,
          from_location_type: classifyProviderEndpoint(fromPick.place_types),
          to_location_type: classifyProviderEndpoint(toPick.place_types),
          date,
          time,
          clientcompanyname: recipientCompany,
          contact_phone: isPortalFieldVisible(bookingFields, "contact_phone") ? phone.trim() || undefined : undefined,
          notes: capabilities.add_notes && isPortalFieldVisible(bookingFields, "notes") ? notes.trim() || undefined : undefined,
          passengers: capabilities.add_passengers && isPortalFieldVisible(bookingFields, "passenger") && passenger.trim() ? [{ name: passenger.trim(), phone: isPortalFieldVisible(bookingFields, "contact_phone") ? phone.trim() || null : null }] : undefined,
          operation_group_id: capabilities.select_operation_group && isPortalFieldVisible(bookingFields, "operation_group") && operationGroupId ? operationGroupId : undefined,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "booking_failed");
      const requiresApproval = payload.requires_approval === true;
      setResult({ id: payload.id, requiresApproval });
      setFromPick({ address: "", place_id: null, lat: null, lng: null });
      setToPick({ address: "", place_id: null, lat: null, lng: null });
      setDate(""); setTime(""); setPassenger(""); setPhone(""); setNotes(""); setOperationGroupId("");
      toast.success(requiresApproval ? "Booking submitted for coordinator approval" : "Booking created");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create booking");
    } finally {
      setBusy(false);
    }
  }

  return <Card><CardHeader><CardTitle className="text-base">Create booking</CardTitle></CardHeader><CardContent className="grid gap-4 sm:grid-cols-2">
    <div className="space-y-1 sm:col-span-2"><Label>Pickup</Label><AddressAutocomplete publicToken={token} value={fromPick.address} placeId={fromPick.place_id} onChange={setFromPick} required /></div>
    <div className="space-y-1 sm:col-span-2"><Label>Destination</Label><AddressAutocomplete publicToken={token} value={toPick.address} placeId={toPick.place_id} onChange={setToPick} required /></div>
    <div className="space-y-1"><Label>Pickup date</Label><Input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></div>
    <div className="space-y-1"><Label>Pickup time</Label><Input type="time" value={time} onChange={(event) => setTime(event.target.value)} /></div>
    {capabilities.add_passengers && isPortalFieldVisible(bookingFields, "passenger") && <div className="space-y-1"><Label>Passenger{isPortalFieldRequired(bookingFields, "passenger") ? " *" : ""}</Label><Input value={passenger} onChange={(event) => setPassenger(event.target.value)} placeholder={isPortalFieldRequired(bookingFields, "passenger") ? "Required" : "Optional"} /></div>}
    {isPortalFieldVisible(bookingFields, "contact_phone") && <div className="space-y-1"><Label>Contact phone{isPortalFieldRequired(bookingFields, "contact_phone") ? " *" : ""}</Label><Input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder={isPortalFieldRequired(bookingFields, "contact_phone") ? "Required" : "Optional"} /></div>}
    {capabilities.select_operation_group && isPortalFieldVisible(bookingFields, "operation_group") && <div className="space-y-1 sm:col-span-2"><Label>Operation Group{isPortalFieldRequired(bookingFields, "operation_group") ? " *" : ""}</Label><select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={operationGroupId} onChange={(event) => setOperationGroupId(event.target.value)}><option value="">{isPortalFieldRequired(bookingFields, "operation_group") ? "Select an Operation Group" : "No Operation Group"}</option>{operationGroups.map((group) => <option key={group.id} value={group.id}>{group.reference} · {group.name}</option>)}</select></div>}
    {capabilities.add_notes && isPortalFieldVisible(bookingFields, "notes") && <div className="space-y-1 sm:col-span-2"><Label>Notes{isPortalFieldRequired(bookingFields, "notes") ? " *" : ""}</Label><Textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder={isPortalFieldRequired(bookingFields, "notes") ? "Required" : "Optional"} /></div>}
    <div className="flex items-center justify-between gap-3 sm:col-span-2"><div className="text-xs text-muted-foreground">{result ? `${result.requiresApproval ? "Awaiting coordinator approval" : "Booking created"} · ${result.id.slice(0, 8)}` : "Direct mode creates one Job and its mirrored Trip; approval mode waits for the coordinator."}</div><Button onClick={submit} disabled={busy || !fromPick.address.trim() || !toPick.address.trim() || !date || !time || (isPortalFieldRequired(bookingFields, "passenger") && !passenger.trim()) || (isPortalFieldRequired(bookingFields, "contact_phone") && !phone.trim()) || (isPortalFieldRequired(bookingFields, "operation_group") && !operationGroupId) || (isPortalFieldRequired(bookingFields, "notes") && !notes.trim())}>{busy ? "Creating…" : "Create booking"}</Button></div>
  </CardContent></Card>;
}
