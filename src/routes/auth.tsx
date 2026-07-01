import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

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
  beforeLoad: async () => {
    if (typeof window === "undefined") return;
    const { data } = await supabase.auth.getSession();
    if (!data.session) return;
    const email = data.session.user.email?.toLowerCase();
    if (email === "melchior.zammit@outlook.com") throw redirect({ to: "/admin" });
    throw redirect({ to: "/coordinator" });
  },

  component: AuthPage,
});

const credsSchema = z.object({
  email: z.string().trim().email().max(255),
  password: z.string().min(8).max(128),
});

function AuthPage() {
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
            <CardDescription>Use the credentials provided by your administrator</CardDescription>
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
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword(parsed.data);
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Signed in");
    const dest = parsed.data.email.toLowerCase() === "melchior.zammit@outlook.com" ? "/admin" : "/coordinator";
    window.location.assign(dest);
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 pt-4">
      <div className="space-y-2">
        <Label htmlFor="si-email">Email</Label>
        <Input id="si-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
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

