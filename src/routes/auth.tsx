import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { whoAmI, requestPasswordReset } from "@/lib/admin.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Copy } from "lucide-react";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — Crew Change" },
      { name: "description", content: "Sign in to your Crew Change coordinator or admin console." },
      { property: "og:title", content: "Sign in — Crew Change" },
      { property: "og:description", content: "Sign in to your Crew Change coordinator or admin console." },
      { property: "og:url", content: "https://transfersmt.lovable.app/auth" },
      { name: "robots", content: "noindex" },
    ],
    links: [{ rel: "canonical", href: "https://transfersmt.lovable.app/auth" }],
  }),
  component: AuthPage,
});

const credsSchema = z.object({
  phone: z.string().trim().regex(/^\+[1-9]\d{6,14}$/, "Enter phone in international format, e.g. +35699123456"),
  password: z.string().min(8).max(128),
});


function AuthPage() {
  const navigate = useNavigate();
  const whoAmIFn = useServerFn(whoAmI);

  useEffect(() => {
    let cancelled = false;
    async function redirectSignedInUser() {
      const { data } = await supabase.auth.getSession();
      if (!data.session || cancelled) return;
      try {
        const identity = await whoAmIFn();
        if (!cancelled) navigate({ to: identity?.isAdmin ? "/admin" : "/coordinator", replace: true });
      } catch {
        if (!cancelled) navigate({ to: "/coordinator", replace: true });
      }
    }
    redirectSignedInUser();
    return () => {
      cancelled = true;
    };
  }, [navigate, whoAmIFn]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-primary text-primary-foreground font-bold text-lg">
            CC
          </div>
          <h1 className="mt-4 text-2xl font-semibold">Crew Change Admin</h1>
          <p className="text-sm text-muted-foreground mt-1">Operations console</p>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Sign in</CardTitle>
            <CardDescription>Use the phone number and password from your administrator</CardDescription>
          </CardHeader>
          <CardContent>
            <SignInForm />
          </CardContent>
        </Card>

        <p className="text-xs text-muted-foreground text-center mt-6">
          <Link to="/" className="hover:underline">Back home</Link>
        </p>
        <div className="mt-10 pt-6 border-t border-border/60 text-center">
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">Administrator</p>
          <Link
            to="/admin-auth"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            🔒 Admin sign in
          </Link>
        </div>
      </div>
    </div>
  );
}

function SignInForm() {
  const [phone, setPhone] = useState("+");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const whoAmIFn = useServerFn(whoAmI);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = credsSchema.safeParse({ phone: phone.trim(), password });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    setLoading(true);
    const digits = parsed.data.phone.replace(/[^\d]/g, "");
    const email = `p${digits}@phone.crewchange.local`;
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password: parsed.data.password,
    });
    setLoading(false);
    if (error) {
      toast.error("Invalid phone number or password");
      return;
    }

    toast.success("Signed in");
    try {
      const identity = await whoAmIFn();
      window.location.assign(identity?.isAdmin ? "/admin" : "/coordinator");
    } catch {
      window.location.assign("/coordinator");
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 pt-4">
      <div className="space-y-2">
        <Label htmlFor="si-phone">Phone number</Label>
        <Input
          id="si-phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="+35699123456"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          required
        />
        <p className="text-xs text-muted-foreground">Include country code, e.g. +356 for Malta.</p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="si-password">Password</Label>
        <Input id="si-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </div>
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}


