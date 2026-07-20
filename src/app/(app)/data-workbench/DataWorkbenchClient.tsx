"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { c } from "@/lib/theme";
import type { CustomFieldDef } from "@/lib/constants";
import { IMPORT_OBJECTS, CUSTOM_FIELD_OBJECT_TYPE, getObjectSpec, withCustomFields } from "@/lib/import/schema";
import { ImportParseError, parseImportFile } from "@/lib/import/parse";
import { applyMapping, suggestMapping } from "@/lib/import/mapping";
import { hasBlockingIssue, validateQuoteRows, validateRow } from "@/lib/import/validate";
import { buildErrorReportCsv, buildTemplateCsv, downloadCsv } from "@/lib/import/template";
import type {
  ColumnMapping,
  ImportObjectId,
  ImportResponse,
  ObjectSpec,
  ParsedSheet,
  ValidatedRow,
} from "@/lib/import/types";
import ColumnMapper from "./ColumnMapper";
import { banner, btn, btnGhost, card, mono, pill, stepDot, td, th, tone } from "./ui";

type Step = "upload" | "map" | "review" | "done";

const STEPS: { id: Step; label: string }[] = [
  { id: "upload", label: "Upload" },
  { id: "map", label: "Match columns" },
  { id: "review", label: "Review" },
  { id: "done", label: "Result" },
];

export default function DataWorkbenchClient({
  customFieldsByObject = {},
}: {
  customFieldsByObject?: Record<string, CustomFieldDef[]>;
}) {
  const [activeId, setActiveId] = useState<ImportObjectId>("accounts");

  const specs = useMemo(() => {
    const map = {} as Record<ImportObjectId, ObjectSpec>;
    for (const base of IMPORT_OBJECTS) {
      const objectType = CUSTOM_FIELD_OBJECT_TYPE[base.id];
      const defs = objectType ? customFieldsByObject[objectType] ?? [] : [];
      map[base.id] = withCustomFields(base, defs);
    }
    return map;
  }, [customFieldsByObject]);

  const spec = specs[activeId];

  return (
    <div style={{ display: "grid", gridTemplateColumns: "215px 1fr", gap: 18, alignItems: "start" }}>
      <nav style={{ display: "flex", flexDirection: "column", gap: 3, position: "sticky", top: 20 }}>
        <div style={{ fontSize: 10.5, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.7, padding: "4px 10px 8px" }}>
          What to import
        </div>
        {IMPORT_OBJECTS.map((obj) => {
          const active = obj.id === activeId;
          return (
            <button
              key={obj.id}
              onClick={() => setActiveId(obj.id)}
              style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "10px 12px", borderRadius: 8, border: "none", cursor: "pointer",
                textAlign: "left", width: "100%",
                background: active ? c.accentbg : "transparent",
                color: active ? c.accent : c.ink,
                fontWeight: active ? 600 : 400,
              }}
            >
              <span style={{ fontSize: 16, width: 20, textAlign: "center", flexShrink: 0 }}>{obj.icon}</span>
              <div>
                <div style={{ fontSize: 13 }}>{obj.label}</div>
                <div style={{ fontSize: 10.5, color: c.hint, marginTop: 1, fontWeight: 400 }}>
                  {specs[obj.id].fields.length} fields
                </div>
              </div>
            </button>
          );
        })}

        <div style={{ borderTop: `1px solid ${c.line}`, marginTop: 12, paddingTop: 12, padding: "12px 10px 0" }}>
          <strong style={{ display: "block", marginBottom: 4, color: c.muted, fontSize: 11 }}>Import order</strong>
          <div style={{ fontSize: 11, color: c.hint, lineHeight: 1.6 }}>
            Accounts first, then Contacts and Assets, then Quotes. Each one links to the records above it by name.
          </div>
        </div>
      </nav>

      <ImportFlow key={activeId} spec={spec} />
    </div>
  );
}

function ImportFlow({ spec }: { spec: ObjectSpec }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>("upload");
  const [dragging, setDragging] = useState(false);
  const [fileName, setFileName] = useState("");
  const [sheet, setSheet] = useState<ParsedSheet | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [parseError, setParseError] = useState("");
  const [serverError, setServerError] = useState("");
  const [result, setResult] = useState<ImportResponse | null>(null);
  const [showOnlyProblems, setShowOnlyProblems] = useState(false);
  const [pending, startImport] = useTransition();

  const validated: ValidatedRow[] = useMemo(() => {
    if (!sheet) return [];
    const mapped = sheet.rows.map((row, i) => ({
      values: applyMapping(row, mapping),
      rowNum: sheet.rowNumbers[i],
    }));
    return spec.id === "quotes"
      ? validateQuoteRows(spec, mapped)
      : mapped.map((m) => validateRow(spec, m.values, m.rowNum));
  }, [sheet, mapping, spec]);

  const readyRows = validated.filter((r) => !hasBlockingIssue(r));
  const problemRows = validated.filter(hasBlockingIssue);

  const claimed = new Set(Object.values(mapping).filter(Boolean) as string[]);
  const canProceedFromMapping = spec.fields.every((f) => !f.required || claimed.has(f.key));

  async function handleFile(file: File) {
    setParseError("");
    setServerError("");
    setResult(null);
    setFileName(file.name);

    try {
      const parsed = await parseImportFile(file);
      if (parsed.rows.length === 0) {
        setParseError("That file has a header row but no data rows below it.");
        return;
      }
      setSheet(parsed);
      setMapping(suggestMapping(parsed.headers, spec).mapping);
      setStep("map");
    } catch (e) {
      setParseError(e instanceof ImportParseError ? e.message : "Could not read that file.");
      setSheet(null);
    }
  }

  function reset() {
    setStep("upload");
    setSheet(null);
    setMapping({});
    setFileName("");
    setParseError("");
    setServerError("");
    setResult(null);
    setShowOnlyProblems(false);
  }

  function runImport() {
    if (readyRows.length === 0) return;
    setServerError("");

    startImport(async () => {
      try {
        const res = await fetch(`/api/import/${spec.id}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            rows: readyRows.map((r) => ({ rowNum: r.rowNum, values: r.values })),
          }),
        });

        const json = await res.json();
        if (!res.ok) {
          setServerError(json.error ?? `Import failed (${res.status})`);
          return;
        }
        setResult(json as ImportResponse);
        setStep("done");
      } catch {
        setServerError("Could not reach the server. Check your connection and try again.");
      }
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ width: 40, height: 40, borderRadius: 10, background: c.accentbg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, color: c.accent }}>
          {spec.icon}
        </div>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: c.ink }}>{spec.label}</div>
          <div style={{ fontSize: 12.5, color: c.muted }}>{spec.description}</div>
        </div>
      </div>

      <StepBar step={step} />

      {step === "upload" && (
        <UploadStep
          spec={spec}
          dragging={dragging}
          setDragging={setDragging}
          fileRef={fileRef}
          onFile={handleFile}
          parseError={parseError}
        />
      )}

      {step === "map" && sheet && (
        <div style={card}>
          <SectionTitle
            title="Match your columns to BPMSquare fields"
            subtitle={`${fileName} — ${sheet.rows.length} data row${sheet.rows.length === 1 ? "" : "s"}, ${sheet.headers.length} columns${sheet.format === "xlsx" ? " (Excel)" : ""}`}
          />
          <ColumnMapper sheet={sheet} spec={spec} mapping={mapping} onChange={setMapping} />
          <div style={{ display: "flex", gap: 10, marginTop: 18, alignItems: "center" }}>
            <button
              onClick={() => setStep("review")}
              disabled={!canProceedFromMapping}
              style={{ ...btn(canProceedFromMapping ? c.accent : c.line), cursor: canProceedFromMapping ? "pointer" : "not-allowed" }}
            >
              Continue to review →
            </button>
            <button onClick={reset} style={btnGhost}>Choose a different file</button>
          </div>
        </div>
      )}

      {step === "review" && sheet && (
        <div style={card}>
          <SectionTitle
            title="Review before importing"
            subtitle="Rows with problems are left out — everything else is imported."
          />

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
            <span style={pill(tone.ok)}>{readyRows.length} ready</span>
            {problemRows.length > 0 && <span style={pill(tone.bad)}>{problemRows.length} with problems</span>}
            {problemRows.length > 0 && (
              <button
                onClick={() => setShowOnlyProblems((v) => !v)}
                style={{ ...btnGhost, padding: "5px 11px", fontSize: 12 }}
              >
                {showOnlyProblems ? "Show all rows" : "Show only problems"}
              </button>
            )}
          </div>

          <ReviewTable
            spec={spec}
            rows={showOnlyProblems ? problemRows : validated}
            mapping={mapping}
          />

          {serverError && <div style={{ ...banner(tone.bad), marginTop: 12 }}>{serverError}</div>}

          <div style={{ display: "flex", gap: 10, marginTop: 18, alignItems: "center", flexWrap: "wrap" }}>
            <button
              onClick={runImport}
              disabled={readyRows.length === 0 || pending}
              style={{
                ...btn(readyRows.length > 0 && !pending ? tone.ok.base : c.line),
                cursor: readyRows.length > 0 && !pending ? "pointer" : "not-allowed",
              }}
            >
              {pending ? "Importing…" : `Import ${readyRows.length} row${readyRows.length === 1 ? "" : "s"}`}
            </button>
            <button onClick={() => setStep("map")} style={btnGhost}>← Back to columns</button>
            {problemRows.length > 0 && (
              <button
                onClick={() =>
                  downloadCsv(
                    `${spec.id}_problems.csv`,
                    buildErrorReportCsv(
                      problemRows.map((r) => ({
                        rowNum: r.rowNum,
                        status: "not imported",
                        reason: r.issues.filter((i) => i.severity === "error").map((i) => i.message).join("; "),
                      }))
                    )
                  )
                }
                style={btnGhost}
              >
                ↓ Download problem list
              </button>
            )}
          </div>
        </div>
      )}

      {step === "done" && result && (
        <ResultStep spec={spec} result={result} onReset={reset} />
      )}
    </div>
  );
}

function StepBar({ step }: { step: Step }) {
  const index = STEPS.findIndex((s) => s.id === step);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      {STEPS.map((s, i) => (
        <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div style={stepDot(i === index, i < index)}>{i < index ? "✓" : i + 1}</div>
          <span style={{ fontSize: 12, fontWeight: i === index ? 600 : 400, color: i === index ? c.ink : c.hint }}>
            {s.label}
          </span>
          {i < STEPS.length - 1 && <div style={{ width: 26, height: 1, background: c.line, margin: "0 4px" }} />}
        </div>
      ))}
    </div>
  );
}

function SectionTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 13.5, fontWeight: 700, color: c.ink }}>{title}</div>
      {subtitle && <div style={{ fontSize: 12, color: c.muted, marginTop: 3 }}>{subtitle}</div>}
    </div>
  );
}

function UploadStep({
  spec, dragging, setDragging, fileRef, onFile, parseError,
}: {
  spec: ObjectSpec;
  dragging: boolean;
  setDragging: (v: boolean) => void;
  fileRef: React.RefObject<HTMLInputElement | null>;
  onFile: (f: File) => void;
  parseError: string;
}) {
  const required = spec.fields.filter((f) => f.required);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={card}>
        <SectionTitle
          title="Start from the template"
          subtitle="Pre-filled with example rows and every column this import understands. Replace the examples with your data."
        />
        {required.length > 0 && (
          <div style={{ ...banner(tone.warn), marginBottom: 14 }}>
            <strong>Required:</strong>{" "}
            {required.map((f) => f.label).join(", ")}. Everything else is optional.
          </div>
        )}
        <button
          onClick={() => downloadCsv(`bpmsquare_${spec.id}_template.csv`, buildTemplateCsv(spec))}
          style={btn()}
        >
          ↓ Download {spec.label} template
        </button>
      </div>

      <div style={card}>
        <SectionTitle
          title="Upload your file"
          subtitle="Your own column names are fine — you'll match them to fields in the next step."
        />
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const file = e.dataTransfer.files[0];
            if (file) onFile(file);
          }}
          onClick={() => fileRef.current?.click()}
          style={{
            border: `2px dashed ${dragging ? c.accent : c.line}`,
            borderRadius: 10,
            padding: "34px 24px",
            textAlign: "center",
            cursor: "pointer",
            background: dragging ? c.accentbg : c.panel2,
            transition: "all .15s",
          }}
        >
          <div style={{ fontSize: 26, marginBottom: 8 }}>⇅</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: c.ink }}>Drop a file here, or click to browse</div>
          <div style={{ fontSize: 12, color: c.hint, marginTop: 5 }}>
            Excel (.xlsx) or CSV · up to 15 MB
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.xlsx,.xlsm,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onFile(file);
              e.target.value = "";
            }}
            style={{ display: "none" }}
          />
        </div>
        {parseError && <div style={{ ...banner(tone.bad), marginTop: 12 }}>{parseError}</div>}
      </div>
    </div>
  );
}

function ReviewTable({
  spec, rows, mapping,
}: {
  spec: ObjectSpec;
  rows: ValidatedRow[];
  mapping: ColumnMapping;
}) {
  const mappedKeys = new Set(Object.values(mapping).filter(Boolean) as string[]);
  const columns = spec.fields.filter((f) => mappedKeys.has(f.key));
  const visible = rows.slice(0, 200);

  return (
    <>
      <div style={{ overflowX: "auto", border: `1px solid ${c.line}`, borderRadius: 9, maxHeight: 460, overflowY: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead style={{ position: "sticky", top: 0, zIndex: 1 }}>
            <tr>
              <th style={{ ...th, width: 52 }}>Row</th>
              <th style={{ ...th, minWidth: 180 }}>Status</th>
              {columns.map((f) => (
                <th key={f.key} style={th}>{f.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => {
              const errors = row.issues.filter((i) => i.severity === "error");
              const warnings = row.issues.filter((i) => i.severity === "warning");
              const bad = errors.length > 0;
              return (
                <tr key={row.rowNum} style={{ background: bad ? tone.bad.bg : "transparent" }}>
                  <td style={{ ...td, ...mono, color: c.hint }}>{row.rowNum}</td>
                  <td style={td}>
                    <span style={pill(bad ? tone.bad : warnings.length ? tone.warn : tone.ok)}>
                      {bad ? "Not imported" : warnings.length ? "Imported with note" : "Ready"}
                    </span>
                    {(bad ? errors : warnings).length > 0 && (
                      <div style={{ fontSize: 11.5, color: bad ? tone.bad.fg : tone.warn.fg, marginTop: 4, lineHeight: 1.5 }}>
                        {(bad ? errors : warnings).map((i) => i.message).join("; ")}
                      </div>
                    )}
                  </td>
                  {columns.map((f) => (
                    <td
                      key={f.key}
                      style={{ ...td, color: row.values[f.key] ? c.ink : c.hint, maxWidth: 190, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                    >
                      {row.values[f.key] || <span style={{ fontStyle: "italic" }}>—</span>}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows.length > visible.length && (
        <div style={{ fontSize: 11.5, color: c.hint, marginTop: 8 }}>
          Showing the first {visible.length} of {rows.length} rows. All {rows.length} will be processed.
        </div>
      )}
    </>
  );
}

function ResultStep({
  spec, result, onReset,
}: {
  spec: ObjectSpec;
  result: ImportResponse;
  onReset: () => void;
}) {
  const problems = result.outcomes.filter((o) => o.status !== "inserted");
  const allGood = result.failed === 0 && result.skipped === 0;

  return (
    <div style={card}>
      <div style={{ ...banner(result.failed > 0 ? tone.warn : tone.ok), marginBottom: problems.length ? 16 : 0 }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>
          {allGood ? "✓ Import complete" : "Import finished"}
        </div>
        <div>
          <strong>{result.inserted}</strong> {spec.label.toLowerCase()} imported
          {result.skipped > 0 && <> · <strong>{result.skipped}</strong> skipped</>}
          {result.failed > 0 && <> · <strong>{result.failed}</strong> could not be imported</>}
          {result.inserted > 0 && result.failed > 0 && (
            <div style={{ marginTop: 6 }}>
              The successful rows are saved. Fix the rows below and re-upload just those.
            </div>
          )}
        </div>
      </div>

      {problems.length > 0 && (
        <div style={{ overflowX: "auto", border: `1px solid ${c.line}`, borderRadius: 9, maxHeight: 320, overflowY: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead style={{ position: "sticky", top: 0 }}>
              <tr>
                <th style={{ ...th, width: 52 }}>Row</th>
                <th style={{ ...th, width: 110 }}>Status</th>
                <th style={th}>Reason</th>
              </tr>
            </thead>
            <tbody>
              {problems.map((o) => (
                <tr key={o.rowNum}>
                  <td style={{ ...td, ...mono, color: c.hint }}>{o.rowNum}</td>
                  <td style={td}>
                    <span style={pill(o.status === "failed" ? tone.bad : tone.warn)}>
                      {o.status === "failed" ? "Failed" : "Skipped"}
                    </span>
                  </td>
                  <td style={{ ...td, color: c.muted }}>{o.reason ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ display: "flex", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
        <button onClick={onReset} style={btn()}>Import another file</button>
        {problems.length > 0 && (
          <button
            onClick={() =>
              downloadCsv(
                `${spec.id}_import_report.csv`,
                buildErrorReportCsv(problems.map((o) => ({ rowNum: o.rowNum, status: o.status, reason: o.reason ?? "" })))
              )
            }
            style={btnGhost}
          >
            ↓ Download report
          </button>
        )}
      </div>
    </div>
  );
}
