import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { ArrowLeft, Check, Loader2 } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

type Search = { demo?: string | number | boolean; ref?: string };

export const Route = createFileRoute("/request-access")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    demo: s.demo as Search["demo"],
    ref: typeof s.ref === "string" ? s.ref.slice(0, 40) : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Request access — The Coordinator" },
      { name: "description", content: "Request access or book a demo of The Coordinator — the pay-as-you-go transport network for Malta." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: RequestAccessPage,
});

const schema = z.object({
  company_name: z.string().trim().min(2, "Company required").max(120),
  full_name: z.string().trim().min(2, "Name required").max(80),
  email: z.string().trim().email("Valid email required").max(200),
  phone: z.string().trim().min(4, "Phone required").max(40),
  role: z.enum(["hotel", "shipping_agent", "fleet_owner", "other"]),
  fleet_size: z.enum(["1-5", "6-20", "21-50", "50+"]),
  message: z.string().trim().max(1000).optional().or(z.literal("")),
});

function RequestAccessPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const isDemo = String(search.demo ?? "") === "1" || search.demo === true;
  const refCode = (search.ref ?? "").trim().toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 40);

  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [form, setForm] = useState({
    company_name: "",
    full_name: "",
    email: "",
    phone: "",
    role: "hotel" as "hotel" | "shipping_agent" | "fleet_owner" | "other",
    fleet_size: "1-5" as "1-5" | "6-20" | "21-50" | "50+",
    message: "",
  });

  const onChange = (k: keyof typeof form) => (v: string) =>
    setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = schema.safeParse(form);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Please check the form");
      return;
    }
    setSubmitting(true);
    try {
      const roleLabel = {
        hotel: "Hotel",
        shipping_agent: "Shipping agent",
        fleet_owner: "Fleet owner",
        other: "Other",
      }[parsed.data.role];

      const { error } = await supabase.from("access_requests").insert({
        full_name: parsed.data.full_name,
        email: parsed.data.email,
        phone: parsed.data.phone,
        company_name: parsed.data.company_name,
        role: roleLabel,
        fleet_size: parsed.data.fleet_size,
        message: parsed.data.message || null,
        kind: isDemo ? "demo" : "access",
        status: "new",
      } as never);
      if (error) throw error;
      setDone(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Something went wrong";
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="max-w-md w-full rounded-2xl border bg-white p-8 text-center shadow-sm">
          <div className="mx-auto w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center mb-4">
            <Check className="h-6 w-6 text-emerald-600" />
          </div>
          <h1 className="text-xl font-semibold text-slate-900">
            {isDemo ? "Demo request received" : "Request received"}
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            Thanks — we'll be in touch within 24 hours to {isDemo ? "schedule your demo" : "set up your account"}.
          </p>
          <Button className="mt-6 w-full" onClick={() => navigate({ to: "/" })}>
            Back to home
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-xl mx-auto p-6 md:p-10">
        <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900 mb-6">
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>

        <div className="rounded-2xl border bg-white p-6 md:p-8 shadow-sm">
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-2xl font-semibold text-[#1a2a52]">
              {isDemo ? "Book a demo" : "Request access"}
            </h1>
            {isDemo && (
              <Badge variant="secondary" className="bg-amber-100 text-amber-800 border-amber-200">
                Demo
              </Badge>
            )}
          </div>
          <p className="text-sm text-slate-600 mb-6">
            {isDemo
              ? "Tell us about your operation and we'll walk you through The Coordinator live."
              : "The Coordinator is invite-only. Fill this in and we'll approve your account within 24 hours."}
          </p>

          <form onSubmit={submit} className="space-y-4">
            <div>
              <Label htmlFor="company">Company name *</Label>
              <Input id="company" value={form.company_name} onChange={(e) => onChange("company_name")(e.target.value)} maxLength={120} required />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="name">Your name *</Label>
                <Input id="name" value={form.full_name} onChange={(e) => onChange("full_name")(e.target.value)} maxLength={80} required />
              </div>
              <div>
                <Label htmlFor="phone">Phone *</Label>
                <Input id="phone" type="tel" value={form.phone} onChange={(e) => onChange("phone")(e.target.value)} maxLength={40} required />
              </div>
            </div>

            <div>
              <Label htmlFor="email">Email *</Label>
              <Input id="email" type="email" value={form.email} onChange={(e) => onChange("email")(e.target.value)} maxLength={200} required />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label>Role *</Label>
                <Select value={form.role} onValueChange={(v) => onChange("role")(v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="hotel">Hotel</SelectItem>
                    <SelectItem value="shipping_agent">Shipping agent</SelectItem>
                    <SelectItem value="fleet_owner">Fleet owner / transport company</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Trips per month *</Label>
                <Select value={form.fleet_size} onValueChange={(v) => onChange("fleet_size")(v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1-5">1 – 5</SelectItem>
                    <SelectItem value="6-20">6 – 20</SelectItem>
                    <SelectItem value="21-50">21 – 50</SelectItem>
                    <SelectItem value="50+">50+</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label htmlFor="message">What do you need? (optional)</Label>
              <Textarea
                id="message"
                value={form.message}
                onChange={(e) => onChange("message")(e.target.value)}
                maxLength={1000}
                rows={4}
                placeholder="Anything specific we should know about your workflow…"
              />
            </div>

            <Button type="submit" disabled={submitting} className="w-full bg-[#1a2a52] hover:bg-[#243668]">
              {submitting ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Sending…</>
              ) : (
                isDemo ? "Request demo" : "Request access"
              )}
            </Button>

            <p className="text-xs text-slate-500 text-center pt-2">
              Pay-as-you-go pricing. No credit card required to request access.
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}
