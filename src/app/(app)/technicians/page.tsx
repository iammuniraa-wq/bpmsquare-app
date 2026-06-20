import Link from "next/link";
import { listTechnicians, TECH_STATUS_LABEL, VISIT_STATUS_LABEL } from "@/lib/data";
import { c, pillar, type PillarKey } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import PageHeader from "@/components/PageHeader";
import Pill from "@/components/Pill";
import { ROUTES } from "@/lib/constants";
import type { Technician } from "@/lib/types";

const STATUS_TONE: Record<Technician["status"], PillarKey> = {
  active: "green", on_leave: "amber", inactive: "red",
};

const SKILL_ICON = "◈";
const CERT_ICON  = "✓";

function StatBox({ value, label }: { value: string | number; label: string }) {
  return (
    <div style={{ textAlign: "center", padding: "6px 10px" }}>
      <div style={{ fontSize: 18, fontWeight: 700, color: c.ink }}>{value}</div>
      <div style={{ fontSize: 10.5, color: c.muted, marginTop: 1 }}>{label}</div>
    </div>
  );
}

export default async function TechniciansPage() {
  const techs = await listTechnicians();
  const activeCt  = techs.filter((t) => t.technician.status === "active").length;
  const onLeaveCt = techs.filter((t) => t.technician.status === "on_leave").length;

  return (
    <>
      <PageHeader
        title="Technicians"
        subtitle={`Field team · ${activeCt} active${onLeaveCt > 0 ? ` · ${onLeaveCt} on leave` : ""}`}
      />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 14 }}>
        {techs.map(({ technician: tech, todayWorkOrders, currentLeave, monthStats }) => {
          const isLeave = tech.status === "on_leave";
          const tone = STATUS_TONE[tech.status];
          const skills = tech.skills?.split(",").map((s) => s.trim()).slice(0, 3) ?? [];

          return (
            <Link
              key={tech.id}
              href={ROUTES.technician(tech.id)}
              style={{ textDecoration: "none", color: "inherit" }}
            >
              <article style={{
                ...cardStyle,
                borderLeft: `3px solid ${pillar[tone].base}`,
                cursor: "pointer",
                transition: "box-shadow 0.15s",
              }}>
                {/* Header row */}
                <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 10 }}>
                  <div style={{
                    width: 44, height: 44, borderRadius: 12, flexShrink: 0,
                    background: pillar[tone].bg, color: pillar[tone].fg,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 17, fontWeight: 700, letterSpacing: "-0.5px",
                  }}>
                    {tech.name.split(" ").map((w) => w[0]).slice(0, 2).join("")}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 14.5, color: c.ink }}>{tech.name}</div>
                    <div style={{ fontSize: 11.5, color: c.muted, marginTop: 1 }}>{tech.base_location}</div>
                    <div style={{ marginTop: 4 }}>
                      <Pill label={TECH_STATUS_LABEL[tech.status]} tone={tone} />
                    </div>
                  </div>
                  {/* Slot indicator */}
                  {!isLeave && (
                    <div style={{
                      textAlign: "center", padding: "4px 8px", borderRadius: 8,
                      background: c.panel2, border: `1px solid ${c.line}`,
                    }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: c.ink }}>
                        {todayWorkOrders.length}/{tech.max_visits_per_day}
                      </div>
                      <div style={{ fontSize: 9.5, color: c.muted }}>today</div>
                    </div>
                  )}
                </div>

                {/* Leave banner */}
                {isLeave && currentLeave && (
                  <div style={{
                    background: pillar.amber.bg, color: pillar.amber.fg,
                    borderRadius: 7, padding: "5px 10px", fontSize: 11.5,
                    marginBottom: 8, fontWeight: 500,
                  }}>
                    On leave until {new Date(currentLeave.to_date).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                    {" "}· {currentLeave.reason.charAt(0).toUpperCase() + currentLeave.reason.slice(1)}
                  </div>
                )}

                {/* Skills */}
                {skills.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 8 }}>
                    {skills.map((sk) => (
                      <span key={sk} style={{
                        fontSize: 10.5, padding: "2px 7px", borderRadius: 20,
                        background: c.panel2, color: c.muted, border: `1px solid ${c.line}`,
                      }}>
                        {SKILL_ICON} {sk}
                      </span>
                    ))}
                  </div>
                )}

                {/* Certs */}
                {tech.certifications.length > 0 && (
                  <div style={{ marginBottom: 8 }}>
                    {tech.certifications.map((cert) => {
                      const expiry = tech.cert_expiry[cert];
                      const isExpiring = expiry && new Date(expiry) < new Date(Date.now() + 90 * 86400000);
                      return (
                        <div key={cert} style={{
                          fontSize: 11, color: isExpiring ? pillar.amber.fg : c.muted,
                          display: "flex", alignItems: "center", gap: 4, marginBottom: 2,
                        }}>
                          <span style={{ color: isExpiring ? pillar.amber.base : pillar.green.base }}>
                            {CERT_ICON}
                          </span>
                          {cert}
                          {expiry && (
                            <span style={{ color: isExpiring ? pillar.amber.base : c.hint, fontSize: 10, marginLeft: 2 }}>
                              exp {new Date(expiry).toLocaleDateString("en-IN", { month: "short", year: "2-digit" })}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Month stats */}
                <div style={{
                  display: "flex", borderTop: `1px solid ${c.line}`, marginTop: 4, paddingTop: 8,
                }}>
                  <StatBox value={monthStats.visits} label="visits this month" />
                  <div style={{ width: 1, background: c.line }} />
                  <StatBox value={monthStats.kmTravelled > 0 ? `${monthStats.kmTravelled} km` : "—"} label="km (est)" />
                  <div style={{ width: 1, background: c.line }} />
                  <StatBox value={monthStats.visitedAccounts} label="accounts" />
                </div>

                {/* Today WOs */}
                {todayWorkOrders.length > 0 && (
                  <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${c.line}` }}>
                    <div style={{ fontSize: 10.5, color: c.muted, fontWeight: 600, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                      Today
                    </div>
                    {todayWorkOrders.map((wo) => (
                      <div key={wo.id} style={{
                        fontSize: 11.5, color: c.ink, fontFamily: "monospace",
                        background: pillar.blue.bg, borderRadius: 5, padding: "2px 7px", marginBottom: 3,
                        display: "inline-block", marginRight: 4,
                      }}>
                        {wo.ref}
                      </div>
                    ))}
                  </div>
                )}

                {/* Contact */}
                <div style={{ marginTop: 8, display: "flex", gap: 12, flexWrap: "wrap" }}>
                  {tech.phone && (
                    <span style={{ fontSize: 11, color: c.muted }}>
                      ☎ {tech.phone}
                    </span>
                  )}
                  {tech.email && (
                    <span style={{ fontSize: 11, color: c.muted }}>
                      ✉ {tech.email}
                    </span>
                  )}
                </div>
              </article>
            </Link>
          );
        })}
      </div>
    </>
  );
}

