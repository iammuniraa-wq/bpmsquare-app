"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { DwGroupId, DwMode } from "@/lib/import/catalog";
import { isInteractive, pickerItems, pickerKey, type OpenOverrides, type PickerEntry, type PickerItem, type PickerUnowned } from "./pickerModel";
import s from "./ObjectPicker.module.css";

/**
 * The object picker: search, recents, groups, lines under their parent. One component, two homes: the left column on a
 * PC and the bottom sheet on a phone. It only draws what pickerModel.ts returns and owns the highlight and the typed text.
 * Keyboard: ArrowUp/ArrowDown move over the visible rows, Enter opens an object or toggles a group, Esc clears the search
 * and then asks the host to close.
 */
export default function ObjectPicker({ entries, unowned, selectedId, mode, recents, overrides, onToggleGroup, onPick, onEscape, inputRef, autoFocus, guide = "dw.search" }: {
  entries: PickerEntry[];
  unowned: PickerUnowned[];
  selectedId: string | null;
  mode: DwMode | null;
  recents: string[];
  overrides: OpenOverrides;
  onToggleGroup: (group: DwGroupId, open: boolean) => void;
  onPick: (id: string) => void;
  /** Esc with an empty search: the sheet closes, the column does nothing. */
  onEscape?: () => void;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  autoFocus?: boolean;
  guide?: string;
}) {
  const uid = useId();
  const own = useRef<HTMLInputElement>(null);
  const input = inputRef ?? own;
  const [query, setQuery] = useState("");
  const [hl, setHl] = useState(-1);

  const items = useMemo(
    () => pickerItems({ entries, unowned, query, selectedId, mode, recents, overrides }),
    [entries, unowned, query, selectedId, mode, recents, overrides],
  );
  const rows = useMemo(() => items.filter(isInteractive), [items]);
  const idOf = (key: string) => `${uid}-${key}`;
  const activeKey = hl >= 0 ? rows[hl]?.key : undefined;

  useEffect(() => {
    if (!autoFocus) return;
    // The sheet moves focus to its Close button when it opens; the search takes it back a frame later.
    const t = requestAnimationFrame(() => input.current?.focus());
    return () => cancelAnimationFrame(t);
  }, [autoFocus, input]);

  useEffect(() => {
    if (activeKey) document.getElementById(idOf(activeKey))?.scrollIntoView({ block: "nearest" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey]);

  function activate(it: Extract<PickerItem, { kind: "group" | "object" }>) {
    if (it.kind === "group") onToggleGroup(it.id, !it.open);
    else onPick(it.id);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    const r = pickerKey({ key: e.key, query, hl, rows });
    if (r.handled) {
      e.preventDefault();
      if (e.key === "Escape") e.stopPropagation();
    }
    setHl(r.hl);
    if (r.query !== query) setQuery(r.query);
    if (!r.act) return;
    if (r.act.kind === "open") onPick(r.act.id);
    else if (r.act.kind === "toggle") onToggleGroup(r.act.id, r.act.open);
    else onEscape?.();
  }

  return (
    <div className={s.picker}>
      <div className={s.search}>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
        <input
          ref={input}
          type="search"
          role="combobox"
          aria-expanded="true"
          aria-controls={`${uid}-list`}
          aria-activedescendant={activeKey ? idOf(activeKey) : undefined}
          aria-label="Find an object"
          placeholder="Find an object"
          autoComplete="off"
          data-guide={guide}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setHl(e.target.value.trim() ? 0 : -1); }}
          onKeyDown={onKeyDown}
        />
        <kbd aria-hidden="true">/</kbd>
      </div>
      <div id={`${uid}-list`} className={s.list} role="group" aria-label="Objects">
        {items.map((it) => {
          if (it.kind === "section") return <div key={it.key} className={s.sec}>{it.label}</div>;
          if (it.kind === "notice") return <div key={it.key} className={s.notice} role="status">{it.text}</div>;
          const active = it.key === activeKey;
          if (it.kind === "group") {
            return (
              <button
                key={it.key}
                id={idOf(it.key)}
                type="button"
                tabIndex={-1}
                className={`${s.grp} ${it.open ? s.open : ""} ${active ? s.hl : ""}`}
                aria-expanded={it.open}
                onClick={() => activate(it)}
              >
                <span className={s.chev} aria-hidden="true">▸</span>
                {it.label}
                <span className={s.count}>{it.count}</span>
              </button>
            );
          }
          return (
            <button
              key={it.key}
              id={idOf(it.key)}
              type="button"
              tabIndex={-1}
              className={`${s.row} ${it.child ? s.child : ""} ${it.selected ? s.on : ""} ${active ? s.hl : ""}`}
              aria-current={it.selected ? "true" : undefined}
              title={it.label}
              onClick={() => activate(it)}
            >
              <span className={s.ic} aria-hidden="true">{it.child ? "└" : it.icon}</span>
              <span className={s.label}>{it.label}</span>
              {it.caption && <span className={s.cap}>{it.caption}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
