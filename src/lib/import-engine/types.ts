export type ImportCell = string;

export type ImportSource = {
  fileName: string;
  columns: string[];
  rows: ImportCell[][];
};

export type NormalizedImportRecord = {
  source: {
    adapterId: string;
    fileName: string;
    rowNumber: number;
  };
};

export type ImportSourceAdapter<TRecord extends NormalizedImportRecord> = {
  id: string;
  acceptedFileTypes: string;
  supports: (file: File) => boolean;
  read: (file: File) => Promise<ImportSource>;
  normalize: (source: ImportSource, mappings: Record<string, string>) => TRecord[];
};

export type ImportField = {
  key: string;
  label: string;
  required?: boolean;
  aliases?: string[];
};

export type ImportIssue = {
  field?: string;
  rule: string;
  severity: "warning" | "error";
  message: string;
};

export type ImportValidationStatus = "valid" | "warning" | "error";

export type ValidationContext<TRecord extends NormalizedImportRecord> = {
  record: TRecord;
  values: Record<string, string>;
  rowIndex: number;
  allValues: Record<string, string>[];
};

export type ValidationRule<TRecord extends NormalizedImportRecord> = {
  name: string;
  normalise?: (context: ValidationContext<TRecord>) => void;
  validate: (context: ValidationContext<TRecord>) => ImportIssue[];
};

export type ValidatedImportRow = {
  rowNumber: number;
  values: Record<string, ImportCell>;
  status: ImportValidationStatus;
  issues: ImportIssue[];
  duplicate: boolean;
};

export type ImportValidationSummary = {
  totalRows: number;
  validRows: number;
  warningRows: number;
  errorRows: number;
  duplicateRows: number;
  ignoredRows: number;
};

export type ImportValidationReport = {
  rows: ValidatedImportRow[];
  summary: ImportValidationSummary;
  sourceWarnings: ImportIssue[];
};
