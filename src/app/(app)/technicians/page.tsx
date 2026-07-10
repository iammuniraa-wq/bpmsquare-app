import Link from "next/link";
import { listTechnicians, TECH_STATUS_LABEL } from "@/lib/data";
import { c, pillar, type PillarKey } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import PageHeader from "@/components/PageHeader";
import Pill from "@/components/Pill";
import { ROUTES } from "@/lib/constants";
import type { Technician } from "@/lib/types";
import { AlertTriangle } from "@/components/Icons";

const STATUS_TONE: Record<Technician["status"], PillarKey> = {
  active: "green", on_leave: "amber", inactive: "red",
};

function Avatar({ name, tone }: { name: string; tone: PillarKey }) {
  const initials = name.split(" ").map((w) => w[0]).slice(0, 2).join("");
  return (
    <div style={{
      width: 40, height: 40, borderRadius: 10, flexShrink: 0,
      background: pillar[tone].bg, color: pillar[tone].fg,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: 14, fontWeight: 700, letterSpacing: "-0.5px",
    }}>
      {initials}
    </div>
  );
}

export default async function TechniciansPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status: statusFilter } = await searchParams;
  const allTechs = await listTechnicians();
  const techs = statusFilter ? allTechs.filter((t) => t.technician.status === statusFilter) : allTechs;
  const activeCt   = allTechs.filter((t) => t.technician.status === "active").length;
  const onLeaveCt  = allTechs.filter((t) => t.technician.status === "on_leave").length;
  const totalSlots = techs
    .filter((t) => t.technician.status === "active")
    .reduce((s, t) => s + t.technician.max_visits_per_day, 0);
  const usedSlots  = techs
    .filter((t) => t.technician.status === "active")
    .reduce((s, t) => s + t.todayWorkOrders.length, 0);

  return (
    <>
      <PageHeader
        title="Technicians"
        subtitle={`Field team · ${activeCt} active${onLeaveCt > 0 ? ` · ${onLeaveCt} on leave` : ""}`}
        action={
          <Link
            href={ROUTES.technicianNew}
            style={{
              padding: "7px 14px", borderRadius: 8, fontSize: 12.5, fontWeight: 600,
              background: c.accent, color: "#fff", textDecoration: "none",
              whiteSpace: "nowrap",
            }}
          >
            + New Technician
          </Link>
        }
      />

      {/* Team capacity strip */}
      <div style={{
        display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap",
      }}>
        {[
          { label: "Active today",  value: activeCt },
          { label: "On leave",      value: onLeaveCt, warn: onLeaveCt > 0 },
          { label: "Slots used",    value: `${usedSlots} / ${totalSlots}` },
          { label: "Slots free",    value: totalSlots - usedSlots, accent: true },
        ].map(({ label, value, warn, accent }) => (
          <div key={label} style={{
            ...cardStyle,
            padding: "10px 16px",
            display: "flex", flexDirection: "column", gap: 2, minWidth: 110,
          }}>
            <div style={{
              fontSize: 20, fontWeight: 700,
              color: warn ? pillar.amber.base : accent ? pillar.green.base : c.ink,
            }}>
              {value}
            </div>
            <div style={{ fontSize: 11, color: c.muted }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Roster */}
      <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
        {techs.map(({ technician: tech, todayWorkOrders, currentLeave, monthStats }) => {
          const tone      = STATUS_TONE[tech.status];
          const isLeave   = tech.status === "on_leave";
          const slotsUsed = todayWorkOrders.length;
          const slotsFree = Math.max(0, tech.max_visits_per_day - slotsUsed);
          const isFull    = slotsFree === 0 && !isLeave;

          // Cert expiry within 90 days
          const expiringSoon = tech.certifications.filter((cert) => {
            const exp = tech.cert_expiry[cert];
            return exp && new Date(exp) < new Date(Date.now() + 90 * 86400_000);
          });

          const skillsLine = tech.skills ?? "";

          return (
            <Link
              key={tech.id}
              href={ROUTES.technician(tech.id)}
              style={{ textDecoration: "none", color: "inherit" }}
            >
              <div style={{
                display: "flex", alignItems: "center", gap: 14,
                background: c.panel, borderRadius: 10, padding: "12px 16px",
                border: `1px solid ${c.line}`,
                borderLeft: `3px solid ${pillar[tone].base}`,
                transition: "box-shadow 0.15s",
                opacity: tech.status === "inactive" ? 0.55 : 1,
              }}>

                <Avatar name={tech.name} tone={tone} />

                {/* Name + location + status */}
                <div style={{ minWidth: 160, flexShrink: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 13.5, color: c.ink }}>{tech.name}</div>
                  <div style={{ fontSize: 11.5, color: c.muted, marginTop: 1 }}>{tech.base_location}</div>
                </div>

                <div style={{ flexShrink: 0 }}>
                  <Pill label={TECH_STATUS_LABEL[tech.status]} tone={tone} />
                </div>

                {/* Skills — single truncated line */}
                <div style={{
                  flex: 1, fontSize: 12, color: c.muted,
                  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                  minWidth: 0,
                }}>
                  {skillsLine}
                </div>

                {/* Cert expiry warning */}
                {expiringSoon.length > 0 && (
                  <div style={{
                    flexShrink: 0,
                    fontSize: 11, color: pillar.amber.fg,
                    background: pillar.amber.bg, borderRadius: 5,
                    padding: "3px 7px", fontWeight: 500,
                  }} title={expiringSoon.join(", ")}>
                    <AlertTriangle size={11} color={pillar.amber.fg} style={{ marginRight: 4 }} /> {expiringSoon.length} cert{expiringSoon.length > 1 ? "s" : ""} expiring
                  </div>
                )}

                {/* Leave note */}
                {isLeave && currentLeave && (
                  <div style={{
                    flexShrink: 0, fontSize: 11, color: pillar.amber.fg,
                    background: pillar.amber.bg, borderRadius: 5,
                    padding: "3px 8px", fontWeight: 500,
                  }}>
                    Back {new Date(currentLeave.to_date + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                  </div>
                )}

                {/* Slot indicator */}
                {!isLeave && (
                  <div style={{
                    flexShrink: 0, textAlign: "center",
                    padding: "4px 12px", borderRadius: 8,
                    background: isFull ? pillar.red.bg : slotsFree === tech.max_visits_per_day ? pillar.green.bg : pillar.amber.bg,
                    border: `1px solid ${isFull ? pillar.red.base : slotsFree === tech.max_visits_per_day ? pillar.green.base : pillar.amber.base}`,
                  }}>
                    <div style={{
                      fontSize: 14, fontWeight: 700,
                      color: isFull ? pillar.red.fg : slotsFree === tech.max_visits_per_day ? pillar.green.fg : pillar.amber.fg,
                    }}>
                      {slotsFree}/{tech.max_visits_per_day}
                    </div>
                    <div style={{ fontSize: 9, color: c.muted, marginTop: 0 }}>free today</div>
                  </div>
                )}

                {/* Month visits summary */}
                <div style={{
                  flexShrink: 0, textAlign: "right",
                  fontSize: 11, color: c.hint, minWidth: 60,
                }}>
                  <div style={{ fontWeight: 600, color: c.muted }}>{monthStats.visits}</div>
                  <div>visits / mo</div>
                </div>

                <div style={{ color: c.hint, fontSize: 16, flexShrink: 0 }}>›</div>
              </div>
            </Link>
          );
        })}
      </div>
    </>
  );
}
