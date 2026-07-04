import { useState } from "react";
import { X } from "lucide-react";

export type BrandingInfo = {
  company_name?: string | null;
  logo_url: string | null;
  advert_url: string | null;
  advert_link: string | null;
  advert_caption: string | null;
  booking_token?: string | null;
} | null | undefined;

/**
 * Fixed bottom bar shown inside driver / client portals.
 * Advert-only: the coordinator logo is now the brand mark in each
 * portal's header, so it does not repeat here. When no advert is set,
 * this component renders nothing.
 */
export function BrandingBar({ branding }: { branding: BrandingInfo }) {
  const [dismissed, setDismissed] = useState(false);
  if (!branding) return null;
  const { advert_url, advert_link, advert_caption, company_name, booking_token } = branding;
  if (!advert_url) return null;
  if (dismissed) return null;

  // Priority: coordinator's own booking page (carries the promo caption
  // as ?promo=... so it lands on the booking as a billing reminder).
  // Fall back to an external advert_link. Otherwise render the advert
  // without a link.
  const promo = (advert_caption ?? "").trim();
  const clickHref = booking_token
    ? `/c/${booking_token}${promo ? `?promo=${encodeURIComponent(promo)}` : ""}`
    : (advert_link || null);
  const clickTarget = clickHref && !booking_token ? "_blank" : undefined;

  const AdvertMedia = (
    <img
      src={advert_url}
      alt={advert_caption ?? "Sponsored"}
      className="h-14 w-auto max-w-[55vw] object-contain rounded-md"
      loading="lazy"
    />
  );

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 pointer-events-none">
      <div className="mx-auto max-w-3xl px-2 pb-[max(env(safe-area-inset-bottom),0.5rem)]">
        <div className="pointer-events-auto rounded-t-xl border border-b-0 bg-background/95 backdrop-blur shadow-lg flex items-center gap-3 pl-3 pr-2 py-2">
          <a
            href={clickHref || undefined}
            target={clickTarget}
            rel="noreferrer"
            className="flex-1 flex items-center gap-3 min-w-0 no-underline text-foreground"
          >
            {AdvertMedia}
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                {booking_token ? "Tap to book" : "Sponsored"}
              </div>
              <div className="text-xs truncate">{advert_caption ?? company_name ?? ""}</div>
            </div>
          </a>

          <button
            type="button"
            aria-label="Hide"
            onClick={() => setDismissed(true)}
            className="h-7 w-7 grid place-items-center rounded-md text-muted-foreground hover:bg-muted shrink-0"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
