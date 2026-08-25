"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { c } from "@/lib/theme";
import { ROUTES } from "@/lib/constants";
import { matchMethodTemplate, humanizeArea, type MethodTemplate } from "@/lib/pricing/wizard";
import RateSnapshotView, { type SnapshotRule } from "../RateSnapshotView";

type VersionRow = { version: number; status: "DRAFT" | "PUBLISHED" | "SUPERSEDED"; published_at: string | null };
type Snapshot = {
  version: { published_at: string | null } | null;
  procedures: { code: string; entry_mode: string }[];
  rules: SnapshotRule[];
};

type State =
  | { kind: "loading" }
  | { kind: "empty" }
  | { kind: "unrecognized" }
  | { kind: "ready"; template: MethodTemplate; rules: SnapshotRule[]; publishedAt: string | null };

function formatDate(iso: string | null): string {
  if (!iso) return "recently";
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

export default function TodaysRatesClient() {
  const searchParams = useSearchParams();
  const area = searchParams.get("area") || "default";
  const setupHref = area === "default" ? ROUTES.pricingSetup : `${ROUTES.pricingSetup}?area=${encodeURIComponent(area)}`;
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    setState({ kind: "loading" });
    (async () => {
      try {
        const listRes = await fetch(`/api/settings/pricing-engine/versions?area=${encodeURIComponent(area)}`);
        const list = await listRes.json();
        const versions: VersionRow[] = list.versions ?? [];
        const published = versions.find((v) => v.status === "PUBLISHED");
        if (!published) { setState({ kind: "empty" }); return; }

        const snapRes = await fetch(`/api/settings/pricing-engine/versions/${published.version}?area=${encodeURIComponent(area)}`);
        const snap: Snapshot = await snapRes.json();
        const template = matchMethodTemplate(snap.procedures);
        if (!template) { setState({ kind: "unrecognized" }); return; }
        setState({ kind: "ready", template, rules: snap.rules, publishedAt: snap.version?.published_at ?? null });
      } catch {
        setState({ kind: "empty" });
      }
    })();
  }, [area]);

  if (state.kind === "loading") {
    return <div style={{ padding: 24, color: c.muted, fontSize: 13 }}>Loading…</div>;
  }

  if (state.kind === "empty") {
    return (
      <div style={{ padding: 24, borderRadius: 10, border: `1px solid ${c.line}`, background: c.panel, textAlign: "center" }}>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>No pricing is live yet</div>
        <div style={{ fontSize: 12.5, color: c.muted, marginBottom: 14 }}>
          Set up {area === "default" ? "your pricing" : `the "${humanizeArea(area)}" Price Book`} to see it here.
        </div>
        <Link
          href={setupHref}
          style={{ display: "inline-block", padding: "8px 16px", fontSize: 13, fontWeight: 700, borderRadius: 6, background: c.accent, color: "#fff", textDecoration: "none" }}
        >
          Set up pricing
        </Link>
      </div>
    );
  }

  if (state.kind === "unrecognized") {
    return (
      <div style={{ padding: 20, borderRadius: 10, border: `1px solid ${c.line}`, background: c.panel, fontSize: 13, color: c.muted }}>
        Your live pricing was set up in{" "}
        <Link href={ROUTES.pricingAdvanced} style={{ color: c.accent }}>Advanced</Link> — see the full configuration there.
      </div>
    );
  }

  const { template, rules, publishedAt } = state;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700 }}>{template.label}</div>
          <div style={{ fontSize: 12.5, color: c.muted }}>{template.tagline}</div>
        </div>
        <div style={{ fontSize: 12, color: c.muted }}>Live since {formatDate(publishedAt)}</div>
      </div>

      <RateSnapshotView template={template} rules={rules} />

      <div style={{ marginTop: 16 }}>
        <Link href={setupHref} style={{ fontSize: 12.5, color: c.accent, textDecoration: "none" }}>
          Make changes →
        </Link>
      </div>
    </div>
  );
}
