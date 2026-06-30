import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { listLedger, listCompanies } from "@/lib/admin.functions";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useState } from "react";

type LedgerRow = {
  id: string;
  company_id: string;
  job_id: string | null;
  feature_used: string | null;
  points_deducted: number;
  note: string | null;
  created_at: string;
  companies?: { name: string } | null;
};

export const Route = createFileRoute("/_authenticated/admin/ledger")({
  head: () => ({ meta: [{ title: "Points Audit — Admin" }] }),
  component: LedgerPage,
});

function LedgerPage() {
  const [companyId, setCompanyId] = useState<string>("all");
  const listFn = useServerFn(listLedger);
  const compsFn = useServerFn(listCompanies);

  const { data: companies } = useQuery({
    queryKey: ["companies"],
    queryFn: () => compsFn() as Promise<{ id: string; name: string }[]>,
  });

  const { data, isLoading } = useQuery({
    queryKey: ["ledger", companyId],
    queryFn: () =>
      listFn({ data: companyId === "all" ? {} : { company_id: companyId } }) as Promise<LedgerRow[]>,
  });

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto">
      <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-semibold">Points Audit</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Every deduction and top-up across all companies.
          </p>
        </div>
        <div className="w-full md:w-64">
          <Select value={companyId} onValueChange={setCompanyId}>
            <SelectTrigger><SelectValue placeholder="Filter by company" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All companies</SelectItem>
              {companies?.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </header>

      <div className="rounded-lg border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Feature</TableHead>
                <TableHead>Job</TableHead>
                <TableHead className="text-right">Δ Points</TableHead>
                <TableHead>Note</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={6} className="text-center py-10 text-muted-foreground">Loading…</TableCell></TableRow>
              ) : !data?.length ? (
                <TableRow><TableCell colSpan={6} className="text-center py-10 text-muted-foreground">No entries.</TableCell></TableRow>
              ) : (
                data.map((r) => {
                  const delta = -r.points_deducted; // ledger stores deductions positive; show signed delta to balance
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                        {new Date(r.created_at).toLocaleString()}
                      </TableCell>
                      <TableCell className="font-medium">{r.companies?.name ?? r.company_id.slice(0, 8)}</TableCell>
                      <TableCell>
                        {r.feature_used
                          ? <Badge variant="outline">{r.feature_used}</Badge>
                          : <span className="text-xs text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="text-xs font-mono">{r.job_id ? r.job_id.slice(0, 8) : "—"}</TableCell>
                      <TableCell className={`text-right font-mono ${delta >= 0 ? "text-emerald-600" : "text-destructive"}`}>
                        {delta >= 0 ? `+${delta}` : delta}
                      </TableCell>
                      <TableCell className="text-sm">{r.note ?? <span className="text-muted-foreground">—</span>}</TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
