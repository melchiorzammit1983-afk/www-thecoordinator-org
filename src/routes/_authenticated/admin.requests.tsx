import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Mail, Phone, Trash2, Check, X, MessageSquare } from "lucide-react";

import {
  listAccessRequests,
  setAccessRequestStatus,
  deleteAccessRequest,
} from "@/lib/admin.functions";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin/requests")({
  head: () => ({ meta: [{ title: "Access Requests — Admin" }] }),
  component: RequestsPage,
});

type Status = "all" | "new" | "contacted" | "approved" | "rejected";

const STATUS_COLORS: Record<string, string> = {
  new: "bg-blue-500/15 text-blue-700 border-blue-500/30",
  contacted: "bg-amber-500/15 text-amber-700 border-amber-500/30",
  approved: "bg-emerald-500/15 text-emerald-700 border-emerald-500/30",
  rejected: "bg-rose-500/15 text-rose-700 border-rose-500/30",
};

function RequestsPage() {
  const [status, setStatus] = useState<Status>("all");
  const listFn = useServerFn(listAccessRequests);
  const setFn = useServerFn(setAccessRequestStatus);
  const delFn = useServerFn(deleteAccessRequest);
  const qc = useQueryClient();

  const { data = [], isLoading } = useQuery({
    queryKey: ["access-requests", status],
    queryFn: () => listFn({ data: { status } }),
    refetchInterval: 30_000,
  });

  const updateStatus = useMutation({
    mutationFn: (v: { id: string; status: Exclude<Status, "all"> }) =>
      setFn({ data: v }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["access-requests"] });
      toast.success("Updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: (id: string) => delFn({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["access-requests"] });
      toast.success("Deleted");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="p-4 md:p-8 max-w-6xl">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-semibold">Access Requests</h1>
          <p className="text-sm text-muted-foreground mt-1">
            New sign-up requests from the landing page.
          </p>
        </div>
        <Select value={status} onValueChange={(v) => setStatus(v as Status)}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="new">New</SelectItem>
            <SelectItem value="contacted">Contacted</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : data.length === 0 ? (
        <div className="rounded-lg border bg-background p-10 text-center text-sm text-muted-foreground">
          No requests yet.
        </div>
      ) : (
        <div className="grid gap-3">
          {data.map((r: any) => (
            <div key={r.id} className="rounded-lg border bg-background p-4">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="font-medium">{r.full_name}</div>
                    {r.kind === "demo" && (
                      <Badge variant="outline" className="bg-amber-100 text-amber-800 border-amber-200 text-xs">
                        Demo
                      </Badge>
                    )}
                    <Badge variant="outline" className={STATUS_COLORS[r.status] ?? ""}>
                      {r.status}
                    </Badge>
                    {r.referral_code && (
                      <Badge variant="secondary" className="text-xs">
                        ref: {r.referred_by?.name ?? r.referral_code}
                      </Badge>
                    )}
                  </div>
                  <div className="mt-1 text-sm text-muted-foreground flex flex-wrap gap-x-4 gap-y-1">
                    <a href={`mailto:${r.email}`} className="flex items-center gap-1 hover:underline">
                      <Mail className="h-3.5 w-3.5" /> {r.email}
                    </a>
                    {r.phone && (
                      <a href={`tel:${r.phone}`} className="flex items-center gap-1 hover:underline">
                        <Phone className="h-3.5 w-3.5" /> {r.phone}
                      </a>
                    )}
                  </div>
                  <div className="mt-2 text-sm grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1">
                    {r.company_name && <div><span className="text-muted-foreground">Company:</span> {r.company_name}</div>}
                    {r.role && <div><span className="text-muted-foreground">Role:</span> {r.role}</div>}
                    {r.country && <div><span className="text-muted-foreground">Country:</span> {r.country}</div>}
                    {r.fleet_size && <div><span className="text-muted-foreground">Fleet:</span> {r.fleet_size}</div>}
                  </div>
                  {r.message && (
                    <div className="mt-2 text-sm flex gap-2">
                      <MessageSquare className="h-3.5 w-3.5 mt-0.5 text-muted-foreground shrink-0" />
                      <span className="text-foreground/80">{r.message}</span>
                    </div>
                  )}
                  <div className="mt-2 text-xs text-muted-foreground">
                    {new Date(r.created_at).toLocaleString()}
                  </div>
                </div>
                <div className="flex flex-col gap-2 shrink-0">
                  <Select
                    value={r.status}
                    onValueChange={(v) =>
                      updateStatus.mutate({ id: r.id, status: v as any })
                    }
                  >
                    <SelectTrigger className="w-36 h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="new">New</SelectItem>
                      <SelectItem value="contacted">Contacted</SelectItem>
                      <SelectItem value="approved">Approved</SelectItem>
                      <SelectItem value="rejected">Rejected</SelectItem>
                    </SelectContent>
                  </Select>
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 flex-1"
                      onClick={() => updateStatus.mutate({ id: r.id, status: "approved" })}
                    >
                      <Check className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 flex-1"
                      onClick={() => updateStatus.mutate({ id: r.id, status: "rejected" })}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8"
                      onClick={() => {
                        if (confirm("Delete this request?")) del.mutate(r.id);
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
