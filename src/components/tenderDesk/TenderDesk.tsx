"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { TenderDeskData, TenderDeskStyle } from "@/lib/tenderDesk/types";
import BoldTiles from "./BoldTiles";
import ControlRoom from "./ControlRoom";
import s from "./TenderDesk.module.css";

export type TenderDeskProps = {
  data: TenderDeskData;
  style: TenderDeskStyle;
  userName: string | null;
  /** "Good afternoon": the name is added here, so pass it without one. */
  greeting: string;
  /** "Tuesday, 27 October 2026", already formatted for the workspace time zone. */
  dateLabel: string;
};

const OPTIONS: { value: TenderDeskStyle; label: string }[] = [
  { value: "bold", label: "Bold tiles" },
  { value: "control", label: "Control room" },
];

/**
 * The Tender desk home: a header with the two-way view switch and the chosen style. The choice is stored per person by
 * POST /api/tender-desk/style (a cookie the server reads, so the next first paint is already right), then the page is refreshed.
 */
export default function TenderDesk({ data, style, userName, greeting, dateLabel }: TenderDeskProps) {
  const router = useRouter();
  const [chosen, setChosen] = useState<TenderDeskStyle>(style);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, startRefresh] = useTransition();
  const buttons = useRef<Record<string, HTMLButtonElement | null>>({});
  const busy = saving || refreshing;

  useEffect(() => { setChosen(style); }, [style]);

  async function choose(next: TenderDeskStyle) {
    if (next === chosen || busy) return;
    const previous = chosen;
    setChosen(next);
    setError(null);
    setSaving(true);
    try {
      const res = await fetch("/api/tender-desk/style", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ style: next }),
      });
      if (!res.ok) throw new Error(String(res.status));
      startRefresh(() => router.refresh());
    } catch {
      setChosen(previous);
      setError("The view could not be changed. Try again.");
    } finally {
      setSaving(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const i = OPTIONS.findIndex((o) => o.value === chosen);
    const next = OPTIONS[(i + step + OPTIONS.length) % OPTIONS.length];
    buttons.current[next.value]?.focus();
    void choose(next.value);
  }

  return (
    <div className={s.desk} data-guide="tender.desk">
      <div className={s.topbar}>
        <p className={s.eyebrow}>Tender desk</p>
        <div className={s.switchWrap}>
          <div className={s.seg} role="radiogroup" aria-label="Home view" aria-busy={busy} data-guide="tender.desk.switch" onKeyDown={onKeyDown}>
            {OPTIONS.map((o) => (
              <button
                key={o.value}
                ref={(el) => { buttons.current[o.value] = el; }}
                type="button"
                role="radio"
                aria-checked={chosen === o.value}
                tabIndex={chosen === o.value ? 0 : -1}
                className={s.segBtn}
                data-guide={`tender.desk.switch.${o.value}`}
                onClick={() => void choose(o.value)}
              >
                {o.label}
              </button>
            ))}
          </div>
          {busy && <span className={s.pending} role="status">Saving…</span>}
        </div>
      </div>
      {error && <p className={s.error} role="alert">{error}</p>}

      {chosen === "control"
        ? <ControlRoom data={data} dateLabel={dateLabel} />
        : <BoldTiles data={data} userName={userName} greeting={greeting} dateLabel={dateLabel} />}
    </div>
  );
}
