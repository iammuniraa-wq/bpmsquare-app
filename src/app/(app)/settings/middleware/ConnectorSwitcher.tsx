"use client";

import { useState } from "react";
import Button from "@/components/ui/Button";
import InfoTip from "@/components/ui/InfoTip";
import s from "./middleware.module.css";
import type { MiddlewareConnector } from "./connectors";
import { MIDDLEWARE_TIPS } from "./tips";
import { PlusIcon } from "./ui";

/**
 * One chip per connector from the registry, then "Add connector". The chip IS the connection:
 * its dot shows the state, a small warning shows only when the secret ends within 30 days, and
 * clicking the open chip shows the connection panel. Everything under the chips is the same four
 * tabs for whichever connector is chosen.
 */
export default function ConnectorSwitcher({ connectors, value, connected, expiry, onChange, onManage }: {
  connectors: MiddlewareConnector[];
  value: string;
  /** Which connectors are connected, by id, for the dot on the chip. */
  connected: Record<string, boolean | undefined>;
  /** The selected connector's expiry warning, or null. */
  expiry: string | null;
  onChange: (id: string) => void;
  onManage: () => void;
}) {
  const [adding, setAdding] = useState(false);
  return (
    <div className={s.stack} style={{ gap: 8 }}>
      <div className={s.chips} role="group" aria-label="Connector" data-guide="middleware.connector">
        {connectors.map((c) => {
          const open = c.id === value;
          return (
            <button
              key={c.id} type="button" className={s.chip} aria-pressed={open} aria-haspopup={open ? "dialog" : undefined}
              onClick={() => (open ? onManage() : onChange(c.id))}
            >
              <span className={`${s.dot} ${connected[c.id] ? s.dotOn : ""}`} aria-hidden="true" />
              {c.shortName}
              <span className="bpm-sr-only">{connected[c.id] ? ", connected" : ", not connected"}</span>
              {open && expiry ? <span className={s.expiryChip}>{expiry}</span> : null}
              {open ? (
                <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
              ) : null}
            </button>
          );
        })}
        <button type="button" className={`${s.chip} ${s.chipDash}`} aria-expanded={adding} onClick={() => setAdding((a) => !a)}>
          <PlusIcon /> Add connector
        </button>
        <InfoTip label="Connector">{MIDDLEWARE_TIPS.switcher}</InfoTip>
      </div>
      {adding && (
        <div className={s.addPanel} role="status">
          <span>ePROMIS is coming. It will appear here with the same four tabs.</span>
          <Button size="sm" onClick={() => setAdding(false)}>Close</Button>
        </div>
      )}
    </div>
  );
}
