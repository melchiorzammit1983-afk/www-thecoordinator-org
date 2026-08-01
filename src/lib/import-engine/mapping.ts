import type { ImportField } from "@/lib/import-engine/types";

const normalise = (value: string) =>
  value.trim().toLocaleLowerCase().replace(/[_-]/g, " ").replace(/\s+/g, " ");

export function suggestColumnMappings(columns: string[], fields: ImportField[]) {
  return fields.reduce<Record<string, string>>((mappings, field) => {
    const candidates = new Set([field.label, ...(field.aliases ?? [])].map(normalise));
    const column = columns.find((candidate) => candidates.has(normalise(candidate)));
    if (column) mappings[field.key] = column;
    return mappings;
  }, {});
}

export function hasDuplicateMappings(mappings: Record<string, string>) {
  const selected = Object.values(mappings).filter(Boolean);
  return new Set(selected).size !== selected.length;
}
