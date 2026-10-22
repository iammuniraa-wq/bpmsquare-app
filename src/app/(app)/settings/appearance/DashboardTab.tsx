"use client";

import InfoTip from "@/components/ui/InfoTip";
import { Input } from "@/components/ui/Input";
import { Toggle } from "@/components/settings/generalShared";
import { DEFAULT_NEWS_TOPICS_LABEL } from "@/lib/constants";
import { SETTINGS_TIPS } from "@/lib/settingsTips";
import type { AppearanceDraft, DashboardMode } from "./appearanceLogic";
import s from "./appearance.module.css";

const MODES: { value: DashboardMode; label: string }[] = [
  { value: "curated", label: "Curated" },
  { value: "adaptive", label: "My layout" },
];

/** Which dashboard opens, and the two content blocks that give a workspace with no data something to show. */
export default function DashboardTab({ draft, accent, onChange }: {
  draft: AppearanceDraft;
  accent: string;
  onChange: (patch: Partial<AppearanceDraft>) => void;
}) {
  return (
    <div className={s.card}>
      <div>
        <div className={s.label}><span className="bpm-t-label">Opens on</span><InfoTip label="Opens on">{SETTINGS_TIPS.dashboard}</InfoTip></div>
        <div className={s.chips}>
          {MODES.map((m) => (
            <button key={m.value} type="button" className={s.chip} aria-pressed={draft.dashboardMode === m.value} onClick={() => onChange({ dashboardMode: m.value })}>{m.label}</button>
          ))}
        </div>
      </div>
      <div className={s.switchRow}>
        <span className={s.name}>Business news<InfoTip label="Business news">{SETTINGS_TIPS.businessNews}</InfoTip></span>
        <Toggle on={draft.news} onChange={(v) => onChange({ news: v })} accent={accent} label="Business news" />
      </div>
      {draft.news && (
        <div>
          <label className="bpm-t-label" htmlFor="dash-topics" style={{ display: "block", marginBottom: 6 }}>Topics, up to 4</label>
          <Input id="dash-topics" value={draft.topics} onChange={(e) => onChange({ topics: e.target.value })} placeholder={DEFAULT_NEWS_TOPICS_LABEL} />
        </div>
      )}
      <div className={s.switchRow}>
        <span className={s.name}>Tips and shortcuts<InfoTip label="Tips and shortcuts">{SETTINGS_TIPS.productTips}</InfoTip></span>
        <Toggle on={draft.tips} onChange={(v) => onChange({ tips: v })} accent={accent} label="Tips and shortcuts" />
      </div>
    </div>
  );
}
