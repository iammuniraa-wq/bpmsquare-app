import { c, pillar } from "@/lib/theme";
import InfoTip from "@/components/ui/InfoTip";
import type { ProjectPath } from "@/lib/contractProjects/path";
import { PROJECT_TIPS } from "@/lib/contractProjects/tips";

/**
 * Where the project stands, as one row of steps under the title: Draft, Baseline waiting, Active, Handed over, Closed. The step it is
 * on is filled; earlier ones are ticked. Scrolls sideways on a phone rather than wrapping. Server-safe, no hooks.
 */
export default function ProjectPathBar({ path }: { path: ProjectPath }) {
  return (
    <div data-guide="cp.path" style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 12 }}>
      <ol aria-label="Project path" style={{ display: "flex", gap: 6, margin: 0, padding: 0, listStyle: "none", overflowX: "auto", flex: "1 1 auto", minWidth: 0 }}>
        {path.steps.map((s) => (
          <li
            key={s.key} data-step={s.key} data-state={s.state} aria-current={s.state === "current" ? "step" : undefined}
            style={{
              flex: "1 0 96px", minHeight: 36, display: "flex", alignItems: "center", justifyContent: "center", gap: 4, padding: "0 10px", borderRadius: 8,
              fontSize: 12.5, fontWeight: s.state === "current" ? 700 : 500, whiteSpace: "nowrap",
              background: s.state === "current" ? pillar.blue.bg : c.panel2,
              color: s.state === "current" ? pillar.blue.fg : s.state === "done" ? c.ink : c.hint,
              border: `1px solid ${s.state === "current" ? pillar.blue.base : c.line}`,
            }}
          >
            {s.state === "done" && <span aria-hidden="true">✓</span>}
            {s.label}
            <span className="bpm-sr-only">{s.state === "done" ? " (reached)" : s.state === "current" ? " (current)" : " (not reached)"}</span>
          </li>
        ))}
      </ol>
      <InfoTip label="Project path">{PROJECT_TIPS.path}</InfoTip>
    </div>
  );
}
