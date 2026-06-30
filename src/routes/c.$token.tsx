import { createFileRoute, notFound } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";

import { getCompanyByLink, submitClientBooking } from "@/lib/booking.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/c/$token")({
  head: ({ loaderData }) => {
    const name = (loaderData as { name?: string } | undefined)?.name;
    return {
      meta: [
        { title: name ? `Book transport — ${name}` : "Book transport" },
        { name: "description", content: "Request a crew transfer." },
      ],
    };
  },
  loader: async ({ params }) => {
    const company = await getCompanyByLink({ data: { token: params.token } });
    if (!company) throw notFound();
    return company;
  },
  errorComponent: ({ error }) => (
    <div className="min-h-screen grid place-items-center px-4">
      <div className="text-center">
        <h1 className="text-xl font-semibold">Couldn't load this page</h1>
        <p className="text-sm text-muted-foreground mt-2">{error.message}</p>
      </div>
    </div>
  ),
  notFoundComponent: () => (
    <div className="min-h-screen grid place-items-center px-4">
      <div className="max-w-md text-center">
        <h1 className="text-2xl font-semibold">Link not active</h1>
        <p className="text-sm text-muted-foreground mt-2">
          This booking link is either invalid or the company is not approved yet.
        </p>
      </div>
    </div>
  ),
  component: PublicBookingPage,
});

function PublicBookingPage() {
  const company = Route.useLoaderData();
  const params = Route.useParams();
  const [done, setDone] = useState(false);
  const submitFn = useServerFn(submitClientBooking);

  const [form, setForm] = useState({
    name: "", surname: "", client_email: "", room_number: "",
    from_location: "", to_location: "", time: "",
  });

  const mut = useMutation({
    mutationFn: () => submitFn({ data: { token: params.token, ...form } }),
    onSuccess: () => { setDone(true); toast.success("Booking submitted"); },
    onError: (e: Error) => toast.error(e.message),
  });

  function update<K extends keyof typeof form>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  return (
    <div className="min-h-screen bg-muted/30 py-10 px-4">
      <div className="max-w-xl mx-auto">
        <div className="mb-6 text-center">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Booking link</div>
          <h1 className="text-2xl font-semibold mt-1">{company.name}</h1>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Request transport</CardTitle>
            <CardDescription>Your request will be reviewed by the operations team.</CardDescription>
          </CardHeader>
          <CardContent>
            {done ? (
              <div className="py-8 text-center">
                <div className="text-emerald-600 font-medium">Submitted</div>
                <p className="text-sm text-muted-foreground mt-2">We'll be in touch shortly.</p>
                <Button variant="outline" className="mt-6" onClick={() => { setDone(false); setForm({ name:"", surname:"", client_email:"", room_number:"", from_location:"", to_location:"", time:"" }); }}>
                  Submit another
                </Button>
              </div>
            ) : (
              <form onSubmit={(e) => { e.preventDefault(); mut.mutate(); }} className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="b-name">First name</Label>
                    <Input id="b-name" value={form.name} onChange={(e) => update("name", e.target.value)} required maxLength={100} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="b-surname">Surname</Label>
                    <Input id="b-surname" value={form.surname} onChange={(e) => update("surname", e.target.value)} required maxLength={100} />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="b-email">Email</Label>
                  <Input id="b-email" type="email" value={form.client_email} onChange={(e) => update("client_email", e.target.value)} required maxLength={255} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="b-room">Room / cabin (optional)</Label>
                  <Input id="b-room" value={form.room_number} onChange={(e) => update("room_number", e.target.value)} maxLength={40} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="b-from">Pickup location</Label>
                  <Input id="b-from" value={form.from_location} onChange={(e) => update("from_location", e.target.value)} required maxLength={255} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="b-to">Drop-off location</Label>
                  <Input id="b-to" value={form.to_location} onChange={(e) => update("to_location", e.target.value)} required maxLength={255} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="b-time">Time (24h)</Label>
                  <Input id="b-time" type="time" value={form.time} onChange={(e) => update("time", e.target.value)} required />
                </div>
                <Button type="submit" className="w-full" disabled={mut.isPending}>
                  {mut.isPending ? "Submitting…" : "Submit booking"}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
