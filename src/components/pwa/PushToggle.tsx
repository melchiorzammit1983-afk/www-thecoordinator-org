import { Bell, BellOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { usePushRegistration } from "@/hooks/use-push-registration";
import type { PushRole } from "@/lib/push-client";

interface Props {
  role: PushRole;
  companyId?: string | null;
  className?: string;
}

export function PushToggle({ role, companyId, className }: Props) {
  const { status, busy, enable, disable } = usePushRegistration({ role, companyId });

  if (status === "unsupported") {
    return (
      <div className={className}>
        <p className="text-xs text-muted-foreground">
          Push notifications aren't supported on this browser. Install the app
          from <span className="font-medium">/install</span> for alerts.
        </p>
      </div>
    );
  }

  if (status === "denied") {
    return (
      <div className={className}>
        <p className="text-xs text-muted-foreground">
          Notifications are blocked. Enable them for this site in your browser
          settings, then reload.
        </p>
      </div>
    );
  }

  const enabled = status === "enabled";

  async function toggle() {
    try {
      if (enabled) {
        await disable();
        toast.success("Notifications disabled on this device");
      } else {
        const result = await enable();
        if (result) toast.success("Notifications enabled on this device");
        else toast.error("Could not enable notifications");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Push toggle failed");
    }
  }

  return (
    <Button
      variant={enabled ? "outline" : "default"}
      onClick={toggle}
      disabled={busy}
      className={className}
    >
      {busy ? (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      ) : enabled ? (
        <BellOff className="mr-2 h-4 w-4" />
      ) : (
        <Bell className="mr-2 h-4 w-4" />
      )}
      {enabled ? "Disable notifications on this device" : "Enable notifications"}
    </Button>
  );
}
