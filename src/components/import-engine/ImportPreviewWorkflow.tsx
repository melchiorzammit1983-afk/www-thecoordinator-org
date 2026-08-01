import { useRef, useState } from "react";
import { AlertCircle, CheckCircle2, FileUp, RotateCcw, TriangleAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { hasDuplicateMappings, suggestColumnMappings } from "@/lib/import-engine/mapping";
import { validateImport } from "@/lib/import-engine/validate";
import type {
  ImportField,
  ImportSource,
  ImportSourceAdapter,
  NormalizedImportRecord,
  ValidationRule,
} from "@/lib/import-engine/types";

type Props<TRecord extends NormalizedImportRecord> = {
  sourceAdapter: ImportSourceAdapter<TRecord>;
  fields: ImportField[];
  rules: ValidationRule<TRecord>[];
};

export function ImportPreviewWorkflow<TRecord extends NormalizedImportRecord>({
  sourceAdapter,
  fields,
  rules,
}: Props<TRecord>) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState<ImportSource>();
  const [mappings, setMappings] = useState<Record<string, string>>({});
  const [error, setError] = useState<string>();

  const records = source ? sourceAdapter.normalize(source, mappings) : [];
  const report = validateImport(records, {
    fields,
    rules,
    sourceColumns: source?.columns,
    mappedColumns: mappings,
  });
  const rows = report.rows;
  const requiredUnmapped = fields.filter((field) => field.required && !mappings[field.key]);
  const duplicateMappings = hasDuplicateMappings(mappings);

  async function chooseFile(file?: File) {
    if (!file) return;
    try {
      const nextSource = await sourceAdapter.read(file);
      setSource(nextSource);
      setMappings(suggestColumnMappings(nextSource.columns, fields));
      setError(undefined);
    } catch (nextError) {
      setSource(undefined);
      setMappings({});
      setError(nextError instanceof Error ? nextError.message : "Could not read that file.");
    }
  }

  function reset() {
    setSource(undefined);
    setMappings({});
    setError(undefined);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>1. Select file</CardTitle>
          <CardDescription>
            Files are processed in your browser and are not saved in this milestone.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <input
            ref={inputRef}
            type="file"
            accept={sourceAdapter.acceptedFileTypes}
            className="hidden"
            onChange={(event) => void chooseFile(event.target.files?.[0])}
          />
          <Button type="button" onClick={() => inputRef.current?.click()}>
            <FileUp /> Choose CSV, XLS, or XLSX
          </Button>
          {source && (
            <>
              <Badge variant="secondary">{source.fileName}</Badge>
              <span className="text-sm text-muted-foreground">
                {source.rows.length} rows · {source.columns.length} columns
              </span>
              <Button type="button" variant="ghost" size="sm" onClick={reset}>
                <RotateCcw /> Start again
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      {error && (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>File could not be read</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {source && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>2. Map columns</CardTitle>
              <CardDescription>
                Match each required flight field to a column from {source.fileName}.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {fields.map((field) => (
                <div className="space-y-2" key={field.key}>
                  <Label>
                    {field.label}
                    {field.required && <span className="text-destructive"> *</span>}
                  </Label>
                  <Select
                    value={mappings[field.key] ?? "__none"}
                    onValueChange={(value) =>
                      setMappings((current) => ({
                        ...current,
                        [field.key]: value === "__none" ? "" : value,
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Choose column" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none">Not mapped</SelectItem>
                      {source.columns.map((column) => (
                        <SelectItem key={column} value={column}>
                          {column}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </CardContent>
          </Card>

          {(requiredUnmapped.length > 0 || duplicateMappings) && (
            <Alert variant="destructive">
              <AlertCircle />
              <AlertTitle>Mapping needs attention</AlertTitle>
              <AlertDescription>
                {requiredUnmapped.length > 0
                  ? `Map: ${requiredUnmapped.map((field) => field.label).join(", ")}.`
                  : ""}
                {duplicateMappings ? " Each source column can only be mapped once." : ""}
              </AlertDescription>
            </Alert>
          )}

          {report.sourceWarnings.length > 0 && (
            <Alert>
              <TriangleAlert />
              <AlertTitle>Unmapped columns</AlertTitle>
              <AlertDescription>
                {report.sourceWarnings.map((warning) => warning.message).join(" ")}
              </AlertDescription>
            </Alert>
          )}

          <Card>
            <CardHeader>
              <CardTitle>3. Validation summary</CardTitle>
              <CardDescription>Nothing is imported or saved at this stage.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <Summary label="Total rows" value={report.summary.totalRows} />
              <Summary label="Valid" value={report.summary.validRows} tone="good" />
              <Summary
                label="Warnings"
                value={report.summary.warningRows + report.sourceWarnings.length}
                tone={report.summary.warningRows || report.sourceWarnings.length ? "warn" : undefined}
              />
              <Summary
                label="Errors"
                value={report.summary.errorRows}
                tone={report.summary.errorRows ? "bad" : undefined}
              />
              <Summary
                label="Duplicates"
                value={report.summary.duplicateRows}
                tone={report.summary.duplicateRows ? "bad" : undefined}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>4. Preview</CardTitle>
              <CardDescription>
                All rows stay visible. Correct errors in the source file, then select it again.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Row</TableHead>
                    <TableHead>Status</TableHead>
                    {fields.map((field) => (
                      <TableHead key={field.key}>{field.label}</TableHead>
                    ))}
                    <TableHead>Issues</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow
                      key={row.rowNumber}
                      className={row.status === "error" ? "bg-destructive/5" : undefined}
                    >
                      <TableCell>{row.rowNumber}</TableCell>
                      <TableCell>
                        <Badge variant={row.status === "error" ? "destructive" : "secondary"}>
                          {row.status === "valid"
                            ? "Valid"
                            : row.status === "warning"
                              ? "Warning"
                              : "Error"}
                        </Badge>
                      </TableCell>
                      {fields.map((field) => (
                        <TableCell key={field.key}>
                          {row.values[field.key] || (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      ))}
                      <TableCell className="min-w-64">
                        {row.issues.length ? (
                          <ul className="space-y-1 text-xs">
                            {row.issues.map((issue, index) => (
                              <li
                                className={
                                  issue.severity === "error"
                                    ? "text-destructive"
                                    : "text-amber-700 dark:text-amber-400"
                                }
                                key={`${issue.rule}-${index}`}
                              >
                                {issue.message}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <span className="text-muted-foreground">No issues</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function Summary({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "good" | "bad" | "warn";
}) {
  const Icon =
    tone === "good"
      ? CheckCircle2
      : tone === "bad"
        ? AlertCircle
        : tone === "warn"
          ? TriangleAlert
          : undefined;
  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        {Icon && (
          <Icon
            className={
              tone === "good"
                ? "text-emerald-600"
                : tone === "bad"
                  ? "text-destructive"
                  : "text-amber-600"
            }
          />
        )}
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </div>
  );
}
