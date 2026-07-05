import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

/**
 * Renders as a bottom sheet on mobile (drag-friendly via the underlying
 * Radix Dialog) and as a centered Dialog on desktop.
 *
 * API is deliberately a subset of both Dialog and Sheet so most existing
 * dialogs can migrate by only swapping the imports.
 */

type RootProps = {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  defaultOpen?: boolean;
  children?: React.ReactNode;
};

export function ResponsiveDialog(props: RootProps) {
  const isMobile = useIsMobile();
  const Root = isMobile ? Sheet : Dialog;
  return <Root {...props} />;
}

export function ResponsiveDialogTrigger(
  props: React.ComponentProps<typeof DialogTrigger>,
) {
  const isMobile = useIsMobile();
  const T = isMobile ? SheetTrigger : DialogTrigger;
  return <T {...(props as any)} />;
}

type ContentProps = React.ComponentProps<typeof DialogContent> & {
  side?: "bottom" | "right";
};

export function ResponsiveDialogContent({
  className,
  side = "bottom",
  children,
  ...props
}: ContentProps) {
  const isMobile = useIsMobile();
  if (isMobile) {
    return (
      <SheetContent
        side={side}
        className={cn(
          "max-h-[90vh] overflow-y-auto rounded-t-2xl pb-safe",
          "flex flex-col gap-4",
          className,
        )}
        {...(props as any)}
      >
        {/* Drag handle affordance */}
        <div className="mx-auto -mt-2 mb-1 h-1.5 w-10 shrink-0 rounded-full bg-muted-foreground/30" />
        {children}
      </SheetContent>
    );
  }
  return (
    <DialogContent className={className} {...props}>
      {children}
    </DialogContent>
  );
}

export function ResponsiveDialogHeader(
  props: React.ComponentProps<typeof DialogHeader>,
) {
  const isMobile = useIsMobile();
  const H = isMobile ? SheetHeader : DialogHeader;
  return <H {...props} />;
}

export function ResponsiveDialogFooter({
  className,
  ...props
}: React.ComponentProps<typeof DialogFooter>) {
  const isMobile = useIsMobile();
  const F = isMobile ? SheetFooter : DialogFooter;
  return (
    <F
      className={cn(
        isMobile && "sticky bottom-0 -mx-6 -mb-6 border-t bg-background px-6 py-4 pb-safe",
        className,
      )}
      {...props}
    />
  );
}

export function ResponsiveDialogTitle(
  props: React.ComponentProps<typeof DialogTitle>,
) {
  const isMobile = useIsMobile();
  const T = isMobile ? SheetTitle : DialogTitle;
  return <T {...props} />;
}

export function ResponsiveDialogDescription(
  props: React.ComponentProps<typeof DialogDescription>,
) {
  const isMobile = useIsMobile();
  const D = isMobile ? SheetDescription : DialogDescription;
  return <D {...props} />;
}
