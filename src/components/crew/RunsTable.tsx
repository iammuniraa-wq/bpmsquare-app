import Link from "next/link";
import { ROUTES } from "@/lib/constants";
import type { RunDTO } from "@/lib/crew/viewTypes";
import s from "./crew.module.css";
import When from "./When";

// The Runs tab: When, Agent, Because, Result, Tokens. A row opens the trace. A phone shows each run as a small card (no sideways scroll).

const RESULT: Record<RunDTO["status"], string> = {
  queued: "Waiting to start", running: "Running", done: "Done", failed: "Failed", skipped_budget: "Paused: allowance reached", skipped_paused: "Paused", cancelled: "Stopped",
};

function result(r: RunDTO): string {
  if (r.status === "done") {
    if (r.findings > 0) return `${r.findings} suggestion${r.findings === 1 ? "" : "s"}${r.proposals > 0 ? `, ${r.proposals} note${r.proposals === 1 ? "" : "s"} drafted` : ""}`;
    return r.note ?? "Nothing to report";
  }
  if (r.status === "failed" && r.error) return `Failed: ${r.error}`;
  return RESULT[r.status];
}

export default function RunsTable({ runs, showAgent }: { runs: RunDTO[]; showAgent: boolean }) {
  if (runs.length === 0) {
    return (
      <div className={s.empty} data-guide="crew.runs.empty">
        <div className={s.emptyTitle}>No runs yet</div>
        <div style={{ marginTop: 6, fontSize: 13 }}>Switch an agent on and it will look at its next scheduled time. An admin can also press Run now.</div>
      </div>
    );
  }
  return (
    <table className={s.runs} data-guide="crew.runs">
      <thead><tr><th>When</th>{showAgent && <th>Agent</th>}<th>Because</th><th>Result</th><th>Tokens</th></tr></thead>
      <tbody>
        {runs.map((r) => (
          <tr key={r.id}>
            <td><Link className={s.runLink} href={ROUTES.aiAutomationRun(r.agent, r.id)}><When iso={r.at} mode="stamp" /></Link></td>
            {showAgent && <td>{r.agentName}</td>}
            <td>{r.because || (r.trigger === "schedule" ? "Daily pass" : r.trigger === "manual" ? "Run now" : "Something changed")}</td>
            <td className={s[`status_${r.status}`]}>{result(r)}</td>
            <td>{r.tokens > 0 ? r.tokens.toLocaleString("en-GB") : "0"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
