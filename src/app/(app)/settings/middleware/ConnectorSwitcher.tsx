"use client";

import InfoTip from "@/components/ui/InfoTip";
import s from "./middleware.module.css";
import type { MiddlewareConnector } from "./connectors";
import { MIDDLEWARE_TIPS } from "./tips";

/**
 * One chip per connector from the registry, then "Connections". The chip IS the connection:
 * its dot shows the state, a small warning shows only when the secret ends within 30 days, and
 * clicking the open chip shows the connection panel. Everything under the chips is the same four
 * tabs for whichever connector is chosen. "Connections" lists every connection in one table and is where
 * a REST API or an OData service is added; while it is open no connector chip is pressed.
 */
export default function ConnectorSwitcher({ connectors, value, connected, expiry, onChange, onManage, connectionsOpen, connectionsCount, onConnections }: {
  connectors: MiddlewareConnector[];
  value: string;
  /** Which connectors are connected, by id, for the dot on the chip. */
  connected: Record<string, boolean | undefined>;
  /** The selected connector's expiry warning, or null. */
  expiry: string | null;
  onChange: (id: string) => void;
  onManage: () => void;
  connectionsOpen: boolean;
  /** How many connections the workspace added itself; nothing is shown when there are none. */
  connectionsCount: number;
  onConnections: () => void;
}) {
  return (
    <div className={s.stack} style={{ gap: 8 }}>
      <div className={s.chips} role="group" aria-label="Connector" data-guide="middleware.connector">
        {connectors.map((c) => {
          const open = !connectionsOpen && c.id === value;
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
        <button type="button" className={`${s.chip} ${s.chipDash}`} aria-pressed={connectionsOpen} data-guide="middleware.connections" onClick={onConnections}>
          Connections{connectionsCount > 0 ? ` (${connectionsCount})` : ""}
        </button>
        <InfoTip label="Connector">{MIDDLEWARE_TIPS.switcher}</InfoTip>
      </div>
    </div>
  );
}
