<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Address inputs

Any input that collects a street address, hotel/venue name, airport, or
similar location MUST use `@/components/address/AddressAutocomplete` — never
a raw `<Input>`. It debounces typing, calls the Google Places (New) API
through the Lovable Google Maps connector gateway (bias configurable per
user via the Address & Map settings page), and exposes the picked
`{address, place_id, lat, lng}` so callers can persist geodata later.

Bulk paste flows should call `resolveAddresses` from
`@/lib/places.functions` after parsing, honour `useAddressSettings().auto_fix_bulk`,
and expose an Undo affordance per auto-fixed cell (`ParsedTrip.autoFixed`).
