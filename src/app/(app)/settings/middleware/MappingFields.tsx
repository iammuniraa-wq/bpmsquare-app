"use client";

import { useEffect, useMemo, useState } from "react";
import Button from "@/components/ui/Button";
import { useFeel } from "@/components/FeelProvider";
import { SettingsSave } from "@/components/settings/SettingsHeaderActions";
import D365Preview from "@/components/connectors/D365Preview";
import type { D365EntityKey } from "@/lib/connectors/d365/types";
import type { Converter, MapRow, SourceField, TargetField, ValueList } from "@/lib/middleware/mapping/types";
import { kindLabel } from "@/lib/middleware/mapping/valueLists";
import s from "./middleware.module.css";
import {
  ApiProblem, PendingProblem, fetchSchema, getMappingDoc, previewEntity, proposeAi, proposeRows, proposeValueLists, resetMapping, saveEngineRows, saveMappingRows, saveValueList,
  type AiSuggestion, type EngineRows, type MapDocumentKey, type ProposedList, type SchemaOperation, type SchemaRequest, type SchemaResult,
} from "./api";
import AiReviewSheet from "./AiReviewSheet";
import ConverterSheet from "./ConverterSheet";
import { useMw } from "./context";
import {
  NOT_SENT, acceptRow, addSuggestions, aiProblemWords, blankRow, cleanRows, confidenceWord, convertLabel, copyRows, errorsByRow, isInboundDocument, isMapDirty,
  legacyEdits, listChoices, missingBar, needsAccept, onlyPlainChanges, removeRow, sampleFieldMap, schemaBar, setRowConvert, setRowTarget, stillMissing, tryBlocker, usedListKinds,
  viewRows, type Block, type MapChoice, type ViewRow,
} from "./mappingLogic";
import ProposeMenu from "./ProposeMenu";
import { FetchPanel, SchemaBar } from "./SchemaBar";
import TryItPanel from "./TryItPanel";
import { Notice, ProblemNotice, describeError, useFlash, useLoad } from "./ui";

const uid = (): string => `u:${typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2)}`;
const UNMAPPED_SHOWN = 12;

// ── The two-column blocks ───────────────────────────────────────────────────

export const targetOptionLabel = (f: TargetField): string =>
  `${f.label} · ${f.path}${f.required ? " *" : ""}${f.state === "new" ? " (new)" : f.state === "missing" ? " (missing)" : ""}`;

/** Mapped lines always show; the BPMSquare fields with no target yet are cut to a few unless asked for. */
export function visibleRows(rows: readonly ViewRow[], showAll: boolean, shown = UNMAPPED_SHOWN): { rows: ViewRow[]; hidden: number } {
  if (showAll) return { rows: [...rows], hidden: 0 };
  let seen = 0;
  const out = rows.filter((r) => {
    if (r.target !== null || r.source === null) return true;
    seen++;
    return seen <= shown;
  });
  return { rows: out, hidden: rows.length - out.length };
}

function FieldCell({ label, name }: { label: string; name: string }) {
  return (
    <span className={s.fieldCell}>
      <span className={s.fieldName}>{label}</span>
      {name && name !== label ? <span className={s.fieldTech}>{name}</span> : null}
    </span>
  );
}

/** Plain props only, so it renders the same in the page and in a test. */
export function FieldBlock({ title, block, rows, targets, errors, inbound, locked, showAll, onShowAll, onTarget, onConvert, onAccept, onRemove, onAdd }: {
  title: string; block: Block; rows: readonly ViewRow[]; targets: readonly TargetField[]; errors: Record<string, string>; inbound?: boolean; locked?: boolean;
  showAll?: boolean; onShowAll?: () => void;
  onTarget: (block: Block, row: ViewRow, target: string | null) => void;
  onConvert: (block: Block, row: ViewRow) => void;
  onAccept: (block: Block, rowId: string) => void;
  onRemove: (block: Block, rowId: string) => void;
  onAdd?: (block: Block) => void;
}) {
  const used = new Set(rows.flatMap((r) => (r.target ? [r.target] : [])));
  const vis = visibleRows(rows, showAll === true);
  const side = inbound ? "ERP source field" : "ERP field";
  return (
    <section aria-label={title}>
      <h3 className="bpm-t-label" style={{ margin: "6px 0" }}>{title}</h3>
      <div className={s.mapCard}>
        <table className={`${s.mapTbl} ${s.mapTbl3}`}>
          <thead><tr><th>BPMSquare field</th><th>{side}</th><th>Convert</th></tr></thead>
          <tbody>
            {vis.rows.length === 0 && <tr><td colSpan={3} className={s.muted}>No fields.</td></tr>}
            {vis.rows.map((r) => {
              const word = r.rowId ? confidenceWord(r) : null;
              const err = r.rowId ? errors[r.rowId] : undefined;
              const own = r.target ? targets.find((t) => t.path === r.target) : undefined;
              const free = targets.filter((t) => t.path === r.target || !used.has(t.path));
              return (
                <tr key={r.key}>
                  <td>
                    <span className={s.row}>
                      <FieldCell label={r.label} name={r.tech} />
                      {r.source === null && r.origin === "standard" ? <span className={s.standardWord}>Standard</span> : null}
                      {r.source === null && r.origin !== "standard" && r.rowId ? <Button size="sm" variant="quiet" onClick={() => onRemove(block, r.rowId as string)} aria-label={`Remove ${r.label}`}>Remove</Button> : null}
                    </span>
                  </td>
                  <td>
                    <div className={s.targetCell}>
                      <select className="bpm-input" aria-label={`${side} for ${r.label}`} value={r.target ?? NOT_SENT} onChange={(e) => onTarget(block, r, e.target.value || null)}>
                        <option value={NOT_SENT}>{inbound ? "Not read" : "Not sent"}</option>
                        {r.target && !own && <option value={r.target}>{r.target} (not in the field list)</option>}
                        {free.map((t) => <option key={t.path} value={t.path}>{targetOptionLabel(t)}</option>)}
                      </select>
                      {word && <span className={s.conf} data-guess={word === "Guess" ? "true" : undefined}>{word}</span>}
                      {r.rowId && needsAccept(r) && <Button size="sm" variant="quiet" onClick={() => onAccept(block, r.rowId as string)} aria-label={`Accept ${r.label}`}>Accept</Button>}
                    </div>
                    {err && <div className={s.issue} role="alert">{err}</div>}
                  </td>
                  <td>
                    <button type="button" className={s.convertBtn} disabled={!r.rowId || locked} aria-label={`Convert ${r.label}`} onClick={() => onConvert(block, r)}>{convertLabel(r.convert)}</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className={s.blockFoot}>
          {vis.hidden > 0 && <Button size="sm" variant="quiet" onClick={onShowAll}>{`Show all ${vis.hidden + vis.rows.length} fields`}</Button>}
          {onAdd && !inbound && <Button size="sm" variant="quiet" onClick={() => onAdd(block)}>Add a fixed value</Button>}
        </div>
      </div>
    </section>
  );
}

// ── The Fields view ─────────────────────────────────────────────────────────

type Panel = "fetch" | "try" | { convert: { block: Block; rowId: string } } | null;

export default function MappingFields({ choice, onDirty }: { choice: MapChoice; onDirty: (dirty: boolean) => void }) {
  const mw = useMw();
  const { confirm } = useFeel();
  const document = choice.document as MapDocumentKey;
  const inbound = isInboundDocument(document);
  const webhook = choice.connection.startsWith("webhook:");
  const view = useLoad(() => getMappingDoc(document, choice.connection), [choice.key, mw.connector.id]);
  const v = view.data;
  const eng = v?.engine ?? null;
  const pending = v?.pending ?? null;

  const [rows, setRows] = useState<EngineRows | null>(null);
  const [base, setBase] = useState<EngineRows | null>(null);
  const [override, setOverride] = useState<SchemaResult | null>(null);
  const [proposedLists, setProposedLists] = useState<ProposedList[]>([]);
  const [missing, setMissing] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [general, setGeneral] = useState<string[]>([]);
  const [problem, setProblem] = useState<unknown>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [ai, setAi] = useState<{ suggestions: AiSuggestion[]; usage: number | null } | null>(null);
  const [busy, setBusy] = useState<"save" | "fetch" | "propose" | "ai" | "reset" | "sample" | null>(null);
  const [fetchErr, setFetchErr] = useState<string | null>(null);
  const [ops, setOps] = useState<{ list: SchemaOperation[]; message: string | null }>({ list: [], message: null });
  const [showAll, setShowAll] = useState<Record<Block, boolean>>({ header: false, lines: false });
  const [sample, setSample] = useState<Record<string, unknown>[] | null>(null);
  const { flash, show } = useFlash();

  useEffect(() => {
    if (!eng) { setRows(null); setBase(null); return; }
    setRows(copyRows(eng.rows)); setBase(copyRows(eng.rows)); setOverride(null); setProposedLists([]);
    setMissing(eng.missingRequired); setErrors({}); setGeneral([]); setPanel(null); setAi(null);
  }, [v]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = isMapDirty(base, rows);
  useEffect(() => { onDirty(dirty); }, [dirty]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => onDirty(false), []); // eslint-disable-line react-hooks/exhaustive-deps

  const targetFields = override?.targetFields ?? eng?.targetFields ?? { header: [], lines: [] };
  const target = override?.target ?? eng?.target ?? null;
  const counts = override?.counts ?? eng?.target.schema.counts ?? { total: 0, new: 0, missing: 0 };
  const sources = eng?.sourceFields ?? { header: [], lines: [] };
  const hasLines = !inbound && (sources.lines.length > 0 || targetFields.lines.length > 0 || (rows?.lines.length ?? 0) > 0);
  const listKinds = useMemo(() => listChoices(eng?.lists.map((l) => l.kind) ?? [], proposedLists.map((l) => l.kind)), [eng, proposedLists]);
  const listMap = useMemo(() => {
    const m: Record<string, ValueList> = {};
    for (const l of proposedLists) m[l.kind] = { kind: l.kind, label: l.label, rows: l.rows, default_in: l.default_in, unknown_in: [] };
    return m;
  }, [proposedLists]);

  const edit = (fn: (r: EngineRows) => EngineRows) => setRows((cur) => (cur ? fn(cur) : cur));
  const setBlock = (block: Block, f: (list: MapRow[]) => MapRow[]) => edit((r) => ({ ...r, [block]: f(r[block]) }));

  const fetchNow = async (req: SchemaRequest) => {
    setBusy("fetch"); setFetchErr(null); setProblem(null);
    try {
      const r = await fetchSchema(choice.connection, document, req);
      if (r.needsOperation) { setOps({ list: r.operations, message: r.message }); setPanel("fetch"); return; }
      setOps({ list: [], message: null }); setPanel(null);
      if (dirty) setOverride(r); else await view.reload();
      show(true, `${r.counts.total} fields read.`);
    } catch (e) {
      if (panel === "fetch") setFetchErr(describeError(e)); else setProblem(e);
    } finally { setBusy(null); }
  };

  const proposeNow = async (mode: "fill" | "replace") => {
    if (!rows) return;
    if (mode === "replace" && !(await confirm({ title: "Replace all lines?", body: "Every line is matched again by name. Your own choices are dropped until you press Save.", confirmLabel: "Replace", tone: "danger" }))) return;
    setBusy("propose"); setProblem(null);
    try {
      const r = await proposeRows(choice.connection, document, mode);
      setRows(r.rows); setProposedLists(r.lists); setMissing(r.missingRequired);
      show(true, `${r.rows.header.length + r.rows.lines.length} lines proposed. Nothing is saved until you press Save.`);
    } catch (e) { setProblem(e); } finally { setBusy(null); }
  };

  const askAi = async () => {
    setBusy("ai"); setProblem(null);
    try {
      const r = await proposeAi(choice.connection, document);
      if (r.suggestions.length === 0) show(true, "AI found nothing more to suggest.");
      else setAi({ suggestions: r.suggestions, usage: r.usage && !r.usage.off ? r.usage.percent : null });
    } catch (e) {
      const status = e instanceof ApiProblem ? e.status : 0;
      setProblem(new ApiProblem(aiProblemWords(status, describeError(e)), status));
    } finally { setBusy(null); }
  };

  const ensureLists = async (r: EngineRows) => {
    const have = new Set(eng?.lists.map((l) => l.kind) ?? []);
    for (const kind of usedListKinds(r)) {
      if (have.has(kind)) continue;
      const draft = proposedLists.find((l) => l.kind === kind) ?? (await proposeValueLists(choice.connection, kind)).find((l) => l.kind === kind);
      await saveValueList(choice.connection, kind, { label: draft?.label ?? kindLabel(kind), rows: draft?.rows ?? [], default_in: draft?.default_in ?? null });
    }
  };

  const save = async () => {
    if (!rows || !base || !v) return;
    setBusy("save"); setProblem(null); setErrors({}); setGeneral([]);
    try {
      if (pending) {
        if (!onlyPlainChanges(base, rows)) throw new PendingProblem(pending.bundle);
        for (const part of legacyEdits(v, rows)) await saveMappingRows(document, part.section, part.rows);
        await view.reload();
      } else {
        await ensureLists(rows);
        view.setData(await saveEngineRows(choice.connection, document, cleanRows(rows)));
      }
      show(true, "Mapping saved.");
    } catch (e) {
      setProblem(e);
      if (e instanceof ApiProblem && e.errors.length) { const m = errorsByRow(e.errors); setErrors(m.byRow); setGeneral(m.general); }
    } finally { setBusy(null); }
  };

  const reset = async () => {
    if (!(await confirm({ title: "Reset to standard?", body: webhook ? "The saved mapping is removed and the proposal is shown again." : "Your changes to this mapping are replaced by the standard one.", confirmLabel: "Reset", tone: "danger" }))) return;
    setBusy("reset"); setProblem(null);
    try { await resetMapping(document, choice.connection); await view.reload(); show(true, webhook ? "Back to the proposal." : "Back to the standard mapping."); } catch (e) { setProblem(e); } finally { setBusy(null); }
  };

  const showSample = async () => {
    if (sample) { setSample(null); return; }
    setBusy("sample"); setProblem(null);
    try { setSample((await previewEntity(document as D365EntityKey)).rows); } catch (e) { setProblem(e); } finally { setBusy(null); }
  };

  if (view.error != null && !v) return <ProblemNotice error={view.error} onRetry={() => void view.reload()} />;
  if (!v) return <div className={`${s.small} ${s.muted}`} role="status">Loading…</div>;
  if (!v.connected) return <Notice tone="info" action={<Button size="sm" onClick={mw.openConnection}>Connect</Button>}>Connect a system first.</Notice>;
  if (!eng || !rows) return <ProblemNotice error={new ApiProblem("This part is still being installed.", 404, true)} />;

  const bar = schemaBar(target ?? eng.target, counts);
  const none = counts.total === 0 && rows.header.length + rows.lines.length === 0;
  const needLine = missingBar(stillMissing(missing, [...targetFields.header, ...targetFields.lines], [...rows.header, ...rows.lines]));
  const blocker = tryBlocker(dirty, none);
  const mine = panel && typeof panel === "object" ? panel.convert : null;
  const mineRow = mine ? rows[mine.block].find((x) => x.id === mine.rowId) ?? null : null;
  const label = (block: Block, key: string) => (block === "lines" ? sources.lines : sources.header).find((f) => f.key === key)?.label ?? key;
  const tlabel = (block: Block, path: string) => (block === "lines" ? targetFields.lines : targetFields.header).find((f) => f.path === path)?.label ?? path;
  const canReset = eng.engine.active || (!v.usingStandard && !webhook);

  const blocks: { block: Block; title: string; fields: readonly SourceField[] }[] = [
    { block: "header", title: inbound ? "Fields" : "Header data", fields: sources.header },
    ...(hasLines ? [{ block: "lines" as Block, title: `Lines${target?.linesPath ? ` (${target.linesPath})` : ""}`, fields: sources.lines }] : []),
  ];

  return (
    <>
      <SettingsSave dirty={dirty} saving={busy === "save"} onSave={() => void save()} label="Save mapping" />
      {pending && <Notice tone="info">{`Database update needed: run ${pending.bundle ?? "the mapping update"} once. Until then only plain field changes save; converters, value lists and fetched field lists wait.`}</Notice>}
      <SchemaBar bar={bar} automatic={target?.kind === "adapter"} busy={busy === "fetch"} onFetch={() => (webhook || !target || target.kind !== "adapter" ? setPanel("fetch") : void fetchNow({ source: "adapter" }))} />
      {needLine && <Notice tone="warn">{needLine}</Notice>}
      {flash && <Notice tone={flash.ok ? "ok" : "err"}>{flash.text}</Notice>}
      {general.map((g) => <Notice key={g} tone="err">{g}</Notice>)}
      {problem != null && general.length === 0 && <ProblemNotice error={problem} />}

      <div className={s.rowBetween}>
        <span className={`${s.row} bpm-tap`}>
          {!inbound && <ProposeMenu disabled={counts.total === 0} busy={busy === "propose" || busy === "ai"} aiAvailable={eng.ai.available} onFill={() => void proposeNow("fill")} onReplace={() => void proposeNow("replace")} onAi={() => void askAi()} />}
          <Button variant="quiet" size="sm" onClick={() => void reset()} loading={busy === "reset"} disabled={!canReset || !!busy}>Reset to standard</Button>
          {inbound && <Button variant="quiet" size="sm" onClick={() => void showSample()} loading={busy === "sample"} aria-pressed={!!sample}>{sample ? "Hide sample data" : "Show sample data"}</Button>}
        </span>
        {!inbound && (
          <span className={s.row}>
            {blocker && <span className={`${s.small} ${s.muted}`}>{blocker}</span>}
            <Button size="sm" onClick={() => setPanel("try")} disabled={!!blocker || !!pending}>Try it</Button>
          </span>
        )}
      </div>
      {sample && <D365Preview title={v.document.label || document} rows={sample} fieldMap={sampleFieldMap(rows)} onClose={() => setSample(null)} />}

      {none && <Notice tone="info">No field list yet: fetch one, paste a sample, or add fields.</Notice>}
      {blocks.map(({ block, title, fields }) => (
        <FieldBlock
          key={block} title={title} block={block} rows={viewRows(rows[block], fields)} targets={targetFields[block]} errors={errors} inbound={inbound} locked={!!pending}
          showAll={showAll[block]} onShowAll={() => setShowAll((a) => ({ ...a, [block]: true }))}
          onTarget={(b, row, t) => setBlock(b, (list) => setRowTarget(list, row, t, uid))}
          onConvert={(b, row) => row.rowId && setPanel({ convert: { block: b, rowId: row.rowId } })}
          onAccept={(b, id) => setBlock(b, (list) => acceptRow(list, id))}
          onRemove={(b, id) => setBlock(b, (list) => removeRow(list, id))}
          onAdd={(b) => setBlock(b, (list) => [...list, blankRow(uid())])}
        />
      ))}

      {panel === "fetch" && (
        <FetchPanel webhook={webhook} busy={busy === "fetch"} error={fetchErr} message={ops.message} operations={ops.list} onFetch={(r) => void fetchNow(r)} onClose={() => { setPanel(null); setFetchErr(null); }} />
      )}
      {panel === "try" && <TryItPanel connection={choice.connection} document={document} onClose={() => setPanel(null)} />}
      {mine && mineRow && (
        <ConverterSheet
          targetLabel={tlabel(mine.block, mineRow.target)} sourceLabel={mineRow.source ? label(mine.block, mineRow.source) : "Fixed value"}
          source={(mine.block === "lines" ? sources.lines : sources.header).find((f) => f.key === mineRow.source) ?? null}
          sourceFields={mine.block === "lines" ? sources.lines : sources.header} current={mineRow.convert as Converter | null} ifEmpty={mineRow.ifEmpty}
          direction={inbound ? "in" : "out"} lists={listMap} listKinds={listKinds}
          onApply={(c, empty) => { setBlock(mine.block, (list) => setRowConvert(list, mineRow.id, c, empty)); setPanel(null); }}
          onClose={() => setPanel(null)}
        />
      )}
      {ai && (
        <AiReviewSheet
          suggestions={ai.suggestions} usagePercent={ai.usage} labels={{ source: label, target: tlabel }}
          onApply={(accepted) => { edit((r) => addSuggestions(r, accepted, uid)); setAi(null); show(true, `${accepted.length} lines added. Press Save to keep them.`); }}
          onClose={() => setAi(null)}
        />
      )}
    </>
  );
}
