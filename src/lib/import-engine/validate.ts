import type {
  ImportField,
  ImportIssue,
  ImportValidationReport,
  NormalizedImportRecord,
  ValidationContext,
  ValidationRule,
} from "@/lib/import-engine/types";

type ValidationOptions<TRecord extends NormalizedImportRecord> = {
  fields: ImportField[];
  rules: ValidationRule<TRecord>[];
  sourceColumns?: string[];
  mappedColumns?: Record<string, string>;
};

function createContext<TRecord extends NormalizedImportRecord>(
  record: TRecord,
  values: Record<string, string>,
  rowIndex: number,
  allValues: Record<string, string>[],
): ValidationContext<TRecord> {
  return { record, values, rowIndex, allValues };
}

function getStatus(issues: ImportIssue[]) {
  if (issues.some((issue) => issue.severity === "error")) return "error" as const;
  if (issues.length) return "warning" as const;
  return "valid" as const;
}

export function validateImport<TRecord extends NormalizedImportRecord>(
  records: TRecord[],
  options: ValidationOptions<TRecord>,
): ImportValidationReport {
  const candidateRows = records
    .map((record) => ({
      record,
      values: Object.fromEntries(
        options.fields.map((field) => [
          field.key,
          String(record[field.key as keyof TRecord] ?? "").trim(),
        ]),
      ),
    }))
    .filter(({ values }) => Object.values(values).some(Boolean));

  const allValues = candidateRows.map(({ values }) => values);
  candidateRows.forEach(({ record, values }, validationIndex) => {
    const context = createContext(record, values, validationIndex, allValues);
    options.rules.forEach((rule) => rule.normalise?.(context));
  });

  const rows = candidateRows.map(({ record, values }, validationIndex) => {
    const context = createContext(record, values, validationIndex, allValues);
    const issues = options.rules.flatMap((rule) => rule.validate(context));
    const duplicate = issues.some((issue) => issue.rule === "duplicate");
    return {
      rowNumber: record.source.rowNumber,
      values,
      status: getStatus(issues),
      issues,
      duplicate,
    };
  });

  const mapped = new Set(Object.values(options.mappedColumns ?? {}).filter(Boolean));
  const sourceWarnings = (options.sourceColumns ?? [])
    .filter((column) => !mapped.has(column))
    .map<ImportIssue>((column) => ({
      rule: "unknown-column",
      severity: "warning",
      message: `Column "${column}" is not mapped and will be ignored.`,
    }));

  return {
    rows,
    sourceWarnings,
    summary: {
      totalRows: rows.length,
      validRows: rows.filter((row) => row.status === "valid").length,
      warningRows: rows.filter((row) => row.status === "warning").length,
      errorRows: rows.filter((row) => row.status === "error").length,
      duplicateRows: rows.filter((row) => row.duplicate).length,
      ignoredRows: records.length - rows.length,
    },
  };
}
