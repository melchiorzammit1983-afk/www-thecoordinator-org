import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Copy, KeyRound } from "lucide-react";

import {
  adminListPasswordResetRequests,
  adminApprovePasswordResetRequest,
  adminDismissPasswordResetRequest,
} from "@/lib/admin.functions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/admin/password-resets")({
  component: PasswordResetsPage,
});

type ResetRow = {
  id: string;
  phone: string;
  status: string;
  created_at: string;
  resolved_at: string | null;
};

function PasswordResetsPage() {
  const listFn = useServerFn(adminListPasswordResetRequests);
  const approveFn = useServerFn(adminApprovePasswordResetRequest);
  const dismissFn = useServerFn(adminDismissPasswordResetRequest);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["admin-password-resets"],
    queryFn: () => listFn() as Promise<ResetRow[]>,
    refetchInterval: 30_000,
  });

  const [busy, setBusy] = useState<string | null>(null);
  const [reveal, setReveal] = useState<Record<string, { phone: string; temp_password: string }>>({});

  async function onApprove(id: string) {
    setBusy(id);
    try {
      const res = await approveFn({ data: { id } });
      setReveal((r) => ({ ...r, [id]: { phone: res.phone, temp_password: res.temp_password } }));
      toast.success("Temporary password generated");
      refetch();
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to approve");
    } finally {
      setBusy(null);
    }
  }

  async function onDismiss(id: string) {
    setBusy(id);
    try {
      await dismissFn({ data: { id } });
      toast.success("Request dismissed");
      refetch();
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to dismiss");
    } finally {
      setBusy(null);
    }
  }

  const rows = data ?? [];

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto space-y-6">
      <header className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-primary/10 text-primary grid place-items-center">
          <KeyRound className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-xl font-semibold">Password reset requests</h1>
          <p className="text-sm text-muted-foreground">
            Verify the requester's identity by phone before approving. The temporary password is shown to you only — read it out over the call.
          </p>
        </div>
      </header>

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No password reset requests yet.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => {
            const revealed = reveal[r.id];
            return (
              <Card key={r.id}>
                <CardHeader className="pb-2 flex flex-row items-center justify-between gap-3">
                  <div>
                    <CardTitle className="text-base font-mono">{r.phone}</CardTitle>
                    <div className="text-xs text-muted-foreground mt-1">
                      Requested {new Date(r.created_at).toLocaleString()}
                      {r.resolved_at ? ` · Resolved ${new Date(r.resolved_at).toLocaleString()}` : ""}
                    </div>
                  </div>
                  <StatusBadge status={r.status} />
                </CardHeader>
                <CardContent className="pt-2">
                  {r.status === "pending" ? (
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => onApprove(r.id)} disabled={busy === r.id}>
                        {busy === r.id ? "Working…" : "Approve"}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => onDismiss(r.id)} disabled={busy === r.id}>
                        Dismiss
                      </Button>
                    </div>
                  ) : null}
                  {revealed ? (
                    <div className="mt-3 rounded-md border bg-muted/50 p-3">
                      <div className="text-xs text-muted-foreground mb-1">
                        Temporary password for {revealed.phone} — read out over the phone; do not send by message.
                      </div>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 font-mono text-sm break-all">{revealed.temp_password}</code>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            navigator.clipboard.writeText(revealed.temp_password);
                            toast.success("Copied");
                          }}
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const variant =
    status === "pending" ? "default" : status === "approved" ? "secondary" : "outline";
  return <Badge variant={variant as any}>{status}</Badge>;
}
