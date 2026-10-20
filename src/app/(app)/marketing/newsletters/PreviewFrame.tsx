"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import styles from "./newsletter.module.css";

type Box = { id: string; top: number; left: number; width: number; height: number };

/**
 * The email, exactly as the renderer built it, in an iframe with no scripts (the
 * sandbox grants only same-origin so this page can measure the height and find each
 * block's row; no script can run inside it). A block you click is selected, and the
 * blocks a translation was unsure about carry "Check this" with Accept and Edit,
 * pinned to their row from outside the email, so nothing is added to the email itself.
 *
 * "Dark" shows what a program that inverts colours does, by letting the email's own
 * dark rules apply; "Phone" narrows the frame so its small-screen rules apply.
 */
export default function PreviewFrame({
  html, dark, phone, rtl, selectedId, pendingIds, onSelect, onAccept, onEdit, loading,
}: {
  html: string; dark: boolean; phone: boolean; rtl: boolean; selectedId: string | null; pendingIds: readonly string[];
  onSelect: (id: string) => void; onAccept: (id: string) => void; onEdit: (id: string) => void; loading: boolean;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(520);
  const [boxes, setBoxes] = useState<Box[]>([]);

  const srcDoc = dark ? html.replace(/@media \(prefers-color-scheme: dark\)/g, "@media all") : html;

  const measure = useCallback(() => {
    const doc = frame.current?.contentDocument;
    if (!doc?.body) return;
    setHeight(Math.max(240, doc.documentElement.scrollHeight));
    const origin = doc.documentElement.getBoundingClientRect();
    const out: Box[] = [];
    doc.querySelectorAll<HTMLElement>("[data-nl-block]").forEach((el) => {
      const r = el.getBoundingClientRect();
      out.push({ id: el.dataset.nlBlock ?? "", top: r.top - origin.top, left: r.left - origin.left, width: r.width, height: r.height });
    });
    setBoxes(out);
  }, []);

  const onLoad = useCallback(() => {
    const doc = frame.current?.contentDocument;
    if (!doc) return;
    measure();
    doc.addEventListener("click", (e) => {
      const row = (e.target as HTMLElement | null)?.closest?.("[data-nl-block]") as HTMLElement | null;
      if (row?.dataset.nlBlock) { e.preventDefault(); onSelect(row.dataset.nlBlock); }
    });
    // Images load after the document does; measure again when they have.
    doc.querySelectorAll("img").forEach((img) => img.addEventListener("load", measure));
  }, [measure, onSelect]);

  useLayoutEffect(() => { measure(); }, [phone, measure]);
  useEffect(() => {
    const t = window.setTimeout(measure, 120);
    window.addEventListener("resize", measure);
    return () => { window.clearTimeout(t); window.removeEventListener("resize", measure); };
  }, [html, measure]);

  const by = new Map(boxes.map((b) => [b.id, b]));
  const sel = selectedId ? by.get(selectedId) : undefined;

  return (
    <div className={`${styles.stage} ${dark ? styles.dark : ""}`} aria-busy={loading}>
      <div className={`${styles.frameWrap} ${phone ? styles.phone : ""}`}>
        <iframe
          ref={frame} title="Preview of the email" sandbox="allow-same-origin" srcDoc={srcDoc} onLoad={onLoad}
          className={styles.frame} style={{ height, opacity: loading ? 0.7 : 1 }}
        />
        <div className={styles.overlay}>
          {sel && <div className={styles.ring} style={{ top: sel.top, left: sel.left, width: sel.width, height: sel.height }} />}
          {pendingIds.map((id) => {
            const b = by.get(id);
            if (!b) return null;
            return (
              <span key={id} className={styles.rv} style={{ top: b.top + 6, ...(rtl ? { left: b.left + 6 } : { right: Math.max(4, (frame.current?.clientWidth ?? 0) - b.left - b.width + 6) }) }}>
                Check this
                <button type="button" className={styles.ok} onClick={() => onAccept(id)}>Accept</button>
                <button type="button" onClick={() => onEdit(id)}>Edit</button>
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}
