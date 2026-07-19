/**
 * Auto-fill passenger names from free-text fields.
 *
 * Given whatever context we have on a trip (client/company name, notes,
 * optional first/last name, and any explicit portal-supplied list), returns
 * a deduped list of passenger names. When `pax_count` is provided and greater
 * than the extracted list, the tail is padded with "Guest N" so the driver
 * always sees the right number of slots to verify.
 *
 * Pure string parsing — no AI calls, zero cost.
 */

export interface ExtractPaxInput {
  clientcompanyname?: string | null;
  notes?: string | null;
  name?: string | null;
  surname?: string | null;
  portalPaxNames?: string[] | null;
}

const SPLIT_RE = /\s*(?:,|;|\/|&|\band\b|\n|\r)\s*/i;
const MAX_NAMES = 20;

function splitNames(raw: string): string[] {
  return raw
    .split(SPLIT_RE)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.length <= 120);
}

function extractParenthetical(text: string): string[] {
  const out: string[] = [];
  const re = /\(([^)]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push(...splitNames(m[1]));
  }
  return out;
}

function extractFromNotes(text: string): string[] {
  // "Passengers: A, B & C", "Pax - A / B", "Guests — A, B"
  const re = /(?:passengers?|pax|guests?|names?)\s*[:\-–—]\s*([^\n\r.;]+)/gi;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push(...splitNames(m[1]));
  }
  return out;
}

function dedupe(names: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of names) {
    const k = n.toLowerCase().replace(/\s+/g, " ");
    if (k && !seen.has(k)) {
      seen.add(k);
      out.push(n.replace(/\s+/g, " "));
    }
    if (out.length >= MAX_NAMES) break;
  }
  return out;
}

/**
 * Returns extracted names in priority order:
 * portal-supplied → parenthetical on client name → notes → name+surname combo.
 */
export function extractPaxNames(input: ExtractPaxInput): string[] {
  const collected: string[] = [];
  const portal = (input.portalPaxNames ?? []).map((n) => String(n || "").trim()).filter(Boolean);
  collected.push(...portal);

  const client = (input.clientcompanyname ?? "").trim();
  if (client) collected.push(...extractParenthetical(client));

  const notes = (input.notes ?? "").trim();
  if (notes) {
    collected.push(...extractFromNotes(notes));
    // If no keyword-prefixed match, try parentheticals in notes as fallback.
    if (!/passengers?|pax|guests?|names?/i.test(notes)) {
      collected.push(...extractParenthetical(notes));
    }
  }

  const combined = `${input.name ?? ""} ${input.surname ?? ""}`.trim();
  if (combined && /(?:,|;|\/|&|\band\b)/i.test(combined)) {
    collected.push(...splitNames(combined));
  }

  return dedupe(collected);
}

/**
 * Pad an extracted list up to `paxCount` with "Guest N" placeholders.
 * Only pads when `paxCount > 1`; solo trips are untouched.
 */
export function padWithGuests(names: string[], paxCount: number | null | undefined): string[] {
  const count = Math.max(0, Math.min(MAX_NAMES, Number(paxCount) || 0));
  if (count <= 1) return names.slice(0, MAX_NAMES);
  const out = names.slice(0, count);
  while (out.length < count) out.push(`Guest ${out.length + 1}`);
  return out;
}

/**
 * Convenience: extract + pad. Returns [] when there's nothing to fill AND
 * no pax_count target — the caller should skip syncing in that case.
 */
export function autoPaxList(input: ExtractPaxInput, paxCount?: number | null): string[] {
  const names = extractPaxNames(input);
  const padded = padWithGuests(names, paxCount);
  return padded.length ? padded : names;
}
