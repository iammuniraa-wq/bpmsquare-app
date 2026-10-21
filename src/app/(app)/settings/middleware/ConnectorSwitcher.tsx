"use client";

import { useState } from "react";
import Button from "@/components/ui/Button";
import InfoTip from "@/components/ui/InfoTip";
import s from "./middleware.module.css";
import type { MiddlewareConnector } from "./connectors";
import { MIDDLEWARE_TIPS } from "./tips";
import { PlusIcon } from "./ui";

/**
 * One chip per connector from the registry, then "Add connector". Everything
 * under the chips is the same five tabs for whichever connector is chosen.
 */
export default function ConnectorSwitcher({ connectors, value, connected, onChange }: {
  connectors: MiddlewareConnector[];
  value: string;
  /** Which connectors are connected, by id, for the dot on the chip. */
  connected: Record<string, boolean | undefined>;
  onChange: (id: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  return (
    <div className={s.stack} style={{ gap: 8 }}>
      <span className="bpm-label-row"><span className="bpm-t-label">Connector</span><InfoTip label="Connector">{MIDDLEWARE_TIPS.switcher}</InfoTip></span>
      <div className={s.chips} role="group" aria-label="Connector">
        {connectors.map((c) => (
          <button key={c.id} type="button" className={s.chip} aria-pressed={c.id === value} onClick={() => onChange(c.id)}>
            <span className={`${s.dot} ${connected[c.id] ? s.dotOn : ""}`} aria-hidden="true" />
            {c.shortName}
            <span className="bpm-sr-only">{connected[c.id] ? ", connected" : ", not connected"}</span>
          </button>
        ))}
        <button type="button" className={`${s.chip} ${s.chipDash}`} aria-expanded={adding} onClick={() => setAdding((a) => !a)}>
          <PlusIcon /> Add connector
        </button>
      </div>
      {adding && (
        <div className={s.addPanel} role="status">
          <span>SAP and ePROMIS are coming. They will appear here with the same five tabs.</span>
          <Button size="sm" onClick={() => setAdding(false)}>Close</Button>
        </div>
      )}
    </div>
  );
}
