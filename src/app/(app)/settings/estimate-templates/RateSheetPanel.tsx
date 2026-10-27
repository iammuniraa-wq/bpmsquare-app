"use client";

import { useMemo, useState } from "react";
import SidePanel from "@/components/ui/SidePanel";
import Button from "@/components/ui/Button";
import { changeCount, countFilters, defaultChoices, toDecisions } from "@/lib/estimator/rateSheet/view";
import type { ApplyView, Choice, PreviewView, RowFilter } from "@/lib/estimator/rateSheet/view";
import { DoneView, PAGE, PreviewStep, StartStep, todayKey } from "./RateSheetViews";

// Import rate sheet, in a side panel (a bottom sheet on a phone): choose a file, read it, decide the rows that did not match, apply.
// This holds the state and the two calls; the steps themselves are RateSheetViews. The browser sends back only the choices (a row, an
// action, a product id): the server reads the file again and trusts nothing else.

export default function RateSheetPanel({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [asOf, setAsOf] = useState(todayKey());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [view, setView] = useState<PreviewView | null>(null);
  const [choices, setChoices] = useState<Record<number, Choice>>({});
  const [filter, setFilter] = useState<RowFilter>("choose");
  const [shown, setShown] = useState(PAGE);
  const [done, setDone] = useState<ApplyView | null>(null);

  const changes = useMemo(() => changeCount(choices), [choices]);

  function form(extra?: Record<string, string>): FormData {
    const f = new FormData();
    f.set("file", file as File);
    if (asOf) f.set("as_of", asOf);
    for (const [k, v] of Object.entries(extra ?? {})) f.set(k, v);
    return f;
  }

  async function post<T>(url: string, body: FormData): Promise<T | null> {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(url, { method: "POST", body });
      const json = (await res.json().catch(() => ({}))) as T & { error?: string };
      if (!res.ok) { setError(json.error ?? "Something went wrong. Try again."); return null; }
      return json;
    } catch {
      setError("Network error. Try again.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function read() {
    if (!file) { setError("Choose a file first."); return; }
    const v = await post<PreviewView>("/api/estimate-templates/rate-sheet/preview", form());
    if (!v) return;
    setView(v);
    setChoices(defaultChoices(v.rows));
    const c = countFilters(v.rows);
    setFilter(c.choose > 0 ? "choose" : c.ready > 0 ? "ready" : "all");
    setShown(PAGE);
  }

  async function apply() {
    const d = await post<ApplyView>("/api/estimate-templates/rate-sheet", form({ decisions: JSON.stringify(toDecisions(choices)) }));
    if (d) setDone(d);
  }

  const footer = done ? (
    <Button variant="primary" onClick={onDone} data-guide="rate.sheet.done" style={{ minHeight: 44 }}>Done</Button>
  ) : view ? (
    <>
      <Button variant="secondary" onClick={() => { setView(null); setError(""); }} style={{ minHeight: 44 }}>Back</Button>
      <Button variant="primary" loading={busy} disabled={changes === 0} onClick={apply} data-guide="rate.sheet.apply" style={{ minHeight: 44 }}>
        {changes === 0 ? "Nothing to apply" : `Apply ${changes} change${changes === 1 ? "" : "s"}`}
      </Button>
    </>
  ) : (
    <Button variant="primary" loading={busy} disabled={!file} onClick={read} data-guide="rate.sheet.read" style={{ minHeight: 44 }}>Read the file</Button>
  );

  return (
    <SidePanel title="Import rate sheet" subtitle={view ? `${view.file}${view.sheet ? ` · ${view.sheet}` : ""}` : "Excel or CSV"} onClose={onClose} footer={footer} label="Import rate sheet">
      {error && <div role="alert" className="bpm-t-help" style={{ color: "var(--err-ink)" }}>{error}</div>}
      {done ? (
        <DoneView done={done} />
      ) : view ? (
        <PreviewStep view={view} choices={choices} onChoices={setChoices} filter={filter} onFilter={setFilter} shown={shown} onShown={setShown} />
      ) : (
        <StartStep asOf={asOf} onAsOf={setAsOf} onFile={(f) => { setFile(f); setError(""); }} />
      )}
    </SidePanel>
  );
}
