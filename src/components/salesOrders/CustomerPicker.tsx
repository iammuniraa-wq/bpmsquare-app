"use client";

import { useId, useState } from "react";
import Button from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { searchAccounts, type PickAccount } from "./lines";
import s from "./salesOrders.module.css";

/** Customer search: type a few letters, pick from the list. Arrow keys, Enter and Esc work; the choice shows as a chip with Change. */
export default function CustomerPicker({ accounts, value, onPick, id, invalid }: {
  accounts: PickAccount[];
  value: PickAccount | null;
  onPick: (a: PickAccount | null) => void;
  id: string;
  invalid?: boolean;
}) {
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const listId = useId();
  const found = searchAccounts(accounts, q);

  if (value) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 44 }} data-guide="sales_order.customer">
        <span style={{ fontWeight: 600, overflowWrap: "anywhere" }}>{value.name}</span>
        <Button variant="quiet" size="sm" onClick={() => { onPick(null); setQ(""); }} data-guide="sales_order.customer_change">Change</Button>
      </div>
    );
  }

  const choose = (a: PickAccount) => { onPick(a); setQ(""); setActive(0); };

  return (
    <div>
      <Input
        id={id}
        role="combobox"
        aria-expanded={found.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={found[active] ? `${listId}-${found[active].id}` : undefined}
        autoComplete="off"
        value={q}
        invalid={invalid}
        placeholder="Start typing a customer name"
        data-guide="sales_order.customer"
        onChange={(e) => { setQ(e.target.value); setActive(0); }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(found.length - 1, i + 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
          else if (e.key === "Enter" && found[active]) { e.preventDefault(); choose(found[active]); }
          else if (e.key === "Escape") setQ("");
        }}
        style={{ minHeight: 44 }}
      />
      {q.trim() !== "" && (
        <div id={listId} role="listbox" aria-label="Matching customers" className={s.results}>
          {found.length === 0 ? (
            <div className="bpm-t-help" style={{ padding: "12px" }}>No customer matches “{q.trim()}”.</div>
          ) : found.map((a, i) => (
            <button
              key={a.id}
              id={`${listId}-${a.id}`}
              type="button"
              role="option"
              aria-selected={i === active}
              className={s.pickItem}
              style={i === active ? { background: "var(--panel2)" } : undefined}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(a)}
            >
              <span>{a.name}</span>
              <span className={s.muted} style={{ fontSize: 12 }}>{a.address.split(",")[0]}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
