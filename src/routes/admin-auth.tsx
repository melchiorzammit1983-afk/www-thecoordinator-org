import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { toast } from "sonner";
import { ShieldCheck } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const ADMIN_EMAIL = "melchior.zammit@outlook.com";

export const Route = createFileRoute("/admin-auth")({
  head: () => ({
    meta: [
      { title: "Admin sign in — Crew Change" },
      { name: "description", content: "Restricted administrator sign-in." },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  beforeLoad: async () => {
    if (typeof window === "undefined") return;
    const { data } = await supabase.auth.getSession();
    if (!data.session) return;
    const email = data.session.user.email?.toLowerCase();
    if (email === ADMIN_EMAIL) throw redirect({ to: "/admin" });
    throw redirect({ to: "/coordinator" });
  },
  component: AdminAuthPage,
});

const credsSchema = z.object({
  email: z.string().trim().email().max(255),
  password: z.string().min(8).max(128),
});

function AdminAuthPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-foreground text-background">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <h1 className="mt-4 text-2xl font-semibold">Administrator access</h1>
          <p className="text-sm text-muted-foreground mt-1">Restricted area</p>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Admin sign in</CardTitle>
            <CardDescription>Authorized administrator credentials only</CardDescription>
          </CardHeader>
          <CardContent>
            <AdminSignInForm />
          </CardContent>
        </Card>
        <p className="text-xs text-muted-foreground text-center mt-6">
          <Link to="/auth" className="hover:underline">← Back to coordinator sign in</Link>
        </p>
      </div>
    </div>
  );
}

function AdminSignInForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = credsSchema.safeParse({ email, password });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    if (parsed.data.email.toLowerCase() !== ADMIN_EMAIL) {
      toast.error("This sign-in is reserved for administrators.");
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword(parsed.data);
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Signed in");
    window.location.assign("/admin");
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 pt-4">
      <div className="space-y-2">
        <Label htmlFor="ad-email">Admin email</Label>
        <Input id="ad-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="ad-password">Password</Label>
        <Input id="ad-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </div>
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? "Signing in…" : "Sign in as admin"}
      </Button>
    </form>
  );
}
