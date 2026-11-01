import Link from "next/link";
import InfoTip from "@/components/ui/InfoTip";

export type TabDef = {
  id: string;
  label: string;
  count?: number;
  /** State mode only: the tab is shown but cannot be chosen, and the arrow keys skip it. Give `info` to say why. */
  disabled?: boolean;
  /** An explanation behind an "i" after the tab. Used beside a disabled tab, where the reason must not vanish. */
  info?: React.ReactNode;
  /** data-guide id for the assistant's guide mode; defaults to tab:<id>. */
  guide?: string;
};

type Props = {
  tabs: TabDef[];
  value: string;
  /** State mode: the caller keeps the active id (client components). */
  onChange?: (id: string) => void;
  /** URL mode: each tab is a link, so the active tab survives a refresh and can be shared. */
  hrefFor?: (id: string) => string;
  label?: string;
};

/**
 * Underline tab strip. Scrolls sideways on a phone instead of wrapping.
 * In state mode the arrow keys move the selection (roving tabindex); in URL
 * mode every tab is an ordinary link and stays in the tab order.
 */
export default function Tabs({ tabs, value, onChange, hrefFor, label = "Sections" }: Props) {
  return (
    <div role="tablist" aria-label={label} className="bpm-tabs">
      {tabs.map((t) => {
        const selected = t.id === value;
        const body = (
          <>
            {t.label}
            {typeof t.count === "number" && t.count > 0 && <span className="bpm-tab-count">{t.count}</span>}
          </>
        );
        if (hrefFor) {
          return (
            <Link key={t.id} role="tab" data-guide={`tab:${t.id}`} aria-selected={selected} href={hrefFor(t.id)} scroll={false} replace className="bpm-tab">
              {body}
            </Link>
          );
        }
        const tab = (
          <button
            key={t.id}
            type="button"
            role="tab"
            data-guide={t.guide ?? `tab:${t.id}`}
            aria-selected={selected}
            disabled={t.disabled}
            tabIndex={selected ? 0 : -1}
            className="bpm-tab"
            onClick={() => onChange?.(t.id)}
            onKeyDown={(e) => {
              if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
              e.preventDefault();
              const live = tabs.filter((x) => !x.disabled);
              if (live.length === 0) return;
              const i = live.findIndex((x) => x.id === t.id);
              const next = live[(i + (e.key === "ArrowRight" ? 1 : -1) + live.length) % live.length];
              onChange?.(next.id);
              const strip = e.currentTarget.parentElement;
              requestAnimationFrame(() => {
                strip?.querySelectorAll<HTMLElement>('[role="tab"]')[tabs.indexOf(next)]?.focus();
              });
            }}
          >
            {body}
          </button>
        );
        if (!t.info) return tab;
        return (
          <span key={t.id} role="presentation" className="bpm-tab-with-info">
            {tab}
            <InfoTip label={t.label}>{t.info}</InfoTip>
          </span>
        );
      })}
    </div>
  );
}
