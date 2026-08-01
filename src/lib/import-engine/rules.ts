import type {
  ImportIssue,
  NormalizedImportRecord,
  ValidationContext,
  ValidationRule,
} from "@/lib/import-engine/types";

type RuleOptions = {
  message?: string;
  severity?: "warning" | "error";
};

function issue(
  rule: string,
  field: string | undefined,
  message: string,
  severity: "warning" | "error" = "error",
): ImportIssue {
  return { rule, field, message, severity };
}

export type RequiredFieldRule<TRecord extends NormalizedImportRecord> = ValidationRule<TRecord> & {
  name: "required";
};

export function requiredFieldRule<TRecord extends NormalizedImportRecord>(
  field: string,
  label: string,
): RequiredFieldRule<TRecord> {
  return {
    name: "required",
    validate: ({ values }) =>
      values[field] ? [] : [issue("required", field, `${label} is required.`)],
  };
}

export type RegexRule<TRecord extends NormalizedImportRecord> = ValidationRule<TRecord> & {
  name: "regex";
};

export function regexRule<TRecord extends NormalizedImportRecord>(
  field: string,
  pattern: RegExp,
  options: RuleOptions & { normalise?: (value: string) => string } = {},
): RegexRule<TRecord> {
  return {
    name: "regex",
    normalise: options.normalise
      ? ({ values }) => {
          values[field] = options.normalise?.(values[field] ?? "") ?? "";
        }
      : undefined,
    validate: ({ values }) => {
      const value = values[field];
      return !value || pattern.test(value)
        ? []
        : [issue("regex", field, options.message ?? `${field} has an invalid format.`, options.severity)];
    },
  };
}

export type EnumRule<TRecord extends NormalizedImportRecord> = ValidationRule<TRecord> & {
  name: "enum";
};

export function enumRule<TRecord extends NormalizedImportRecord>(
  field: string,
  values: string[],
  options: RuleOptions & { caseInsensitive?: boolean } = {},
): EnumRule<TRecord> {
  const caseInsensitive = options.caseInsensitive ?? true;
  const accepted = new Map(
    values.map((value) => [caseInsensitive ? value.toLocaleLowerCase() : value, value]),
  );

  return {
    name: "enum",
    normalise: ({ values: rowValues }) => {
      const value = rowValues[field];
      const key = caseInsensitive ? value?.toLocaleLowerCase() : value;
      const canonical = key ? accepted.get(key) : undefined;
      if (canonical) rowValues[field] = canonical;
    },
    validate: ({ values: rowValues }) => {
      const value = rowValues[field];
      return !value || accepted.has(caseInsensitive ? value.toLocaleLowerCase() : value)
        ? []
        : [issue("enum", field, options.message ?? `${field} is not supported.`, options.severity)];
    },
  };
}

export type DateRule<TRecord extends NormalizedImportRecord> = ValidationRule<TRecord> & {
  name: "date";
};

export function dateRule<TRecord extends NormalizedImportRecord>(
  field: string,
  options: RuleOptions = {},
): DateRule<TRecord> {
  const pattern = /^\d{4}-\d{1,2}-\d{1,2}$|^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}$/;
  return {
    name: "date",
    validate: ({ values }) =>
      !values[field] || pattern.test(values[field])
        ? []
        : [
            issue(
              "date",
              field,
              options.message ?? "Date must be YYYY-MM-DD or DD/MM/YYYY.",
              options.severity,
            ),
          ],
  };
}

export type TimeRule<TRecord extends NormalizedImportRecord> = ValidationRule<TRecord> & {
  name: "time";
};

export function timeRule<TRecord extends NormalizedImportRecord>(
  field: string,
  options: RuleOptions = {},
): TimeRule<TRecord> {
  const pattern = /^([01]?\d|2[0-3]):[0-5]\d$/;
  return {
    name: "time",
    normalise: ({ values }) => {
      const value = values[field];
      if (/^\d:\d{2}$/.test(value)) values[field] = `0${value}`;
    },
    validate: ({ values }) =>
      !values[field] || pattern.test(values[field])
        ? []
        : [issue("time", field, options.message ?? "Time must be HH:mm.", options.severity)],
  };
}

export type DuplicateRule<TRecord extends NormalizedImportRecord> = ValidationRule<TRecord> & {
  name: "duplicate";
};

export function duplicateRule<TRecord extends NormalizedImportRecord>(
  fields: string[],
  options: RuleOptions = {},
): DuplicateRule<TRecord> {
  return {
    name: "duplicate",
    validate: ({ rowIndex, values, allValues }) => {
      const key = fields.map((field) => values[field]?.toLocaleLowerCase().trim()).join("|");
      if (!key || fields.some((field) => !values[field])) return [];
      const isDuplicate = allValues.some(
        (candidate, index) =>
          index < rowIndex &&
          fields.every(
            (field) => candidate[field]?.toLocaleLowerCase().trim() === values[field]?.toLocaleLowerCase().trim(),
          ),
      );
      return isDuplicate
        ? [
            issue(
              "duplicate",
              undefined,
              options.message ?? `Duplicate of an earlier row (${fields.join(", ")}).`,
              options.severity,
            ),
          ]
        : [];
    },
  };
}

export type CustomRule<TRecord extends NormalizedImportRecord> = ValidationRule<TRecord> & {
  name: "custom";
};

export function customRule<TRecord extends NormalizedImportRecord>(
  validate: (context: ValidationContext<TRecord>) => ImportIssue[],
  normalise?: (context: ValidationContext<TRecord>) => void,
): CustomRule<TRecord> {
  return { name: "custom", validate, normalise };
}
