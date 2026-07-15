import { Button } from "@/components/ui/button";

export function SafetyModeOverlay({
  speedKmh,
  allowOverride = false,
  onUnlock,
}: {
  speedKmh: number | null;
  allowOverride?: boolean;
  onUnlock?: () => void;
}) {
  return (
    <div className="fixed inset-x-0 top-0 z-40 px-3 pt-[env(safe-area-inset-top)]">
      <div className="mx-auto flex max-w-3xl flex-col items-stretch gap-2 rounded-b-2xl bg-yellow-400 px-4 py-3 text-center text-sm font-bold text-black shadow-lg sm:flex-row sm:items-center sm:justify-between sm:text-base">
        <div className="flex-1">
          🚗 SAFETY MODE ACTIVE · {speedKmh ?? "—"} km/h · Distracting options hidden
        </div>
        {allowOverride && onUnlock && (
          <Button
            size="sm"
            variant="secondary"
            className="bg-black text-yellow-400 hover:bg-black/90"
            onClick={onUnlock}
          >
            Unlock 30 s
          </Button>
        )}
      </div>
    </div>
  );
}
