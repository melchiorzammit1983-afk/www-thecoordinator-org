import type {
  ImportField,
  ImportValidationResult,
  NormalizedImportRecord,
  ValidatedImportRow,
} from "@/lib/import-engine/types";

type ValidationOptions<TRecord extends NormalizedImportRecord> = {
  fields: ImportField[];
  validateRecord: (record: TRecord) => ImportValidationResult;
};

export function validateImport<TRecord extends NormalizedImportRecord>(
  records: TRecord[],
  options: ValidationOptions<TRecord>,
): ValidatedImportRow[] {
  return records.map((record) => {
    const values = Object.fromEntries(
      options.fields.map((field) => [field.key, String(record[field.key as keyof TRecord] ?? "")]),
    );
    const errors = options.fields
      .filter((field) => field.required && !values[field.key].trim())
      .map((field) => ({ field: field.key, message: `${field.label} is required.` }));
    const custom = options.validateRecord(record);
    return {
      rowNumber: record.source.rowNumber,
      values,
      errors: [...errors, ...custom.errors],
      warnings: custom.warnings,
    };
  });
}
