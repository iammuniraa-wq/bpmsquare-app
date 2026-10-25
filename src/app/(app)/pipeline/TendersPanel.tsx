"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { c } from "@/lib/theme";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import SettingsSection from "@/components/settings/SettingsSection";
import ClosingChip from "@/components/tender/ClosingChip";
import { ROUTES, type OpportunityStageDef } from "@/lib/constants";
import { TENDER_CLOSING_SOON_DAYS, TENDER_CLOSING_SOON_SHOWN, closingSoon, tenderIsLive } from "@/lib/tender/rules";
import { TENDER_TIPS } from "@/lib/tender/tips";
import type { TenderBoardRow } from "@/lib/tender/views";
import PipelineBoard from "./PipelineBoard";

type Member = { user_id: string; name: string | null; email: string | null };

/** "3 new in Room": shown only when there is something unread. */
function RoomBadge({ n }: { n?: number }) {
  if (!n || n <= 0) return null;
  return (
    <span data-guide="tender.room_unread" style={{ fontSize: 10.5, fontWeight: 700, padding: "1px 7px", borderRadius: 999, background: "var(--tenant-accent, #378ADD)", color: "#fff", whiteSpace: "nowrap" }}>
      {n} new in Room
    </span>
  );
}

/** The tender number and issuer a row adds beyond its title (a derived title already says both). */
const extra = (title: string, parts: (string | null | undefined)[]) => parts.filter((p): p is string => !!p && !title.includes(p)).join(" · ");

/**
 * The Tenders tab: a "Closing soon" list (open tenders closing within 14 days, overdue ones first) above the same board as
 * Deals, drawn with the tender stages. Cards carry the tender number and a closing-date chip. The board, its drag-to-move and
 * its close dialog are the Deals board's own; only the stage list and the card extra differ.
 */
export default function TendersPanel({ rows, stages, pending, members, accounts, todayKey, currentUserId, nowIso, timezone }: {
  rows: TenderBoardRow[];
  stages: OpportunityStageDef[];
  /** Migration 0220 has not been applied to this database. */
  pending: boolean;
  members: Member[];
  accounts: { id: string; name: string }[];
  todayKey: string;
  currentUserId: string;
  nowIso: string;
  timezone: string;
}) {
  const [all, setAll] = useState(false);
  const byId = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);
  const soon = useMemo(() => closingSoon(rows, new Date(nowIso), timezone), [rows, nowIso, timezone]);
  const shown = all ? soon : soon.slice(0, TENDER_CLOSING_SOON_SHOWN);

  if (pending) {
    return (
      <Card padding={18}>
        <div role="alert" style={{ fontSize: 13, color: "var(--amberink)" }} data-guide="tender.pending">
          Tender deals need a database update (migration 0220). Ask your administrator to apply it, then reload this page.
        </div>
      </Card>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <SettingsSection
        id="tender.closing_soon"
        title="Closing soon"
        info={TENDER_TIPS.closingSoon}
        summary={soon.length === 0 ? `Nothing closes in the next ${TENDER_CLOSING_SOON_DAYS} days` : `${soon.length} tender${soon.length === 1 ? "" : "s"} within ${TENDER_CLOSING_SOON_DAYS} days`}
        defaultOpen
      >
        <div data-guide="tender.closing_soon">
          {soon.length === 0 ? (
            <div style={{ fontSize: 12.5, color: c.hint }}>Nothing closes in the next {TENDER_CLOSING_SOON_DAYS} days.</div>
          ) : (
            <div style={{ border: `1px solid ${c.line}`, borderRadius: 8, overflow: "hidden" }}>
              {shown.map((r, i) => (
                <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderTop: i === 0 ? "none" : `1px solid ${c.line}`, flexWrap: "wrap", minHeight: 44 }}>
                  <Link href={ROUTES.pipelineDetail(r.id)} style={{ color: c.ink, fontWeight: 600, textDecoration: "none", fontSize: 13, flex: "1 1 200px", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.title}</Link>
                  {extra(r.title, [r.tender.tender_no, r.tender.issuer_name ?? r.account_name]) && (
                    <span style={{ fontSize: 11.5, color: c.hint }}>{extra(r.title, [r.tender.tender_no, r.tender.issuer_name ?? r.account_name])}</span>
                  )}
                  <ClosingChip closingAt={r.tender.closing_at} nowIso={nowIso} timezone={timezone} size="sm" />
                  <RoomBadge n={r.tender.room_unread} />
                </div>
              ))}
            </div>
          )}
          {soon.length > TENDER_CLOSING_SOON_SHOWN && (
            <div style={{ marginTop: 8 }}>
              <Button size="sm" variant="quiet" onClick={() => setAll((v) => !v)}>{all ? "Show fewer" : `Show all ${soon.length}`}</Button>
            </div>
          )}
        </div>
      </SettingsSection>

      <PipelineBoard
        rows={rows} stages={stages} members={members} accounts={accounts} todayKey={todayKey} currentUserId={currentUserId}
        cardExtra={(r) => {
          const t = byId.get(r.id)?.tender;
          if (!t) return null;
          const live = tenderIsLive(r, t);
          return (
            <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <ClosingChip closingAt={t.closing_at} nowIso={nowIso} timezone={timezone} size="sm" closed={!live} />
              {t.tender_no && !r.title.includes(t.tender_no) && <span style={{ fontSize: 10.5, color: c.hint }}>{t.tender_no}</span>}
              <RoomBadge n={t.room_unread} />
            </div>
          );
        }}
      />
    </div>
  );
}
