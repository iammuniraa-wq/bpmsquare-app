"use client";

import { useEffect, useRef, useState } from "react";
import Button from "@/components/ui/Button";
import InfoTip from "@/components/ui/InfoTip";
import { Input, Select } from "@/components/ui/Input";
import { useFeel } from "@/components/FeelProvider";
import s from "./middleware.module.css";
import {
  ApiProblem, deleteValueList, getValueLists, importValueListCsv, proposeValueLists, saveValueList, valueListCsvUrl,
  type CsvPreview, type ValueListView,
} from "./api";
import {
  addMissingValue, addRow, addableKinds, cleanListRows, counterLine, csvPreviewLine, defaultChoices, draftOf, draftOfProposed, emptyDraft, isListDirty, listProblems,
  mergeProposed, needsCode, newCustomList, removeRow, setBpm, setErp, setInbound, type ListDraft,
} from "./valueListLogic";
import { MIDDLEWARE_TIPS } from "./tips";
import { Notice, ProblemNotice, useFlash, useLoad } from "./ui";

/** One list as a two-column table. Plain props, so a test renders it as it is. */
export function ListTable({ draft, counts, unmapped, onChange }: {
  draft: ListDraft; counts?: ValueListView["counts"]; unmapped?: ValueListView["unmapped"]; onChange: (d: ListDraft) => void;
}) {
  const problems = listProblems(draft);
  const choices = defaultChoices(draft);
  const gaps = unmapped ? [...unmapped.out.map((v) => ({ side: "out" as const, v })), ...unmapped.in.map((v) => ({ side: "in" as const, v }))] : [];
  return (
    <div className={s.stack} style={{ gap: 10 }}>
      {gaps.length > 0 && (
        <div className={s.valueChips} role="group" aria-label="Values without a row">
          {gaps.slice(0, 12).map((g) => (
            <button key={`${g.side}:${g.v}`} type="button" className={s.valueChip} onClick={() => onChange(addMissingValue(draft, g.side, g.v))}>
              {g.v}<span className={s.muted}> · {g.side === "out" ? "sent" : "came back"} · Add row</span>
            </button>
          ))}
        </div>
      )}
      <div className={s.mapCard}>
        <table className={`${s.mapTbl} ${s.vlTbl}`}>
          <thead><tr><th>BPMSquare value</th><th>ERP code</th><th>In <InfoTip label="In">{MIDDLEWARE_TIPS.listInbound}</InfoTip></th><th><span className={s.srOnly}>Remove</span></th></tr></thead>
          <tbody>
            {draft.rows.length === 0 && <tr><td colSpan={4} className={s.muted}>No rows yet.</td></tr>}
            {draft.rows.map((r, i) => {
              const dupe = problems.find((p) => p.row === i);
              return (
                <tr key={i}>
                  <td><Input aria-label={`BPMSquare value, row ${i + 1}`} value={r.bpm} invalid={!!dupe} onChange={(e) => onChange(setBpm(draft, i, e.target.value))} />{dupe && <div className={s.issue} role="alert">{dupe.message}</div>}</td>
                  <td><Input aria-label={`ERP code, row ${i + 1}`} value={r.erp} invalid={needsCode(r)} placeholder={needsCode(r) ? "Needs a code" : ""} onChange={(e) => onChange(setErp(draft, i, e.target.value))} /></td>
                  <td className={s.inCell}>
                    <input type="radio" name={`in-${draft.kind}-${r.erp}`} aria-label={`Row ${i + 1} answers when ${r.erp || "the code"} comes back`} checked={r.inbound} disabled={!r.erp.trim()} onChange={() => onChange(setInbound(draft, i))} />
                    <span className={s.inLabel}>Answers inbound</span>
                  </td>
                  <td className={s.vlRemove}><Button size="sm" variant="quiet" aria-label={`Remove row ${i + 1}`} onClick={() => onChange(removeRow(draft, i))}>Remove</Button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className={s.blockFoot}>
          <Button size="sm" variant="quiet" onClick={() => onChange(addRow(draft))}>Add row</Button>
          {counts && <span className={`${s.small} ${s.muted}`}>{counterLine(counts)}</span>}
        </div>
      </div>
      <div className={s.row}>
        <label className={`${s.small} ${s.muted}`} htmlFor={`def-${draft.kind}`}>Default for unknown inbound</label>
        <Select id={`def-${draft.kind}`} style={{ width: "auto", maxWidth: "100%" }} value={draft.default_in ?? ""} onChange={(e) => onChange({ ...draft, default_in: e.target.value || null })}>
          <option value="">Keep the code</option>
          {choices.map((c) => <option key={c} value={c}>{c}</option>)}
        </Select>
        <InfoTip label="Default for unknown inbound">{MIDDLEWARE_TIPS.listDefault}</InfoTip>
      </div>
    </div>
  );
}

export default function MappingValueLists({ connection, system }: { connection: string; system: string }) {
  const { confirm } = useFeel();
  const data = useLoad(() => getValueLists(connection), [connection]);
  const d = data.data;
  const [drafts, setDrafts] = useState<Record<string, ListDraft>>({});
  const [open, setOpen] = useState<string | null>(null);
  const [problem, setProblem] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [pick, setPick] = useState("");
  const [customName, setCustomName] = useState("");
  const [csv, setCsv] = useState<{ kind: string; file: File; preview: CsvPreview } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const importFor = useRef<string>("");
  const { flash, show } = useFlash();

  useEffect(() => {
    if (!d) return;
    setDrafts((cur) => {
      const next: Record<string, ListDraft> = {};
      for (const l of d.lists) next[l.kind] = cur[l.kind] && isListDirty(draftOf(l), cur[l.kind]) ? cur[l.kind] : draftOf(l);
      for (const [k, x] of Object.entries(cur)) if (x.isNew && !(k in next)) next[k] = x;
      return next;
    });
    setOpen((o) => o ?? d.lists[0]?.kind ?? null);
  }, [d]);

  if (data.error != null && !d) return <ProblemNotice error={data.error} onRetry={() => void data.reload()} />;
  if (!d) return <div className={`${s.small} ${s.muted}`} role="status">Loading…</div>;
  if (d.pending) return <Notice tone="info">{`Database update needed: run ${d.pending.bundle ?? "the mapping update"} once.`}</Notice>;

  const saved = (kind: string) => d.lists.find((l) => l.kind === kind) ?? null;
  const kinds = Object.keys(drafts);
  const addable = addableKinds(d.standardKinds, kinds);
  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key); setProblem(null);
    try { await fn(); } catch (e) { setProblem(e); } finally { setBusy(null); }
  };

  const create = () => {
    if (pick === "custom") {
      const r = newCustomList(customName, kinds);
      if ("problem" in r) { setProblem(new ApiProblem(r.problem, 422)); return; }
      setDrafts((c) => ({ ...c, [r.kind]: emptyDraft(r.kind, r.label) })); setOpen(r.kind); setCustomName(""); setPick("");
    } else if (pick) {
      const k = d.standardKinds.find((x) => x.kind === pick);
      setDrafts((c) => ({ ...c, [pick]: emptyDraft(pick, k?.label) })); setOpen(pick); setPick("");
    }
  };

  const saveOne = (kind: string) => run(`save:${kind}`, async () => {
    const x = drafts[kind];
    await saveValueList(connection, kind, { label: x.label, rows: cleanListRows(x.rows), default_in: x.default_in });
    setDrafts((c) => { const n = { ...c }; delete n[kind]; return n; });
    await data.reload();
    show(true, `${x.label} saved.`);
  });

  const removeOne = async (kind: string) => {
    if (!(await confirm({ title: "Delete this list?", body: "A list a mapping line uses cannot be deleted.", confirmLabel: "Delete", tone: "danger" }))) return;
    await run(`del:${kind}`, async () => {
      if (saved(kind)) await deleteValueList(connection, kind);
      setDrafts((c) => { const n = { ...c }; delete n[kind]; return n; });
      setOpen(null);
      await data.reload();
    });
  };

  const proposeOne = (kind?: string) => run(`prop:${kind ?? "all"}`, async () => {
    const lists = await proposeValueLists(connection, kind);
    if (lists.length === 0) { show(true, "The target offers no allowed values to propose."); return; }
    let added = 0;
    setDrafts((cur) => {
      const next = { ...cur };
      for (const p of lists) {
        if (next[p.kind]) { const m = mergeProposed(next[p.kind], p.rows); next[p.kind] = m.draft; added += m.added; }
        else { next[p.kind] = draftOfProposed(p); added += p.rows.length; }
      }
      return next;
    });
    setOpen(lists[0].kind);
    show(true, `${lists.length} list${lists.length === 1 ? "" : "s"} proposed. Press Save list to keep them.`);
  });

  const chooseFile = async (f: File | undefined) => {
    const kind = importFor.current;
    if (!f || !kind) return;
    await run(`csv:${kind}`, async () => { const r = await importValueListCsv(connection, kind, f, false); setCsv({ kind, file: f, preview: r.preview }); });
    if (fileRef.current) fileRef.current.value = "";
  };

  const applyCsv = () => csv && run(`csv:${csv.kind}`, async () => {
    await importValueListCsv(connection, csv.kind, csv.file, true);
    setDrafts((c) => { const n = { ...c }; delete n[csv.kind]; return n; });
    setCsv(null);
    await data.reload();
    show(true, "List replaced from the file.");
  });

  const shown = [...new Set([...d.lists.map((l) => l.kind), ...kinds])];

  return (
    <>
      <div className={s.rowBetween}>
        <span className="bpm-label-row"><h3 className="bpm-t-label">Lists for {system}</h3><InfoTip label="Value mapping">{MIDDLEWARE_TIPS.valueMapping}</InfoTip></span>
        <span className={s.row}>
          <Select aria-label="New list" style={{ width: "auto", maxWidth: "100%" }} value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">New list…</option>
            {addable.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
            <option value="custom">Custom…</option>
          </Select>
          {pick === "custom" && <Input aria-label="Name of the list" placeholder="Name" value={customName} onChange={(e) => setCustomName(e.target.value)} style={{ width: 160 }} />}
          <Button size="sm" onClick={create} disabled={!pick}>Create</Button>
        </span>
      </div>
      <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={(e) => void chooseFile(e.target.files?.[0])} />
      {flash && <Notice tone={flash.ok ? "ok" : "err"}>{flash.text}</Notice>}
      {problem != null && <ProblemNotice error={problem} />}
      {csv && (
        <Notice tone="info" action={<span className={s.row}><Button size="sm" variant="primary" onClick={() => void applyCsv()} loading={busy === `csv:${csv.kind}`}>Replace the list</Button><Button size="sm" variant="quiet" onClick={() => setCsv(null)}>Cancel</Button></span>}>
          {csvPreviewLine(csv.preview)}
        </Notice>
      )}

      {shown.length === 0 && (
        <Notice tone="info" action={<Button size="sm" onClick={() => void proposeOne()} loading={busy === "prop:all"}>Propose from target</Button>}>
          No value lists yet. Propose from target, or New list.
        </Notice>
      )}
      {shown.map((kind) => {
        const draft = drafts[kind];
        if (!draft) return null;
        const live = saved(kind);
        const isOpen = open === kind;
        const dirty = isListDirty(live ? draftOf(live) : null, draft);
        const counts = live?.counts ?? { rows: cleanListRows(draft.rows).length, unused: 0, unmapped: draft.rows.filter(needsCode).length };
        return (
          <section key={kind} className={s.listCard} aria-label={draft.label}>
            <button type="button" className={s.listHead} aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : kind)}>
              <span className={s.fieldName}>{draft.label}</span>
              <span className={`${s.small} ${s.muted}`}>{counterLine(counts)}{dirty ? " · unsaved" : ""}</span>
              <span className={s.chev} aria-hidden="true">{isOpen ? "▲" : "▼"}</span>
            </button>
            {isOpen && (
              <div className={s.listBody}>
                <ListTable draft={draft} counts={live?.counts} unmapped={live?.unmapped} onChange={(x) => setDrafts((c) => ({ ...c, [kind]: x }))} />
                <div className={s.row}>
                  <Button size="sm" variant="primary" onClick={() => void saveOne(kind)} disabled={!dirty || listProblems(draft).length > 0} loading={busy === `save:${kind}`}>Save list</Button>
                  <Button size="sm" onClick={() => void proposeOne(kind)} loading={busy === `prop:${kind}`}>Propose from target</Button>
                  {live && <a className="bpm-btn bpm-btn-quiet bpm-btn-sm" href={valueListCsvUrl(connection, kind)} download>Export CSV</a>}
                  <Button size="sm" variant="quiet" onClick={() => { importFor.current = kind; fileRef.current?.click(); }}>Import CSV</Button>
                  <Button size="sm" variant="quiet" onClick={() => void removeOne(kind)}>Delete</Button>
                </div>
              </div>
            )}
          </section>
        );
      })}
    </>
  );
}
