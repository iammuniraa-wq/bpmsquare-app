"use client";

import Link from "next/link";
import { c } from "@/lib/theme";
import Button from "@/components/ui/Button";
import InfoTip from "@/components/ui/InfoTip";
import { ROUTES } from "@/lib/constants";
import { PROJECT_TIPS } from "@/lib/contractProjects/tips";

export type ContractProjectInfo = { existing: { id: string; ref: string | null } | null; canCreate: boolean };

/**
 * On an awarded tender: the way into its contract project. One project per tender, so once it exists this is a link to it.
 * The create call is the deal page's own (it also feeds the "..." menu); this strip only asks for it.
 */
export default function ContractProjectBanner({ info, busy, onCreate }: { info: ContractProjectInfo; busy: boolean; onCreate: () => void }) {
  if (!info.existing && !info.canCreate) return null;
  return (
    <div data-guide="cp.banner" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", margin: "0 0 12px", padding: "10px 14px", border: `1px solid ${c.line}`, borderRadius: 10, background: c.accentbg }}>
      <span style={{ fontSize: 13.5, color: c.ink, fontWeight: 600 }}>Contract project</span>
      {info.existing ? (
        <Link href={ROUTES.contractProject(info.existing.id)} data-guide="cp.banner.open" style={{ color: c.accent, fontSize: 13.5, display: "inline-flex", alignItems: "center", minHeight: 44 }}>{info.existing.ref ?? "Open the project"}</Link>
      ) : (
        <>
          <Button variant="primary" loading={busy} data-guide="cp.banner.create" style={{ minHeight: 44 }} onClick={onCreate}>Create contract project</Button>
          <InfoTip label="Create contract project">{PROJECT_TIPS.fromTender}</InfoTip>
        </>
      )}
    </div>
  );
}
