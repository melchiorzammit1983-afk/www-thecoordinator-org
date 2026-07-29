// Splits a free-typed "names" cell/field into individual passenger names.
// Client-safe mirror of the separator convention already used server-side
// by extractPaxNames (src/lib/pax-extract.ts) — kept as its own tiny module
// rather than importing that one, since it's server-oriented (used from
// portal.functions.ts / coordinator.functions.ts) and this only needs the
// splitting rule, not the notes/parenthetical extraction logic.
const SPLIT_RE = /\s*(?:,|;|\/|&|\band\b|\n|\r)\s*/i;

export function splitPaxNames(raw: string): string[] {
  return raw
    .split(SPLIT_RE)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.length <= 120)
    .slice(0, 20);
}
