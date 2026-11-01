import type { ReactNode } from "react";
import { c } from "@/lib/theme";
import type { DwMode } from "@/lib/import/catalog";
import { btnGhost, card, tone } from "./ui";
import s from "./DataWorkbench.module.css";

export type StartRecent = { id: string; label: string; icon: string };

const TASKS: { mode: DwMode; guide: string; title: string; text: string; icon: ReactNode }[] = [
  {
    mode: "import", guide: "dw.start.import", title: "Bring data in", text: "Create new records from a file",
    icon: <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 20h14" /></svg>,
  },
  {
    mode: "export", guide: "dw.start.export", title: "Take data out", text: "Download records as CSV",
    icon: <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 15V3" /><path d="m7 8 5-5 5 5" /><path d="M5 20h14" /></svg>,
  },
  {
    mode: "update", guide: "dw.start.update", title: "Fix data in bulk", text: "Change records you exported",
    icon: <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 20h4L19 9a2.1 2.1 0 0 0-4-4L4 16v4Z" /><path d="m14 6 4 4" /></svg>,
  },
];

/**
 * The opening screen with no object chosen: three tasks and the person's recent objects. A task is a shortcut, not a
 * second navigation: it sets the mode and sends the cursor to the picker. A link to an object the workspace does not
 * have lands here with one honest line (owner decision 2026-11-02).
 */
export default function StartScreen({ recents, stray, picked, onTask, onRecent, onChoose }: {
  recents: StartRecent[];
  /** Label of an object named in the link that this workspace has not switched on. */
  stray?: string | null;
  /** The task chosen or named in the link, highlighted. */
  picked: DwMode | null;
  onTask: (mode: DwMode) => void;
  onRecent: (id: string) => void;
  /** Phones only: opens the picker sheet. */
  onChoose?: () => void;
}) {
  return (
    <div style={card} data-guide="dw.start">
      {stray && (
        <div role="status" style={{ display: "inline-flex", marginBottom: 12, padding: "4px 12px", borderRadius: 999, fontSize: 12.5, fontWeight: 600, background: tone.warn.bg, color: tone.warn.fg }}>
          {`${stray} is not switched on in this workspace`}
        </div>
      )}
      <div style={{ fontSize: 15, fontWeight: 700, color: c.ink }}>What do you want to do?</div>
      <div className={s.tiles}>
        {TASKS.map((t) => (
          <button
            key={t.mode}
            type="button"
            className={s.tile}
            aria-pressed={picked === t.mode}
            data-guide={t.guide}
            onClick={() => onTask(t.mode)}
          >
            <span className={s.tileIcon}>{t.icon}</span>
            <b>{t.title}</b>
            <span className={s.tileText}>{t.text}</span>
          </button>
        ))}
      </div>
      {recents.length > 0 ? (
        <div data-guide="dw.recents">
          <div className={s.sec} style={{ paddingLeft: 0 }}>Recent</div>
          <div className={s.recents}>
            {recents.map((r) => (
              <button key={r.id} type="button" style={{ ...btnGhost, minHeight: 40 }} onClick={() => onRecent(r.id)}>
                <span aria-hidden="true">{r.icon}</span> {r.label}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div style={{ fontSize: 12.5, color: c.muted }}>Pick a task, then choose an object.</div>
      )}
      {onChoose && (
        <div className={`${s.sticky} ${s.phoneOnly}`}>
          <button type="button" className="bpm-btn bpm-btn-primary bpm-btn-md" style={{ flex: 1, justifyContent: "center", minHeight: 44 }} data-guide="dw.change" onClick={onChoose}>
            Choose an object
          </button>
        </div>
      )}
    </div>
  );
}
