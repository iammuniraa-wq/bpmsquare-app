import Link from "next/link";
import type { ComingSoon } from "@/lib/crew/registry";
import type { TileDTO } from "@/lib/crew/viewTypes";
import { LOGOS } from "./logos";
import s from "./crew.module.css";
import When from "./When";

// One tile of the gallery (data, not a layout: adding an agent adds a registry entry, never a new component). A live tile is one link to the
// agent's page (so it holds no InfoTip: a button inside a link is invalid; the page header explains the meter); a coming-soon tile is quieter and not interactive: no link, no data, no sign-up.

const compact = (n: number): string => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));

export function AgentTile({ t }: { t: TileDTO }) {
  const Logo = LOGOS[t.logo];
  const hot = t.percent >= 80;
  return (
    <Link href={t.href} className={`${s.tile} ${s[`acc_${t.accent}`]}`} data-guide={`crew.tile.${t.key}`} aria-label={`${t.name}, ${t.status.label}`}>
      <span className={s.go} aria-hidden>→</span>
      <div className={s.tileTop}>
        <span className={s.logoWrap}><Logo size={58} /></span>
        <div className={s.tileTitle}>
          <h3 className={s.name}>{t.name}</h3>
          <p className={s.purpose}>{t.purpose}</p>
        </div>
      </div>
      <div className={s.chipRow}>
        <span className={`${s.chip} ${s[`tone_${t.status.tone}`]}`}><span className={s.dot} />{t.status.label}</span>
      </div>
      <div className={s.stats}>
        <div className={s.stat}>
          <div className={s.statLabel}>Last run</div>
          <div className={s.statValue}>{t.lastRunAt ? <When iso={t.lastRunAt} /> : "Not yet"}</div>
        </div>
        <div className={s.stat}>
          <div className={s.statLabel}>Open findings</div>
          <div className={s.statValue}>{t.openFindings}</div>
        </div>
        <div className={`${s.stat} ${s.statWide}`}>
          <div className={s.statLabel}>This month</div>
          <div className={s.statValue}>{compact(t.used)} of {compact(t.cap)} tokens</div>
          <div className={s.meter} role="progressbar" aria-valuenow={t.percent} aria-valuemin={0} aria-valuemax={100} aria-label={`${t.name} monthly allowance`}>
            <span className={`${s.meterFill} ${hot ? s.meterHot : ""}`} style={{ width: `${Math.max(2, t.percent)}%`, display: "block" }} />
          </div>
        </div>
      </div>
    </Link>
  );
}

export function SoonTile({ t }: { t: ComingSoon }) {
  const Logo = LOGOS[t.logo];
  return (
    <div className={`${s.tile} ${s.soon} ${s.acc_blue}`} aria-disabled="true" data-guide={`crew.soon.${t.key}`}>
      <div className={s.tileTop}>
        <span className={s.logoWrap}><Logo size={52} /></span>
        <div className={s.tileTitle}>
          <h3 className={s.name}>{t.name}</h3>
          <p className={s.purpose}>{t.purpose}</p>
        </div>
      </div>
      <div className={s.chipRow}><span className={s.soonBadge}>Coming soon</span></div>
    </div>
  );
}
