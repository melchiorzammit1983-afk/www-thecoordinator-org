import type { ReactNode } from "react";

type Item = { title: string; body: ReactNode };

export function StepList(
  props: { items: Item[] } | { children: ReactNode },
) {
  if ("items" in props) {
    return (
      <ol className="not-prose my-6 space-y-6">
        {props.items.map((it, i) => (
          <Step key={i} n={i + 1} title={it.title}>{it.body}</Step>
        ))}
      </ol>
    );
  }
  return <ol className="not-prose my-6 space-y-6">{props.children}</ol>;
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
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
        <div className="text-sm leading-relaxed text-muted-foreground">{children}</div>
      </div>
    </li>
  );
}
