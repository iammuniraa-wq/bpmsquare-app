import Link from "next/link";
import { listTechnicians, TECH_STATUS_LABEL } from "@/lib/data";
import { c, pillar, type PillarKey } from "@/lib/theme";
import { CARD_SURFACE } from "@/components/ui/Card";
import StatusPill from "@/components/ui/StatusPill";
import ObjectListPage, { type ListColumn } from "@/components/page/ObjectListPage";
import { ROUTES } from "@/lib/constants";
import type { Technician } from "@/lib/types";
import { AlertTriangle } from "@/components/Icons";
import { requireWorkcenterView } from "@/lib/permissions";
import { getTenant, requireFeature } from "@/lib/tenant";
import { getTechnicianLiveStates } from "@/lib/wfm/server";
import TechnicianLiveBadge from "@/components/wfm/TechnicianLiveBadge";
import { sortRows, readSortParams, applyColFilters, parseColFilterParams, colFilterQueryParams, type SortExtractor } from "@/lib/listSort";
import { paginate } from "@/lib/paginate";

type TechRow = Awaited<ReturnType<typeof listTechnicians>>[number];

const SORT_EXTRACTORS: Record<string, SortExtractor<TechRow>> = {
  name: (r) => r.technician.name,
  location: (r) => r.technician.base_location,
  status: (r) => r.technician.status,
  visits: (r) => r.monthStats.visits,
};

const STATUS_TONE: Record<Technician["status"], PillarKey> = {
  active: "green", on_leave: "amber", inactive: "red",
};

function Avatar({ name, tone }: { name: string; tone: PillarKey }) {
  const initials = name.split(" ").map((w) => w[0]).slice(0, 2).join("");
  return (
    <div style={{
      width: 36, height: 36, borderRadius: 10, flexShrink: 0,
      background: pillar[tone].bg, color: pillar[tone].fg,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: 13, fontWeight: 700, letterSpacing: "-0.5px",
    }}>
      {initials}
    </div>
  );
}

export default async function TechniciansPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; sort?: string; dir?: string; page?: string } & Record<string, string | undefined>>;
}) {
  await requireWorkcenterView("technicians");
  await requireFeature("technicians");
  const params = await searchParams;
  const { status: statusFilter, q } = params;
  const colFilters = parseColFilterParams(params);
  const cfParams = colFilterQueryParams(colFilters);
  const { sort, dir } = readSortParams(params);
  const page = Math.max(1, Number(params.page) || 1);
  const [allTechs, tenant] = await Promise.all([listTechnicians(), getTenant()]);
  // The status filter already existed but had no control to reach it -- it
  // was only settable by hand-editing the URL. Now driven by the bar below.
  const needle = (q ?? "").trim().toLowerCase();
  let techs = allTechs.filter((t) => {
    if (statusFilter && t.technician.status !== statusFilter) return false;
    if (!needle) return true;
    const tech = t.technician;
    return (
      (tech.name ?? "").toLowerCase().includes(needle) ||
      (tech.phone ?? "").toLowerCase().includes(needle) ||
      (tech.skills ?? "").toLowerCase().includes(needle)
    );
  });
  techs = applyColFilters(techs, colFilters, SORT_EXTRACTORS);
  techs = sortRows(techs, sort, dir, SORT_EXTRACTORS);
  const pageTechs = paginate(techs, page);
  const liveStates = tenant?.features?.wfm
    ? await getTechnicianLiveStates(tenant.id, allTechs.map((t) => t.technician.id))
    : new Map();
  const activeCt   = allTechs.filter((t) => t.technician.status === "active").length;
  const onLeaveCt  = allTechs.filter((t) => t.technician.status === "on_leave").length;
  const totalSlots = techs
    .filter((t) => t.technician.status === "active")
    .reduce((s, t) => s + t.technician.max_visits_per_day, 0);
  const usedSlots  = techs
    .filter((t) => t.technician.status === "active")
    .reduce((s, t) => s + t.todayWorkOrders.length, 0);

  const columns: ListColumn<TechRow>[] = [
    {
      id: "name", label: "Technician", sortKey: "name", card: "title",
      render: ({ technician: tech }) => (
        <Link href={ROUTES.technician(tech.id)} style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none", opacity: tech.status === "inactive" ? 0.6 : 1 }}>
          <Avatar name={tech.name} tone={STATUS_TONE[tech.status]} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 13.5, color: c.ink }}>{tech.name}</div>
            {tech.skills && <div style={{ fontSize: 11.5, color: c.muted, marginTop: 1, maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 400 }}>{tech.skills}</div>}
          </div>
        </Link>
      ),
    },
    { id: "location", label: "Location", sortKey: "location", cellStyle: { color: c.muted, fontSize: 13 }, render: ({ technician: tech }) => tech.base_location ?? "—" },
    {
      id: "status", label: "Status", sortKey: "status",
      render: ({ technician: tech, currentLeave }) => {
        // Cert expiry within 90 days
        const expiringSoon = tech.certifications.filter((cert) => {
          const exp = tech.cert_expiry[cert];
          return exp && new Date(exp) < new Date(Date.now() + 90 * 86400_000);
        });
        return (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
            <StatusPill label={TECH_STATUS_LABEL[tech.status]} tone={STATUS_TONE[tech.status]} />
            <TechnicianLiveBadge state={liveStates.get(tech.id)} />
            {tech.status === "on_leave" && currentLeave && (
              <span style={{ fontSize: 11, color: pillar.amber.fg, background: pillar.amber.bg, borderRadius: 5, padding: "3px 8px", fontWeight: 500 }}>
                Back {new Date(currentLeave.to_date + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
              </span>
            )}
            {expiringSoon.length > 0 && (
              <span title={expiringSoon.join(", ")} style={{ fontSize: 11, color: pillar.amber.fg, background: pillar.amber.bg, borderRadius: 5, padding: "3px 7px", fontWeight: 500 }}>
                <AlertTriangle size={11} color={pillar.amber.fg} style={{ marginRight: 4 }} />{expiringSoon.length} cert{expiringSoon.length > 1 ? "s" : ""} expiring
              </span>
            )}
          </div>
        );
      },
    },
    {
      id: "slots", label: "Free today",
      render: ({ technician: tech, todayWorkOrders }) => {
        if (tech.status === "on_leave") return <span style={{ color: c.hint }}>—</span>;
        const slotsFree = Math.max(0, tech.max_visits_per_day - todayWorkOrders.length);
        const isFull = slotsFree === 0;
        const allFree = slotsFree === tech.max_visits_per_day;
        const t = isFull ? pillar.red : allFree ? pillar.green : pillar.amber;
        return (
          <span style={{ display: "inline-block", padding: "3px 10px", borderRadius: 8, background: t.bg, border: `1px solid ${t.base}`, color: t.fg, fontSize: 13, fontWeight: 700 }}>
            {slotsFree}/{tech.max_visits_per_day}
          </span>
        );
      },
    },
    { id: "visits", label: "Visits / mo", sortKey: "visits", cellStyle: { fontWeight: 600, color: c.muted }, render: ({ monthStats }) => monthStats.visits },
  ];

  return (
    <ObjectListPage
      title="Technicians"
      subtitle={`Field team · ${activeCt} active${onLeaveCt > 0 ? ` · ${onLeaveCt} on leave` : ""}`}
      newLabel="Technician"
      newHref={ROUTES.technicianNew}
      search={{
        value: q,
        placeholder: "Search technician, phone or skill…",
        selects: [{
          name: "status", value: statusFilter, placeholder: "All statuses",
          options: [
            { value: "active", label: "Active" },
            { value: "on_leave", label: "On leave" },
            { value: "inactive", label: "Inactive" },
          ],
        }],
        hiddenParams: { ...cfParams },
      }}
      beforeTable={
        <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
          {[
            { label: "Active today",  value: activeCt },
            { label: "On leave",      value: onLeaveCt, warn: onLeaveCt > 0 },
            { label: "Slots used",    value: `${usedSlots} / ${totalSlots}` },
            { label: "Slots free",    value: totalSlots - usedSlots, accent: true },
          ].map(({ label, value, warn, accent }) => (
            <div key={label} style={{ ...CARD_SURFACE, padding: "10px 16px", display: "flex", flexDirection: "column", gap: 2, minWidth: 110 }}>
              <div style={{ fontSize: 20, fontWeight: 700, color: warn ? pillar.amber.base : accent ? pillar.green.base : c.ink }}>{value}</div>
              <div style={{ fontSize: 11, color: c.muted }}>{label}</div>
            </div>
          ))}
        </div>
      }
      columns={columns}
      rows={pageTechs}
      rowKey={({ technician }) => technician.id}
      rowHref={({ technician }) => ROUTES.technician(technician.id)}
      total={techs.length}
      page={page}
      baseHref={ROUTES.technicians}
      sort={sort}
      dir={dir}
      linkParams={{ status: statusFilter, q, ...cfParams }}
      filtered={!!(needle || statusFilter || Object.keys(cfParams).length > 0)}
      empty={{
        title: "No technicians yet",
        text: "Add the field technicians on your team, then assign visits to them.",
        filteredTitle: "No technicians match these filters.",
      }}
    />
  );
}
