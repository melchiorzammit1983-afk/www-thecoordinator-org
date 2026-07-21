import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Link2, User } from "lucide-react";
import { getClientTripLink } from "@/lib/coordinator.functions";

export type LinkPickerPax = { id: string; name: string };

async function copyText(url: string, label: string) {
  try {
    await navigator.clipboard.writeText(url);
    toast.success(`${label} copied`);
  } catch {
    toast.error("Copy failed — " + url);
  }
}

export function ClientLinkPicker({
  open,
  onOpenChange,
  jobId,
  pax,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  jobId: string;
  pax: LinkPickerPax[];
}) {
  const linkFn = useServerFn(getClientTripLink);
  const [busy, setBusy] = useState<string | null>(null);

  async function copyForPax(p: LinkPickerPax | null) {
    setBusy(p?.id ?? "__trip");
    try {
      const res: any = await linkFn({ data: { job_id: jobId } });
      const base = `${window.location.origin}/t/${res.token}`;
      const url = p ? `${base}?pax=${p.id}` : base;
      await copyText(url, p ? `Link for ${p.name}` : "Trip link");
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err?.message ?? "Could not create link");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Who is this link for?</DialogTitle>
          <DialogDescription>
            Pick a passenger to copy their personal link, or copy the shared trip link.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1 max-h-72 overflow-y-auto">
          {pax.map((p) => (
            <button
              key={p.id}
              onClick={() => copyForPax(p)}
              disabled={busy !== null}
              className="w-full flex items-center gap-2 px-3 py-2.5 rounded-md text-sm text-left hover:bg-muted/70 disabled:opacity-50 transition-colors"
            >
              <User className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="flex-1 truncate">{p.name || "Unnamed passenger"}</span>
              <Link2 className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          ))}
        </div>
        <DialogFooter className="sm:justify-between gap-2">
          <Button variant="outline" size="sm" onClick={() => copyForPax(null)} disabled={busy !== null}>
            Copy shared trip link
          </Button>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
