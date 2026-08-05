export const operationGroupColours = ["slate", "blue", "teal", "amber", "rose", "violet"] as const;

export type OperationGroupColour = (typeof operationGroupColours)[number];

export const operationGroupColourLabels: Record<OperationGroupColour, string> = {
  slate: "Slate",
  blue: "Blue",
  teal: "Teal",
  amber: "Amber",
  rose: "Rose",
  violet: "Violet",
};

export function normaliseOperationGroupColour(value: string | null | undefined): OperationGroupColour {
  return operationGroupColours.includes(value as OperationGroupColour)
    ? value as OperationGroupColour
    : "slate";
}

export const operationGroupColourClasses: Record<OperationGroupColour, string> = {
  slate: "border-slate-400/50 bg-slate-100 text-slate-800 dark:bg-slate-900 dark:text-slate-100",
  blue: "border-blue-400/50 bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-100",
  teal: "border-teal-400/50 bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-100",
  amber: "border-amber-400/50 bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-100",
  rose: "border-rose-400/50 bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-100",
  violet: "border-violet-400/50 bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-100",
};

export const operationGroupColourDotClasses: Record<OperationGroupColour, string> = {
  slate: "bg-slate-500",
  blue: "bg-blue-500",
  teal: "bg-teal-500",
  amber: "bg-amber-500",
  rose: "bg-rose-500",
  violet: "bg-violet-500",
};
