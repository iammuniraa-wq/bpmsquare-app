"use client";

import { useState } from "react";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import { Select } from "@/components/ui/Input";
import { ERP_EXPORT_PROFILES, DEFAULT_ERP_PROFILE } from "@/lib/estimator/exports";

/** BOM and WBS downloads with the ERP layout choice. Internal: the files carry costs. */
export default function ExportBar({ estimateId }: { estimateId: string }) {
  const [profile, setProfile] = useState(DEFAULT_ERP_PROFILE);
  const [scope, setScope] = useState<"items" | "all">("items");
  const p = ERP_EXPORT_PROFILES[profile];
  const href = (format: "bom" | "wbs", type: "csv" | "xlsx") =>
    `/api/estimates/${estimateId}/export?format=${format}&type=${type}&profile=${profile}${format === "bom" ? `&include=${scope}` : ""}`;

  return (
    <Card title="Export" padding={16} style={{ scrollMarginTop: 80 }}>
      <div id="export" className="fg2">
        <Field label="ERP layout" hint={p?.note}>
          <Select value={profile} onChange={(e) => setProfile(e.target.value)}>
            {Object.values(ERP_EXPORT_PROFILES).map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
          </Select>
        </Field>
        <Field label="BOM lists" hint="Physical items only, or every line including labour, transport and overhead.">
          <Select value={scope} onChange={(e) => setScope(e.target.value as "items" | "all")}>
            <option value="items">Items only</option>
            <option value="all">All lines</option>
          </Select>
        </Field>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Button href={href("bom", "xlsx")} variant="secondary" size="sm">BOM (Excel)</Button>
        <Button href={href("bom", "csv")} variant="secondary" size="sm">BOM (CSV)</Button>
        <Button href={href("wbs", "xlsx")} variant="secondary" size="sm">WBS (Excel)</Button>
        <Button href={href("wbs", "csv")} variant="secondary" size="sm">WBS (CSV)</Button>
      </div>
      <div className="bpm-t-help" style={{ marginTop: 8 }}>These files include unit costs. Keep them internal.</div>
    </Card>
  );
}
