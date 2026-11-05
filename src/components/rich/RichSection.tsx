"use client";

import { useEffect, useState } from "react";
import InfoTip from "@/components/ui/InfoTip";
import { useRecordEdit } from "@/components/page/RecordEditContext";

const KEY = (id: string) => `bpm-rich-section:${id}`;

/**
 * A detail section that opens and closes and remembers which (per browser, per section id). The body stays mounted while closed so
 * a field editor inside it keeps its state, and `openOnEdit` opens it when "Edit" is picked in the record's menu, since that request
 * is picked up by the editor inside. The "i" sits beside the title, never inside the toggle button (the row pattern of OptionGroup).
 */
export default function RichSection({ id, title, hint, info, defaultOpen = false, openOnEdit = false, children }: {
  id: string;
  title: string;
  /** A few words on the right of the closed header: a count, a place. */
  hint?: string;
  info?: React.ReactNode;
  defaultOpen?: boolean;
  openOnEdit?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const edit = useRecordEdit();

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(KEY(id));
      if (saved === "1") setOpen(true);
      else if (saved === "0") setOpen(false);
    } catch { /* remembering is a convenience; the section still works */ }
  }, [id]);

  useEffect(() => {
    if (openOnEdit && edit?.pending) setOpen(true);
  }, [openOnEdit, edit?.pending]);

  function toggle() {
    const next = !open;
    setOpen(next);
    try { window.localStorage.setItem(KEY(id), next ? "1" : "0"); } catch { /* see above */ }
  }

  return (
    <section className="rich-sec" data-open={open ? "true" : "false"} id={`rich-sec-${id}`}>
      <div className="rich-sec__head">
        <button type="button" className="rich-sec__title" aria-expanded={open} aria-controls={`rich-sec-${id}-body`} onClick={toggle}>
          {title}
        </button>
        {info ? <span className="rich-sec__tip"><InfoTip label={title}>{info}</InfoTip></span> : null}
        {hint ? <span className="rich-sec__hint">{hint}</span> : null}
        <svg className="rich-sec__chev" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
          <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <div className="rich-sec__body" id={`rich-sec-${id}-body`} hidden={!open}>{children}</div>
    </section>
  );
}
