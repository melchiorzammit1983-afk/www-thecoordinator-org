export type Label = { id: string; name: string; color: string };

export function labelTint(hex: string, alpha = 0.14): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return `rgba(59,130,246,${alpha})`;
  const r = parseInt(m[1], 16);
  const g = parseInt(m[2], 16);
  const b = parseInt(m[3], 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

export function LabelChip({ label, size = "sm" }: { label: Label; size?: "sm" | "xs" }) {
  const font = size === "xs" ? "text-[9px] px-1 py-[1px]" : "text-[10px] px-1.5 py-0.5";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded font-medium ${font}`}
      style={{ backgroundColor: labelTint(label.color), color: label.color }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: label.color }} />
      {label.name}
    </span>
  );
}

export function LabelStripe({ labels }: { labels: Label[] }) {
  if (!labels.length) return null;
  const stops = labels.slice(0, 3);
  const bg =
    stops.length === 1
      ? stops[0].color
      : `linear-gradient(to bottom, ${stops.map((l, i) => `${l.color} ${(i / stops.length) * 100}% ${((i + 1) / stops.length) * 100}%`).join(", ")})`;
  return (
    <div
      aria-hidden
      className="absolute left-0 top-0 bottom-0 w-1 rounded-l"
      style={{ background: bg }}
    />
  );
}
