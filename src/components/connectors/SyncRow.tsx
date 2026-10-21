"use client";

import { c } from "@/lib/theme";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import type { SyncResult } from "@/lib/connectors/d365/runSummary";

/**
 * One entity's sync controls and the line that keeps its last outcome.
 * `busy` is the key of whatever action is running anywhere on the screen
 * ("prev-customers", "sync-customers"); every button waits while one runs.
 * The result line belongs to the parent's state (or the run history), so it
 * survives re-renders and a later action on another row. Extra buttons go in
 * `actions`, anything that opens under the row (a map editor) in `children`.
 */
export default function SyncRow({
  entityKey, label, subtitle, direction, enabled, onEnabledChange, connected, busy, result,
  hasModifiedField = true, syncLabel, onPreview, onSync, actions, children,
}: {
  entityKey: string;
  label: string;
  /** Small text after the label, e.g. the entity set and linked count. */
  subtitle?: string;
  direction: "pull" | "push";
  enabled: boolean;
  onEnabledChange?: (enabled: boolean) => void;
  connected: boolean;
  busy: string | null;
  result: SyncResult | null;
  /** The entity has a modified-on field, so a pull reads only what changed; without one every run reads on from the last row and "Start over" resets it. */
  hasModifiedField?: boolean;
  syncLabel?: string;
  onPreview?: () => void;
  onSync: (full: boolean) => void;
  actions?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const push = direction === "push";
  const prevKey = `prev-${entityKey}`;
  const syncKey = `sync-${entityKey}`;
  const sync = syncLabel ?? (push ? "Push won projects" : "Sync now");
  return (
    <Card padding={14}>
      <div className="bpm-tap" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <label className="bpm-t-label" style={{ display: "flex", gap: 8, alignItems: "center", cursor: "pointer", flex: 1, minWidth: 220 }}>
          <input type="checkbox" checked={enabled} onChange={(ev) => onEnabledChange?.(ev.target.checked)} disabled={!onEnabledChange} />
          {label}
          {subtitle && <span className="bpm-t-help">{subtitle}</span>}
        </label>
        {actions}
        {!push && onPreview && <Button size="sm" disabled={!connected || !!busy} loading={busy === prevKey} onClick={onPreview}>Preview</Button>}
        <Button size="sm" variant="primary" disabled={!connected || !enabled || !!busy} loading={busy === syncKey} onClick={() => onSync(false)}>{sync}</Button>
        {!push && (
          <Button
            size="sm"
            disabled={!connected || !enabled || !!busy}
            title={hasModifiedField ? undefined : "This entity has no modified-on field, so each run reads on from where the last one stopped and starts over after the last row. This starts over now."}
            onClick={() => onSync(true)}
          >
            {hasModifiedField ? "Full resync" : "Start over"}
          </Button>
        )}
      </div>
      {result && (
        <div role={result.ok ? "status" : "alert"} style={{ marginTop: 8, fontSize: 12.5, color: result.ok ? c.muted : "var(--redink)", wordBreak: "break-word" }}>
          {result.text}
          {result.issues && result.issues.length > 0 && (
            <details style={{ marginTop: 4 }}>
              <summary style={{ cursor: "pointer", color: c.muted }}>{result.issues.length} note{result.issues.length === 1 ? "" : "s"}</summary>
              <ul style={{ margin: "4px 0 0 16px", padding: 0, color: c.muted }}>{result.issues.map((x, i) => <li key={i}>{x}</li>)}</ul>
            </details>
          )}
        </div>
      )}
      {children}
    </Card>
  );
}
