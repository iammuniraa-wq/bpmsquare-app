"use client";

import { useId, useMemo, useRef, useState } from "react";
import Field from "@/components/ui/Field";
import s from "./middleware.module.css";
import { listAccountChoices, listQuoteChoices, type AccountChoice } from "./api";
import { quoteOptions, type QuoteOption } from "./quotePick";
import { useLoad, ProblemNotice } from "./ui";

// Pick, don't paste an id: a Standard Quote from a list, an account by typing a few letters.

export function useQuoteOptions() {
  const load = useLoad(async () => {
    const [quotes, accounts] = await Promise.all([listQuoteChoices(), listAccountChoices().catch(() => [] as AccountChoice[])]);
    return quoteOptions(quotes, accounts);
  }, []);
  return load;
}

export function QuoteSelect({ value, onChange, options, loading, error, onRetry, label = "Standard Quote", info }: {
  value: string; onChange: (id: string) => void; options: QuoteOption[] | null; loading: boolean; error: unknown; onRetry: () => void; label?: string; info?: string;
}) {
  const id = useId();
  if (error != null) return <ProblemNotice error={error} onRetry={onRetry} />;
  const groups: ("Awarded" | "Rejected")[] = ["Awarded", "Rejected"];
  return (
    <Field label={label} info={info} htmlFor={id} style={{ marginBottom: 0 }}>
      <select id={id} className="bpm-input" value={value} disabled={loading} onChange={(e) => onChange(e.target.value)}>
        <option value="">{loading ? "Loading…" : options && options.length ? "Choose a quote…" : "No awarded or rejected quote yet"}</option>
        {groups.map((g) => {
          const items = (options ?? []).filter((o) => o.group === g);
          return items.length ? <optgroup key={g} label={g}>{items.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</optgroup> : null;
        })}
      </select>
    </Field>
  );
}

// ── Accounts: type to find ──────────────────────────────────────────────────

export function AccountPick({ value, onChange, label = "Account" }: { value: AccountChoice | null; onChange: (a: AccountChoice | null) => void; label?: string }) {
  const accounts = useLoad(listAccountChoices, []);
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const inputId = useId();
  const box = useRef<HTMLDivElement>(null);

  const matches = useMemo(() => {
    const q = text.trim().toLowerCase();
    const all = accounts.data ?? [];
    return (q ? all.filter((a) => a.name.toLowerCase().includes(q)) : all).slice(0, 8);
  }, [accounts.data, text]);

  if (accounts.error != null) return <ProblemNotice error={accounts.error} onRetry={() => void accounts.reload()} />;

  const choose = (a: AccountChoice) => { onChange(a); setText(a.name); setOpen(false); };

  return (
    <Field label={label} htmlFor={inputId} style={{ marginBottom: 0 }}>
      <div ref={box} style={{ position: "relative" }}>
        <input
          id={inputId} className="bpm-input" role="combobox" aria-expanded={open} aria-controls={listId} aria-autocomplete="list"
          autoComplete="off" value={text} placeholder={accounts.loading ? "Loading…" : "Type a few letters"}
          onChange={(e) => { setText(e.target.value); setOpen(true); setActive(0); if (value) onChange(null); }}
          onFocus={() => setOpen(true)}
          onBlur={(e) => { if (!box.current?.contains(e.relatedTarget as Node)) setOpen(false); }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((i) => Math.min(i + 1, matches.length - 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
            else if (e.key === "Enter" && open && matches[active]) { e.preventDefault(); choose(matches[active]); }
            else if (e.key === "Escape") setOpen(false);
          }}
        />
        {open && matches.length > 0 && (
          <ul id={listId} role="listbox" style={{ position: "absolute", zIndex: 20, left: 0, right: 0, margin: "4px 0 0", padding: 4, listStyle: "none", background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 9, boxShadow: "var(--card-shadow)", maxHeight: 280, overflowY: "auto" }}>
            {matches.map((a, i) => (
              <li key={a.id} role="option" aria-selected={i === active}>
                <button type="button" tabIndex={-1} className="bpm-menu-item" style={{ minHeight: 44, background: i === active ? "var(--panel2)" : undefined }} onMouseDown={(e) => e.preventDefault()} onClick={() => choose(a)}>{a.name}</button>
              </li>
            ))}
          </ul>
        )}
        {open && !accounts.loading && matches.length === 0 && <div className={`${s.small} ${s.muted}`} style={{ marginTop: 4 }}>No account matches that.</div>}
      </div>
    </Field>
  );
}
