"use client";

import Link from "next/link";
import { c, pillar, type PillarKey } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import { ROUTES } from "@/lib/constants";
import type { Asset } from "@/lib/types";
import { Zap, Gear, Droplet, Battery, Monitor, Activity } from "@/components/Icons";

function KindIcon({ kind, size = 22, color }: { kind: string; size?: number; color?: string }) {
  const p = { size, color: color ?? "currentColor" };
  switch (kind) {
    case "motor":       return <Zap {...p} />;
    case "transformer": return <Gear {...p} />;
    case "pump":        return <Droplet {...p} />;
    case "generator":   return <Battery {...p} />;
    case "panel":       return <Monitor {...p} />;
    default:            return <Activity {...p} />;
  }
}

type Props = {
  asset: Asset;
  account: { id: string; name: string } | null;
  casesCount: number;
  openCasesCount: number;
};

// Static header shell: name/kind/spec summary alongside primary actions.
// Editing the asset's own field values happens inline in the Details card
// below (ObjectSections), not here — see AccountHeader for the same rule.
export default function AssetHeaderCard({ asset, account, casesCount, openCasesCount }: Props) {
  return (
    <div style={{ ...cardStyle, marginBottom: 14 }}>
      <div style={{ marginBottom: 10 }}>
        <Link href={ROUTES.assets} style={{ fontSize: 12, color: c.muted, textDecoration: "none" }}>
          ← All assets
        </Link>
        {account && (
          <>
            <span style={{ fontSize: 12, color: c.hint, margin: "0 6px" }}>/</span>
            <Link href={ROUTES.account(account.id)} style={{ fontSize: 12, color: c.accent, textDecoration: "none" }}>
              {account.name}
            </Link>
          </>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
        <div style={{
          width: 52, height: 52, borderRadius: 12, flexShrink: 0,
          background: pillar.green.bg, color: pillar.green.fg,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <KindIcon kind={asset.kind} size={24} color={pillar.green.fg} />
        </div>
        <div style={{ flex: 1 }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 4px", color: c.ink }}>{asset.name}</h1>
          <div style={{ fontSize: 12.5, color: c.muted, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <span style={{ textTransform: "capitalize" }}>{asset.kind}</span>
            {asset.make  && <span>· {asset.make}</span>}
            {asset.model && <span>· {asset.model}</span>}
          </div>
        </div>

        {/* Primary actions — always visible, top of card */}
        <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
          {account && (
            <Link href={`${ROUTES.caseNew}?account_id=${account.id}`}
              style={{ fontSize: 12, fontWeight: 600, color: "#fff", background: c.accent, borderRadius: 7, padding: "7px 14px", textDecoration: "none", flexShrink: 0 }}>
              + New case
            </Link>
          )}
        </div>
      </div>

      {/* Spec grid */}
      <div style={{
        marginTop: 14, paddingTop: 12, borderTop: `1px solid ${c.line}`,
        display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 10,
      }}>
        {asset.serial && (
          <div>
            <div style={{ fontSize: 10, color: c.hint, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 }}>Serial no.</div>
            <div style={{ fontSize: 12.5, fontFamily: "monospace", fontWeight: 600, color: c.ink }}>{asset.serial}</div>
          </div>
        )}
        {asset.rating && (
          <div>
            <div style={{ fontSize: 10, color: c.hint, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 }}>Rating / specs</div>
            <div style={{ fontSize: 12.5, color: c.ink }}>{asset.rating}</div>
          </div>
        )}
        {account && (
          <div>
            <div style={{ fontSize: 10, color: c.hint, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 }}>Account</div>
            <Link href={ROUTES.account(account.id)} style={{ fontSize: 12.5, color: c.accent, fontWeight: 600, textDecoration: "none" }}>
              {account.name}
            </Link>
          </div>
        )}
        <div>
          <div style={{ fontSize: 10, color: c.hint, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 }}>Service history</div>
          <div style={{ fontSize: 12.5, color: c.ink }}>
            <strong>{casesCount}</strong> cases
            {openCasesCount > 0 && <span style={{ color: c.accent }}> · {openCasesCount} open</span>}
          </div>
        </div>
      </div>

      {asset.notes && (
        <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid ${c.line}`, fontSize: 12.5, color: c.muted, fontStyle: "italic" }}>
          {asset.notes}
        </div>
      )}
    </div>
  );
}
