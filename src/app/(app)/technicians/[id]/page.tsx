import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getTechnicianDetail, TECH_STATUS_LABEL, LEAVE_REASON_LABEL, VISIT_STATUS_LABEL,
  CASE_STATUS_LABEL,
} from "@/lib/data";
import { c, pillar, type PillarKey } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import PageHeader from "@/components/PageHeader";
import Pill from "@/components/Pill";
import { ROUTES } from "@/lib/constants";
import TabTitle from "@/components/TabTitle";
import type { Technician, VisitLog } from "@/lib/types";
import { Gear, Phone, Mail, AlertTriangle } from "@/components/Icons";

// Config button is rendered separately — avoids making this whole page a client component
function ConfigButton({ id }: { id: string }) {
  return (
    <Link href={ROUTES.technicianConfig(id)} style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      padding: "7px 14px", borderRadius: 8, fontSize: 13, fontWeight: 600,
      background: "#1c2733", color: "#e2e7ee", textDecoration: "none",
    }}>
      <Gear size={14} /> Edit profile
    </Link>
  );
}

const STATUS_TONE: Record<Technician["status"], PillarKey> = {
  active: "green", on_leave: "amber", inactive: "red",
};

const DAY_NAMES = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

// ── helpers ──────────────────────────────────────────────────────────────────

function hhmm(t: string | null) { return t ?? "--:--"; }

function minDiff(a: string | null, b: string | null): number {
  if (!a || !b) return 0;
  const [ah, am] = a.split(":").map(Number);
  const [bh, bm] = b.split(":").map(Number);
  return (bh * 60 + bm) - (ah * 60 + am);
}

function fmtMins(m: number) {
  if (m <= 0) return "—";
  const h = Math.floor(m / 60), mm = m % 60;
  return h > 0 ? `${h}h ${mm}m` : `${mm}m`;
}

function fmtDate(s: string) {
  return new Date(s + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

// ── sub-components ────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={cardStyle}>
      <h3 style={{ fontSize: 12.5, fontWeight: 700, color: c.muted, textTransform: "uppercase", letterSpacing: "0.06em", margin: "0 0 10px" }}>
        {title}
      </h3>
      {children}
    </section>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "5px 0", fontSize: 12.5, borderTop: `1px solid ${c.line}` }}>
      <span style={{ color: c.muted, flexShrink: 0 }}>{label}</span>
      <span style={{ textAlign: "right" }}>{value}</span>
    </div>
  );
}

// Visual time-bar: shows travel/work/break/return segments as coloured strips
function VisitTimeline({ v }: { v: VisitLog }) {
  const DAY_START = 7 * 60;  // 07:00
  const DAY_END   = 19 * 60; // 19:00
  const SPAN      = DAY_END - DAY_START;

  function toMin(t: string | null) {
    if (!t) return null;
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m;
  }

  function pct(t: string | null) {
    const m = toMin(t);
    if (m === null) return null;
    return Math.max(0, Math.min(100, ((m - DAY_START) / SPAN) * 100));
  }

  type Seg = { start: number; end: number; color: string; label: string };
  const segs: Seg[] = [];

  // Travel out
  const ts  = toMin(v.travel_start_time), ar = toMin(v.arrived_time);
  if (ts !== null && ar !== null) segs.push({ start: ts, end: ar, color: pillar.blue.base, label: "Travel out" });

  // Work (excluding break)
  const ws  = toMin(v.work_start_time), we = toMin(v.work_end_time);
  const bks = toMin(v.break_start_time), bke = toMin(v.break_end_time);
  if (ws !== null) {
    const workEnd = bks ?? we ?? ws;
    segs.push({ start: ws, end: workEnd, color: pillar.teal.base, label: "Work" });
  }
  if (bks !== null && bke !== null) {
    segs.push({ start: bks, end: bke, color: pillar.amber.base, label: "Break" });
  }
  if (bke !== null && we !== null) {
    segs.push({ start: bke, end: we, color: pillar.teal.base, label: "Work (cont)" });
  }

  // Return travel
  const rs = toMin(v.return_start_time), re = toMin(v.return_end_time);
  if (rs !== null && re !== null) segs.push({ start: rs, end: re, color: pillar.purple.base, label: "Return" });

  const hourTicks = [8, 10, 12, 14, 16, 18];

  return (
    <div style={{ position: "relative", height: 22, background: c.panel2, borderRadius: 5, overflow: "hidden", marginBottom: 6, border: `1px solid ${c.line}` }}>
      {/* Hour ticks */}
      {hourTicks.map((h) => {
        const p = ((h * 60 - DAY_START) / SPAN) * 100;
        return (
          <div key={h} style={{
            position: "absolute", top: 0, bottom: 0, left: `${p}%`,
            width: 1, background: c.line, zIndex: 0,
          }} />
        );
      })}
      {/* Segments */}
      {segs.map((seg, i) => {
        const left = ((seg.start - DAY_START) / SPAN) * 100;
        const width = ((seg.end - seg.start) / SPAN) * 100;
        if (width <= 0) return null;
        return (
          <div key={i} style={{
            position: "absolute", top: 3, bottom: 3, borderRadius: 3,
            left: `${left}%`, width: `${Math.max(1, width)}%`,
            background: seg.color, opacity: 0.85, zIndex: 1,
          }} title={`${seg.label}: ${hhmm(segs[i] ? String(Math.floor(seg.start / 60)).padStart(2,"0") + ":" + String(seg.start % 60).padStart(2,"0") : null)} – ${String(Math.floor(seg.end / 60)).padStart(2,"0")}:${String(seg.end % 60).padStart(2,"0")}`} />
        );
      })}
    </div>
  );
}

// Legend for timeline
function TimelineLegend() {
  const items = [
    { color: pillar.blue.base,   label: "Travel out" },
    { color: pillar.teal.base,   label: "Work" },
    { color: pillar.amber.base,  label: "Break" },
    { color: pillar.purple.base, label: "Return" },
  ];
  return (
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 10 }}>
      {items.map((it) => (
        <span key={it.label} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10.5, color: c.muted }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: it.color, display: "inline-block" }} />
          {it.label}
        </span>
      ))}
    </div>
  );
}

// ── page ──────────────────────────────────────────────────────────────────────

export default async function TechnicianDetailPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ month?: string }>;
}) {
  const { id }    = await params;
  const { month } = await searchParams;
  const today     = new Date().toISOString().slice(0, 10);
  const yearMonth = month ?? today.slice(0, 7);

  const data = await getTechnicianDetail(id, yearMonth);
  if (!data) notFound();

  const { technician: tech, calendarDays, leaves, recentVisits, upcomingWOs, monthStats } = data;

  // Calendar navigation
  const [cy, cm] = yearMonth.split("-").map(Number);
  const prevMonth = cm === 1 ? `${cy - 1}-12` : `${cy}-${String(cm - 1).padStart(2, "0")}`;
  const nextMonth = cm === 12 ? `${cy + 1}-01` : `${cy}-${String(cm + 1).padStart(2, "0")}`;
  const monthLabel = new Date(cy, cm - 1, 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" });

  // First weekday of the month (0=Sun)
  const firstDow = new Date(cy, cm - 1, 1).getDay();

  const tone = STATUS_TONE[tech.status];

  // Cert expiry within 90 days
  const soonExpiring = tech.certifications.filter((c_) => {
    const exp = tech.cert_expiry[c_];
    return exp && new Date(exp) < new Date(Date.now() + 90 * 86400000);
  });

  return (
    <>
      <TabTitle title={tech.name} />
      <div style={{ marginBottom: 10 }}>
        <Link href={ROUTES.technicians} style={{ fontSize: 12, color: c.muted, textDecoration: "none" }}>
          ← All technicians
        </Link>
      </div>

      <PageHeader
        title={tech.name}
        subtitle={`Field team · ${tech.base_location ?? "—"}`}
        action={<ConfigButton id={id} />}
      />

      {/* Status + contacts row */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14, alignItems: "center" }}>
        <Pill label={TECH_STATUS_LABEL[tech.status]} tone={tone} />
        {tech.phone && (
          <span style={{ fontSize: 12.5, color: c.muted, display: "inline-flex", alignItems: "center", gap: 4 }}><Phone size={12} color={c.hint} /> {tech.phone}</span>
        )}
        {tech.email && (
          <span style={{ fontSize: 12.5, color: c.muted, display: "inline-flex", alignItems: "center", gap: 4 }}><Mail size={12} color={c.hint} /> {tech.email}</span>
        )}
        <span style={{ fontSize: 12.5, color: c.muted, marginLeft: "auto" }}>
          Max {tech.max_visits_per_day} visits/day
        </span>
      </div>

      {/* KPI strip */}
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 16,
      }} className="hub-grid">
        {[
          { label: "Visits this month", value: monthStats.totalVisits },
          { label: "Completed",         value: monthStats.completed },
          { label: "Km travelled",      value: `${monthStats.kmTravelled} km` },
          { label: "Avg work time",     value: fmtMins(monthStats.avgWorkMinutes) },
        ].map(({ label, value }) => (
          <div key={label} style={{ ...cardStyle, textAlign: "center" }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: c.ink }}>{value}</div>
            <div style={{ fontSize: 11, color: c.muted, marginTop: 2 }}>{label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 240px", gap: 12 }} className="hub-grid">

        {/* ── LEFT COLUMN ────────────────────────────────────────────────── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

          {/* Cert expiry warning */}
          {soonExpiring.length > 0 && (
            <div style={{
              ...cardStyle, borderLeft: `3px solid ${pillar.amber.base}`,
              background: pillar.amber.bg, padding: "10px 14px",
            }}>
              <div style={{ fontWeight: 600, fontSize: 13, color: pillar.amber.fg, marginBottom: 4 }}>
                <AlertTriangle size={13} color={pillar.amber.fg} style={{ marginRight: 5 }} /> Certification expiring soon
              </div>
              {soonExpiring.map((cert) => (
                <div key={cert} style={{ fontSize: 12, color: c.ink, marginBottom: 2 }}>
                  {cert} — expires {fmtDate(tech.cert_expiry[cert])}
                </div>
              ))}
            </div>
          )}

          {/* Skills + Certs side by side */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {/* Skills */}
            <Section title="Skills">
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 6 }}>
                {(tech.skills?.split(",") ?? []).map((sk) => (
                  <span key={sk} style={{
                    fontSize: 12, padding: "3px 9px", borderRadius: 20,
                    background: c.panel2, color: c.ink, border: `1px solid ${c.line}`,
                  }}>
                    {sk.trim()}
                  </span>
                ))}
              </div>
            </Section>

            {/* Certifications */}
            <Section title="Certifications">
              {tech.certifications.map((cert) => {
                const expiry = tech.cert_expiry[cert];
                const isExpiring = expiry && new Date(expiry) < new Date(Date.now() + 90 * 86400000);
                const isExpired  = expiry && new Date(expiry) < new Date();
                return (
                  <div key={cert} style={{ borderTop: `1px solid ${c.line}`, paddingTop: 5, marginTop: 5 }}>
                    <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
                      <span style={{ fontSize: 11, color: isExpired ? pillar.red.base : isExpiring ? pillar.amber.base : pillar.green.base }}>
                        {isExpired ? "✗" : "✓"}
                      </span>
                      <span style={{ fontSize: 12, color: c.ink, flex: 1, minWidth: 0, wordBreak: "break-word" }}>{cert}</span>
                    </div>
                    {expiry && (
                      <div style={{ fontSize: 10.5, color: isExpired ? pillar.red.fg : isExpiring ? pillar.amber.fg : c.hint, marginTop: 2, paddingLeft: 16 }}>
                        {isExpired ? "Expired" : isExpiring ? "Expiring soon" : "Valid until"} {fmtDate(expiry)}
                      </div>
                    )}
                  </div>
                );
              })}
            </Section>
          </div>

          {/* Visit log history */}
          {recentVisits.length > 0 && (
            <section style={cardStyle}>
              <h3 style={{ fontSize: 13, fontWeight: 600, margin: "0 0 8px" }}>
                Recent visit logs
              </h3>
              <TimelineLegend />
              {recentVisits.map(({ visitLog: v, account, workOrder }) => {
                const travelOutMin  = minDiff(v.travel_start_time, v.arrived_time);
                const workMin       = minDiff(v.work_start_time, v.work_end_time) - minDiff(v.break_start_time, v.break_end_time);
                const breakMin      = minDiff(v.break_start_time, v.break_end_time);
                const returnMin     = minDiff(v.return_start_time, v.return_end_time);
                const VISIT_TONE: Record<string, PillarKey> = { planned: "blue", in_progress: "amber", completed: "green", cancelled: "red" };

                return (
                  <div key={v.id} style={{ borderTop: `1px solid ${c.line}`, paddingTop: 10, marginTop: 10 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 12.5, fontWeight: 600, color: c.ink }}>
                        {fmtDate(v.visit_date)}
                      </span>
                      {account && (
                        <Link href={ROUTES.account(account.id)} style={{ fontSize: 12, color: c.accent, textDecoration: "none" }}>
                          {account.name}
                        </Link>
                      )}
                      {workOrder && (
                        <Link href={ROUTES.workOrder(workOrder.id)} style={{ fontSize: 11, color: c.muted, fontFamily: "monospace", textDecoration: "none" }}>
                          {workOrder.ref}
                        </Link>
                      )}
                      <Pill label={VISIT_STATUS_LABEL[v.status]} tone={VISIT_TONE[v.status] ?? "blue"} />
                      <span style={{ marginLeft: "auto", fontSize: 11, color: c.muted }}>
                        {v.travel_distance_km != null ? `${v.travel_distance_km * 2} km round trip` : ""}
                      </span>
                    </div>
                    <VisitTimeline v={v} />
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 6, fontSize: 11 }}>
                      <span style={{ color: pillar.blue.fg }}>
                        Travel out: {hhmm(v.travel_start_time)} → {hhmm(v.arrived_time)} ({fmtMins(travelOutMin)})
                      </span>
                      {v.work_start_time && (
                        <span style={{ color: pillar.teal.fg }}>
                          Work: {hhmm(v.work_start_time)} → {hhmm(v.work_end_time)} ({fmtMins(workMin)})
                        </span>
                      )}
                      {breakMin > 0 && (
                        <span style={{ color: pillar.amber.fg }}>Break: {fmtMins(breakMin)}</span>
                      )}
                      {returnMin > 0 && (
                        <span style={{ color: pillar.purple.fg }}>
                          Return: {hhmm(v.return_start_time)} → {hhmm(v.return_end_time)} ({fmtMins(returnMin)})
                        </span>
                      )}
                    </div>
                    {v.work_done && (
                      <p style={{ fontSize: 12, color: c.muted, margin: "4px 0", lineHeight: 1.55 }}>{v.work_done}</p>
                    )}
                    {v.parts_used && (
                      <p style={{ fontSize: 11.5, color: c.hint, margin: "4px 0" }}>
                        <strong style={{ color: c.muted }}>Parts: </strong>{v.parts_used}
                      </p>
                    )}
                    {v.customer_feedback && (
                      <p style={{ fontSize: 11.5, color: c.muted, margin: "4px 0", fontStyle: "italic" }}>
                        &ldquo;{v.customer_feedback}&rdquo;
                      </p>
                    )}
                    {v.next_action && (
                      <p style={{ fontSize: 11.5, color: pillar.blue.fg, margin: "4px 0" }}>→ {v.next_action}</p>
                    )}
                    {v.needs_escalation && (
                      <div style={{ marginTop: 4 }}><Pill label="Needs escalation" tone="red" /></div>
                    )}
                    {v.customer_acknowledged && (
                      <span style={{ fontSize: 11, color: pillar.green.fg }}>✓ Customer acknowledged</span>
                    )}
                  </div>
                );
              })}
            </section>
          )}
        </div>

        {/* ── RIGHT COLUMN — compact calendar + schedule ──────────────────── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

          {/* Calendar */}
          <section style={cardStyle}>
            {/* Month nav */}
            <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 8 }}>
              <Link href={`?month=${prevMonth}`} style={{
                padding: "2px 8px", borderRadius: 5, fontSize: 12,
                background: c.panel2, color: c.muted, textDecoration: "none",
                border: `1px solid ${c.line}`, lineHeight: 1.6,
              }}>←</Link>
              <span style={{ fontWeight: 700, fontSize: 12.5, color: c.ink, flex: 1, textAlign: "center" }}>
                {monthLabel}
              </span>
              <Link href={`?month=${nextMonth}`} style={{
                padding: "2px 8px", borderRadius: 5, fontSize: 12,
                background: c.panel2, color: c.muted, textDecoration: "none",
                border: `1px solid ${c.line}`, lineHeight: 1.6,
              }}>→</Link>
            </div>

            {/* Day-name header */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2, marginBottom: 2 }}>
              {DAY_NAMES.map((d) => (
                <div key={d} style={{ textAlign: "center", fontSize: 9, color: c.hint, fontWeight: 700, paddingBottom: 2 }}>
                  {d}
                </div>
              ))}
            </div>

            {/* Day grid */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2 }}>
              {Array.from({ length: firstDow }).map((_, i) => <div key={`blank-${i}`} />)}

              {calendarDays.map((day) => {
                const isToday     = day.date === today;
                const isPast      = day.date < today;
                const hasWO       = day.workOrders.length > 0;
                const hasVisit    = day.visitLogs.length > 0;
                const allComplete = day.visitLogs.every((v) => v.status === "completed");
                const hasConflict = day.isLeave && (hasWO || hasVisit);

                let bg: string = "transparent";
                let textColor: string = c.muted;
                let borderColor: string = "transparent";

                if (hasConflict) { bg = pillar.red.bg; textColor = pillar.red.fg; borderColor = pillar.red.base; }
                else if (day.isLeave) { bg = pillar.amber.bg; textColor = pillar.amber.fg; }
                else if (hasVisit && allComplete) { bg = pillar.green.bg; textColor = pillar.green.fg; }
                else if (hasWO || hasVisit) { bg = pillar.blue.bg; textColor = pillar.blue.fg; }
                else if (!isPast) { bg = c.panel2; textColor = c.ink; }

                return (
                  <div
                    key={day.date}
                    title={day.date}
                    style={{
                      background: bg,
                      border: `1px solid ${isToday ? c.accent : borderColor}`,
                      borderRadius: 4,
                      padding: "3px 2px 2px",
                      textAlign: "center",
                      minHeight: 28,
                      opacity: isPast && !hasWO && !hasVisit && !day.isLeave ? 0.4 : 1,
                    }}
                  >
                    <div style={{ fontSize: 10.5, fontWeight: isToday ? 700 : 400, color: textColor, lineHeight: 1.2 }}>
                      {parseInt(day.date.slice(-2))}
                    </div>
                    {(hasWO || hasVisit) && (
                      <div style={{ display: "flex", justifyContent: "center", gap: 1, marginTop: 1 }}>
                        {day.workOrders.slice(0, 3).map((_, i) => (
                          <span key={i} style={{ width: 3, height: 3, borderRadius: "50%", background: textColor, display: "inline-block", opacity: 0.8 }} />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Compact legend */}
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8, paddingTop: 7, borderTop: `1px solid ${c.line}` }}>
              {[
                { color: pillar.green.bg, border: pillar.green.base, label: "Done" },
                { color: pillar.blue.bg,  border: pillar.blue.base,  label: "WO" },
                { color: pillar.amber.bg, border: pillar.amber.base, label: "Leave" },
                { color: pillar.red.bg,   border: pillar.red.base,   label: "Conflict" },
              ].map((it) => (
                <span key={it.label} style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 10, color: c.muted }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: it.color, border: `1px solid ${it.border}`, display: "inline-block" }} />
                  {it.label}
                </span>
              ))}
            </div>
          </section>

          {/* Upcoming work orders */}
          {upcomingWOs.length > 0 && (
            <Section title="Upcoming">
              {upcomingWOs.map(({ workOrder: wo, account }) => (
                <div key={wo.id} style={{ borderTop: `1px solid ${c.line}`, paddingTop: 8, marginTop: 8 }}>
                  <Link href={ROUTES.workOrder(wo.id)} style={{ fontFamily: "monospace", fontSize: 12, color: c.accent, textDecoration: "none", fontWeight: 600 }}>
                    {wo.ref}
                  </Link>
                  {account && (
                    <div style={{ fontSize: 11.5, color: c.muted, marginTop: 2 }}>{account.name}</div>
                  )}
                  {wo.scheduled_for && (
                    <div style={{ fontSize: 11, color: c.hint, marginTop: 1 }}>{fmtDate(wo.scheduled_for)}</div>
                  )}
                </div>
              ))}
            </Section>
          )}

          {/* Leave schedule */}
          {leaves.length > 0 && (
            <Section title="Leave schedule">
              {leaves.map((lv) => (
                <div key={lv.id} style={{ borderTop: `1px solid ${c.line}`, paddingTop: 8, marginTop: 8 }}>
                  <Pill label={LEAVE_REASON_LABEL[lv.reason]} tone="amber" />
                  <div style={{ fontSize: 11.5, color: c.muted, marginTop: 4 }}>
                    {fmtDate(lv.from_date)} — {fmtDate(lv.to_date)}
                  </div>
                  {lv.notes && (
                    <div style={{ fontSize: 11, color: c.hint, marginTop: 3, lineHeight: 1.4 }}>{lv.notes}</div>
                  )}
                </div>
              ))}
            </Section>
          )}
        </div>
      </div>
    </>
  );
}

