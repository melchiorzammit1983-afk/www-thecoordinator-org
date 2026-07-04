import { useState } from "react";
import { X } from "lucide-react";

export type BrandingInfo = {
  company_name?: string | null;
  logo_url: string | null;
  advert_url: string | null;
  advert_link: string | null;
  advert_caption: string | null;
} | null | undefined;

/**
 * Fixed bottom bar shown inside driver / client portals.
 * Renders the coordinator's logo + optional advert banner.
 * Silently renders nothing when there is nothing to show.
 */
export function BrandingBar({ branding }: { branding: BrandingInfo }) {
  const [dismissed, setDismissed] = useState(false);
  if (!branding) return null;
  const { logo_url, advert_url, advert_link, advert_caption, company_name } = branding;
  if (!logo_url && !advert_url) return null;
  if (dismissed) return null;

  const AdvertMedia = advert_url ? (
    <img
      src={advert_url}
      alt={advert_caption ?? "Sponsored"}
      className="h-14 w-auto max-w-[55vw] object-contain rounded-md"
      loading="lazy"
    />
  ) : null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 pointer-events-none">
      <div className="mx-auto max-w-3xl px-2 pb-[max(env(safe-area-inset-bottom),0.5rem)]">
        <div className="pointer-events-auto rounded-t-xl border border-b-0 bg-background/95 backdrop-blur shadow-lg flex items-center gap-3 pl-3 pr-2 py-2">
          {logo_url ? (
            <img
              src={logo_url}
              alt={company_name ?? "Company logo"}
              className="h-9 w-9 rounded-md object-contain bg-background shrink-0"
            />
          ) : (
            <div className="h-9 w-9 rounded-md bg-primary/10 text-primary grid place-items-center text-xs font-semibold shrink-0">
              {(company_name ?? "").slice(0, 2).toUpperCase() || "—"}
            </div>
          )}

          {advert_url ? (
            <a
              href={advert_link || undefined}
              target={advert_link ? "_blank" : undefined}
              rel="noreferrer"
              className="flex-1 flex items-center gap-3 min-w-0 no-underline text-foreground"
            >
              {AdvertMedia}
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Sponsored</div>
                <div className="text-xs truncate">{advert_caption ?? company_name ?? ""}</div>
              </div>
            </a>
          ) : (
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium truncate">{company_name}</div>
              <div className="text-[10px] text-muted-foreground">Powered by your coordinator</div>
            </div>
          )}

          <button
            type="button"
            aria-label="Hide"
            onClick={() => setDismissed(true)}
            className="h-7 w-7 grid place-items-center rounded-md text-muted-foreground hover:bg-muted"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
