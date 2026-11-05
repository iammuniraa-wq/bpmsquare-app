"use client";

import type { RichNav } from "@/lib/richUi";

/** Menu / Rail switch in the top bar of the Rich look. Per-browser (Shell stores it); hidden on phones, where the tab bar is the nav. */
export default function RichNavToggle({ value, onChange }: { value: RichNav; onChange: (v: RichNav) => void }) {
  return (
    <div className="rich-seg rich-nav-toggle" role="group" aria-label="Navigation style">
      {(["menu", "rail"] as const).map((v) => (
        <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)}>
          {v === "menu" ? "Menu" : "Rail"}
        </button>
      ))}
    </div>
  );
}
