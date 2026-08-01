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
  message: string;
};

export type ImportValidationResult = {
  errors: ImportIssue[];
  warnings: ImportIssue[];
};

export type ValidatedImportRow = {
  rowNumber: number;
  values: Record<string, ImportCell>;
  errors: ImportIssue[];
  warnings: ImportIssue[];
};
