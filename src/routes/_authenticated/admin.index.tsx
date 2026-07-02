import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { Copy, RefreshCw, Plus, Trash2 } from "lucide-react";

import {
  listCompanies,
  createCompany,
  setCompanyStatus,
  setAccessEnd,
  regenerateCustomLink,
  setRequireClientCompany,
  createCoordinator,
  deleteCoordinator,
} from "@/lib/admin.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

type CompanyRow = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  access_end: string | null;
  custom_link: string;
  require_client_company: boolean;
  status: "pending" | "approved" | "suspended";
  created_at: string;
};

export const Route = createFileRoute("/_authenticated/admin/")({
  head: () => ({ meta: [{ title: "Companies — Admin" }] }),
  component: CompaniesPage,
});

function statusVariant(s: CompanyRow["status"]) {
  if (s === "approved") return "default" as const;
  if (s === "pending") return "secondary" as const;
  return "destructive" as const;
}

function CompaniesPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(listCompanies);
  const { data, isLoading } = useQuery({
    queryKey: ["companies"],
    queryFn: () => listFn() as Promise<CompanyRow[]>,
  });

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto">
      <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-semibold">Companies</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Approve access and share booking links.
          </p>
        </div>
        <CreateCompanyDialog onCreated={() => qc.invalidateQueries({ queryKey: ["companies"] })} />
      </header>

      <div className="rounded-lg border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
                <TableRow>
                <TableHead>Company</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Access until</TableHead>
                <TableHead>Custom link</TableHead>
                <TableHead>Require client co.</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={6} className="text-center py-10 text-muted-foreground">Loading…</TableCell></TableRow>
              ) : !data?.length ? (
                <TableRow><TableCell colSpan={6} className="text-center py-10 text-muted-foreground">No companies yet.</TableCell></TableRow>
              ) : (
                data.map((c) => <CompanyRowView key={c.id} c={c} />)
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}

function CompanyRowView({ c }: { c: CompanyRow }) {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["companies"] });
  const statusFn = useServerFn(setCompanyStatus);
  const regenFn = useServerFn(regenerateCustomLink);
  const reqFn = useServerFn(setRequireClientCompany);

  const statusMut = useMutation({
    mutationFn: (status: CompanyRow["status"]) => statusFn({ data: { id: c.id, status } }),
    onSuccess: () => { toast.success("Status updated"); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const regenMut = useMutation({
    mutationFn: () => regenFn({ data: { id: c.id } }),
    onSuccess: () => { toast.success("Link regenerated"); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const reqMut = useMutation({
    mutationFn: (value: boolean) => reqFn({ data: { id: c.id, value } }),
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
  });

  const linkUrl = typeof window !== "undefined" ? `${window.location.origin}/c/${c.custom_link}` : `/c/${c.custom_link}`;

  return (
    <TableRow>
      <TableCell>
        <div className="font-medium">{c.name}</div>
        <div className="text-xs text-muted-foreground">{c.email}</div>
      </TableCell>
      <TableCell>
        <Badge variant={statusVariant(c.status)} className="capitalize">{c.status}</Badge>
      </TableCell>
      <TableCell className="text-sm">
        {c.access_end ? new Date(c.access_end).toLocaleDateString() : <span className="text-muted-foreground">—</span>}
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-1">
          <code className="text-xs bg-muted px-2 py-1 rounded max-w-[180px] truncate">{linkUrl}</code>
          <Button size="icon" variant="ghost" onClick={() => { navigator.clipboard.writeText(linkUrl); toast.success("Copied"); }}>
            <Copy className="h-3.5 w-3.5" />
          </Button>
          <Button size="icon" variant="ghost" onClick={() => regenMut.mutate()} title="Regenerate">
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </TableCell>
      <TableCell>
        <Switch checked={c.require_client_company} onCheckedChange={(v) => reqMut.mutate(v)} />
      </TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-2 flex-wrap">
          <Select value={c.status} onValueChange={(v) => statusMut.mutate(v as CompanyRow["status"])}>
            <SelectTrigger className="w-32 h-8"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="suspended">Suspended</SelectItem>
            </SelectContent>
          </Select>
          
          <AccessDialog company={c} onDone={invalidate} />
          <CoordinatorDialog company={c} onDone={invalidate} />
          <DeleteCoordinatorDialog company={c} onDone={invalidate} />
        </div>
      </TableCell>
    </TableRow>
  );
}

function CreateCompanyDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const fn = useServerFn(createCompany);
  const mut = useMutation({
    mutationFn: () => fn({ data: { name, email, phone } }),
    onSuccess: () => {
      toast.success("Company created");
      setOpen(false); setName(""); setEmail(""); setPhone("");
      onCreated();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button><Plus className="h-4 w-4 mr-2" />Add company</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New company</DialogTitle>
          <DialogDescription>Creates a pending company with a unique booking link.</DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); mut.mutate(); }} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="cc-name">Name</Label>
            <Input id="cc-name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={200} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="cc-email">Email</Label>
            <Input id="cc-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required maxLength={255} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="cc-phone">Phone (optional)</Label>
            <Input id="cc-phone" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={40} />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={mut.isPending}>{mut.isPending ? "Saving…" : "Create"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}


function AccessDialog({ company, onDone }: { company: CompanyRow; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState<string>("30");
  const fn = useServerFn(setAccessEnd);
  const mut = useMutation({
    mutationFn: () => fn({ data: { id: company.id, days: Number(days) } }),
    onSuccess: () => { toast.success("Access expiry set"); setOpen(false); onDone(); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">Access</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Set access expiry — {company.name}</DialogTitle>
          <DialogDescription>Sets access_end to N days from now (UTC).</DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); mut.mutate(); }} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="ac-days">Days from today</Label>
            <Input id="ac-days" type="number" min={0} max={3650} step={1} value={days} onChange={(e) => setDays(e.target.value)} required />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={mut.isPending}>{mut.isPending ? "Saving…" : "Save"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CoordinatorDialog({ company, onDone }: { company: CompanyRow; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState(company.email ?? "");
  const [password, setPassword] = useState("");
  const fn = useServerFn(createCoordinator);
  const mut = useMutation({
    mutationFn: () => fn({ data: { company_id: company.id, email, password } }),
    onSuccess: () => {
      toast.success("Coordinator ready. Share the credentials.");
      setOpen(false); setPassword("");
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function generate() {
    const bytes = new Uint8Array(9);
    crypto.getRandomValues(bytes);
    const pw = btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, "").slice(0, 12);
    setPassword(pw);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">Coordinator</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Set coordinator — {company.name}</DialogTitle>
          <DialogDescription>
            Creates (or updates) the coordinator account with the password below and assigns it to this company. Email is auto-confirmed — share the credentials directly.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); mut.mutate(); }} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="co-email">Coordinator email</Label>
            <Input id="co-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required maxLength={255} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="co-password">Password</Label>
            <div className="flex gap-2">
              <Input id="co-password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} maxLength={128} />
              <Button type="button" variant="outline" onClick={generate}>Generate</Button>
              <Button type="button" variant="ghost" size="icon" onClick={() => { if (password) { navigator.clipboard.writeText(password); toast.success("Copied"); } }}>
                <Copy className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">Minimum 8 characters. Share this with the coordinator over a secure channel.</p>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={mut.isPending || !password || !email}>
              {mut.isPending ? "Saving…" : "Save & assign"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteCoordinatorDialog({ company, onDone }: { company: CompanyRow; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [alsoDeleteCompany, setAlsoDeleteCompany] = useState(false);
  const fn = useServerFn(deleteCoordinator);
  const mut = useMutation({
    mutationFn: () => fn({ data: { company_id: company.id, also_delete_company: alsoDeleteCompany } }),
    onSuccess: (res: { ok?: boolean; company_deleted: boolean; auth_user_missing?: boolean; warning?: string | null }) => {
      if (res.ok === false) {
        toast.error(res.warning ?? "Could not delete coordinator");
        return;
      }
      if (res.warning) toast.warning(res.warning);
      toast.success(
        res.company_deleted
          ? "Company and coordinator deleted"
          : res.auth_user_missing
            ? "Coordinator assignment cleared"
            : "Coordinator account deleted",
      );
      setOpen(false);
      setAlsoDeleteCompany(false);
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="text-destructive hover:text-destructive">
          <Trash2 className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete coordinator — {company.name}</DialogTitle>
          <DialogDescription>
            Permanently removes the coordinator's login account. They will no longer be able to sign in.
            The company row is kept unless you also choose to delete it below.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2 py-2">
          <Switch id="del-co" checked={alsoDeleteCompany} onCheckedChange={setAlsoDeleteCompany} />
          <Label htmlFor="del-co" className="text-sm">Also delete the company record</Label>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="destructive" onClick={() => mut.mutate()} disabled={mut.isPending}>
            {mut.isPending ? "Deleting…" : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
