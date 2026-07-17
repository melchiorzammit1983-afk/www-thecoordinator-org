import type { ReactNode } from "react";

export function StepList({ children }: { children: ReactNode }) {
  return <ol className="my-6 space-y-6">{children}</ol>;
}

export function Step({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: ReactNode;
}) {
  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)] gap-4">
      <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
        {n}
      </div>
      <div className="min-w-0 space-y-2">
        <h3 className="text-lg font-semibold text-foreground">{title}</h3>
        <div className="text-sm leading-relaxed text-muted-foreground">{children}</div>
      </div>
    </li>
  );
}
