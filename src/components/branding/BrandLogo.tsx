import { useEffect } from "react";

/**
 * Small round-square brand logo used in portal/coordinator headers.
 * Falls back to the first two letters of `name` when no logo is set.
 */
export function BrandLogo({
  logoUrl,
  name,
  size = "md",
  className = "",
}: {
  logoUrl: string | null | undefined;
  name: string | null | undefined;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const dim = size === "sm" ? "h-8 w-8 text-[10px]" : size === "lg" ? "h-11 w-11 text-sm" : "h-9 w-9 text-xs";
  const initials = (name ?? "").trim().slice(0, 2).toUpperCase() || "—";
  if (logoUrl) {
    return (
      <img
        src={logoUrl}
        alt={name ?? "Logo"}
        className={`${dim} rounded-md object-contain bg-background border shrink-0 ${className}`}
      />
    );
  }
  return (
    <div
      className={`${dim} rounded-md bg-primary/10 text-primary grid place-items-center font-semibold shrink-0 ${className}`}
    >
      {initials}
    </div>
  );
}

/**
 * Swap the browser tab favicon at runtime. Used on public portal routes
 * where the brand comes from loader data rather than a static file.
 */
export function useFavicon(href: string | null | undefined) {
  useEffect(() => {
    if (!href || typeof document === "undefined") return;
    const prev: { el: HTMLLinkElement; href: string }[] = [];
    document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]').forEach((el) => {
      prev.push({ el, href: el.href });
      el.href = href;
    });
    let injected: HTMLLinkElement | null = null;
    if (prev.length === 0) {
      injected = document.createElement("link");
      injected.rel = "icon";
      injected.href = href;
      document.head.appendChild(injected);
    }
    return () => {
      prev.forEach(({ el, href }) => { el.href = href; });
      if (injected && injected.parentNode) injected.parentNode.removeChild(injected);
    };
  }, [href]);
}
