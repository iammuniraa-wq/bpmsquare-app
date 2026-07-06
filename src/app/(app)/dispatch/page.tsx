import { requireFeature } from "@/lib/tenant";
import { listDispatch } from "@/lib/data/live";
import { c, pillar, type PillarKey } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import PageHeader from "@/components/PageHeader";
import Pill from "@/components/Pill";

type WOStatus = "scheduled" | "in_progress";

const STATUS_TONE: Record<WOStatus, PillarKey> = {
  scheduled: "blue", in_progress: "amber",
};
const STATUS_LABEL: Record<WOStatus, string> = {
  scheduled: "Scheduled", in_progress: "In Progress",
};

const fmtDateTime = (s: string) =>
  new Date(s).toLocaleString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: true,
  });

const th: React.CSSProperties = {
  textAlign: "left", color: c.hint, fontWeight: 500,
  padding: "9px 12px", borderBottom: `1px solid ${c.line}`, fontSize: 11.5,
};
const td: React.CSSProperties = {
  padding: "10px 12px", borderBottom: `1px solid ${c.line}`,
  fontSize: 12.5, verticalAlign: "middle",
};

export default async function DispatchPage() {
  await requireFeature("dispatch");
  const jobs = await listDispatch();
  const scheduled = jobs.filter((j) => j.status === "scheduled");
  const inProgress = jobs.filter((j) => j.status === "in_progress");

  return (
    <>
      <PageHeader title="Dispatch" subtitle={`${jobs.length} active · Field service scheduling`} />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12, marginBottom: 20 }}>
        <div style={{ ...cardStyle, textAlign: "center" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>Scheduled</div>
          <div style={{ fontSize: 28, fontWeight: 700, color: pillar.blue.base }}>{scheduled.length}</div>
        </div>
        <div style={{ ...cardStyle, textAlign: "center" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>In Progress</div>
          <div style={{ fontSize: 28, fontWeight: 700, color: pillar.amber.base }}>{inProgress.length}</div>
        </div>
      </div>

      {jobs.length === 0 ? (
        <div style={{ ...cardStyle, textAlign: "center", padding: "48px 24px", color: c.muted }}>
          No active work orders to dispatch.
        </div>
      ) : (
        <div style={cardStyle}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={th}>Ref</th>
                <th style={th}>Account</th>
                <th style={th}>Technician</th>
                <th style={th}>Status</th>
                <th style={th}>Scheduled</th>
                <th style={th}>Case</th>
                <th style={th}>Scope</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={job.id}>
                  <td style={td}>
                    <span style={{ fontFamily: "monospace", fontSize: 12, color: c.accent, fontWeight: 600 }}>
                      {job.ref}
                    </span>
                  </td>
                  <td style={td}>{job.account_name}</td>
                  <td style={{ ...td, fontWeight: 500 }}>{job.technician_name ?? "Unassigned"}</td>
                  <td style={td}>
                    <Pill
                      label={STATUS_LABEL[job.status as WOStatus] ?? job.status}
                      tone={STATUS_TONE[job.status as WOStatus] ?? "blue"}
                    />
                  </td>
                  <td style={{ ...td, color: c.muted, fontSize: 12 }}>
                    {job.scheduled_for ? fmtDateTime(job.scheduled_for) : "TBD"}
                  </td>
                  <td style={{ ...td, fontFamily: "monospace", fontSize: 11.5, color: c.muted }}>
                    {job.case_ref ?? "—"}
                  </td>
                  <td style={{ ...td, color: c.muted, maxWidth: 200 }}>
                    <span style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                      {job.description ?? "—"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
