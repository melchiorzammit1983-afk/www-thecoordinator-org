import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

/**
 * Two modes:
 * - forced: user is required to change password (temp password flow). Non-dismissible.
 * - voluntary: user opens it from the sidebar. Dismissible with Cancel.
 */
export function ChangePasswordDialog({
  onDone,
  mode = "forced",
  onCancel,
}: {
  onDone: () => void;
  mode?: "forced" | "voluntary";
  onCancel?: () => void;
}) {
  const [current, setCurrent] = useState("");
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const voluntary = mode === "voluntary";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pw.length < 8) return toast.error("Password must be at least 8 characters");
    if (pw !== confirm) return toast.error("Passwords do not match");
    setLoading(true);

    if (voluntary) {
      // Re-verify current password before updating.
      const { data: userData } = await supabase.auth.getUser();
      const email = userData.user?.email;
      if (!email) { setLoading(false); return toast.error("Not signed in"); }
      const { error: signErr } = await supabase.auth.signInWithPassword({ email, password: current });
      if (signErr) { setLoading(false); return toast.error("Current password is incorrect"); }
    }

    const { error } = await supabase.auth.updateUser({
      password: pw,
      data: { must_change_password: false },
    });
    setLoading(false);
    if (error) return toast.error(error.message);
    toast.success("Password updated");
    onDone();
  }

  return (
    <Dialog open={true} onOpenChange={(v) => { if (!v && voluntary) onCancel?.(); }}>
      <DialogContent
        onPointerDownOutside={(e) => { if (!voluntary) e.preventDefault(); }}
        onEscapeKeyDown={(e) => { if (!voluntary) e.preventDefault(); }}
      >
        <DialogHeader>
          <DialogTitle>{voluntary ? "Change password" : "Set a new password"}</DialogTitle>
          <DialogDescription>
            {voluntary
              ? "Enter your current password, then choose a new one."
              : "Your account uses a temporary password from your administrator. Please pick a new one to continue."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          {voluntary && (
            <div className="space-y-2">
              <Label htmlFor="cp">Current password</Label>
              <Input id="cp" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} required autoFocus />
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="np">New password</Label>
            <Input id="np" type="password" value={pw} onChange={(e) => setPw(e.target.value)} required minLength={8} autoFocus={!voluntary} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="np2">Confirm new password</Label>
            <Input id="np2" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required minLength={8} />
          </div>
          <DialogFooter>
            {voluntary && (
              <Button type="button" variant="ghost" onClick={onCancel} disabled={loading}>Cancel</Button>
            )}
            <Button type="submit" disabled={loading}>{loading ? "Saving…" : "Update password"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
