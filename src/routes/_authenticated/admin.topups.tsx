import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { Check, X } from "lucide-react";
import { adminListTopups, adminApproveTopup, adminDeclineTopup } from "@/lib/admin.functions";
import { AdminBillingHeaderTabs } from "@/components/admin/AdminBillingHeaderTabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/admin/topups")({
  component: TopupsPage,
});

function TopupsPage() {
  const [status, setStatus] = useState<"pending" | "fulfilled" | "rejected" | "all">("pending");
  const qc = useQueryClient();
  const listFn = useServerFn(adminListTopups);
  const approveFn = useServerFn(adminApproveTopup);
  const declineFn = useServerFn(adminDeclineTopup);
  const { data: rows, isLoading } = useQuery({
    queryKey: ["admin-topups", status],
    queryFn: () => listFn({ data: { status, limit: 100 } }) as Promise<any[]>,
  });

  const approveMut = useMutation({
    mutationFn: (id: string) => approveFn({ data: { id } }),
    onSuccess: (r: any) => { toast.success(`Granted ${r.granted} points`); qc.invalidateQueries({ queryKey: ["admin-topups"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const declineMut = useMutation({
    mutationFn: (id: string) => declineFn({ data: { id } }),
    onSuccess: () => { toast.success("Declined"); qc.invalidateQueries({ queryKey: ["admin-topups"] }); },
  });

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <AdminBillingHeaderTabs active="topups" />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Top-up requests</h1>
          <p className="text-sm text-muted-foreground">Approve or decline coordinator point purchases.</p>
        </div>
        <Select value={status} onValueChange={(v: any) => setStatus(v)}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="fulfilled">Fulfilled</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
            <SelectItem value="all">All</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardHeader><CardTitle>Requests</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="py-10 text-center text-sm text-muted-foreground">Loading…</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead>Pack</TableHead>
                  <TableHead>Points</TableHead>
                  <TableHead>Price</TableHead>
                  <TableHead>Note</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(rows ?? []).length === 0 ? (
                  <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">No requests.</TableCell></TableRow>
                ) : (rows ?? []).map((r: any) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-xs">{new Date(r.created_at).toLocaleString()}</TableCell>
                    <TableCell className="text-sm">{r.companies?.name ?? "—"}</TableCell>
                    <TableCell className="text-sm">{r.point_packs?.name ?? <span className="italic text-muted-foreground">custom</span>}</TableCell>
                    <TableCell className="text-sm font-semibold">{r.points_requested}</TableCell>
                    <TableCell className="text-sm">{r.price != null ? `€${Number(r.price).toFixed(2)}` : "—"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">{r.note ?? ""}</TableCell>
                    <TableCell>
                      <Badge variant={r.status === "pending" ? "secondary" : r.status === "fulfilled" ? "default" : "destructive"}>{r.status}</Badge>
                    </TableCell>
                    <TableCell className="text-right space-x-1">
                      {r.status === "pending" ? (
                        <>
                          <Button size="sm" variant="default" onClick={() => approveMut.mutate(r.id)} disabled={approveMut.isPending}><Check className="h-4 w-4" /></Button>
                          <Button size="sm" variant="outline" onClick={() => declineMut.mutate(r.id)} disabled={declineMut.isPending}><X className="h-4 w-4" /></Button>
                        </>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
