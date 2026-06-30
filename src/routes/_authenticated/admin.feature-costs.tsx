import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { listFeatureCosts, setFeatureCost } from "@/lib/admin.functions";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

type Cost = {
  feature_name: "tracking" | "bulkupload" | "client_booking" | "qr";
  points_cost: number;
};

const LABELS: Record<Cost["feature_name"], string> = {
  tracking: "Tracking",
  bulkupload: "Bulk upload",
  client_booking: "Client booking",
  qr: "QR codes",
};

export const Route = createFileRoute("/_authenticated/admin/feature-costs")({
  head: () => ({ meta: [{ title: "Feature Costs — Admin" }] }),
  component: FeatureCostsPage,
});

function FeatureCostsPage() {
  const listFn = useServerFn(listFeatureCosts);
  const { data, isLoading } = useQuery({
    queryKey: ["feature-costs"],
    queryFn: () => listFn() as Promise<Cost[]>,
  });

  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Feature Costs</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Points charged per feature use. Bulk upload is free by default.
        </p>
      </header>

      <div className="rounded-lg border bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Feature</TableHead>
              <TableHead className="w-40">Points</TableHead>
              <TableHead className="w-32 text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={3} className="text-center py-10 text-muted-foreground">Loading…</TableCell></TableRow>
            ) : (
              data?.map((row) => <CostRow key={row.feature_name} row={row} />)
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function CostRow({ row }: { row: Cost }) {
  const [value, setValue] = useState(String(row.points_cost));
  useEffect(() => { setValue(String(row.points_cost)); }, [row.points_cost]);
  const qc = useQueryClient();
  const fn = useServerFn(setFeatureCost);
  const mut = useMutation({
    mutationFn: () => fn({ data: { feature_name: row.feature_name, points_cost: Number(value) } }),
    onSuccess: () => { toast.success("Saved"); qc.invalidateQueries({ queryKey: ["feature-costs"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const num = Number(value);
  const dirty = !Number.isNaN(num) && num !== row.points_cost;
  const isFree = row.feature_name === "bulkupload" && row.points_cost === 0;

  return (
    <TableRow>
      <TableCell>
        <div className="font-medium">{LABELS[row.feature_name]}</div>
        <div className="text-xs text-muted-foreground">{row.feature_name}</div>
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          <Input type="number" min={0} step={1} value={value} onChange={(e) => setValue(e.target.value)} className="w-28" />
          {isFree && <Badge variant="secondary">Free</Badge>}
        </div>
      </TableCell>
      <TableCell className="text-right">
        <Button size="sm" disabled={!dirty || mut.isPending} onClick={() => mut.mutate()}>
          {mut.isPending ? "Saving…" : "Save"}
        </Button>
      </TableCell>
    </TableRow>
  );
}
