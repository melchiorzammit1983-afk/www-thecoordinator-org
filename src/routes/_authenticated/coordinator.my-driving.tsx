import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getMyDrivingLink } from "@/lib/coordinator.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/coordinator/my-driving")({
  component: MyDrivingRedirect,
});

function MyDrivingRedirect() {
  const navigate = useNavigate();
  const fn = useServerFn(getMyDrivingLink);
  useEffect(() => {
    (async () => {
      try {
        const r = await fn({ data: {} as any });
        navigate({ to: "/m/driver/$token", params: { token: (r as any).token }, replace: true });
      } catch (e: any) {
        toast.error(e?.message ?? "Failed to open");
        navigate({ to: "/coordinator", replace: true });
      }
    })();
  }, [fn, navigate]);
  return <div className="min-h-[40vh] grid place-items-center text-sm text-muted-foreground">Opening your driving view…</div>;
}
