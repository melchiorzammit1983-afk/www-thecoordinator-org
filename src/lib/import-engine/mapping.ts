import type { ImportField } from "@/lib/import-engine/types";

const normalise = (value: string) =>
  value
    .trim()
    // Spreadsheet exports commonly use camelCase/PascalCase headers such as
    // FlightNumber. Split those words before matching aliases.
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLocaleLowerCase()
    .replace(/[_-]/g, " ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ");

type MappingCandidate = {
  column: string;
  score: number;
};

function scoreColumn(column: string, field: ImportField) {
  const normalisedColumn = normalise(column);
  const aliases = [field.label, ...(field.aliases ?? [])].map(normalise).filter(Boolean);

  if (aliases.includes(normalisedColumn)) return 100;

  const columnTokens = new Set(normalisedColumn.split(" "));
  return aliases.reduce((bestScore, alias) => {
    const aliasTokens = alias.split(" ");
    const sharedTokens = aliasTokens.filter((token) => columnTokens.has(token));

    if (aliasTokens.length > 1 && sharedTokens.length === aliasTokens.length) return 90;
    if (aliasTokens.length > 1 && normalisedColumn.includes(alias)) return 80;
    if (aliasTokens.length > 1 && sharedTokens.length >= 2)
      return Math.max(bestScore, 60 + sharedTokens.length * 5);

    return bestScore;
  }, 0);
}

/**
 * Returns only unambiguous high-confidence suggestions. Keeping the score
 * internal lets later import UIs explain suggestions without coupling adapters
 * to a particular file layout.
 */
export function getSmartMappingSuggestions(columns: string[], fields: ImportField[]) {
  const claimedColumns = new Set<string>();

  return fields.reduce<Record<string, string>>((mappings, field) => {
    const candidates = columns
      .filter((column) => !claimedColumns.has(column))
      .map<MappingCandidate>((column) => ({ column, score: scoreColumn(column, field) }))
      .filter((candidate) => candidate.score >= 80)
      .sort((left, right) => right.score - left.score || left.column.localeCompare(right.column));

    const [best, second] = candidates;
    if (!best || (second && second.score === best.score)) return mappings;

    mappings[field.key] = best.column;
    claimedColumns.add(best.column);
    return mappings;
  }, {});
}

export function suggestColumnMappings(columns: string[], fields: ImportField[]) {
  return getSmartMappingSuggestions(columns, fields);
}

export function hasDuplicateMappings(mappings: Record<string, string>) {
  const selected = Object.values(mappings).filter(Boolean);
  return new Set(selected).size !== selected.length;
}
