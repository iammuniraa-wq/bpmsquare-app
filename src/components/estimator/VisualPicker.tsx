"use client";

import { useEffect, useId, useRef, useState } from "react";
import { MATERIALS, HEX_COLOUR } from "@/lib/estimator/materialCatalog";
import type { MaterialDef, MaterialGroup } from "@/lib/estimator/materialCatalog";
import { visualSwatch } from "@/lib/estimator/visuals";
import s from "./VisualPicker.module.css";

const GROUP_LABEL: Record<MaterialGroup, string> = {
  concrete: "Concrete", metal: "Metal and coatings", tile: "Tile", wood: "Wood", cladding: "Cladding and roofing", glass: "Glass", ground: "Ground", paint: "Paint",
};

const GROUPS: { group: MaterialGroup; items: MaterialDef[] }[] = (() => {
  const order: MaterialGroup[] = [];
  for (const m of MATERIALS) if (!order.includes(m.group)) order.push(m.group);
  return order.map((group) => ({ group, items: MATERIALS.filter((m) => m.group === group) }));
})();

/** A colour disc (flat colour) or a rounded square (a material that has a texture set). Hatched when there is no visual. */
export function VisualDot({ value }: { value: string | null | undefined }) {
  const sw = visualSwatch(value);
  if (!sw) return <span className={`${s.dot} ${s.dotEmpty}`} aria-hidden="true" />;
  return <span className={`${s.dot} ${sw.textured ? s.dotSquare : ""}`} style={{ background: sw.colour }} aria-hidden="true" />;
}

export function visualName(value: string | null | undefined): string {
  return visualSwatch(value)?.label ?? "Model default";
}

const asHex = (t: string) => (t.startsWith("#") ? t : `#${t}`);

/**
 * The picker behind an option's swatch button: the catalogue grouped (concrete, metal, tile, ...) with a swatch each, and a
 * custom colour. `value` is a material key, "#rrggbb" or "" (the model's own look).
 */
export function VisualPicker({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [hex, setHex] = useState(HEX_COLOUR.test(value) ? value : "");
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const first = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    first.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); setOpen(false); trigger.current?.focus(); } };
    const onDown = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("pointerdown", onDown); };
  }, [open]);

  const pick = (v: string) => { onChange(v); setHex(HEX_COLOUR.test(v) ? v : ""); setOpen(false); trigger.current?.focus(); };
  const typed = (t: string) => {
    setHex(t);
    if (HEX_COLOUR.test(asHex(t))) onChange(asHex(t).toLowerCase());
  };

  return (
    <div className={s.wrap} ref={wrap}>
      <button ref={trigger} type="button" className={s.trigger} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined}
        aria-label={`${label}: ${visualName(value)}. Change`} onClick={() => setOpen((o) => !o)}>
        <VisualDot value={value} />
      </button>
      {open && (
        <div id={id} role="dialog" aria-label={`Choose how ${label} looks`} className={s.pop}>
          <button type="button" className={`${s.none} ${!value ? s.noneOn : ""}`} onClick={() => pick("")} aria-pressed={!value}>
            <VisualDot value="" /> Model default
          </button>
          {GROUPS.map(({ group, items }, gi) => (
            <div key={group} className={s.group} role="group" aria-label={GROUP_LABEL[group]}>
              <div className={s.groupName}>{GROUP_LABEL[group]}</div>
              <div className={s.grid}>
                {items.map((m, k) => (
                  <button key={m.key} ref={gi === 0 && k === 0 ? first : undefined} type="button" title={m.label} aria-label={m.label} aria-pressed={value === m.key}
                    className={`${s.swatch} ${value === m.key ? s.swatchOn : ""}`} onClick={() => pick(m.key)}>
                    <VisualDot value={m.key} />
                  </button>
                ))}
              </div>
            </div>
          ))}
          <div className={s.custom}>
            <input type="color" aria-label="Custom colour picker" value={HEX_COLOUR.test(value) ? value : "#cccccc"} onChange={(e) => { onChange(e.target.value); setHex(e.target.value); }} />
            <input className={`bpm-input ${s.hex}`} aria-label="Custom colour, hex" placeholder="#d9ccb4" maxLength={7} value={hex} onChange={(e) => typed(e.target.value)}
              aria-invalid={hex !== "" && !HEX_COLOUR.test(asHex(hex)) ? true : undefined} />
          </div>
          <div className={s.picked}>{visualName(value)}</div>
        </div>
      )}
    </div>
  );
}

/**
 * The options of a choice that repaints the model, as swatch chips (a radio group, so the arrow keys move between
 * them). Each chip is at least 44 px high.
 */
export function SwatchChoice({
  options, value, onChange, disabled, label,
}: {
  options: readonly { key: string; label: string; visual?: string }[];
  value: string;
  onChange: (key: string) => void;
  disabled?: boolean;
  label: string;
}) {
  const groupName = useId();
  return (
    <div className={s.chips} role="radiogroup" aria-label={label}>
      {options.map((o) => {
        const on = o.key === value;
        return (
          <label key={o.key} className={`${s.chip} ${on ? s.chipOn : ""} ${disabled ? s.chipOff : ""}`}>
            <input type="radio" name={groupName} value={o.key} checked={on} disabled={disabled} onChange={() => onChange(o.key)} />
            <VisualDot value={o.visual} />
            <span>{o.label}</span>
          </label>
        );
      })}
    </div>
  );
}
