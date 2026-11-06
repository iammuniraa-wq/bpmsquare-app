"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/**
 * Rich phone view: a table cannot fit 375 px, so under 781 px each table row is drawn as a card (rich-mobile.css, `table.rich-mt`).
 * A card needs a label per value, and the labels already exist as the column headers, so this copies each header's text onto the cells
 * below it (`data-label`) and marks the cells that carry nothing (`data-empty`) or only a checkbox (`data-bare`).
 * It only reads and annotates; it never changes what a table says or does. Mounted by Shell for a Rich tenant on a phone.
 */
export default function RichMobileTables() {
  const pathname = usePathname();

  useEffect(() => {
    const root = document.querySelector("main");
    if (!root) return;

    const annotate = () => {
      root.querySelectorAll<HTMLTableElement>("table").forEach((table) => {
        const heads = Array.from(table.querySelectorAll<HTMLTableCellElement>("thead th"));
        if (heads.length === 0) return;
        const labels = heads.map((h) => (h.textContent ?? "").replace(/[↕⌕]/g, "").replace(/\s+/g, " ").trim());
        table.classList.add("rich-mt");
        table.querySelectorAll<HTMLTableRowElement>("tbody tr").forEach((tr) => {
          Array.from(tr.children).forEach((cell, i) => {
            if (!(cell instanceof HTMLElement)) return;
            const text = (cell.textContent ?? "").replace(/\s+/g, " ").trim();
            const label = labels[i] ?? "";
            if (cell.dataset.label !== label) cell.dataset.label = label;
            const empty = text === "" || text === "—" || text === "-";
            const bare = !label && cell.querySelector("input[type=checkbox]") !== null;
            if (empty && !bare) { if (cell.dataset.empty !== "1") cell.dataset.empty = "1"; } else if (cell.dataset.empty) delete cell.dataset.empty;
            if (bare) { if (cell.dataset.bare !== "1") cell.dataset.bare = "1"; }
          });
        });
      });
    };

    annotate();
    let raf = 0;
    const observer = new MutationObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(annotate);
    });
    observer.observe(root, { childList: true, subtree: true });
    return () => { observer.disconnect(); cancelAnimationFrame(raf); };
  }, [pathname]);

  return null;
}
