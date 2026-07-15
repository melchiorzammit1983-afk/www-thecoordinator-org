export function SafetyModeOverlay({ speedKmh }: { speedKmh: number | null }) {
  return (
    <div className="fixed inset-x-0 top-0 z-40 px-3 pt-[env(safe-area-inset-top)]">
      <div className="mx-auto max-w-3xl rounded-b-2xl bg-yellow-400 px-4 py-3 text-center text-sm font-bold text-black shadow-lg sm:text-base">
        🚗 Safety Mode · {speedKmh ?? "—"} km/h · Distracting options hidden
      </div>
    </div>
  );
}
