import { AlertCircle, Info, Lightbulb, CheckCircle2 } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type Kind = "info" | "tip" | "warning" | "success";

const KIND: Record<Kind, { icon: typeof Info; classes: string }> = {
  info: { icon: Info, classes: "border-blue-500/30 bg-blue-500/5 text-blue-950 dark:text-blue-100" },
  tip: { icon: Lightbulb, classes: "border-amber-500/30 bg-amber-500/5 text-amber-950 dark:text-amber-100" },
  warning: { icon: AlertCircle, classes: "border-red-500/30 bg-red-500/5 text-red-950 dark:text-red-100" },
  success: { icon: CheckCircle2, classes: "border-emerald-500/30 bg-emerald-500/5 text-emerald-950 dark:text-emerald-100" },
};

export function Callout({
  kind = "info",
  title,
  children,
}: {
  kind?: Kind;
  title?: string;
  children: ReactNode;
}) {
  const { icon: Icon, classes } = KIND[kind];
  return (
    <div className={cn("my-4 flex gap-3 rounded-lg border p-4", classes)}>
      <Icon className="mt-0.5 h-5 w-5 shrink-0" />
      <div className="min-w-0 space-y-1 text-sm leading-relaxed">
        {title && <div className="font-semibold">{title}</div>}
        <div>{children}</div>
      </div>
    </div>
  );
}
