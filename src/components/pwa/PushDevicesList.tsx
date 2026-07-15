import { useEffect, useState } from "react";
import { Loader2, Smartphone, Monitor, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { listMyPushDevices, unregisterPushDevice } from "@/lib/push.functions";

type Device = Awaited<ReturnType<typeof listMyPushDevices>>[number];

export function PushDevicesList() {
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    try {
      const data = await listMyPushDevices();
      setDevices(data);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load devices");
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function remove(id: string) {
    setBusy(id);
    try {
      await unregisterPushDevice({ data: { id } });
      setDevices((prev) => prev?.filter((d) => d.id !== id) ?? null);
      toast.success("Device removed");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Remove failed");
    } finally {
      setBusy(null);
    }
  }

  if (devices === null) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading devices…
      </div>
    );
  }
  if (devices.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No devices registered yet. Enable notifications above to add this one.
      </p>
    );
  }

  return (
    <ul className="divide-y rounded-md border">
      {devices.map((d) => {
        const Icon = d.platform === "web" ? Monitor : Smartphone;
        return (
          <li key={d.id} className="flex items-center gap-3 p-3">
            <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium capitalize">{d.role}</span>
                <span className="rounded bg-muted px-1.5 py-0.5 text-xs uppercase text-muted-foreground">
                  {d.platform}
                </span>
                <span className="text-xs text-muted-foreground">
                  …{d.tag || "device"}
                </span>
              </div>
              <p className="truncate text-xs text-muted-foreground">
                {d.user_agent ?? "Unknown device"}
              </p>
              <p className="text-xs text-muted-foreground">
                Last seen {new Date(d.last_seen_at).toLocaleString()}
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => remove(d.id)}
              disabled={busy === d.id}
              aria-label="Remove device"
            >
              {busy === d.id ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
            </Button>
          </li>
        );
      })}
    </ul>
  );
}
