"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import { c } from "@/lib/theme";
import { ImportParseError, parseImportFile } from "@/lib/import/parse";
import { applyMapping, suggestMapping } from "@/lib/import/mapping";
import { hasBlockingIssue, validateQuoteRows, validateRow } from "@/lib/import/validate";
import { buildErrorReportCsv, buildTemplateCsv, downloadCsv } from "@/lib/import/template";
import type {
  ColumnMapping,
  ExtractedRow,
  FieldSpec,
  ImportObjectId,
  ImportResponse,
  ObjectSpec,
  ParsedSheet,
  UpdateResponse,
  ValidatedRow,
} from "@/lib/import/types";
import { DW_CATALOG, DW_MODES, supportedMode, type DwGroupId, type DwMode, type DwObject } from "@/lib/import/catalog";
import SidePanel from "@/components/ui/SidePanel";
import InfoTip from "@/components/ui/InfoTip";
import { useUrlTab } from "@/components/ui/useUrlTab";
import ColumnMapper from "./ColumnMapper";
import ExportFlow from "./ExportFlow";
import ObjectHeader from "./ObjectHeader";
import { DW_TIPS, needsFirstTip } from "./tips";
import ObjectPicker from "./ObjectPicker";
import { shouldFocusSearch, type OpenOverrides, type PickerEntry, type PickerUnowned } from "./pickerModel";
import s from "./DataWorkbench.module.css";
import StartScreen from "./StartScreen";
import { browserStorage, ownedRecents, readRecents, touchRecent } from "./recents";
import { banner, btn, btnGhost, card, mono, pill, stepDot, td, th, tone } from "./ui";

type Step = "upload" | "extract-review" | "map" | "review" | "done";

const STEPS: { id: Step; label: string }[] = [
  { id: "upload", label: "Upload" },
  { id: "map", label: "Match columns" },
  { id: "review", label: "Review" },
  { id: "done", label: "Result" },
];

// Synthetic column prepended to a spec's fields when in Update mode — matches
// the "id" key every /api/export/[object] route always includes.
const ID_FIELD: FieldSpec = {
  key: "id",
  label: "Record ID",
  type: "text",
  required: true,
  hint: "The record's internal ID — comes from a file you exported from this workbench.",
  aliases: ["record id", "recordid", "id"],
};

// Extraction calls a paid, non-instant AI request -- losing that work because
// the user clicked to another screen (or hit back) would mean redoing it.
// sessionStorage survives a route change within the tab; it does not survive
// closing the tab, which is the right lifetime for "in-progress import work."
type ExtractSnapshot = { fileName: string; rows: ExtractedRow[]; documentNotes: string[]; step: "extract-review" | "review" };

function extractStorageKey(objectId: string): string {
  return `dw-extract:${objectId}`;
}

function saveExtractSnapshot(objectId: string, snapshot: ExtractSnapshot) {
  try {
    sessionStorage.setItem(extractStorageKey(objectId), JSON.stringify(snapshot));
  } catch {
    // Storage can be unavailable (private browsing, quota) -- losing the
    // restore convenience isn't worth failing the import over.
  }
}

function loadExtractSnapshot(objectId: string): ExtractSnapshot | null {
  try {
    const raw = sessionStorage.getItem(extractStorageKey(objectId));
    return raw ? (JSON.parse(raw) as ExtractSnapshot) : null;
  } catch {
    return null;
  }
}

function clearExtractSnapshot(objectId: string) {
  try {
    sessionStorage.removeItem(extractStorageKey(objectId));
  } catch {
    // no-op
  }
}

/** An object the catalog knows that this workspace has not switched on: named only in reply to a link or a search. */
export type DwUnowned = { id: ImportObjectId; label: string };

const PHONE_QUERY = "(max-width: 899px)";

export default function DataWorkbenchClient({ objects, unowned, recentsKey }: { objects: DwObject[]; unowned: DwUnowned[]; recentsKey: string }) {
  const params = useSearchParams();
  const [mode, setMode] = useUrlTab(DW_MODES) as [DwMode, (id: string) => void];
  const objectIds = useMemo(() => objects.map((o) => o.spec.id), [objects]);
  const byId = useMemo(() => new Map(objects.map((o) => [o.spec.id, o])), [objects]);
  const [objectId, setObject] = useUrlTab(objectIds, "object", "");
  const current = byId.get(objectId as ImportObjectId) ?? null;
  const shownMode: DwMode = current ? supportedMode(current.spec.id, mode) : mode;
  const rawObject = params.get("object");
  const searchRef = useRef<HTMLInputElement>(null);
  const [recents, setRecents] = useState<string[]>([]);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [overrides, setOverrides] = useState<OpenOverrides>({});
  // The task named in the link (?tab=update with no object) or tapped on the start screen.
  const [picked, setPicked] = useState<DwMode | null>(() => {
    const t = params.get("tab");
    return (DW_MODES as string[]).includes(t ?? "") ? (t as DwMode) : null;
  });

  // An object whose catalog lacks the mode in the URL falls back to its first supported mode, and the URL follows.
  useEffect(() => {
    if (current && shownMode !== mode) setMode(shownMode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.spec.id, mode]);

  // Using an object (from the picker, a link or a recent) moves it to the front of this person's recents.
  useEffect(() => {
    setRecents(objectId ? touchRecent(browserStorage(), recentsKey, objectId) : readRecents(browserStorage(), recentsKey));
  }, [objectId, recentsKey]);

  // Arriving on /data-workbench with no object (a sidebar click or an assistant button) means the start screen.
  useEffect(() => {
    if (!rawObject && objectId) setObject("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawObject]);

  const onPhone = () => typeof window !== "undefined" && window.matchMedia(PHONE_QUERY).matches;
  /** The cursor goes to the picker's search; on a phone the picker is a sheet, so it opens. */
  function focusPicker() {
    if (onPhone()) setSheetOpen(true);
    else searchRef.current?.focus();
  }

  // "/" from anywhere that is not a field focuses the search.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!shouldFocusSearch(e, document.activeElement as HTMLElement | null)) return;
      e.preventDefault();
      focusPicker();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  function openObject(id: string) {
    const target = byId.get(id as ImportObjectId);
    if (!target) return;
    const m = supportedMode(target.spec.id, mode);
    if (m !== mode) setMode(m);
    setObject(target.spec.id);
    setSheetOpen(false);
  }

  function chooseTask(m: DwMode) {
    setPicked(m);
    setMode(m);
    focusPicker();
  }

  const entries: PickerEntry[] = useMemo(
    () => objects.map(({ spec, catalog }) => ({ id: spec.id, label: spec.label, icon: spec.icon, group: catalog.group, parent: catalog.parent, modes: catalog.modes, keywords: catalog.keywords })),
    [objects],
  );
  const unownedEntries: PickerUnowned[] = useMemo(() => unowned.map((u) => ({ id: u.id, label: u.label, keywords: DW_CATALOG[u.id].keywords })), [unowned]);
  const toggleGroup = (g: DwGroupId, open: boolean) => setOverrides((o) => ({ ...o, [g]: open }));
  const pickerProps = {
    entries, unowned: unownedEntries, selectedId: current?.spec.id ?? null, mode: current ? shownMode : picked, recents,
    overrides, onToggleGroup: toggleGroup, onPick: openObject,
  };

  const spec = current?.spec;
  const parent = current?.catalog.parent ? byId.get(current.catalog.parent) : undefined;
  const strayLabel = !current && rawObject ? unowned.find((u) => u.id === rawObject)?.label ?? null : null;
  const ownedSet = new Set<string>(objectIds);
  const startRecents = ownedRecents(recents, ownedSet).map((id) => ({ id, label: byId.get(id as ImportObjectId)!.spec.label, icon: byId.get(id as ImportObjectId)!.spec.icon }));
  // "Needs Accounts first": only the objects this workspace has; a name it cannot import would send the person nowhere.
  const needs = spec ? spec.dependsOn.filter((id) => byId.has(id)).map((id) => byId.get(id)!.spec.label) : [];

  return (
    <div className={`${s.grid} sticky-actions-page`}>
      <aside className={s.col} data-guide="dw.picker" style={{ ...card, padding: 12 }}>
        <ObjectPicker {...pickerProps} inputRef={searchRef} />
      </aside>

      <div style={{ minWidth: 0 }}>
        {current && spec ? (
          <>
            <ObjectHeader
              spec={spec}
              catalog={current.catalog}
              parentLabel={parent?.spec.label ?? null}
              mode={shownMode}
              onMode={(m) => setMode(m)}
              onChange={() => setSheetOpen(true)}
            />
            {shownMode === "export" && <ExportFlow key={`${shownMode}-${spec.id}`} spec={spec} />}
            {(shownMode === "import" || shownMode === "update") && (
              <ImportFlow key={`${shownMode}-${spec.id}`} spec={spec} mode={shownMode} needs={needs} onGoExport={() => setMode("export")} />
            )}
          </>
        ) : (
          <StartScreen
            recents={startRecents}
            stray={strayLabel}
            picked={picked}
            onTask={chooseTask}
            onRecent={openObject}
            onChoose={() => setSheetOpen(true)}
          />
        )}
      </div>

      {sheetOpen && (
        <SidePanel title="Choose an object" onClose={() => setSheetOpen(false)}>
          <ObjectPicker {...pickerProps} autoFocus onEscape={() => setSheetOpen(false)} guide="dw.search.sheet" />
        </SidePanel>
      )}
    </div>
  );
}

function ImportFlow({ spec: baseSpec, mode, needs, onGoExport }: { spec: ObjectSpec; mode: "import" | "update"; needs: string[]; onGoExport: () => void }) {
  // Update mode works against an exported file: a Record ID column is required,
  // and only scalar (non-relationship) fields are mapped/submitted — relationship
  // changes aren't supported by bulk Update, matching what each object's own
  // PATCH route accepts in bulk.
  const spec: ObjectSpec = useMemo(() => {
    // exportOnly fields (computed values like quote status/total/line amount)
    // are Export columns only -- never offered for mapping on Import/Update.
    if (mode !== "update") return { ...baseSpec, fields: baseSpec.fields.filter((f) => !f.exportOnly) };
    // Quotes additionally drop line-item columns and the quote_name grouping
    // key -- bulk Update edits quote header scalars only, one row per quote.
    // Tender BOQ lines: the Unit rate column stays in Update's list (it is a plain number field) but the route ignores it and says so in
    // the row's outcome. A rate needs a source (client's, supplier, past project...), so the Bill of quantities screen is the one place
    // that sets it; item number, unit and tender are likewise not changed by a file, and the Client columns cell is read on Import and written
    // by Export only.
    return {
      ...baseSpec,
      fields: [ID_FIELD, ...baseSpec.fields.filter((f) => !f.exportOnly && !f.importOnly && f.type !== "ref" && f.scope !== "line" && f.key !== "quote_name")],
    };
  }, [baseSpec, mode]);
  const fileRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>("upload");
  const [dragging, setDragging] = useState(false);
  const [fileName, setFileName] = useState("");
  const [sheet, setSheet] = useState<ParsedSheet | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [parseError, setParseError] = useState("");
  const [serverError, setServerError] = useState("");
  const [result, setResult] = useState<ImportResponse | UpdateResponse | null>(null);
  const [showOnlyProblems, setShowOnlyProblems] = useState(false);
  const [pending, startImport] = useTransition();

  // Extraction path: bypasses parse/mapping entirely -- the extraction
  // endpoint already returns rows keyed by spec field keys, so once the
  // user confirms them here they feed validateRow/validateQuoteRows directly.
  const [extractedRows, setExtractedRows] = useState<ExtractedRow[] | null>(null);
  const [extractionNotes, setExtractionNotes] = useState<string[]>([]);
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState("");

  // Restore an in-progress extraction if the user navigated away and came
  // back -- see the ExtractSnapshot helpers above. Runs once per mount
  // (ImportFlow remounts on object/mode switch via its `key`, so this never
  // fires on a stale spec).
  useEffect(() => {
    const snapshot = loadExtractSnapshot(spec.id);
    if (!snapshot) return;
    setFileName(snapshot.fileName);
    setExtractedRows(snapshot.rows);
    setExtractionNotes(snapshot.documentNotes);
    setStep(snapshot.step);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const validated: ValidatedRow[] = useMemo(() => {
    if (extractedRows) {
      return spec.id === "quotes" && mode === "import"
        ? validateQuoteRows(spec, extractedRows)
        : extractedRows.map((r) => validateRow(spec, r.values, r.rowNum));
    }
    if (!sheet) return [];
    const mapped = sheet.rows.map((row, i) => ({
      values: applyMapping(row, mapping),
      rowNum: sheet.rowNumbers[i],
    }));
    // Grouped header+line validation only applies to quote IMPORT files --
    // Update files are one flat row per quote, validated like any object.
    return spec.id === "quotes" && mode === "import"
      ? validateQuoteRows(spec, mapped)
      : mapped.map((m) => validateRow(spec, m.values, m.rowNum));
  }, [sheet, mapping, spec, mode, extractedRows]);

  const readyRows = validated.filter((r) => !hasBlockingIssue(r));
  const problemRows = validated.filter(hasBlockingIssue);

  const claimed = new Set(Object.values(mapping).filter(Boolean) as string[]);
  const canProceedFromMapping = spec.fields.every((f) => !f.required || claimed.has(f.key));

  // Mapped-column import shows only columns the user actually mapped;
  // extraction has no column mapping, so show every field any row populated.
  const reviewColumns = extractedRows
    ? spec.fields.filter((f) => validated.some((r) => r.values[f.key] !== undefined))
    : spec.fields.filter((f) => claimed.has(f.key));

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

  async function handleExtractFile(file: File) {
    setExtractError("");
    setResult(null);
    setFileName(file.name);
    setExtracting(true);

    try {
      const body = new FormData();
      body.append("file", file);
      body.append("object", spec.id);
      const res = await fetch("/api/import/extract", { method: "POST", body });
      const json = await res.json();
      if (!res.ok) {
        setExtractError(json.error ?? `Extraction failed (${res.status})`);
        return;
      }
      const rows = json.rows as ExtractedRow[];
      if (rows.length === 0) {
        setExtractError("No records could be found in that document. Try the file upload instead, or enter this record manually.");
        return;
      }
      const documentNotes = (json.documentNotes as string[]) ?? [];
      setExtractedRows(rows);
      setExtractionNotes(documentNotes);
      setStep("extract-review");
      saveExtractSnapshot(spec.id, { fileName: file.name, rows, documentNotes, step: "extract-review" });
    } catch {
      setExtractError("Could not reach the server. Check your connection and try again.");
    } finally {
      setExtracting(false);
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
    setExtractedRows(null);
    setExtractionNotes([]);
    setExtractError("");
    clearExtractSnapshot(spec.id);
  }

  function runImport() {
    if (readyRows.length === 0) return;
    setServerError("");

    startImport(async () => {
      try {
        const res = await fetch(`/api/${mode}/${spec.id}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            rows: readyRows.map((r) => ({ rowNum: r.rowNum, values: r.values })),
            // Consents are stored with the file they came from as evidence; other objects ignore it.
            fileName,
          }),
        });

        const json = await res.json();
        if (!res.ok) {
          setServerError(json.error ?? `${mode === "update" ? "Update" : "Import"} failed (${res.status})`);
          return;
        }
        setResult(json as ImportResponse | UpdateResponse);
        setStep("done");
        clearExtractSnapshot(spec.id);
      } catch {
        setServerError("Could not reach the server. Check your connection and try again.");
      }
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <StepBar step={step} />

      {step === "upload" && (
        <UploadStep
          spec={spec}
          mode={mode}
          needs={needs}
          onGoExport={onGoExport}
          dragging={dragging}
          setDragging={setDragging}
          fileRef={fileRef}
          onFile={handleFile}
          parseError={parseError}
          // Extraction quality is only proven for Quotes so far (real
          // line-item documents) -- keep it scoped there until the other
          // objects get the same real-document testing before widening it.
          onExtractFile={mode === "import" && spec.id === "quotes" ? handleExtractFile : undefined}
          extracting={extracting}
          extractError={extractError}
        />
      )}

      {step === "extract-review" && extractedRows && (
        <ExtractReviewStep
          spec={spec}
          fileName={fileName}
          rows={extractedRows}
          notes={extractionNotes}
          onRowsChange={(rows) => {
            setExtractedRows(rows);
            saveExtractSnapshot(spec.id, { fileName, rows, documentNotes: extractionNotes, step: "extract-review" });
          }}
          onContinue={() => {
            setStep("review");
            saveExtractSnapshot(spec.id, { fileName, rows: extractedRows, documentNotes: extractionNotes, step: "review" });
          }}
          onBack={reset}
        />
      )}

      {step === "map" && sheet && (
        <div style={card}>
          <SectionTitle
            title="Match your columns to BPMSquare fields"
            info={DW_TIPS.map}
            subtitle={`${fileName} — ${sheet.rows.length} data row${sheet.rows.length === 1 ? "" : "s"}, ${sheet.headers.length} columns${sheet.format === "xlsx" ? " (Excel)" : ""}`}
          />
          <ColumnMapper sheet={sheet} spec={spec} mapping={mapping} onChange={setMapping} />
          <div className={s.actionBar}>
            <button
              data-guide="dw.map.continue"
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

      {step === "review" && (sheet || extractedRows) && (
        <div style={card}>
          <SectionTitle
            title={mode === "update" ? "Review before updating" : "Review before importing"}
            info={mode === "update" ? DW_TIPS.reviewUpdate : DW_TIPS.reviewImport}
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
            {problemRows.length > 0 && (
              <button
                onClick={() =>
                  downloadCsv(
                    `${spec.id}_problems.csv`,
                    buildErrorReportCsv(
                      problemRows.map((r) => ({
                        rowNum: r.rowNum,
                        status: mode === "update" ? "not updated" : "not imported",
                        reason: r.issues.filter((i) => i.severity === "error").map((i) => i.message).join("; "),
                      }))
                    )
                  )
                }
                style={{ ...btnGhost, padding: "5px 11px", fontSize: 12 }}
              >
                ↓ Download problem list
              </button>
            )}
          </div>

          <ReviewTable
            rows={showOnlyProblems ? problemRows : validated}
            columns={reviewColumns}
          />

          {serverError && <div style={{ ...banner(tone.bad), marginTop: 12 }}>{serverError}</div>}

          <div className={s.actionBar}>
            <button
              data-guide="dw.review.run"
              onClick={runImport}
              disabled={readyRows.length === 0 || pending}
              style={{
                ...btn(readyRows.length > 0 && !pending ? tone.ok.base : c.line),
                cursor: readyRows.length > 0 && !pending ? "pointer" : "not-allowed",
              }}
            >
              {pending
                ? (mode === "update" ? "Updating…" : "Importing…")
                : `${mode === "update" ? "Update" : "Import"} ${readyRows.length} row${readyRows.length === 1 ? "" : "s"}`}
            </button>
            <button onClick={() => setStep("map")} style={btnGhost}>← Back to columns</button>
          </div>
        </div>
      )}

      {step === "done" && result && (
        <ResultStep spec={spec} mode={mode} result={result} onReset={reset} />
      )}
    </div>
  );
}

function StepBar({ step }: { step: Step }) {
  // "extract-review" isn't one of the fixed steps -- it stands in for "map"
  // (both sit between choosing a file and reviewing it) so the dots don't
  // go blank while the user is on the extraction path.
  const index = step === "extract-review" ? 1 : STEPS.findIndex((s) => s.id === step);
  return (
    <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "6px 6px" }}>
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

function SectionTitle({ title, subtitle, info }: { title: string; subtitle?: string; info?: string }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "center", fontSize: 13.5, fontWeight: 700, color: c.ink }}>
        <span>{title}</span>
        {info && <InfoTip label={title}>{info}</InfoTip>}
      </div>
      {subtitle && <div style={{ fontSize: 12, color: c.muted, marginTop: 3 }}>{subtitle}</div>}
    </div>
  );
}

/** A short fact about the file, as a pill with its explanation behind an "i". */
function Chip({ t, tip, label, guide, children }: { t: { fg: string; bg: string }; tip: string; label: string; guide: string; children: React.ReactNode }) {
  return (
    <span
      data-guide={guide}
      style={{ display: "inline-flex", alignItems: "center", gap: 2, maxWidth: "100%", padding: "3px 4px 3px 12px", borderRadius: 999, fontSize: 12, fontWeight: 600, background: t.bg, color: t.fg, overflowWrap: "anywhere" }}
    >
      {children}
      <InfoTip label={label}>{tip}</InfoTip>
    </span>
  );
}

function UploadStep({
  spec, mode, needs, dragging, setDragging, fileRef, onFile, parseError,
  onExtractFile, extracting, extractError, onGoExport,
}: {
  spec: ObjectSpec;
  mode: "import" | "update";
  /** Labels of the objects this one links to by name, that must already be in the workspace. */
  needs: string[];
  dragging: boolean;
  setDragging: (v: boolean) => void;
  fileRef: React.RefObject<HTMLInputElement | null>;
  onFile: (f: File) => void;
  parseError: string;
  /** Only offered for Import — Update matches against an exported file's Record ID, which no document has. */
  onExtractFile?: (f: File) => void;
  extracting?: boolean;
  extractError?: string;
  /** Update needs a file that came from Export: this switches the tab. */
  onGoExport: () => void;
}) {
  const required = spec.fields.filter((f) => f.required);
  const extractRef = useRef<HTMLInputElement>(null);
  const browse = () => fileRef.current?.click();

  return (
    <div style={card}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
        {mode === "import" && needs.length > 0 && (
          <Chip t={tone.warn} label="Import order" guide="dw.needs" tip={needsFirstTip(spec.label, needs.length)}>{`Needs ${needs.join(", ")} first`}</Chip>
        )}
        {mode === "update" && <Chip t={tone.info} label="Update file" guide="dw.needs_export" tip={DW_TIPS.needsExport}>Needs a file from Export</Chip>}
        {required.length > 0 && (
          <Chip t={tone.ok} label="Required columns" guide="dw.required" tip={mode === "update" ? DW_TIPS.requiredUpdate : DW_TIPS.required}>
            {`Required: ${required.map((f) => f.label).join(", ")}`}
          </Chip>
        )}
        <InfoTip label="Your file">{DW_TIPS.ownColumns}</InfoTip>
      </div>

      <div
        role="button"
        tabIndex={0}
        data-guide="dw.upload"
        aria-label="Choose a file to upload"
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files[0];
          if (file) onFile(file);
        }}
        onClick={browse}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); browse(); } }}
        style={{
          border: `2px dashed ${dragging ? c.accent : c.line}`,
          borderRadius: 10,
          padding: "30px 20px",
          textAlign: "center",
          cursor: "pointer",
          background: dragging ? c.accentbg : c.panel2,
          transition: "all .15s",
        }}
      >
        <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ color: c.hint, marginBottom: 8 }}>
          <path d="M12 16V4" /><path d="m7 9 5-5 5 5" /><path d="M5 20h14" />
        </svg>
        <div style={{ fontSize: 13, fontWeight: 600, color: c.ink }}>Drop a file here, or click to browse</div>
        <div style={{ fontSize: 12, color: c.hint, marginTop: 5 }}>Excel (.xlsx) or CSV · up to 15 MB</div>
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

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginTop: 14 }}>
        {mode === "import" ? (
          <>
            <button type="button" data-guide="dw.template" onClick={() => downloadCsv(`bpmsquare_${spec.id}_template.csv`, buildTemplateCsv(spec))} style={{ ...btnGhost, minHeight: 44 }}>
              {`↓ Download ${spec.label} template`}
            </button>
            <InfoTip label="Template">{DW_TIPS.template}</InfoTip>
          </>
        ) : (
          <button type="button" data-guide="dw.go_export" onClick={onGoExport} style={{ ...btnGhost, minHeight: 44 }}>Go to Export</button>
        )}
        {onExtractFile && (
          <>
            <button
              type="button"
              data-guide="dw.extract"
              disabled={extracting}
              onClick={() => extractRef.current?.click()}
              style={{ ...btnGhost, minHeight: 44, cursor: extracting ? "wait" : "pointer", opacity: extracting ? 0.7 : 1 }}
            >
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z" /></svg>
              {extracting ? "Reading your document…" : "Read a PDF or Word document"}
            </button>
            <InfoTip label="Reading a document">{DW_TIPS.extract}</InfoTip>
            <input
              ref={extractRef}
              type="file"
              accept=".csv,.xlsx,.xlsm,.pdf,.docx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              disabled={extracting}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onExtractFile(file);
                e.target.value = "";
              }}
              style={{ display: "none" }}
            />
          </>
        )}
      </div>
      {extractError && <div style={{ ...banner(tone.bad), marginTop: 12 }}>{extractError}</div>}

      <div className={`${s.actionBar} ${s.phoneOnly}`}>
        <button type="button" className="bpm-btn bpm-btn-primary bpm-btn-md" style={{ flex: 1, justifyContent: "center" }} onClick={browse}>Choose a file</button>
      </div>
    </div>
  );
}

function ExtractReviewStep({
  spec, fileName, rows, notes, onRowsChange, onContinue, onBack,
}: {
  spec: ObjectSpec;
  fileName: string;
  rows: ExtractedRow[];
  notes: string[];
  onRowsChange: (rows: ExtractedRow[]) => void;
  onContinue: () => void;
  onBack: () => void;
}) {
  const columns = spec.fields.filter((f) => !f.exportOnly);
  const flaggedCount = rows.filter((r) => r.note).length;

  function setCell(rowIndex: number, key: string, value: string) {
    const next = rows.slice();
    next[rowIndex] = { ...next[rowIndex], values: { ...next[rowIndex].values, [key]: value } };
    onRowsChange(next);
  }

  return (
    // A bounded panel, not a page section that grows with row count -- with
    // 40+ extracted rows the title and the Continue button used to scroll
    // out of reach along with the table. Only the table body scrolls now;
    // the context above it and the actions below it never move.
    <div style={{ ...card, display: "flex", flexDirection: "column", maxHeight: "calc(100vh - 220px)", minHeight: 320 }}>
      <div style={{ flexShrink: 0 }}>
        <SectionTitle
          title="Review what was extracted"
          info={DW_TIPS.extractReview}
          subtitle={`${fileName} — ${rows.length} record${rows.length === 1 ? "" : "s"} found`}
        />

        {notes.length > 0 && (
          <div style={{ ...banner(tone.info), marginBottom: 14 }}>
            <strong>About this extraction:</strong>
            <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
              {notes.map((n, i) => <li key={i}>{n}</li>)}
            </ul>
          </div>
        )}

        {flaggedCount > 0 && (
          <div style={{ ...banner(tone.warn), marginBottom: 14 }}>
            <strong>{flaggedCount}</strong> row{flaggedCount === 1 ? "" : "s"} flagged for a closer look — see the Notes column below.
          </div>
        )}
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: "auto", border: `1px solid ${c.line}`, borderRadius: 9 }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead style={{ position: "sticky", top: 0, zIndex: 1 }}>
            <tr>
              <th style={{ ...th, width: 52 }}>Row</th>
              {columns.map((f) => (
                <th key={f.key} style={th}>{f.label}{f.required ? " *" : ""}</th>
              ))}
              <th style={th}>Notes</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={row.rowNum} style={{ background: row.note ? tone.warn.bg : "transparent" }}>
                <td style={{ ...td, ...mono, color: c.hint }}>{row.rowNum}</td>
                {columns.map((f) => (
                  <td key={f.key} style={td}>
                    <input
                      value={row.values[f.key] ?? ""}
                      onChange={(e) => setCell(i, f.key, e.target.value)}
                      style={{
                        width: "100%", minWidth: 100, border: `1px solid ${c.line}`, borderRadius: 6,
                        padding: "4px 7px", fontSize: 12.5, background: c.panel, color: c.ink,
                      }}
                    />
                  </td>
                ))}
                <td style={{ ...td, color: tone.warn.fg, fontSize: 11.5, maxWidth: 220 }}>{row.note ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ flexShrink: 0, display: "flex", gap: 10, marginTop: 16, paddingTop: 16, alignItems: "center", borderTop: `1px solid ${c.line}` }}>
        <button onClick={onContinue} style={btn()}>Looks good — continue to review →</button>
        <button onClick={onBack} style={btnGhost}>Choose a different file</button>
      </div>
    </div>
  );
}

function ReviewTable({
  rows, columns,
}: {
  rows: ValidatedRow[];
  columns: FieldSpec[];
}) {
  const visible = rows.slice(0, 10);

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
  spec, mode, result, onReset,
}: {
  spec: ObjectSpec;
  mode: "import" | "update";
  result: ImportResponse | UpdateResponse;
  onReset: () => void;
}) {
  const doneCount = mode === "update" ? (result as UpdateResponse).updated : (result as ImportResponse).inserted;
  const doneLabel = mode === "update" ? "updated" : "imported";
  // A quote's line rows past the first are always reported "skipped" once
  // their header row succeeds — that's the row's data being absorbed into
  // the header's line list, not a warning. Hide those specifically; a real
  // skip on quotes update ("No mapped columns to update") or on any other
  // object (duplicate account/contact/user, etc.) still shows.
  const isBenignQuoteSkip = (o: { status: string; reason?: string }) =>
    o.status === "skipped" && spec.id === "quotes" &&
    (mode === "import" || /^Line row of the quote already updated by row /.test(o.reason ?? ""));
  const problems = result.outcomes.filter((o) => o.status !== "inserted" && o.status !== "updated" && !isBenignQuoteSkip(o));
  const visibleSkipped = result.outcomes.filter((o) => o.status === "skipped" && !isBenignQuoteSkip(o)).length;
  const allGood = result.failed === 0 && visibleSkipped === 0;
  // Users import only: temporary passwords for the logins just created. No
  // invite emails are sent, so this list is the ONLY time these are shown --
  // copying them out before leaving the page is the whole point.
  const credentials = (result as ImportResponse).credentials ?? [];

  function copyCredentials() {
    const text = credentials.map((cr) => `${cr.email}\t${cr.password}`).join("\n");
    navigator.clipboard?.writeText(text).catch(() => {});
  }

  return (
    <div style={card}>
      <div style={{ ...banner(result.failed > 0 ? tone.warn : tone.ok), marginBottom: problems.length ? 16 : 0 }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>
          {allGood ? `✓ ${mode === "update" ? "Update" : "Import"} complete` : `${mode === "update" ? "Update" : "Import"} finished`}
        </div>
        <div>
          <strong>{doneCount}</strong> {spec.label.toLowerCase()} {doneLabel}
          {visibleSkipped > 0 && <> · <strong>{visibleSkipped}</strong> skipped</>}
          {result.failed > 0 && <> · <strong>{result.failed}</strong> could not be {doneLabel}</>}
          {doneCount > 0 && result.failed > 0 && (
            <div style={{ marginTop: 6 }}>
              The successful rows are saved. Fix the rows below and re-upload just those.
            </div>
          )}
        </div>
      </div>

      {credentials.length > 0 && (
        <div style={{ marginTop: 16, border: `1px solid ${c.line}`, borderRadius: 9, overflow: "hidden" }}>
          <div style={{ padding: "10px 12px", background: c.panel2, borderBottom: `1px solid ${c.line}`, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: c.ink }}>Temporary passwords</div>
              <div style={{ fontSize: 11.5, color: c.muted, marginTop: 2 }}>
                No emails were sent. Copy these now and give each person their password — they are not shown again. Each person chooses a new password at first sign-in.
              </div>
            </div>
            <button
              onClick={copyCredentials}
              style={{ padding: "7px 14px", borderRadius: 7, fontSize: 12.5, fontWeight: 600, background: c.accent, color: c.panel, border: "none", cursor: "pointer", whiteSpace: "nowrap" }}
            >
              Copy all
            </button>
          </div>
          <div style={{ maxHeight: 260, overflowY: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <tbody>
                {credentials.map((cr) => (
                  <tr key={cr.email}>
                    <td style={{ padding: "7px 12px", borderBottom: `1px solid ${c.line}`, color: c.ink }}>{cr.email}</td>
                    <td style={{ padding: "7px 12px", borderBottom: `1px solid ${c.line}`, fontFamily: "monospace", color: c.ink }}>{cr.password}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

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
        <button onClick={onReset} style={btn()}>{mode === "update" ? "Update another file" : "Import another file"}</button>
        {problems.length > 0 && (
          <button
            onClick={() =>
              downloadCsv(
                `${spec.id}_${mode}_report.csv`,
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
